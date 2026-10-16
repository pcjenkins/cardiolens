"use client";

// Channel and window pickers. State lives in the URL (?ch=DO2I,MAP&from=...&to=...), so a view is
// bookmarkable and shareable, and the server component re-renders with the right data.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PHASE_LABEL } from "@/lib/format";

type Props = {
  channels: { code: string; name: string }[];
  selected: string[];
  windows: { phase: string; start: string; end: string }[];
  max?: number;
  /** The full-record page shows every channel, so it only needs the window picker. */
  showChannels?: boolean;
};

export default function SeriesControls({ channels, selected, windows, max = 6, showChannels = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const toggle = (code: string) => go((p) => {
    const set = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code].slice(-max);
    if (set.length) p.set("ch", set.join(",")); else p.delete("ch");
  });

  const zoomed = params.has("from") || params.has("to");
  const activeWindow = windows.find((w) => w.start === params.get("from") && w.end === params.get("to"))?.phase;

  return (
    <div className="series-controls">
      {showChannels && <fieldset>
        <legend>Channels <span className="hint">(up to {max})</span></legend>
        <div className="chips">
          {channels.map((c) => (
            <label key={c.code} className={`chip ${selected.includes(c.code) ? "on" : ""}`} title={c.name}>
              <input type="checkbox" checked={selected.includes(c.code)} onChange={() => toggle(c.code)} aria-label={c.name} />
              {c.code}
            </label>
          ))}
        </div>
      </fieldset>}
      <fieldset>
        <legend>Window</legend>
        <div className="chips">
          <button type="button" className={`chip ${!zoomed ? "on" : ""}`} onClick={() => go((p) => { p.delete("from"); p.delete("to"); })}>Whole recording</button>
          {windows.map((w) => (
            <button key={w.phase} type="button" className={`chip ${activeWindow === w.phase ? "on" : ""}`}
              onClick={() => go((p) => { p.set("from", w.start); p.set("to", w.end); })}>
              {PHASE_LABEL[w.phase] ?? w.phase}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
