"use client";

// BYT-20261118-002 — the board's guided process on the voting detail:
// Príprava · Oznámenie · Priebeh · Uzavretie · Zápisnica. Each step shows
// exactly one primary action; a step is never hidden for reading, only its
// action is disabled with the reason next to it.
//
// Status changes go through PATCH /api/votings/[id] { action } — the server
// state machine (workflow/transitions.ts) is the authority; this component
// only maps its codes to VotingWorkflow.errors.*.
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card, Field, Input, Select, Textarea, useConfirm } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { timeZoneForCountry } from "@/lib/time-zone";
import { minStartDate, civilDate, type NoticeRules } from "@modules/voting/src/workflow/notice";
import {
  REOPEN_NOTE_MIN,
  publicationDeadline,
  type VotingAction,
} from "@modules/voting/src/workflow/transitions";
import { VOTING_WORKFLOW_ERRORS } from "@modules/voting/src/workflow/error-codes";
import type { VotingDetail, VotingOfficial } from "./types";


type StepKey = "prepare" | "announce" | "progress" | "close" | "minutes";
const STEPS: StepKey[] = ["prepare", "announce", "progress", "close", "minutes"];

function currentStep(v: VotingDetail): StepKey {
  if (v.status === "draft") return "prepare";
  if (v.status === "active") return "progress";
  return v.resultPublishedAt ? "minutes" : "close";
}

