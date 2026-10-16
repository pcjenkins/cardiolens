import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";
import { CHANNEL_GROUPS, MARKER_EVENTS, recordQuery, recordVariables } from "@/lib/channel-groups";
import { PHASE_LABEL, clock } from "@/lib/format";
import type { PhaseWindow, Series } from "@/lib/types";
import PerfusionChart from "@/components/PerfusionChart";
import SeriesControls from "@/components/SeriesControls";

export const metadata = { title: "Full record | CardioLens" };

type Data = {
  case: null | ({
    id: string; caseDate: string; procedure: string; source: string; room: string; facility: string;
    perfusionist: { name: string } | null;
    sessions: { startedAt: string; endedAt: string }[];
    events: { ts: string; type: string }[];
    phaseWindows: PhaseWindow[];
    phases: { phase: string; channel: { code: string; decimals: number }; min: number | null; p50: number | null; max: number | null }[];
  } & Record<string, unknown>);
};

const QUERY = recordQuery(CHANNEL_GROUPS);
const isoOrNull = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// Every channel of one case, start to finish, on one page. One GraphQL request: an aliased `series`
// field per group, all over the same time window so the charts line up.
export default async function FullRecord({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await verifySession();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const sp = await searchParams;
  const { case: c } = await gql<Data>(QUERY, { id, from: isoOrNull(sp.from), to: isoOrNull(sp.to), ...recordVariables(CHANNEL_GROUPS) });
  if (!c) notFound();

  if (c.source !== "live_capture" || c.sessions.length === 0) {
    return (
      <>
        <p><Link href={`/cases/${c.id}`}>← Case #{c.id}</Link></p>
        <section className="card">
          <h1>No device data for case #{c.id}</h1>
          <p className="muted">This is a legacy import: a case-level summary with no per-second recording to plot.</p>
        </section>
      </>
    );
  }

  const recording = { from: c.sessions.map((s) => s.startedAt).sort()[0], to: c.sessions.map((s) => s.endedAt).sort().at(-1)! };
  const markers = c.events.filter((e) => MARKER_EVENTS[e.type]).map((e) => ({ t: Date.parse(e.ts), label: MARKER_EVENTS[e.type] }));
  // Headline numbers per channel: median and range on bypass (or over the whole recording for off-pump channels).
  const stats: Record<string, string> = {};
  for (const code of CHANNEL_GROUPS.flatMap((g) => g.codes)) {
    const s = c.phases.find((p) => p.channel.code === code && p.phase === "CPB" && p.p50 != null)
      ?? c.phases.find((p) => p.channel.code === code && p.p50 != null);
    if (s) stats[code] = `${PHASE_LABEL[s.phase].toLowerCase()} median ${s.p50} (${s.min}–${s.max})`;
  }
  const first = c[CHANNEL_GROUPS[0].key] as Series;

  return (
    <>
      <p><Link href={`/cases/${c.id}`}>← Case #{c.id}</Link></p>

      <section className="card record-head">
        <h1>Case #{c.id} · full perfusion record</h1>
        <p className="muted">
          {c.procedure} · {c.caseDate} · {c.facility} {c.room} · {c.perfusionist?.name} ·{" "}
          {clock(recording.from)}–{clock(recording.to)}
        </p>
        <p className="model-note">
          {first.resolution === "RAW"
            ? "Raw 1-second samples. Invalid samples (line flush, artifact, sensor off) are gaps."
            : `${first.stepSeconds / 60}-minute mean with the min–max range shaded. Click any chart to zoom every chart to 10 minutes of raw seconds.`}
          {" "}Vertical lines mark the case milestones; the shaded band is the cross-clamp. Hover one chart and every chart follows.
        </p>
        <Suspense>
          <SeriesControls channels={[]} selected={[]} windows={c.phaseWindows} showChannels={false} />
        </Suspense>
        <nav className="jump" aria-label="Jump to group">
          {CHANNEL_GROUPS.map((g) => <a key={g.key} href={`#${g.key}`}>{g.title}</a>)}
        </nav>
      </section>

      {CHANNEL_GROUPS.map((g, i) => (
        <section key={g.key} id={g.key} className="card record-group">
          <h2>{g.title}</h2>
          <p className="hint">{g.note}</p>
          <Suspense>
            <PerfusionChart series={c[g.key] as Series} windows={c.phaseWindows} recording={recording}
              markers={markers} labelMarkers={i === 0} stats={stats} height={120} />
          </Suspense>
        </section>
      ))}
    </>
  );
}
