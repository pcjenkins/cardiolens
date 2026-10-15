-- CardioLens data tier: PostgreSQL 16+.
-- Everything here is fictitious demo data. Run through `npm run db:reset` (api/scripts/reset.ts).
--
-- Layout
--   1. Organisation hierarchy   health_system > facility > location (self-referencing tree) > room
--   2. People and clinical       patient > encounter > surgical_case, staff, events, labs, transfusions
--   3. Devices and provenance    manufacturer > device_model > device > device_module, channels
--   4. Maintenance               plans, tasks, schedules, work orders, technicians
--   5. Capture                   recording_session > raw_sample (partitioned by month), alarms, settings, emboli
--   6. Aggregates                agg_minute > agg_hour > agg_day (mergeable), agg_case_phase, agg_dirty

CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public;   -- lets an exclusion constraint mix "=" and "&&"

-- ============================================================ 1. Organisation hierarchy

CREATE TABLE health_system (
  id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE facility (
  id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  health_system_id int  NOT NULL REFERENCES health_system,
  name             text NOT NULL,
  city             text NOT NULL,
  state            text NOT NULL,
  time_zone        text NOT NULL DEFAULT 'America/New_York',
  UNIQUE (health_system_id, name)
);

-- Buildings, floors, suites, units: any depth. Walked with a recursive CTE (see v_location_path).
CREATE TABLE location (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  facility_id int  NOT NULL REFERENCES facility,
  parent_id   int  REFERENCES location,
  kind        text NOT NULL CHECK (kind IN ('building','floor','or_suite','icu','biomed','storage')),
  name        text NOT NULL,
  UNIQUE (facility_id, parent_id, name)
);

CREATE TABLE room (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id int  NOT NULL REFERENCES location,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('operating_room','icu_bay','workshop','storage')),
  UNIQUE (location_id, name)
);

-- ============================================================ 2. People and clinical

CREATE TABLE app_user (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('clinician','admin')),
  password_hash text NOT NULL
);

CREATE TABLE staff (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  discipline text NOT NULL CHECK (discipline IN ('surgeon','perfusionist','anesthesiologist','nurse'))
);

CREATE TABLE patient (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mrn        text    NOT NULL UNIQUE,
  first_name text    NOT NULL,
  last_name  text    NOT NULL,
  birth_date date    NOT NULL,
  sex        char(1) NOT NULL CHECK (sex IN ('F','M')),
  height_cm  numeric(5,1) NOT NULL CHECK (height_cm BETWEEN 50 AND 250),
  weight_kg  numeric(5,1) NOT NULL CHECK (weight_kg BETWEEN 2 AND 300),
  -- Mosteller body surface area; drives cardiac index and DO2i.
  bsa_m2     numeric(4,2) GENERATED ALWAYS AS (round(sqrt(height_cm * weight_kg / 3600.0), 2)) STORED
);

CREATE TABLE encounter (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id   int  NOT NULL REFERENCES patient,
  facility_id  int  NOT NULL REFERENCES facility,
  admitted_at  timestamptz NOT NULL,
  discharged_at timestamptz,
  outcome      text CHECK (outcome IN ('Discharged','Complication','Readmitted')),
  CHECK (discharged_at IS NULL OR discharged_at > admitted_at)
);

CREATE TABLE surgical_case (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encounter_id   int  NOT NULL REFERENCES encounter,
  room_id        int  NOT NULL REFERENCES room,
  procedure      text NOT NULL CHECK (procedure IN ('CABG','AVR','MVR','CABG + AVR')),
  scheduled_start timestamptz NOT NULL,
  -- 'live_capture': per-second data recorded from devices.
  -- 'legacy_import': migrated from the old system as a case-level summary only (no waveforms).
  source         text NOT NULL CHECK (source IN ('live_capture','legacy_import')),
  legacy_summary jsonb,
  CHECK ((source = 'legacy_import') = (legacy_summary IS NOT NULL))
);
CREATE INDEX ix_case_encounter ON surgical_case (encounter_id);
CREATE INDEX ix_case_room      ON surgical_case (room_id);

