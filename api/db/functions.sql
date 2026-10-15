-- Data-tier logic that belongs next to the data: ingest, rollups, phase statistics, episodes, reports.

-- ------------------------------------------------------------ time shards
-- Creates the monthly partition of raw_sample for the month containing p_ts (if missing),
-- with a BRIN index: tiny, and ideal for append-mostly, time-ordered data.
CREATE OR REPLACE FUNCTION ensure_raw_partition(p_ts timestamptz) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  m_start timestamptz := date_trunc('month', p_ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  m_end   timestamptz := m_start + interval '1 month';
  part    text := format('raw_sample_%s', to_char(m_start AT TIME ZONE 'UTC', 'YYYY_MM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF raw_sample FOR VALUES FROM (%L) TO (%L)', part, m_start, m_end);
    EXECUTE format('CREATE INDEX %I ON %I USING brin (ts)', part || '_brin_ts', part);
  END IF;
  RETURN part;
END $$;

-- ------------------------------------------------------------ ingest
-- Writes a batch of raw samples for one session and folds them into agg_minute in the SAME statement.
-- Idempotent: re-sending a batch inserts nothing new (ON CONFLICT DO NOTHING) and, because the
-- aggregation reads only the rows actually inserted (RETURNING), the minute buckets are not double-counted.
-- Touched hours and days are queued in agg_dirty for rollup_dirty().
CREATE OR REPLACE FUNCTION ingest_samples(
  p_session int, p_channel smallint[], p_ts timestamptz[], p_value real[], p_quality smallint[]
) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  inserted int;
BEGIN
  WITH ins AS (
    INSERT INTO raw_sample (session_id, channel_id, ts, value, quality)
    SELECT p_session, u.c, u.t, u.v, u.q
    FROM unnest(p_channel, p_ts, p_value, p_quality) AS u(c, t, v, q)
    ON CONFLICT DO NOTHING
    RETURNING channel_id, ts, value, quality
  ),
  b AS (
    SELECT i.channel_id,
           date_bin('1 minute', i.ts, timestamptz '2000-01-01 00:00+00')            AS bucket,
           count(*) FILTER (WHERE i.quality = 0)                                    AS n_valid,
           count(*) FILTER (WHERE i.quality <> 0)                                   AS n_bad,
           coalesce(sum(i.value) FILTER (WHERE i.quality = 0), 0)                   AS sum,
           coalesce(sum(i.value::float8 * i.value) FILTER (WHERE i.quality = 0), 0) AS sum_sq,
           min(i.value) FILTER (WHERE i.quality = 0)                                AS min,
           (array_agg(i.ts ORDER BY i.value, i.ts) FILTER (WHERE i.quality = 0))[1] AS t_min,
           max(i.value) FILTER (WHERE i.quality = 0)                                AS max,
           (array_agg(i.ts ORDER BY i.value DESC, i.ts) FILTER (WHERE i.quality = 0))[1] AS t_max,
           (array_agg(i.value ORDER BY i.ts) FILTER (WHERE i.quality = 0))[1]       AS first_val,
           min(i.ts) FILTER (WHERE i.quality = 0)                                   AS first_ts,
           (array_agg(i.value ORDER BY i.ts DESC) FILTER (WHERE i.quality = 0))[1]  AS last_val,
           max(i.ts) FILTER (WHERE i.quality = 0)                                   AS last_ts,
           count(*) FILTER (WHERE i.quality = 0 AND i.value < c.low_limit)  / c.sample_rate_hz AS sec_below,
           count(*) FILTER (WHERE i.quality = 0 AND i.value > c.high_limit) / c.sample_rate_hz AS sec_above
    FROM ins i
    JOIN channel c ON c.id = i.channel_id
    GROUP BY i.channel_id, 2, c.sample_rate_hz
  ),
  up AS (
    INSERT INTO agg_minute AS a
      (session_id, channel_id, bucket, n_valid, n_bad, sum, sum_sq, min, t_min, max, t_max,
       first_val, first_ts, last_val, last_ts, sec_below, sec_above)
    SELECT p_session, channel_id, bucket, n_valid, n_bad, sum, sum_sq, min, t_min, max, t_max,
           first_val, first_ts, last_val, last_ts, sec_below, sec_above
    FROM b
    ON CONFLICT (session_id, channel_id, bucket) DO UPDATE SET   -- a minute split across two batches
      n_valid   = a.n_valid + EXCLUDED.n_valid,
      n_bad     = a.n_bad   + EXCLUDED.n_bad,
      sum       = a.sum     + EXCLUDED.sum,
      sum_sq    = a.sum_sq  + EXCLUDED.sum_sq,
      t_min     = CASE WHEN a.min IS NULL OR EXCLUDED.min < a.min THEN EXCLUDED.t_min ELSE a.t_min END,
      min       = LEAST(a.min, EXCLUDED.min),                    -- LEAST/GREATEST ignore NULLs
      t_max     = CASE WHEN a.max IS NULL OR EXCLUDED.max > a.max THEN EXCLUDED.t_max ELSE a.t_max END,
      max       = GREATEST(a.max, EXCLUDED.max),
      first_val = CASE WHEN a.first_ts IS NULL OR EXCLUDED.first_ts < a.first_ts THEN EXCLUDED.first_val ELSE a.first_val END,
      first_ts  = LEAST(a.first_ts, EXCLUDED.first_ts),
      last_val  = CASE WHEN a.last_ts IS NULL OR EXCLUDED.last_ts > a.last_ts THEN EXCLUDED.last_val ELSE a.last_val END,
      last_ts   = GREATEST(a.last_ts, EXCLUDED.last_ts),
      sec_below = a.sec_below + EXCLUDED.sec_below,
      sec_above = a.sec_above + EXCLUDED.sec_above
    RETURNING channel_id, bucket
  ),
  dirty AS (
    INSERT INTO agg_dirty (grain, session_id, channel_id, bucket)
    SELECT DISTINCT g.grain, p_session, up.channel_id,
           date_bin(g.width, up.bucket, timestamptz '2000-01-01 00:00+00')
    FROM up
    CROSS JOIN (VALUES ('hour', interval '1 hour'), ('day', interval '1 day')) AS g(grain, width)
    ON CONFLICT DO NOTHING
  )
  SELECT count(*) INTO inserted FROM ins;
  RETURN inserted;
END $$;

-- ------------------------------------------------------------ rollups
-- Recomputes each dirty bucket of p_dst from its children in p_src (never from raw_sample).
CREATE OR REPLACE FUNCTION rollup_grain(p_grain text, p_src regclass, p_dst regclass, p_width interval)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format($sql$
    WITH d AS (
      DELETE FROM agg_dirty WHERE grain = %L RETURNING session_id, channel_id, bucket
    ),
    r AS (
      SELECT d.session_id, d.channel_id, d.bucket,
             sum(s.n_valid)::int AS n_valid, sum(s.n_bad)::int AS n_bad,
             sum(s.sum) AS sum, sum(s.sum_sq) AS sum_sq,
             min(s.min) AS min, (array_agg(s.t_min ORDER BY s.min, s.t_min) FILTER (WHERE s.min IS NOT NULL))[1] AS t_min,
             max(s.max) AS max, (array_agg(s.t_max ORDER BY s.max DESC, s.t_max) FILTER (WHERE s.max IS NOT NULL))[1] AS t_max,
             (array_agg(s.first_val ORDER BY s.first_ts) FILTER (WHERE s.first_ts IS NOT NULL))[1] AS first_val,
             min(s.first_ts) AS first_ts,
             (array_agg(s.last_val ORDER BY s.last_ts DESC) FILTER (WHERE s.last_ts IS NOT NULL))[1] AS last_val,
             max(s.last_ts) AS last_ts,
             sum(s.sec_below) AS sec_below, sum(s.sec_above) AS sec_above
      FROM d
      JOIN %s s ON s.session_id = d.session_id AND s.channel_id = d.channel_id
               AND s.bucket >= d.bucket AND s.bucket < d.bucket + %L::interval
      GROUP BY d.session_id, d.channel_id, d.bucket
    )
    INSERT INTO %s AS t SELECT session_id, channel_id, bucket, n_valid, n_bad, sum, sum_sq, min, t_min, max, t_max,
                               first_val, first_ts, last_val, last_ts, sec_below, sec_above FROM r
    ON CONFLICT (session_id, channel_id, bucket) DO UPDATE SET
      (n_valid, n_bad, sum, sum_sq, min, t_min, max, t_max, first_val, first_ts, last_val, last_ts, sec_below, sec_above) =
      (EXCLUDED.n_valid, EXCLUDED.n_bad, EXCLUDED.sum, EXCLUDED.sum_sq, EXCLUDED.min, EXCLUDED.t_min, EXCLUDED.max, EXCLUDED.t_max,
       EXCLUDED.first_val, EXCLUDED.first_ts, EXCLUDED.last_val, EXCLUDED.last_ts, EXCLUDED.sec_below, EXCLUDED.sec_above)
  $sql$, p_grain, p_src, p_width, p_dst);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Drains the dirty queue: hours from minutes, then days from hours. Safe to run any time, any number of times.
CREATE OR REPLACE FUNCTION rollup_dirty(OUT hours int, OUT days int)
LANGUAGE plpgsql AS $$
BEGIN
  hours := rollup_grain('hour', 'agg_minute', 'agg_hour', interval '1 hour');
  days  := rollup_grain('day',  'agg_hour',   'agg_day',  interval '1 day');
END $$;

-- ------------------------------------------------------------ case phases
-- Phase windows cut from the case milestones. Shared by the phase aggregates, episodes and reports.
CREATE OR REPLACE FUNCTION case_phases(p_case int)
RETURNS TABLE (phase text, t_start timestamptz, t_end timestamptz)
LANGUAGE sql STABLE AS $$
  WITH e AS (
    SELECT max(ts) FILTER (WHERE event_type = 'cpb_on')       AS cpb_on,
           max(ts) FILTER (WHERE event_type = 'cpb_off')      AS cpb_off,
           max(ts) FILTER (WHERE event_type = 'xclamp_on')    AS xclamp_on,
           max(ts) FILTER (WHERE event_type = 'xclamp_off')   AS xclamp_off,
           max(ts) FILTER (WHERE event_type = 'rewarm_start') AS rewarm,
           max(ts) FILTER (WHERE event_type = 'in_room')      AS in_room,
           max(ts) FILTER (WHERE event_type = 'out_of_room')  AS out_room
    FROM case_event WHERE case_id = p_case
  ),
  s AS (SELECT min(started_at) AS s0, max(ended_at) AS s1 FROM recording_session WHERE case_id = p_case)
  SELECT v.phase, v.t0, v.t1
  FROM e, s,
       LATERAL (VALUES ('pre_cpb',     coalesce(s.s0, e.in_room), e.cpb_on),
                       ('cpb',         e.cpb_on,     e.cpb_off),
                       -- bypass minus initiation and weaning, when flow ramps by design; quality metrics use this
                       ('full_flow',   e.cpb_on + interval '2 minutes', e.cpb_off - interval '3 minutes'),
                       ('cross_clamp', e.xclamp_on,  e.xclamp_off),
                       ('rewarm',      e.rewarm,     e.cpb_off),
                       ('post_cpb',    e.cpb_off,    coalesce(s.s1, e.out_room))) AS v(phase, t0, t1)
  WHERE v.t0 IS NOT NULL AND v.t1 > v.t0
$$;

-- Per-phase statistics, including exact percentiles (which cannot be merged from the minute buckets,
-- so they are computed once from raw, per case, after capture ends).
CREATE OR REPLACE FUNCTION refresh_case_phase(p_case int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM agg_case_phase WHERE case_id = p_case;
  INSERT INTO agg_case_phase
    (case_id, phase, channel_id, t_start, t_end, n_valid, n_bad, avg, min, t_min, max, t_max,
     p10, p50, p90, sec_below, sec_above)
  SELECT p_case, ph.phase, r.channel_id, ph.t_start, ph.t_end,
         count(*) FILTER (WHERE r.quality = 0),
         count(*) FILTER (WHERE r.quality <> 0),
         avg(r.value) FILTER (WHERE r.quality = 0),
         min(r.value) FILTER (WHERE r.quality = 0),
         (array_agg(r.ts ORDER BY r.value, r.ts) FILTER (WHERE r.quality = 0))[1],
         max(r.value) FILTER (WHERE r.quality = 0),
         (array_agg(r.ts ORDER BY r.value DESC, r.ts) FILTER (WHERE r.quality = 0))[1],
         percentile_cont(0.1) WITHIN GROUP (ORDER BY r.value) FILTER (WHERE r.quality = 0),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY r.value) FILTER (WHERE r.quality = 0),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY r.value) FILTER (WHERE r.quality = 0),
         count(*) FILTER (WHERE r.quality = 0 AND r.value < c.low_limit)  / c.sample_rate_hz,
         count(*) FILTER (WHERE r.quality = 0 AND r.value > c.high_limit) / c.sample_rate_hz
  FROM case_phases(p_case) ph
  JOIN recording_session rs ON rs.case_id = p_case
  JOIN raw_sample r ON r.session_id = rs.id AND r.ts >= ph.t_start AND r.ts < ph.t_end
  JOIN channel c ON c.id = r.channel_id
  GROUP BY ph.phase, ph.t_start, ph.t_end, r.channel_id, c.sample_rate_hz;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ------------------------------------------------------------ episodes (gaps and islands)
-- Continuous runs where a channel stayed below (or above) a limit for at least p_min_seconds.
-- Classic islands trick: for consecutive qualifying samples, (sample index - row_number) is constant,
-- so it labels each run. A non-valid sample breaks a run (we can't vouch for it).
CREATE OR REPLACE FUNCTION threshold_episodes(
  p_case int, p_channel text, p_direction text DEFAULT 'below', p_limit real DEFAULT NULL,
  p_min_seconds int DEFAULT 10, p_phase text DEFAULT 'full_flow'
) RETURNS TABLE (t_start timestamptz, t_end timestamptz, seconds int, extreme real)
LANGUAGE sql STABLE AS $$
  WITH w AS (SELECT t_start, t_end FROM case_phases(p_case) WHERE phase = p_phase),
  c AS (
    SELECT id, sample_rate_hz,
           coalesce(p_limit, CASE WHEN p_direction = 'below' THEN low_limit ELSE high_limit END) AS lim
    FROM channel WHERE code = p_channel
  ),
  s AS (
    SELECT r.ts, r.value, r.quality,
           round(extract(epoch FROM r.ts) * c.sample_rate_hz)::bigint AS idx,
           c.lim, c.sample_rate_hz
    FROM recording_session rs
    JOIN raw_sample r ON r.session_id = rs.id
    JOIN c ON c.id = r.channel_id
    JOIN w ON r.ts >= w.t_start AND r.ts < w.t_end
    WHERE rs.case_id = p_case
  ),
  hit AS (
    SELECT s.*, idx - row_number() OVER (ORDER BY ts) AS island
    FROM s
    WHERE quality = 0 AND CASE WHEN p_direction = 'below' THEN value < lim ELSE value > lim END
  )
  SELECT min(ts), max(ts),
         round(count(*) / max(sample_rate_hz))::int,
         CASE WHEN p_direction = 'below' THEN min(value) ELSE max(value) END
  FROM hit
  GROUP BY island
  HAVING count(*) / max(sample_rate_hz) >= p_min_seconds
  ORDER BY 1
$$;

-- ------------------------------------------------------------ maintenance status at capture
-- For every session: was each of the device's maintenance plans current when recording started?
-- "Current" = the last passing work order for the plan was within interval_days + grace_days.
CREATE OR REPLACE FUNCTION refresh_session_maintenance() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH chk AS (
    SELECT rs.id AS session_id, mp.name AS plan_name,
           (last_wo.completed_at IS NOT NULL
            AND rs.started_at <= last_wo.completed_at + make_interval(days => mp.interval_days + mp.grace_days)) AS ok
    FROM recording_session rs
    JOIN device d ON d.id = rs.device_id
    JOIN maintenance_plan mp ON mp.device_model_id = d.model_id AND mp.interval_days IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT wo.completed_at FROM work_order wo
      WHERE wo.device_id = d.id AND wo.plan_id = mp.id AND wo.result IN ('pass','repaired')
        AND wo.completed_at <= rs.started_at
      ORDER BY wo.completed_at DESC LIMIT 1
    ) last_wo ON true
  ),
  agg AS (
    SELECT session_id, bool_and(ok) AS ok,
           string_agg(plan_name, ', ' ORDER BY plan_name) FILTER (WHERE NOT ok) AS overdue
    FROM chk GROUP BY session_id
  )
  UPDATE recording_session rs
  SET maintenance_ok = agg.ok,
      maintenance_note = CASE WHEN agg.ok THEN NULL ELSE 'Overdue at capture: ' || agg.overdue END
  FROM agg WHERE agg.session_id = rs.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
