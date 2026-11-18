import { Badge, type BadgeTone } from "@/components/ui";

import type { FaultPriority, FaultStatus } from "../engine/transitions";

// Status / priority badges — always text, never colour only. Labels come
// from the caller (server or client translations).

const STATUS_TONE: Record<FaultStatus, BadgeTone> = {
  new: "info",
  in_progress: "warning",
  resolved: "success",
  rejected: "neutral",
  withdrawn: "neutral",
};

const PRIORITY_TONE: Record<FaultPriority, BadgeTone> = {
  urgent: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

export function FaultStatusBadge({ status, label }: { status: FaultStatus; label: string }) {
  return <Badge tone={STATUS_TONE[status]}>{label}</Badge>;
}

export function FaultPriorityBadge({
  priority,
  label,
}: {
  priority: FaultPriority;
  label: string;
}) {
  return <Badge tone={PRIORITY_TONE[priority]}>{label}</Badge>;
}