export default function WorkflowPanel({
  voting,
  country,
  noticeRules,
  onEdit,
  onChanged,
}: {
  voting: VotingDetail;
  country: "sk" | "cz";
  /** BYT-20261118-020: regime + stanovy lead time (workflow/notice.ts noticeRulesFor). */
  noticeRules?: NoticeRules;
  onEdit: () => void;
  /** Called after a successful change; the page refetches the voting once. */
  onChanged: () => void;
}) {
  const t = useTranslations("VotingWorkflow");
  const tVoting = useTranslations("Voting");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<VotingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReopen, setShowReopen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const tz = timeZoneForCountry(country);
  const today = civilDate(new Date(), tz);
  const [publishedOn, setPublishedOn] = useState(today);

  const step = currentStep(voting);
  const stepIdx = STEPS.indexOf(step);
  const dateFmt = (d: Date | string) =>
    format.dateTime(new Date(d), { day: "numeric", month: "long", year: "numeric" });

  function errorText(code: string, minDate?: string) {
    if (!VOTING_WORKFLOW_ERRORS.has(code)) return t("errors.generic");
    return t(`errors.${code}`, { minDate: minDate ? dateFmt(`${minDate}T12:00:00`) : "" });
  }

  async function run(action: VotingAction, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/votings/${voting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(errorText(String(data.error ?? ""), data.minDate));
        return;
      }
      setShowReopen(false);
      setReopenNote("");
      onChanged();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function announce() {
    const ok = await confirm({
      title: t("announceConfirmTitle"),
      description: t("announceConfirmText"),
      confirmLabel: t("announce"),
    });
    if (ok) run("announce");
  }

  async function close() {
    const ok = await confirm({
      title: tVoting("endVotingConfirmTitle"),
      description: tVoting("endVotingConfirmText"),
      confirmLabel: tVoting("endVotingConfirmButton"),
      tone: "danger",
    });
    if (ok) run("close");
  }

  // SK lead time (§14a ods. 2): earliest start if announced today.
  const minStart = voting.status === "draft" ? minStartDate(country, new Date(), tz, noticeRules) : null;
  const startTooEarly = minStart !== null && civilDate(new Date(voting.startsAt), tz) < minStart;
  const deadline = publicationDeadline(new Date(voting.endsAt));
  const deadlinePassed = deadline.getTime() < Date.now();
  const noteOk = reopenNote.trim().length >= REOPEN_NOTE_MIN;

  return (
    <Card as="section" className="mb-6 space-y-4" aria-labelledby="voting-workflow-heading">
      <h2 id="voting-workflow-heading" className="text-lg font-bold text-ui-text">
        {t("heading")}
      </h2>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label={t("stepsLabel")}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? "step" : undefined}
            className={cn(
              "border-l-4 pl-2 text-base sm:border-l-0 sm:border-t-4 sm:pl-0 sm:pt-2",
              s === step
                ? "border-ui-primary font-semibold text-ui-text"
                : i < stepIdx
                  ? "border-ui-primary/40 text-ui-text-muted"
                  : "border-ui-border text-ui-text-muted"
            )}
          >
            {i + 1}. {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {voting.place && (
        <p className="text-base text-ui-text">
          <span className="font-medium">{t("placeLabel")}:</span> {voting.place}
        </p>
      )}
      {voting.announcedAt && (
        <p className="text-base text-ui-text-muted">
          {t("announcedOn", { date: dateFmt(voting.announcedAt) })}
        </p>
      )}

      {/* 1–2. Preparation → announcement */}
      {voting.status === "draft" && (
        <div className="space-y-3">
          {minStart && (
            <p className={cn("text-base", startTooEarly ? "text-ui-danger" : "text-ui-text-muted")}>
              {t("leadTimeHint", { date: dateFmt(`${minStart}T12:00:00`) })}
            </p>
          )}
          <OfficialsEditor voting={voting} editPlace onSaved={onChanged} />
          <div className="flex flex-wrap gap-3 border-t border-ui-border pt-4">
            <Button variant="secondary" onClick={onEdit}>
              {tCommon("edit")}
            </Button>
            <Button onClick={announce} loading={busy === "announce"} disabled={busy !== null}>
              {t("announce")}
            </Button>
          </div>
        </div>
      )}

      {/* 3. Progress → close. Officials stay editable until the result is
          published (a meeting elects its chair / recorder / verifiers). */}
      {voting.status === "active" && (
        <div className="border-t border-ui-border pt-4">
          <OfficialsEditor voting={voting} editPlace={false} onSaved={onChanged} />
        </div>
      )}
      {voting.status === "active" && (
        <div className="flex flex-wrap gap-3 border-t border-ui-border pt-4">
          <Button variant="danger" onClick={close} loading={busy === "close"} disabled={busy !== null}>
            {tVoting("endVoting")}
          </Button>
        </div>
      )}

      {/* 4. Closed, result not yet published: publish (primary) or reopen */}
      {voting.status === "closed" && !voting.resultPublishedAt && (
        <div className="space-y-4 border-t border-ui-border pt-4">
          {/* Minutes step: officials + a verifier's refusal to sign (§14a ods. 8). */}
          <OfficialsEditor voting={voting} editPlace={false} showRefusal onSaved={onChanged} />
          <p className={cn("text-base", deadlinePassed ? "text-ui-danger" : "text-ui-text")}>
            {t("publishDeadline", { date: dateFmt(deadline) })}
          </p>
          <Field label={t("publishedOnLabel")} hint={t("publishedOnHint")}>
            <Input
              type="date"
              value={publishedOn}
              max={today}
              onChange={(e) => setPublishedOn(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() =>
                run("publish", {
                  // Noon local avoids a day shift across time zones.
                  publishedAt: publishedOn ? new Date(`${publishedOn}T12:00:00`).toISOString() : undefined,
                })
              }
              loading={busy === "publish"}
              disabled={busy !== null || !publishedOn}
            >
              {t("publish")}
            </Button>
            {!showReopen && (
              <Button variant="secondary" onClick={() => setShowReopen(true)} disabled={busy !== null}>
                {t("reopen")}
              </Button>
            )}
          </div>
          {showReopen && (
            <div className="space-y-3 rounded-lg border border-ui-border p-4">
              <p className="text-base text-ui-text">{t("reopenExplain")}</p>
              <Field
                label={t("reopenNoteLabel")}
                hint={t("reopenNoteHint", { min: REOPEN_NOTE_MIN })}
                required
              >
                <Textarea
                  value={reopenNote}
                  onChange={(e) => setReopenNote(e.target.value)}
                  rows={3}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button variant="ghost" onClick={() => setShowReopen(false)}>
                  {tCommon("cancel")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => run("reopen", { note: reopenNote })}
                  loading={busy === "reopen"}
                  disabled={busy !== null || !noteOk}
                >
                  {t("reopenConfirm")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Published — officials read-only */}
      {voting.status === "closed" && voting.resultPublishedAt && (
        <div className="space-y-2 border-t border-ui-border pt-4">
          <OfficialsReadOnly officials={voting.officials ?? []} />
          <p className="text-base text-ui-text">
            {t("publishedOn", { date: dateFmt(voting.resultPublishedAt) })}
          </p>
          <p className="text-base text-ui-text-muted">{t("noReopenAfterPublish")}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      )}

      {voting.events && voting.events.length > 0 && (
        <details className="border-t border-ui-border pt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-medium text-ui-text">
            {t("historyHeading")}
          </summary>
          <ul className="mt-2 divide-y divide-ui-border">
            {voting.events.map((e) => (
              <li key={e.id} className="py-2 text-base">
                <p className="text-ui-text">
                  {t(`events.${e.kind}`)} ·{" "}
                  {format.dateTime(new Date(e.createdAt), {
                    day: "numeric",
                    month: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </p>
                {e.note && (
                  <p className="whitespace-pre-wrap break-words text-ui-text-muted">{e.note}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

// ── Officials, read-only after publication ───────────────
function OfficialsReadOnly({ officials }: { officials: VotingOfficial[] }) {
  const t = useTranslations("VotingWorkflow");
  if (officials.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-base font-medium text-ui-text">{t("officialsHeading")}</p>
      <ul className="space-y-1">
        {officials.map((o, i) => (
          <li key={o.id ?? i} className="text-base text-ui-text">
            {t(`roles.${o.role}`)}: {o.name}
            {o.refusedToSign ? (
              <span className="block text-ui-text-muted">
                {t("officialRefused")}
                {o.refusalStatement ? ` — ${o.refusalStatement}` : ""}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-base text-ui-text-muted">{t("officialsLockedAfterPublish")}</p>
    </div>
  );
}

// ── Place (draft only) + officials (until the result is published) ──
function OfficialsEditor({
  voting,
  editPlace,
  showRefusal = false,
  onSaved,
}: {
  voting: VotingDetail;
  /** Place is announced content (§14a ods. 2) — editable in the draft only. */
  editPlace: boolean;
  /** Minutes step: record a verifier's refusal to sign (§14a ods. 8). */
  showRefusal?: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("VotingWorkflow");
  const tCommon = useTranslations("Common");
  const [place, setPlace] = useState(voting.place ?? "");
  const [officials, setOfficials] = useState<VotingOfficial[]>(voting.officials ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(i: number, patch: Partial<VotingOfficial>) {
    setOfficials((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const cleaned = officials
      .filter((o) => o.name.trim())
      .map((o) =>
        o.role === "verifier" && o.refusedToSign
          ? o
          : { ...o, refusedToSign: false, refusalStatement: null }
      );
    // Two small requests: officials list, then (draft only) place.
    const r1 = await fetch(`/api/votings/${voting.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officials: cleaned }),
    });
    const r2 =
      r1.ok && editPlace
        ? await fetch(`/api/votings/${voting.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ place: place.trim() || null }),
          })
        : null;
    setSaving(false);
    if (!r1.ok || (editPlace && !r2?.ok)) {
      const data = await (r1.ok ? r2 : r1)?.json().catch(() => ({}));
      const code = String((data as { error?: unknown } | undefined)?.error ?? "");
      setError(VOTING_WORKFLOW_ERRORS.has(code) ? t(`errors.${code}`, { minDate: "" }) : t("errors.generic"));
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <div className="space-y-3">
      {editPlace && (
        <Field label={t("placeLabel")} hint={t("placeHint")}>
          <Input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={500} />
        </Field>
      )}
      <fieldset className="space-y-3">
        <legend className="text-base font-medium text-ui-text">{t("officialsHeading")}</legend>
        <p className="text-base text-ui-text-muted">{t("officialsHint")}</p>
        {officials.map((o, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <Field label={t("officialRoleLabel")}>
              <Select
                value={o.role}
                onChange={(e) => update(i, { role: e.target.value as VotingOfficial["role"] })}
              >
                <option value="chair">{t("roles.chair")}</option>
                <option value="recorder">{t("roles.recorder")}</option>
                <option value="verifier">{t("roles.verifier")}</option>
              </Select>
            </Field>
            <Field label={t("officialNameLabel")}>
              <Input value={o.name} onChange={(e) => update(i, { name: e.target.value })} />
            </Field>
            <Button
              variant="ghost"
              onClick={() => setOfficials((prev) => prev.filter((_, idx) => idx !== i))}
            >
              {t("removeOfficial")}
            </Button>
            {showRefusal && o.role === "verifier" && (
              <div className="space-y-2 sm:col-span-3">
                <label className="flex min-h-11 items-start gap-3 text-base text-ui-text">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0"
                    checked={o.refusedToSign}
                    onChange={(e) =>
                      update(i, {
                        refusedToSign: e.target.checked,
                        refusalStatement: e.target.checked ? o.refusalStatement : null,
                      })
                    }
                  />
                  <span>{t("officialRefusedLabel")}</span>
                </label>
                {o.refusedToSign && (
                  <Field label={t("officialRefusalStatementLabel")} hint={t("officialRefusalStatementHint")}>
                    <Textarea
                      value={o.refusalStatement ?? ""}
                      onChange={(e) => update(i, { refusalStatement: e.target.value })}
                      rows={3}
                      maxLength={4000}
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            setOfficials((prev) => [
              ...prev,
              { role: "verifier", name: "", userId: null, refusedToSign: false, refusalStatement: null },
            ])
          }
        >
          {t("addOfficial")}
        </Button>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={save} loading={saving}>
          {saving ? tCommon("saving") : t(editPlace ? "savePreparation" : "saveOfficials")}
        </Button>
        {saved && <span className="text-base text-ui-text-muted">{t("saved")}</span>}
      </div>
      {error && (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      )}
    </div>
  );
}
