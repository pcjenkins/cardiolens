import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";
import { shortDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { MaintenanceStatus } from "@/lib/types";

type Data = {
  device: null | {
    id: string; assetTag: string; serial: string; model: string; manufacturer: string; type: string; status: string; installedOn: string;
    facility: string; location: string | null; room: string | null; runningHours: number; cases: number; lastUsedAt: string | null;
    maintenanceStatus: MaintenanceStatus;
    modules: { position: string; model: string; serial: string; firmware: string; channels: string[] }[];
    software: { version: string; installedAt: string; installedBy: string }[];
    assignments: { room: string; location: string; from: string; to: string | null }[];
    maintenance: { plan: string; regulatory: boolean; intervalDays: number | null; intervalHours: number | null; lastDoneAt: string | null; dueAt: string | null; hoursSinceLast: number | null; status: MaintenanceStatus }[];
    workOrders: { id: string; kind: string; plan: string | null; completedAt: string | null; technician: string | null; result: string | null; notes: string | null; tasks: { description: string; spec: string | null; measured: string | null; passed: boolean }[] }[];
  };
};

const QUERY = `query Device($id: ID!) {
  device(id: $id) {
    id assetTag serial model manufacturer type status installedOn facility location room runningHours cases lastUsedAt maintenanceStatus
    modules { position model serial firmware channels }
    software { version installedAt installedBy }
    assignments { room location from to }
    maintenance { plan regulatory intervalDays intervalHours lastDoneAt dueAt hoursSinceLast status }
    workOrders(limit: 15) { id kind plan completedAt technician result notes tasks { description spec measured passed } }
  }
}`;

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const { device: d } = await gql<Data>(QUERY, { id });
  if (!d) notFound();

  return (
    <>
      <p><Link href="/devices">← Devices</Link></p>
      <section className="card">
        <div className="toolbar">
          <div style={{ flex: 1 }}>
            <h1>{d.assetTag}</h1>
            <p className="muted">{d.manufacturer} {d.model} · serial {d.serial}</p>
          </div>
          <StatusBadge status={d.maintenanceStatus} />
        </div>
        <dl className="detail cols">
          <dt>Location now</dt><dd>{d.facility} · {d.location ?? "-"} / {d.room ?? "-"}</dd>
          <dt>In service since</dt><dd>{d.installedOn} · {d.status.replaceAll("_", " ")}</dd>
          <dt>Recorded</dt><dd>{d.cases} cases · {d.runningHours} running hours{d.lastUsedAt ? ` · last ${shortDate(d.lastUsedAt)}` : ""}</dd>
          <dt>Software</dt><dd>{d.software[0]?.version ?? "-"}</dd>
        </dl>
      </section>

      <section className="card table-wrap">
        <h2>Maintenance schedule</h2>
        <table>
          <thead><tr><th>Plan</th><th>Interval</th><th>Last done</th><th>Due</th><th className="num">Hours since</th><th>Status</th></tr></thead>
          <tbody>
            {d.maintenance.map((m) => (
              <tr key={m.plan}>
                <td>{m.plan}{m.regulatory && <span className="hint"> · regulatory</span>}</td>
                <td>{m.intervalDays ? `${m.intervalDays} days` : ""}{m.intervalDays && m.intervalHours ? " or " : ""}{m.intervalHours ? `${m.intervalHours} h` : ""}</td>
                <td>{m.lastDoneAt ? shortDate(m.lastDoneAt) : "never"}</td>
                <td>{m.dueAt ? shortDate(m.dueAt) : m.intervalHours ? "by usage" : "-"}</td>
                <td className="num">{m.hoursSinceLast ?? "-"}</td>
                <td><StatusBadge status={m.status} /></td>
              </tr>
            ))}
            {d.maintenance.length === 0 && <tr><td colSpan={6} className="muted">No plans for this model.</td></tr>}
          </tbody>
        </table>
      </section>

      {d.modules.length > 0 && (
        <section className="card table-wrap">
          <h2>Modules</h2>
          <table>
            <thead><tr><th>Position</th><th>Module</th><th>Serial</th><th>Firmware</th><th>Channels</th></tr></thead>
            <tbody>
              {d.modules.map((m) => (
                <tr key={m.position}><td>{m.position}</td><td>{m.model}</td><td>{m.serial}</td><td>{m.firmware}</td><td className="hint">{m.channels.join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid-2">
        <section className="card table-wrap">
          <h2>Where it has been</h2>
          <table>
            <tbody>
              {d.assignments.map((a) => (
                <tr key={a.from}><td>{a.location.split(" / ").at(-1)} / {a.room}</td><td>{shortDate(a.from)} → {a.to ? shortDate(a.to) : "now"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card table-wrap">
          <h2>Software history</h2>
          <table>
            <tbody>
              {d.software.map((s) => <tr key={s.installedAt}><td>{s.version}</td><td>{shortDate(s.installedAt)}</td><td className="hint">{s.installedBy}</td></tr>)}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card table-wrap">
        <h2>Work orders</h2>
        <table>
          <thead><tr><th>Completed</th><th>Type</th><th>Plan</th><th>Technician</th><th>Result</th><th>Checks</th></tr></thead>
          <tbody>
            {d.workOrders.map((w) => (
              <tr key={w.id}>
                <td>{w.completedAt ? shortDate(w.completedAt) : "open"}</td>
                <td>{w.kind}</td>
                <td>{w.plan ?? <span className="hint">{w.notes}</span>}</td>
                <td>{w.technician}</td>
                <td><span className={`badge ${w.result === "fail" ? "bad" : "ok"}`}>{w.result}</span></td>
                <td className="hint">{w.tasks.map((t) => `${t.passed ? "✓" : "✗"} ${t.description}${t.passed ? "" : `: ${t.measured}`}`).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