CREATE TABLE case_staff (
  case_id  int  NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  staff_id int  NOT NULL REFERENCES staff,
  role     text NOT NULL CHECK (role IN ('primary_surgeon','assistant_surgeon','primary_perfusionist','anesthesiologist')),
  PRIMARY KEY (case_id, role, staff_id)
);
-- Exactly one primary surgeon / perfusionist per case.
CREATE UNIQUE INDEX ux_case_primary ON case_staff (case_id, role) WHERE role IN ('primary_surgeon','primary_perfusionist');

-- Milestones the phase boundaries are cut from.
CREATE TABLE case_event (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    int  NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  ts         timestamptz NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
               'in_room','incision','heparin','cpb_on','xclamp_on','cardioplegia',
               'rewarm_start','xclamp_off','cpb_off','protamine','out_of_room')),
  detail     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_event_case ON case_event (case_id, ts);
-- At most one of each milestone (cardioplegia doses repeat).
CREATE UNIQUE INDEX ux_event_milestone ON case_event (case_id, event_type) WHERE event_type <> 'cardioplegia';

CREATE TABLE lab_result (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id int  NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  ts      timestamptz NOT NULL,
  test    text NOT NULL CHECK (test IN ('pH','PaO2','PaCO2','Lactate','ACT','Hct','K')),
  value   numeric(7,2) NOT NULL,
  unit    text NOT NULL
);
CREATE INDEX ix_lab_case ON lab_result (case_id, ts);

CREATE TABLE transfusion (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id int  NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  ts      timestamptz NOT NULL,
  product text NOT NULL CHECK (product IN ('PRBC','FFP','Platelets','Cryo')),
  units   int  NOT NULL CHECK (units > 0)
);
CREATE INDEX ix_transfusion_case ON transfusion (case_id);

-- ============================================================ 3. Devices and provenance

CREATE TABLE manufacturer (
  id   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE device_model (
  id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manufacturer_id  int  NOT NULL REFERENCES manufacturer,
  name             text NOT NULL,
  device_type      text NOT NULL CHECK (device_type IN ('perfusion_workstation','heater_cooler','patient_monitor','data_gateway')),
  udi_di           text NOT NULL UNIQUE,        -- UDI device identifier (the model part of a UDI)
  regulatory_class text NOT NULL,
  UNIQUE (manufacturer_id, name)
);

CREATE TABLE module_model (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manufacturer_id int  NOT NULL REFERENCES manufacturer,
  name            text NOT NULL,
  module_type     text NOT NULL CHECK (module_type IN (
                    'sensor_hub','hb_so2_sensor','gas_blender','ventilation_diagnostics',
                    'centrifugal_drive','roller_drive','vital_signs','thermal_unit')),
  UNIQUE (manufacturer_id, name)
);

CREATE TABLE device (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id    int  NOT NULL REFERENCES device_model,
  serial      text NOT NULL,
  asset_tag   text NOT NULL UNIQUE,
  facility_id int  NOT NULL REFERENCES facility,
  installed_on date NOT NULL,
  status      text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','out_of_service','retired')),
  UNIQUE (model_id, serial)
);

CREATE TABLE device_module (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id       int  NOT NULL REFERENCES device,
  module_model_id int  NOT NULL REFERENCES module_model,
  serial          text NOT NULL,
  firmware        text NOT NULL,
  position        text NOT NULL,
  UNIQUE (device_id, position)
);

-- Software history: which version was running when.
CREATE TABLE software_install (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id    int  NOT NULL REFERENCES device,
  version      text NOT NULL,
  installed_at timestamptz NOT NULL,
  installed_by text NOT NULL,
  UNIQUE (device_id, installed_at)
);

-- Where a device was, and when. The exclusion constraint makes it impossible for one device
-- to be in two rooms at the same time; the database enforces it, not application code.
CREATE TABLE device_assignment (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id int NOT NULL REFERENCES device,
  room_id   int NOT NULL REFERENCES room,
  during    tstzrange NOT NULL,
  EXCLUDE USING gist (device_id WITH =, during WITH &&)
);
CREATE INDEX ix_assignment_room ON device_assignment USING gist (room_id, during);

-- The catalogue of what can be measured.
CREATE TABLE channel (
  id             smallint PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  unit           text NOT NULL,
  sample_rate_hz real NOT NULL CHECK (sample_rate_hz > 0),
  kind           text NOT NULL CHECK (kind IN ('measured','device_calculated')),
  formula        text,                          -- for calculated channels: what the device computed
  low_limit      real,                          -- thresholds used by time-below / time-above metrics
  high_limit     real,
  decimals       smallint NOT NULL DEFAULT 0,
  CHECK ((kind = 'device_calculated') = (formula IS NOT NULL))
);

-- Which module types produce which channels.
CREATE TABLE module_channel (
  module_model_id int      NOT NULL REFERENCES module_model,
  channel_id      smallint NOT NULL REFERENCES channel,
  PRIMARY KEY (module_model_id, channel_id)
);

CREATE TABLE disposable_product (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manufacturer_id int  NOT NULL REFERENCES manufacturer,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('oxygenator','tubing_pack','cannula','cardioplegia_set','hb_so2_cuvette')),
  udi_di          text NOT NULL UNIQUE
);

