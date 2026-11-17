"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ActionMenu,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  Select,
} from "@/components/ui";
import Notice, { type NoticeState } from "./Notice";
import type { Entrance } from "./EntrancesTab";

export interface FlatRow {
  id: string;
  flatNumber: string;
  floor: number;
  area: number | null;
  shareNumerator: number;
  shareDenominator: number;
  entranceId: string;
  entranceName: string | null;
}

interface FlatsTabProps {
  canEdit: boolean;
  flats: FlatRow[];
  entrances: Entrance[];
  onChanged: () => Promise<void>;
}

export default function FlatsTab({ canEdit, flats, entrances, onChanged }: FlatsTabProps) {
  const t = useTranslations("Settings");
  const th = useTranslations("SettingsHub");
  const tc = useTranslations("Common");
  const [message, setMessage] = useState<NoticeState>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formEntranceId, setFormEntranceId] = useState("");
  const [formFlatNumber, setFormFlatNumber] = useState("");
  const [formFloor, setFormFloor] = useState("0");
  const [formArea, setFormArea] = useState("");
  const [formShareNum, setFormShareNum] = useState("");
  const [formShareDen, setFormShareDen] = useState("10000");
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<FlatRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormEntranceId("");
    setFormFlatNumber("");
    setFormFloor("0");
    setFormArea("");
    setFormShareNum("");
    setFormShareDen("10000");
  };

  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (flat: FlatRow) => {
    setEditingId(flat.id);
    setFormEntranceId(flat.entranceId);
    setFormFlatNumber(flat.flatNumber);
    setFormFloor(String(flat.floor));
    setFormArea(flat.area !== null ? String(flat.area) : "");
    setFormShareNum(String(flat.shareNumerator));
    setFormShareDen(String(flat.shareDenominator));
    setFormOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        entranceId: formEntranceId,
        flatNumber: formFlatNumber,
        floor: parseInt(formFloor) || 0,
        area: formArea ? parseInt(formArea) : null,
        shareNumerator: parseInt(formShareNum),
        shareDenominator: parseInt(formShareDen),
      };
      const url = editingId ? `/api/flats/${editingId}` : "/api/flats";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      resetForm();
      setMessage({ type: "success", text: t("flatSaved") });
      await onChanged();
    } catch (e) {
      setMessage({ type: "error", text: (e instanceof Error && e.message) || t("flatSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/flats/${toDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      setMessage({ type: "success", text: t("flatDeleted") });
      await onChanged();
    } catch (e) {
      setMessage({ type: "error", text: (e instanceof Error && e.message) || t("flatDeleteFailed") });
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  const flatsByEntrance = flats.reduce<Record<string, FlatRow[]>>((acc, flat) => {
    const key = flat.entranceName || "—";
    (acc[key] ??= []).push(flat);
    return acc;
  }, {});

  return (
    <section aria-labelledby="flats-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="flats-heading" className="text-xl font-semibold text-ui-text">
          {t("flats")}
        </h2>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/admin/import" variant="ghost">
              {th("importFlatsLink")}
            </ButtonLink>
            <Button variant="secondary" onClick={openAdd}>
              {t("addFlat")}
            </Button>
          </div>
        ) : null}
      </div>

      <Notice state={message} />

      {flats.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("noFlats")}</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(flatsByEntrance).map(([entranceName, rows]) => (
            <div key={entranceName}>
              <h3 className="mb-2 text-base font-semibold text-ui-text-muted">{entranceName}</h3>
              <ul className="space-y-2">
                {rows.map((flat) => (
                  <Card as="li" key={flat.id} padding="sm" className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-ui-text">
                        {th("flatTitle", { number: flat.flatNumber })}
                        <span className="font-normal text-ui-text-muted">
                          {" · "}
                          {th("floorValue", { floor: flat.floor })}
                        </span>
                      </p>
                      <p className="text-base text-ui-text-muted">
                        {th("shareValue", { share: `${flat.shareNumerator}/${flat.shareDenominator}` })}
                        {" · "}
                        {flat.area !== null ? `${flat.area} m²` : th("areaMissing")}
                      </p>
                    </div>
                    {canEdit ? (
                      <ActionMenu
                        label={th("actionsFor", { name: th("flatTitle", { number: flat.flatNumber }) })}
                        items={[
                          { label: tc("edit"), onSelect: () => openEdit(flat) },
                          { label: tc("delete"), tone: "danger", onSelect: () => setToDelete(flat) },
                        ]}
                      />
                    ) : null}
                  </Card>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen && canEdit}
        onClose={resetForm}
        title={editingId ? t("editFlat") : t("addFlat")}
        footer={
          <>
            <Button variant="secondary" onClick={resetForm}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={handleSave}
              loading={saving}
              disabled={!formEntranceId || !formFlatNumber || !formShareNum || !formShareDen}
            >
              {tc("save")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("entrance")} required className="sm:col-span-2">
            <Select value={formEntranceId} onChange={(e) => setFormEntranceId(e.target.value)}>
              <option value="">—</option>
              {entrances.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("flatNumber")} required>
            <Input value={formFlatNumber} onChange={(e) => setFormFlatNumber(e.target.value)} />
          </Field>
          <Field label={t("floor")}>
            <Input type="number" value={formFloor} onChange={(e) => setFormFloor(e.target.value)} />
          </Field>
          <Field label={t("area")}>
            <Input type="number" value={formArea} onChange={(e) => setFormArea(e.target.value)} />
          </Field>
          <span className="hidden sm:block" aria-hidden="true" />
          <Field label={t("shareNumerator")} required>
            <Input type="number" value={formShareNum} onChange={(e) => setFormShareNum(e.target.value)} />
          </Field>
          <Field label={t("shareDenominator")} required>
            <Input type="number" value={formShareDen} onChange={(e) => setFormShareDen(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        tone="danger"
        title={th("deleteFlatTitle", { number: toDelete?.flatNumber ?? "" })}
        description={th("deleteFlatBody")}
        confirmLabel={t("deleteFlat")}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </section>
  );
}
