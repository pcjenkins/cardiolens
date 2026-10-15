"use client";

// Client component: Recharts needs the browser. It receives plain, serialisable series data from the
// server component; it never fetches anything itself. Zooming just changes the URL, and the server
// re-renders with finer data (minute aggregates -> raw seconds).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { clock, zoomWindow } from "@/lib/format";
import type { PhaseWindow, Series } from "@/lib/types";

type Props = { series: Series; windows: PhaseWindow[]; recording: { from: string; to: string } };

export default function PerfusionChart({ series, windows, recording }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const from = Date.parse(series.from), to = Date.parse(series.to);
  const clampWindow = windows.find((w) => w.phase === "CROSS_CLAMP");
  const raw = series.resolution === "RAW";

  const zoomTo = (t: number) => {
    if (raw) return;                                   // already at full resolution
    const z = zoomWindow(t, Date.parse(recording.from), Date.parse(recording.to));
    const next = new URLSearchParams(params.toString());
    next.set("from", z.from);
    next.set("to", z.to);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="multiples">
      {series.channels.map(({ channel, points }) => {
        const data = points.map((p) => ({
          t: Date.parse(p.t), avg: p.avg,
          band: p.min == null || p.max == null ? null : [p.min, p.max],
        }));
        return (
          <div key={channel.code} className="multiple">
            <div className="multiple-title">
              <strong>{channel.name}</strong> <span className="muted">{channel.unit}</span>
              {channel.lowLimit != null && <span className="hint"> · target ≥ {channel.lowLimit}</span>}
              {channel.highLimit != null && <span className="hint"> · limit ≤ {channel.highLimit}</span>}
            </div>
            <div style={{ width: "100%", height: 130 }}>
              <ResponsiveContainer>
                <ComposedChart data={data} syncId="perfusion" syncMethod="value" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
                  onClick={(s) => {
                    // Recharts 3 reports the hovered point as a label or an index depending on the axis type
                    const t = Number(s?.activeLabel ?? data[Number(s?.activeTooltipIndex)]?.t);
                    if (Number.isFinite(t)) zoomTo(t);
                  }}
                  style={{ cursor: raw ? "default" : "zoom-in" }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" type="number" scale="time" domain={[from, to]} tickFormatter={(t: number) => clock(new Date(t).toISOString(), to - from <= 20 * 60_000)}
                    tick={{ fill: "var(--muted)", fontSize: 11 }} minTickGap={40} />
                  <YAxis domain={["auto", "auto"]} width={44} tick={{ fill: "var(--muted)", fontSize: 11 }} allowDecimals={channel.decimals > 0} />
                  {clampWindow && <ReferenceArea x1={Date.parse(clampWindow.start)} x2={Date.parse(clampWindow.end)} fill="var(--chart-3)" fillOpacity={0.08} ifOverflow="hidden" />}
                  {channel.lowLimit != null && <ReferenceLine y={channel.lowLimit} stroke="var(--danger)" strokeDasharray="4 4" ifOverflow="extendDomain" />}
                  {channel.highLimit != null && <ReferenceLine y={channel.highLimit} stroke="var(--danger)" strokeDasharray="4 4" ifOverflow="extendDomain" />}
                  <Tooltip
                    labelFormatter={(t) => clock(new Date(Number(t)).toISOString(), true)}
                    formatter={(v, name) => [Array.isArray(v) ? `${v[0]} – ${v[1]}` : v, name === "band" ? "min – max" : "mean"]}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12 }} />
                  {!raw && <Area isAnimationActive={false} dataKey="band" stroke="none" fill="var(--chart-1)" fillOpacity={0.18} connectNulls={false} />}
                  <Line isAnimationActive={false} dataKey="avg" stroke="var(--chart-1)" strokeWidth={1.5} dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
