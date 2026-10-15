import { STATUS_LABEL } from "@/lib/format";
import type { MaintenanceStatus } from "@/lib/types";

export default function StatusBadge({ status }: { status: MaintenanceStatus }) {
  const cls = status === "OVERDUE" ? "bad" : status === "CURRENT" ? "ok" : "warn";
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status]}</span>;
}
