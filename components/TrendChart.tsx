"use client";

// Client component: Recharts needs the browser (SVG measuring, hover tooltips).
// It receives plain serializable data from the server component - no DB access here.
import {
  CartesianGrid, ComposedChart, Bar, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export type TrendPoint = { week: string; cases: number; mean: number; movingAvg: number; trend: number };

export default function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div style={{ width: "100%", height: 340 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(w: string) => w.slice(5)} />
          <YAxis yAxisId="min" tick={{ fill: "var(--muted)", fontSize: 12 }} unit=" m" domain={["auto", "auto"]} />
          <YAxis yAxisId="n" orientation="right" tick={{ fill: "var(--muted)", fontSize: 12 }} allowDecimals={false} />
          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
          <Legend />
          <Bar isAnimationActive={false} yAxisId="n" dataKey="cases" name="Cases / week" fill="var(--chart-3)" opacity={0.35} />
          <Line isAnimationActive={false} yAxisId="min" dataKey="mean" name="Weekly mean bypass" stroke="var(--chart-1)" dot={{ r: 2 }} strokeWidth={1.5} />
          <Line isAnimationActive={false} yAxisId="min" dataKey="movingAvg" name="4-week moving avg" stroke="var(--chart-2)" dot={false} strokeWidth={2.5} />
          <Line isAnimationActive={false} yAxisId="min" dataKey="trend" name="Linear trend" stroke="var(--text)" strokeDasharray="6 4" dot={false} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