CREATE TABLE disposable_use (
  case_id    int  NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  product_id int  NOT NULL REFERENCES disposable_product,
  lot        text NOT NULL,
  expires_on date NOT NULL,
  PRIMARY KEY (case_id, product_id, lot)
);
CREATE INDEX ix_disposable_lot ON disposable_use (product_id, lot);   -- recall lookups

-- ============================================================ 4. Maintenance

CREATE TABLE technician (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           text NOT NULL,
  company        text NOT NULL,
  cert_expires_on date NOT NULL
);

-- Defined per model, applied to every device of that model.
CREATE TABLE maintenance_plan (
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_model_id int  NOT NULL REFERENCES device_model,
  name            text NOT NULL,
  interval_days   int  CHECK (interval_days > 0),
  interval_hours  int  CHECK (interval_hours > 0),     -- running hours, from recording sessions
  grace_days      int  NOT NULL DEFAULT 0,
  regulatory      boolean NOT NULL DEFAULT false,
  CHECK (interval_days IS NOT NULL OR interval_hours IS NOT NULL),   -- time, usage, or whichever first
  UNIQUE (device_model_id, name)
);

CREATE TABLE maintenance_task (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id     int  NOT NULL REFERENCES maintenance_plan ON DELETE CASCADE,
  seq         int  NOT NULL,
  description text NOT NULL,
  spec        text,
  UNIQUE (plan_id, seq)
);

CREATE TABLE work_order (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id     int  NOT NULL REFERENCES device,
  plan_id       int  REFERENCES maintenance_plan,       -- NULL for corrective work
  kind          text NOT NULL CHECK (kind IN ('preventive','corrective')),
  opened_at     timestamptz NOT NULL,
  completed_at  timestamptz,
  technician_id int  REFERENCES technician,
  result        text CHECK (result IN ('pass','fail','repaired')),
  notes         text,
  CHECK ((kind = 'preventive') = (plan_id IS NOT NULL)),
  CHECK (completed_at IS NULL OR (completed_at >= opened_at AND result IS NOT NULL))
);
CREATE INDEX ix_wo_device_plan ON work_order (device_id, plan_id, completed_at DESC);

CREATE TABLE work_order_task (
  work_order_id int NOT NULL REFERENCES work_order ON DELETE CASCADE,
  task_id       int NOT NULL REFERENCES maintenance_task,
  measured      text,
  passed        boolean NOT NULL,
  PRIMARY KEY (work_order_id, task_id)
);

-- ============================================================ 5. Capture

-- One device's stream for one case. Provenance is frozen here at capture time.
CREATE TABLE recording_session (
  id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id          int  NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  device_id        int  NOT NULL REFERENCES device,
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz NOT NULL,
  software_version text NOT NULL,
  clock_offset_ms  int  NOT NULL DEFAULT 0,       -- device clock minus server clock, corrected at ingest
  gateway          text NOT NULL,
  maintenance_ok   boolean,                       -- were all the device's plans current at capture? (set after seed)
  maintenance_note text,
  CHECK (ended_at > started_at)
);
CREATE INDEX ix_session_case   ON recording_session (case_id);
CREATE INDEX ix_session_device ON recording_session (device_id, started_at);

CREATE TABLE sample_quality (
  code smallint PRIMARY KEY,
  name text NOT NULL UNIQUE
);
INSERT INTO sample_quality VALUES (0,'valid'),(1,'artifact'),(2,'sensor_off'),(3,'line_flush'),(4,'interpolated');

