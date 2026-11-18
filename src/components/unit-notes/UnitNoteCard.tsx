"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Button, Card, Icon, Textarea, useConfirm } from "@/components/ui";
import { UNIT_NOTE_MAX_LENGTH, type UnitNoteDTO } from "@/lib/unit-notes";

// "Interná poznámka k bytu" — BYT-20261118-005 Phase C. Self-contained and
// board-only: the API answers 404 to everyone else and this card then renders
// NOTHING, so it is safe to mount on any page that shows a unit.
// Mount points (owned by other streams — coordinator mounts):
//   - src/components/owners/OwnerDetail.tsx — each unit block
//   - src/app/[locale]/(dashboard)/accounting/karta/[unitId]/page.tsx —
//     board view, `defaultCollapsed`

export default function UnitNoteCard({
  entityId,
  defaultCollapsed = false,
}: {
  entityId: string;
  defaultCollapsed?: boolean;
}) {
  const t = useTranslations("UnitNotes");
  const format = useFormatter();
  const confirm = useConfirm();
  const textareaId = useId();
  const [state, setState] = useState<"loading" | "hidden" | "ready">("loading");
  const [note, setNote] = useState<UnitNoteDTO | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/unit-notes/${entityId}`);
    if (!res.ok) {
      setState("hidden");
      return;
    }
    setNote((await res.json()).note);
    setState("ready");
  }, [entityId]);

  useEffect(() => {
    load();
  }, [load]);

  if (state !== "ready") return null;

  function errorText(code: unknown): string {
    switch (code) {
      case "unit_note.too_long":
        return t("errors.tooLong", { max: UNIT_NOTE_MAX_LENGTH });
      case "unit_note.conflict":
        return t("errors.conflict");
      default:
        return t("errors.failed");
    }
  }

  async function handle(res: Response) {
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setNote(j.note ?? null);
      setEditing(false);
      return;
    }
    setError(errorText(j.code));
    if (j.code === "unit_note.conflict") {
      // Show the newer text; the editor re-saves against the new version.
      setNote(j.current ?? null);
      setDraft(j.current?.body ?? "");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await handle(
        await fetch(`/api/unit-notes/${entityId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: draft,
            expectedUpdatedAt: note?.updatedAt ?? null,
          }),
        })
      );
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const ok = await confirm({
      title: t("clearConfirmTitle"),
      description: t("clearConfirmBody"),
      confirmLabel: t("clear"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const qs = note ? `?expectedUpdatedAt=${encodeURIComponent(note.updatedAt)}` : "";
      await handle(await fetch(`/api/unit-notes/${entityId}${qs}`, { method: "DELETE" }));
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  const lastEdited = note
    ? note.updatedByName
      ? t("lastEdited", {
          name: note.updatedByName,
          date: format.dateTime(new Date(note.updatedAt), { dateStyle: "medium" }),
        })
      : t("lastEditedUnknown", {
          date: format.dateTime(new Date(note.updatedAt), { dateStyle: "medium" }),
        })
    : null;

  return (
    <Card as="section" padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-ui-text">{t("title")}</h3>
        <Badge tone="danger">
          <Icon name="key" size={16} />
          {t("badge")}
        </Badge>
      </div>

      {collapsed ? (
        <Button variant="secondary" onClick={() => setCollapsed(false)}>
          {note ? t("show") : t("add")}
        </Button>
      ) : editing ? (
        <div className="space-y-2">
          <label htmlFor={textareaId} className="block text-base font-medium text-ui-text">
            {t("title")}
          </label>
          <Textarea
            id={textareaId}
            rows={6}
            value={draft}
            maxLength={UNIT_NOTE_MAX_LENGTH}
            placeholder={t("placeholder")}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="text-base text-ui-text-muted">
            {t("counter", { count: draft.length, max: UNIT_NOTE_MAX_LENGTH })}
          </p>
          <p className="text-base text-ui-text-muted">{t("hint")}</p>
          <div className="flex gap-2 flex-wrap">
            <Button loading={busy} onClick={save}>
              {t("save")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {note ? (
            <p className="text-base text-ui-text whitespace-pre-wrap break-words">
              {note.body}
            </p>
          ) : (
            <p className="text-base text-ui-text-muted">{t("empty")}</p>
          )}
          {lastEdited && <p className="text-base text-ui-text-muted">{lastEdited}</p>}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(note?.body ?? "");
                setEditing(true);
                setError(null);
              }}
            >
              <Icon name="edit" size={20} />
              {note ? t("edit") : t("add")}
            </Button>
            {note && (
              <Button variant="ghost" loading={busy} onClick={clear}>
                <Icon name="trash" size={20} />
                {t("clear")}
              </Button>
            )}
            {defaultCollapsed && (
              <Button variant="ghost" onClick={() => setCollapsed(true)}>
                {t("hide")}
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
