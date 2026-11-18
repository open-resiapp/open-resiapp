import { getFormatter, getTranslations } from "next-intl/server";

import { isSeedCategorySlug } from "../engine/catalog";
import type { FaultBoardEvent } from "../engine/views";

// Board history timeline (append-only mod_faults_events). Server component.

const KNOWN_TYPES = ["created", "edited", "status_changed", "field_changed", "photo_added", "photo_removed"];
const KNOWN_FIELDS = [
  "status",
  "title",
  "description",
  "locationNote",
  "locationEntityId",
  "visibility",
  "priority",
  "categoryId",
  "assigneeUserId",
  "contractorId",
  "invoiced",
  "expenseId",
  "internalNote",
  "photo",
];

export async function FaultHistory({ events }: { events: FaultBoardEvent[] }) {
  const [t, format] = await Promise.all([getTranslations("Faults"), getFormatter()]);

  const value = (field: string | null, v: unknown): string => {
    if (v === null || v === undefined || v === "") return t("history.empty");
    if (field === "status" && typeof v === "string") return t(`status.${v}` as "status.new");
    if (field === "priority" && typeof v === "string") return t(`priority.${v}` as "priority.normal");
    if (field === "visibility" && typeof v === "string") return t(`visibility.${v}` as "visibility.private");
    if (typeof v === "boolean") return v ? t("history.yes") : t("history.no");
    if (typeof v === "object") {
      const o = v as { name?: string | null; slug?: string };
      if (o.name) return o.name;
      if (o.slug && isSeedCategorySlug(o.slug)) return t(`category.${o.slug}`);
      return t("history.changed");
    }
    if (field === "photo" || field === "expenseId") return t("history.changed");
    const s = String(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  };

  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const type = KNOWN_TYPES.includes(e.type) ? e.type : "field_changed";
        const fieldLabel = e.field && KNOWN_FIELDS.includes(e.field) ? t(`history.field.${e.field}` as "history.field.status") : null;
        const showValues = (e.type === "field_changed" || e.type === "edited" || e.type === "status_changed") && e.field !== "photo";
        return (
          <li key={e.id} className="rounded-lg border border-ui-border px-3 py-2 text-base">
            <p className="text-ui-text">
              <span className="font-medium">{t(`history.type.${type}` as "history.type.created")}</span>
              {fieldLabel ? ` · ${fieldLabel}` : ""}
              {showValues ? `: ${value(e.field, e.oldValue)} → ${value(e.field, e.newValue)}` : ""}
            </p>
            {e.publicMessage ? (
              <p className="mt-1 break-words text-ui-text">{t("history.publicMessage", { message: e.publicMessage })}</p>
            ) : null}
            <p className="mt-1 text-ui-text-muted">
              {e.actorName ?? t("history.unknownActor")} ·{" "}
              {format.dateTime(new Date(e.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              {e.isPublic ? ` · ${t("history.public")}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