-- The raw stream: one row per channel per sample, partitioned by month ("time shards").
-- Old months can be DETACHed and moved to an archive database without a bulk DELETE.
CREATE TABLE raw_sample (
  session_id int      NOT NULL,
  channel_id smallint NOT NULL,
  ts         timestamptz NOT NULL,
  value      real     NOT NULL,
  quality    smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, channel_id, ts)
) PARTITION BY RANGE (ts);
-- FKs to recording_session/channel/sample_quality are deliberately left off this table:
-- ingest goes through ingest_samples(), and a 30M-row table pays for every FK check.

CREATE TABLE setting_change (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id int  NOT NULL REFERENCES recording_session ON DELETE CASCADE,
  ts         timestamptz NOT NULL,
  parameter  text NOT NULL,
  old_value  real,
  new_value  real NOT NULL,
  staff_id   int  REFERENCES staff
);
CREATE INDEX ix_setting_session ON setting_change (session_id, ts);

CREATE TABLE alarm_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  int      NOT NULL REFERENCES recording_session ON DELETE CASCADE,
  channel_id  smallint NOT NULL REFERENCES channel,
  ts          timestamptz NOT NULL,
  limit_kind  text NOT NULL CHECK (limit_kind IN ('low','high')),
  limit_value real NOT NULL,
  value       real NOT NULL,
  acked_at    timestamptz,
  acked_by    int REFERENCES staff
);
CREATE INDEX ix_alarm_session ON alarm_event (session_id, ts);

-- The bubble detector samples at >2,500 Hz. Detections are stored, not the waveform.
CREATE TABLE emboli_event (
  session_id    int  NOT NULL REFERENCES recording_session ON DELETE CASCADE,
  ts            timestamptz NOT NULL,
  line          text NOT NULL CHECK (line IN ('arterial','venous','cardioplegia')),
  est_volume_nl real NOT NULL,
  PRIMARY KEY (session_id, ts, line)
);

-- ============================================================ 6. Aggregates
-- Each bucket stores mergeable parts (count, sum, sum of squares, min, max, first, last), so an hour
-- is computed from its minutes and a day from its hours without touching raw_sample again.
-- Statistics cover valid samples only; n_bad counts the rest.

CREATE TABLE agg_minute (
  session_id int      NOT NULL,
  channel_id smallint NOT NULL,
  bucket     timestamptz NOT NULL,
  n_valid    int    NOT NULL,
  n_bad      int    NOT NULL,
  sum        float8 NOT NULL,
  sum_sq     float8 NOT NULL,
  min        real, t_min timestamptz,
  max        real, t_max timestamptz,
  first_val  real, first_ts timestamptz,
  last_val   real, last_ts  timestamptz,
  sec_below  real   NOT NULL,          -- seconds of valid data below channel.low_limit
  sec_above  real   NOT NULL,          -- seconds of valid data above channel.high_limit
  PRIMARY KEY (session_id, channel_id, bucket)
);
CREATE TABLE agg_hour (LIKE agg_minute INCLUDING ALL);
CREATE TABLE agg_day  (LIKE agg_minute INCLUDING ALL);

-- Buckets whose parent grain needs recomputing (written by ingest, drained by rollup_dirty()).
CREATE TABLE agg_dirty (
  grain      text     NOT NULL CHECK (grain IN ('hour','day')),
  session_id int      NOT NULL,
  channel_id smallint NOT NULL,
  bucket     timestamptz NOT NULL,
  PRIMARY KEY (grain, session_id, channel_id, bucket)
);

-- Clinicians think in phases, not clock hours.
CREATE TABLE agg_case_phase (
  case_id    int      NOT NULL REFERENCES surgical_case ON DELETE CASCADE,
  phase      text     NOT NULL CHECK (phase IN ('pre_cpb','cpb','full_flow','cross_clamp','rewarm','post_cpb')),
  channel_id smallint NOT NULL REFERENCES channel,
  t_start    timestamptz NOT NULL,
  t_end      timestamptz NOT NULL,
  n_valid    int  NOT NULL,
  n_bad      int  NOT NULL,
  avg        real, min real, t_min timestamptz, max real, t_max timestamptz,
  p10        real, p50 real, p90 real,
  sec_below  real NOT NULL,
  sec_above  real NOT NULL,
  PRIMARY KEY (case_id, phase, channel_id)
);
