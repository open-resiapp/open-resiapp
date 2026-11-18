"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button, Card, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";

import {
  allowedBoardTargets,
  FAULT_PRIORITIES,
  FAULT_VISIBILITIES,
  needsReason,
  type FaultPriority,
  type FaultStatus,
  type FaultVisibility,
} from "../engine/transitions";
import type { FaultBoardAccess } from "../engine/views";
import type { FilterOption } from "./BoardFilters";
import { jsonInit, useFaultApi } from "./useFaultApi";

// Board panel of a fault (BYT-20261118-004): explicit per-state status
// buttons (no cycling toggle) + task fields. Caretaker access hides the
// internal note, invoiced flag and expense link.

export interface BoardPanelFault {
  id: string;
  status: FaultStatus;
  priority: FaultPriority;
  visibility: FaultVisibility;
  categoryId: string | null;
  assigneeUserId: string | null;
  contractorId: string | null;
  invoiced: boolean | null;
  expenseId: string | null;
  internalNote: string | null;
  locationNote: string | null;
}

export function BoardFaultPanel({
  fault,
  access,
  categories,
  users,
  contractors,
  expenses,
}: {
  fault: BoardPanelFault;
  access: FaultBoardAccess;
  categories: FilterOption[];
  users: FilterOption[];
  contractors: FilterOption[];
  /** null = accounting disabled (picker hidden). */
  expenses: FilterOption[] | null;
}) {
  const t = useTranslations("Faults");
  const locale = useLocale();
  const router = useRouter();
  const statusApi = useFaultApi();
  const fieldsApi = useFaultApi();
  const extraApi = useFaultApi();
  const full = access === "full";

  // ── Status ──
  const [target, setTarget] = useState<FaultStatus | null>(null);
  const [message, setMessage] = useState("");
  const targets = allowedBoardTargets(fault.status);

  const sendStatus = async () => {
    if (!target) return;
    const res = await statusApi.call(
      `/api/modules/faults/${fault.id}/status`,
      jsonInit("POST", { to: target, message: message.trim() || null, locale })
    );
    if (res) {
      setTarget(null);
      setMessage("");
      router.refresh();
    }
  };

  // ── Fields ──
  const initialAssignee = fault.assigneeUserId
    ? `u:${fault.assigneeUserId}`
    : fault.contractorId
      ? `c:${fault.contractorId}`
      : "";
  const [priority, setPriority] = useState<FaultPriority>(fault.priority);
  const [visibility, setVisibility] = useState<FaultVisibility>(fault.visibility);
  const [categoryId, setCategoryId] = useState(fault.categoryId ?? "");
  const [assignee, setAssignee] = useState(initialAssignee);
  const [invoiced, setInvoiced] = useState(fault.invoiced ?? false);
  const [expenseId, setExpenseId] = useState(fault.expenseId ?? "");
  const [internalNote, setInternalNote] = useState(fault.internalNote ?? "");
  const [locationNote, setLocationNote] = useState(fault.locationNote ?? "");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaved(false);
    const body: Record<string, unknown> = {
      priority,
      visibility,
      categoryId: categoryId || null,
      assigneeUserId: assignee.startsWith("u:") ? assignee.slice(2) : null,
      contractorId: assignee.startsWith("c:") ? assignee.slice(2) : null,
      locationNote: locationNote.trim() || null,
    };
    if (full) {
      body.invoiced = invoiced;
      body.internalNote = internalNote.trim() || null;
      if (expenses) body.expenseId = expenseId || null;
    }
    const res = await fieldsApi.call(`/api/modules/faults/${fault.id}/board`, jsonInit("PATCH", body));
    if (res) {
      setSaved(true);
      router.refresh();
    }
  };

  // ── Add contractor / category ──
  const [adding, setAdding] = useState<"contractor" | "category" | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const addExtra = async () => {
    if (!adding || !newName.trim()) return;
    const url = adding === "contractor" ? "/api/modules/faults/contractors" : "/api/modules/faults/categories";
    const res = await extraApi.call<{ id: string }>(
      url,
      jsonInit("POST", adding === "contractor" ? { name: newName.trim(), phone: newPhone.trim() } : { name: newName.trim() })
    );
    if (res?.id) {
      if (adding === "contractor") setAssignee(`c:${res.id}`);
      else setCategoryId(res.id);
      setAdding(null);
      setNewName("");
      setNewPhone("");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      <Card as="section" padding="md" className="space-y-3" aria-labelledby="fault-status-h">
        <h2 id="fault-status-h" className="text-lg font-semibold text-ui-text">
          {t("board.statusHeading")}
        </h2>
        {targets.length === 0 ? (
          <p className="text-base text-ui-text-muted">{t("board.noTransitions")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targets.map((s) => (
              <Button
                key={s}
                variant={s === "rejected" ? "danger" : "secondary"}
                onClick={() => {
                  statusApi.setError(null);
                  setTarget(s);
                }}
              >
                {t(`board.moveTo.${s}`)}
              </Button>
            ))}
          </div>
        )}
        {statusApi.error && !target ? (
          <p role="alert" className="text-base text-ui-danger">{statusApi.error}</p>
        ) : null}
      </Card>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? t(`board.moveTo.${target}`) : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={statusApi.busy}>
              {t("board.cancel")}
            </Button>
            <Button loading={statusApi.busy} onClick={sendStatus}>
              {t("board.confirmStatus")}
            </Button>
          </>
        }
      >
        <Field
          label={
            target && needsReason(fault.status, target)
              ? t("board.reasonRequired")
              : t("board.reasonOptional")
          }
          hint={t("board.reasonHint")}
          required={!!target && needsReason(fault.status, target)}
        >
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {statusApi.error ? (
          <p role="alert" className="mt-3 text-base text-ui-danger">{statusApi.error}</p>
        ) : null}
      </Modal>

      <Card as="section" padding="md" className="space-y-4" aria-labelledby="fault-fields-h">
        <h2 id="fault-fields-h" className="text-lg font-semibold text-ui-text">
          {t("board.fieldsHeading")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("board.priority")} htmlFor="fault-priority">
            <Select id="fault-priority" value={priority} onChange={(e) => setPriority(e.target.value as FaultPriority)}>
              {FAULT_PRIORITIES.map((p) => (
                <option key={p} value={p}>{t(`priority.${p}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("board.visibility")} htmlFor="fault-visibility">
            <Select
              id="fault-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as FaultVisibility)}
            >
              {FAULT_VISIBILITIES.map((v) => (
                <option key={v} value={v}>{t(`visibility.${v}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("board.category")} htmlFor="fault-category">
            <Select id="fault-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("board.none")}</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("board.assignee")} htmlFor="fault-assignee" hint={t("board.assigneeHint")}>
            <Select id="fault-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t("board.none")}</option>
              {users.length ? (
                <optgroup label={t("board.boardUsers")}>
                  {users.map((u) => (
                    <option key={u.value} value={`u:${u.value}`}>{u.label}</option>
                  ))}
                </optgroup>
              ) : null}
              {contractors.length ? (
                <optgroup label={t("board.contractors")}>
                  {contractors.map((c) => (
                    <option key={c.value} value={`c:${c.value}`}>{c.label}</option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setAdding("category")}>{t("board.addCategory")}</Button>
          <Button variant="ghost" onClick={() => setAdding("contractor")}>{t("board.addContractor")}</Button>
        </div>
        <Field label={t("board.locationNote")} htmlFor="fault-location-note">
          <Input
            id="fault-location-note"
            value={locationNote}
            maxLength={255}
            onChange={(e) => setLocationNote(e.target.value)}
          />
        </Field>
        {full ? (
          <>
            <label className="flex min-h-11 items-center gap-3 text-base text-ui-text">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={invoiced}
                onChange={(e) => setInvoiced(e.target.checked)}
              />
              {t("board.invoiced")}
            </label>
            {expenses ? (
              <Field label={t("board.expense")} htmlFor="fault-expense" hint={t("board.expenseHint")}>
                <Select id="fault-expense" value={expenseId} onChange={(e) => setExpenseId(e.target.value)}>
                  <option value="">{t("board.none")}</option>
                  {expenses.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label={t("board.internalNote")} htmlFor="fault-internal-note" hint={t("board.internalNoteHint")}>
              <Textarea
                id="fault-internal-note"
                rows={3}
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        {fieldsApi.error ? <p role="alert" className="text-base text-ui-danger">{fieldsApi.error}</p> : null}
        {saved ? <p role="status" className="text-base text-ui-success">{t("board.saved")}</p> : null}
        <Button loading={fieldsApi.busy} onClick={save}>
          {t("board.save")}
        </Button>
      </Card>

      <Modal
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={adding === "contractor" ? t("board.addContractor") : t("board.addCategory")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(null)} disabled={extraApi.busy}>
              {t("board.cancel")}
            </Button>
            <Button loading={extraApi.busy} onClick={addExtra}>
              {t("board.add")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("board.name")} required>
            <Input value={newName} maxLength={adding === "contractor" ? 255 : 120} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          {adding === "contractor" ? (
            <Field label={t("board.phone")}>
              <Input type="tel" value={newPhone} maxLength={40} onChange={(e) => setNewPhone(e.target.value)} />
            </Field>
          ) : null}
          {extraApi.error ? <p role="alert" className="text-base text-ui-danger">{extraApi.error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
