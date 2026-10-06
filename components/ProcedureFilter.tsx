"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Writes the filter into the URL (?procedure=CABG) so the server component re-renders with new data,
// and the view is bookmarkable/shareable.
export default function ProcedureFilter({ procedures }: { procedures: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("procedure") ?? "";

  return (
    <label>
      Procedure
      <select
        aria-label="Procedure"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set("procedure", e.target.value);
          else next.delete("procedure");
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        <option value="">All procedures</option>
        {procedures.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </label>
  );
}
