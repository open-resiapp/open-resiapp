"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionMenu, Button, Card, ConfirmDialog, Field, Input, Modal } from "@/components/ui";
import Notice, { type NoticeState } from "./Notice";

export interface Entrance {
  id: string;
  name: string;
  streetNumber: string | null;
  flatCount: number;
}

interface EntrancesTabProps {
  canEdit: boolean;
  entrances: Entrance[];
  /** Re-fetch the shared structure data after a change. */
  onChanged: () => Promise<void>;
}

export default function EntrancesTab({ canEdit, entrances, onChanged }: EntrancesTabProps) {
  const t = useTranslations("Settings");
  const th = useTranslations("SettingsHub");
  const tc = useTranslations("Common");
  const [message, setMessage] = useState<NoticeState>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formStreetNumber, setFormStreetNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<Entrance | null>(null);
  const [deleting, setDeleting] = useState(false);

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormName("");
    setFormStreetNumber("");
  };

  const openAdd = () => {
    closeForm();
    setFormOpen(true);
  };

  const openEdit = (entrance: Entrance) => {
    setEditingId(entrance.id);
    setFormName(entrance.name);
    setFormStreetNumber(entrance.streetNumber || "");
    setFormOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const url = editingId ? `/api/entrances/${editingId}` : "/api/entrances";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, streetNumber: formStreetNumber || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      closeForm();
      setMessage({ type: "success", text: t("entranceSaved") });
      await onChanged();
    } catch (e) {
      setMessage({ type: "error", text: (e instanceof Error && e.message) || t("entranceSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/entrances/${toDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      setMessage({ type: "success", text: t("entranceDeleted") });
      await onChanged();
    } catch (e) {
      setMessage({ type: "error", text: (e instanceof Error && e.message) || t("entranceDeleteFailed") });
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  return (
    <section aria-labelledby="entrances-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="entrances-heading" className="text-xl font-semibold text-ui-text">
          {t("entrances")}
        </h2>
        {canEdit ? (
          <Button variant="secondary" onClick={openAdd}>
            {t("addEntrance")}
          </Button>
        ) : null}
      </div>

      <Notice state={message} />

      {entrances.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("noEntrances")}</p>
      ) : (
        <ul className="space-y-3">
          {entrances.map((entrance) => (
            <Card as="li" key={entrance.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-medium text-ui-text break-words">{entrance.name}</p>
                <p className="text-base text-ui-text-muted">
                  {entrance.streetNumber ? `${t("streetNumber")}: ${entrance.streetNumber} · ` : ""}
                  {t("flatCount")}: {entrance.flatCount}
                </p>
              </div>
              {canEdit ? (
                <ActionMenu
                  label={th("actionsFor", { name: entrance.name })}
                  items={[
                    { label: tc("edit"), onSelect: () => openEdit(entrance) },
                    { label: tc("delete"), tone: "danger", onSelect: () => setToDelete(entrance) },
                  ]}
                />
              ) : null}
            </Card>
          ))}
        </ul>
      )}

      <Modal
        open={formOpen && canEdit}
        onClose={closeForm}
        title={editingId ? t("editEntrance") : t("addEntrance")}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={!formName.trim()}>
              {tc("save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("entranceName")} required>
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
          </Field>
          <Field label={t("streetNumber")}>
            <Input value={formStreetNumber} onChange={(e) => setFormStreetNumber(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        tone="danger"
        title={th("deleteEntranceTitle", { name: toDelete?.name ?? "" })}
        description={th("deleteEntranceBody")}
        confirmLabel={t("deleteEntrance")}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </section>
  );
}
