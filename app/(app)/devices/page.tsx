import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";
import { STATUS_LABEL, shortDate } from "@/lib/format";
import type { DeviceSummary, MaintenanceStatus } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

export const metadata = { title: "Devices | CardioLens" };

type Data = {
  facilities: {
    id: string; name: string; city: string; state: string; healthSystem: string;
    locations: { id: string; path: string; depth: number; kind: string; rooms: { id: string; name: string; devices: DeviceSummary[] }[] }[];
  }[];
  maintenance: { device: { id: string; assetTag: string; room: string | null; facility: string }; plan: string; status: MaintenanceStatus; dueAt: string | null; regulatory: boolean }[];
  recall?: { id: string; caseDate: string; procedure: string; facility: string; room: string }[];
};

// Facility > location > room > device: four levels, each batched by a DataLoader in the API.
const QUERY = `query Devices($lot: String!, $withRecall: Boolean!) {
  facilities {
    id name city state healthSystem
    locations { id path depth kind rooms { id name devices { id assetTag model type runningHours cases maintenanceStatus } } }
  }
  maintenance(status: [OVERDUE, IN_GRACE, DUE_SOON]) { device { id assetTag room facility } plan status dueAt regulatory }
  recall: disposableRecall(lot: $lot) @include(if: $withRecall) { id caseDate procedure facility room }
}`;

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  await verifySession();
  const lot = (await searchParams).lot?.trim().slice(0, 40) ?? "";
  const data = await gql<Data>(QUERY, { lot, withRecall: lot.length > 0 });

  return (
    <>
      <h1>Devices and locations</h1>

      <section className="card table-wrap">
        <h2>Maintenance needing attention</h2>
        <table>
          <thead><tr><th>Device</th><th>Where</th><th>Plan</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>
            {data.maintenance.map((m) => (
              <tr key={m.device.id + m.plan}>
                <td><Link href={`/devices/${m.device.id}`}>{m.device.assetTag}</Link></td>
                <td>{m.device.facility} · {m.device.room ?? "-"}</td>
                <td>{m.plan}{m.regulatory && <span className="hint"> · regulatory</span>}</td>
                <td><StatusBadge status={m.status} /></td>
                <td>{m.dueAt ? shortDate(m.dueAt) : "never done"}</td>
              </tr>
            ))}
            {data.maintenance.length === 0 && <tr><td colSpan={5} className="muted">All maintenance is current.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Disposable lot recall</h2>
        <form className="toolbar" method="get">
          <label>Lot number<input name="lot" defaultValue={lot} placeholder="e.g. OX-RB-038" /></label>
          <button type="submit" style={{ marginTop: 0 }}>Find cases</button>
        </form>
        {data.recall && (
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <p className="muted">{data.recall.length} case{data.recall.length === 1 ? "" : "s"} used lot <strong>{lot}</strong>.</p>
            <table>
              <tbody>
                {data.recall.map((r) => (
                  <tr key={r.id}><td><Link href={`/cases/${r.id}`}>#{r.id}</Link></td><td>{r.caseDate}</td><td>{r.procedure}</td><td>{r.facility} · {r.room}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.facilities.map((f) => (
        <section className="card" key={f.id}>
          <h2>{f.name} <span className="muted">· {f.city}, {f.state}</span></h2>
          <p className="hint">{f.healthSystem}</p>
          <ul className="tree">
            {f.locations.map((l) => (
              <li key={l.id} style={{ marginLeft: `${(l.depth - 1) * 1.25}rem` }}>
                <span className="loc">{l.path.split(" / ").at(-1)}</span> <span className="hint">{l.kind.replace("_", " ")}</span>
                {l.rooms.filter((r) => r.devices.length).map((r) => (
                  <div key={r.id} className="room">
                    <span className="room-name">{r.name}</span>
                    {r.devices.map((d) => (
                      <Link key={d.id} href={`/devices/${d.id}`} className={`device-pill s-${d.maintenanceStatus.toLowerCase()}`} title={`${d.model} · ${STATUS_LABEL[d.maintenanceStatus]}`}>
                        {d.assetTag}
                      </Link>
                    ))}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
