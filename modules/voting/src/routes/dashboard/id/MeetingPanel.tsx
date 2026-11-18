"use client";

// BYT-20261118-001 — "Účasť" on a meeting voting.
//  - Board (admin / chairman / vote counter): announcement + invitation,
//    tab "Odpovede" (planned attendance by share) and tab "Prezenčná
//    listina" (door list), export.
//  - Owner: own answer + own attendance line + aggregate counts only.
// Data loads once per visit and after the user's own action — no polling.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import MeetingRsvpButtons, { type MeetingRsvpValue } from "@/components/community/MeetingRsvpButtons";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Icon,
  Input,
  LoadingBlock,
  Modal,
  Select,
  Tabs,
  useConfirm,
} from "@/components/ui";
import type { AttendanceOwnerLine, MeetingAttendanceSummary, RsvpOverview } from "@modules/voting/src/workflow/attendance";
import { Link } from "@/i18n/navigation";
import type { BuildingInfo, VotingDetail } from "./types";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { getLegalCopy } from "@/lib/legal-copy";

interface BoardData {
  overview: RsvpOverview & {
    voting: {
      id: string;
      status: string;
      startsAt: string;
      place: string | null;
      meetingPostId: string | null;
      meetingChangeSeq: number;
    };
  };
  attendance: {
    lines: AttendanceOwnerLine[];
    summary: MeetingAttendanceSummary;
    mandates: { id: string; fromOwnerId: string; toOwnerName: string | null }[];
    writeError: string | null;
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function useErrorText() {
  const t = useTranslations("MeetingAttendance.errors");
  return (code: string | undefined) => (code && t.has(code) ? t(code as never) : t("generic"));
}

async function readError(res: Response | null): Promise<string | undefined> {
  if (!res) return undefined;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error;
}

// ── Board ──────────────────────────────────────────────

export function MeetingBoardPanel({
  voting,
  building,
  canAnnounce,
  castShare,
}: {
  voting: VotingDetail;
  building: BuildingInfo | null;
  /** Board (admin / chairman): announce, invite, change, cancel. */
  canAnnounce: boolean;
  /** Weight share of CAST ballots (engine basis), shown next to attendance. */
  castShare: number | null;
}) {
  const t = useTranslations("MeetingAttendance");
  const tWorkflow = useTranslations("VotingWorkflow");
  const errorText = useErrorText();
  const locale = useLocale();
  const format = useFormatter();
  const confirm = useConfirm();
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"answers" | "list">(
    new Date(voting.startsAt).getTime() - Date.now() < 2 * 60 * 60 * 1000 ? "list" : "answers"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{
    sent: number;
    alreadyInvited: number;
    failed: { name: string }[];
    withoutEmail: { name: string; units: string[] }[];
    noticeWarning: { minDate: string | null } | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [announcePlace, setAnnouncePlace] = useState(voting.place ?? "");

  const load = useCallback(async () => {
    const res = await fetch(`/api/votings/${voting.id}/attendance`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [voting.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function meetingAction(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/votings/${voting.id}/meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, locale }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(errorText(await readError(res)));
      return null;
    }
    const json = await res.json();
    await load();
    return json;
  }

  if (loading) return <LoadingBlock />;
  if (!data) return null;

  const ov = data.overview;
  const post = ov.voting.meetingPostId;
  // Attendance documents only where their wording is signed off
  // (src/lib/legal-copy); otherwise a "waiting for legal sign-off" note.
  const exportAllowed =
    !building || getLegalCopy(building.templateSlug, building.country).signedOff.attendance;

  return (
    <Card as="section" className="mb-6 space-y-4">
      <h2 className="text-xl font-bold text-ui-text">{t("heading")}</h2>

      {error ? (
        <p role="alert" className="rounded-lg border border-ui-danger/40 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-ui-border bg-ui-surface-muted px-4 py-3 text-base text-ui-text">
          {notice}
        </p>
      ) : null}

      {/* Announcement */}
      {!post ? (
        <div className="space-y-2">
          <p className="text-base text-ui-text-muted">
            {voting.status === "active" ? t("announce.notYet") : t("announce.notAnnounced")}
          </p>
          {canAnnounce && voting.status === "active" ? (
            <>
              {!voting.place ? (
                <Field label={t("create.placeLabel")} hint={t("create.placeHint")} required>
                  <Input
                    value={announcePlace}
                    onChange={(e) => setAnnouncePlace(e.target.value)}
                    maxLength={255}
                  />
                </Field>
              ) : null}
              <Button
                loading={busy}
                disabled={!announcePlace.trim()}
                onClick={async () => {
                  if (await meetingAction({ action: "announce", place: announcePlace.trim() })) {
                    setNotice(t("announce.done"));
                  }
                }}
              >
                <Icon name="megaphone" size={20} />
                {t("announce.button")}
              </Button>
            </>
          ) : null}
        </div>
      ) : canAnnounce ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy}
              disabled={voting.status !== "active"}
              onClick={async () => {
                // Mails every owner with an address who was not invited yet.
                const count = ov.owners.filter((o) => o.hasEmail && !o.invited).length;
                const ok = await confirm({
                  title: t("invite.confirmTitle"),
                  description: t("invite.confirmBody", { count }),
                  confirmLabel: t("invite.confirmButton"),
                });
                if (!ok) return;
                const r = await meetingAction({ action: "invite" });
                if (r) setInviteResult(r);
              }}
            >
              <Icon name="mail" size={20} />
              {t("invite.button")}
            </Button>
            <Button variant="secondary" disabled={busy || voting.status !== "active"} onClick={() => setEditing(true)}>
              <Icon name="edit" size={20} />
              {t("change.button")}
            </Button>
            {ov.voting.meetingChangeSeq > 0 ? (
              <Button
                variant="secondary"
                loading={busy}
                onClick={async () => {
                  // Mails the owners who were already invited and have an address.
                  const count = ov.owners.filter((o) => o.hasEmail && o.invited).length;
                  const ok = await confirm({
                    title: t("change.notifyConfirmTitle"),
                    description: t("change.notifyConfirmBody", { count }),
                    confirmLabel: t("change.notifyConfirmButton"),
                  });
                  if (!ok) return;
                  const r = await meetingAction({ action: "notify_change" });
                  if (r) setNotice(t("change.sent", { count: r.sent }));
                }}
              >
                <Icon name="bell" size={20} />
                {t("change.notify")}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>
              {t("cancel.button")}
            </Button>
          </div>
          {inviteResult ? (
            <div role="status" className="space-y-2 rounded-lg border border-ui-border p-4 text-base text-ui-text">
              <p>{t("invite.result", { sent: inviteResult.sent, already: inviteResult.alreadyInvited })}</p>
              {inviteResult.noticeWarning ? (
                <p className="text-ui-danger">
                  {t("invite.lateNotice", {
                    date: inviteResult.noticeWarning.minDate
                      ? format.dateTime(new Date(`${inviteResult.noticeWarning.minDate}T12:00:00`), {
                          day: "numeric",
                          month: "long",
                        })
                      : "—",
                  })}
                </p>
              ) : null}
              {inviteResult.failed.length > 0 ? (
                <p className="text-ui-danger">
                  {t("invite.failed", { names: inviteResult.failed.map((f) => f.name).join(", ") })}
                </p>
              ) : null}
              {inviteResult.withoutEmail.length > 0 ? (
                <div>
                  <p className="font-medium">{t("invite.withoutEmail")}</p>
                  <ul className="list-disc pl-6">
                    {inviteResult.withoutEmail.map((o) => (
                      <li key={o.name + o.units.join()}>
                        {o.name} ({o.units.join(", ")})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="text-base text-ui-text-muted">{t("invite.disclaimer")}</p>
        </div>
      ) : null}

      {/* Printable invitation (generic / per owner, page each) — paper
          delivery for owners without e-mail (§14a ods. 2 SK). */}
      {canAnnounce && post ? (
        <InvitationBox voting={voting} building={building} overview={ov} />
      ) : null}

      <Tabs
        aria-label={t("tabsLabel")}
        value={tab}
        onChange={(v) => setTab(v as "answers" | "list")}
        items={[
          { value: "answers", label: t("tabs.answers") },
          { value: "list", label: t("tabs.list") },
        ]}
      />

      {tab === "answers" ? (
        <RsvpOverviewView data={data} postId={post} onChanged={load} onError={setError} />
      ) : (
        <AttendanceListView
          votingId={voting.id}
          data={data}
          castShare={castShare}
          onChanged={load}
          onError={setError}
        />
      )}

      {tab === "list" ? (
        exportAllowed ? (
          <ExportBox voting={voting} building={building} />
        ) : (
          <p className="border-t border-ui-border pt-4 text-base text-ui-text-muted">
            {tWorkflow("docs.pendingLegalSignoff")}
          </p>
        )
      ) : null}

      {editing ? (
        <ChangeMeetingModal
          voting={voting}
          place={ov.voting.place}
          startsAt={ov.voting.startsAt}
          busy={busy}
          onClose={() => setEditing(false)}
          onSave={async (startsAt, place) => {
            if (await meetingAction({ action: "change", startsAt, place })) {
              setEditing(false);
              setNotice(t("change.saved"));
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        tone="danger"
        title={t("cancel.title")}
        description={t("cancel.description")}
        confirmLabel={t("cancel.confirm")}
        loading={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={async () => {
          const r = await meetingAction({ action: "cancel" });
          setConfirmCancel(false);
          if (r) setNotice(t("cancel.done", { count: r.sent }));
        }}
      />
    </Card>
  );
}

function RsvpOverviewView({
  data,
  postId,
  onChanged,
  onError,
}: {
  data: BoardData;
  postId: string | null;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const t = useTranslations("MeetingAttendance");
  const tQuorum = useTranslations("VotingWizard");
  const tRsvp = useTranslations("MeetingAttendance.rsvp");
  const errorText = useErrorText();
  const [filter, setFilter] = useState<"all" | "yes" | "no" | "maybe" | "none">("all");
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
  const [editingOwner, setEditingOwner] = useState<string | null>(null);
  const ov = data.overview;
  const total = ov.eligibleWeight;

  async function setFor(ownerId: string, status: MeetingRsvpValue | null) {
    if (!postId) return;
    setBusyOwner(ownerId);
    onError(null);
    const res = await fetch(
      status === null
        ? `/api/community/posts/${postId}/rsvp?ownerId=${encodeURIComponent(ownerId)}`
        : `/api/community/posts/${postId}/rsvp`,
      status === null
        ? { method: "DELETE" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, ownerId }),
          }
    ).catch(() => null);
    setBusyOwner(null);
    if (!res?.ok) {
      onError(errorText(await readError(res)));
      return;
    }
    await onChanged();
  }

  const owners = ov.owners.filter((o) => filter === "all" || (o.rsvp ?? "none") === filter);

  return (
    <div className="space-y-4">
      <p className="text-base font-medium text-ui-text">
        {t("overview.summary", {
          yes: ov.totals.yes.owners,
          no: ov.totals.no.owners,
          maybe: ov.totals.maybe.owners,
          none: ov.totals.none.owners,
        })}
      </p>
      <p className="text-base text-ui-text-muted">
        {t("overview.expectedShare", { pct: pct(ov.totals.yes.weight, total) })}
      </p>

      {ov.items.length > 0 ? (
        <div className="space-y-2">
          <p className="text-base font-medium text-ui-text">{t("overview.itemsHeading")}</p>
          <ul className="space-y-2">
            {ov.items.map((it) => (
              <li key={it.itemId} className="rounded-lg border border-ui-border p-3 text-base">
                <p className="break-words font-medium text-ui-text">
                  {it.idx + 1}. {it.title}
                </p>
                <p className="text-ui-text-muted">{tQuorum(`quorum.${it.quorumType}.label`)}</p>
                <p className={it.estimate === "REACHABLE" ? "text-ui-success" : "text-ui-text"}>
                  {t(`overview.estimate.${it.estimate}`, { pct: pct(ov.totals.yes.weight, total) })}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-base text-ui-text-muted">{t("overview.estimateNote")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("overview.filterLabel")}>
        {(["all", "yes", "no", "maybe", "none"] as const).map((f) => (
          <Button
            key={f}
            variant="secondary"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={filter === f ? "border-ui-primary ring-2 ring-ui-primary" : undefined}
          >
            {t(`overview.filter.${f}`)}
          </Button>
        ))}
      </div>

      <ul className="space-y-2">
        {owners.map((o) => (
          <li key={o.ownerId} className="rounded-lg border border-ui-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-base font-medium text-ui-text">{o.ownerName ?? "—"}</p>
                <p className="text-base text-ui-text-muted">
                  {o.unitLabels.join(", ")} · {t("share", { pct: pct(o.weight, total) })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={o.rsvp === "yes" ? "success" : o.rsvp === "no" ? "danger" : "neutral"}>
                  {o.rsvp ? tRsvp(o.rsvp) : t("overview.noAnswer")}
                </Badge>
                {o.source ? <Badge tone="info">{t(`overview.source.${o.source}`)}</Badge> : null}
                {!o.hasEmail ? (
                  <Badge tone="warning">{t("overview.noEmail")}</Badge>
                ) : o.invited ? (
                  <Badge tone="neutral">{t("overview.invited")}</Badge>
                ) : null}
              </div>
            </div>
            {postId ? (
              editingOwner === o.ownerId ? (
                <div className="mt-3">
                  <MeetingRsvpButtons
                    value={o.rsvp}
                    busy={busyOwner === o.ownerId}
                    legend={t("overview.setFor", { name: o.ownerName ?? "—" })}
                    onSelect={(s) => void setFor(o.ownerId, s).then(() => setEditingOwner(null))}
                    onWithdraw={() => void setFor(o.ownerId, null).then(() => setEditingOwner(null))}
                  />
                </div>
              ) : (
                <Button variant="ghost" className="mt-2" onClick={() => setEditingOwner(o.ownerId)}>
                  {t("overview.setAnswer")}
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATE_TONE = {
  present: "success",
  represented: "info",
  absent: "danger",
  not_recorded: "neutral",
} as const;

function AttendanceListView({
  votingId,
  data,
  castShare,
  onChanged,
  onError,
}: {
  votingId: string;
  data: BoardData;
  castShare: number | null;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const t = useTranslations("MeetingAttendance");
  const tRsvp = useTranslations("MeetingAttendance.rsvp");
  const errorText = useErrorText();
  const format = useFormatter();
  const [q, setQ] = useState("");
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
  const [represent, setRepresent] = useState<AttendanceOwnerLine | null>(null);
  const s = data.attendance.summary;
  const rsvpBy = useMemo(
    () => new Map(data.overview.owners.map((o) => [o.ownerId, o.rsvp])),
    [data.overview.owners]
  );
  const writable = data.attendance.writeError === null;

  async function act(body: Record<string, unknown>) {
    setBusyOwner(String(body.ownerId));
    onError(null);
    const res = await fetch(`/api/votings/${votingId}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusyOwner(null);
    if (!res?.ok) onError(errorText(await readError(res)));
    // Refresh in both cases: a double tick from another device shows up.
    await onChanged();
    return Boolean(res?.ok);
  }

  const needle = q.trim().toLowerCase();
  const lines = data.attendance.lines.filter(
    (l) =>
      !needle ||
      (l.ownerName ?? "").toLowerCase().includes(needle) ||
      l.unitLabels.some((u) => u.toLowerCase().includes(needle))
  );
  const time = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-ui-surface-muted p-3 text-base text-ui-text">
        <p className="font-semibold">
          {t("list.header", {
            owners: s.presentNowOwners,
            pct: pct(s.presentWeight, s.eligibleWeight),
          })}
        </p>
        {s.closed ? (
          <p>{t("list.absentClosed", { count: s.absentOwners })}</p>
        ) : (
          <p className="text-ui-text-muted">{t("list.notRecorded", { count: s.notRecordedOwners })}</p>
        )}
        {castShare !== null ? (
          // TODO(legal): §14b ods. 4 "present" — the engine counts cast
          // ballots, not this list. Both numbers are shown side by side.
          <p className="text-ui-text-muted">{t("list.castShare", { pct: castShare })}</p>
        ) : null}
      </div>

      {data.attendance.writeError ? (
        <p className="rounded-lg border border-ui-border px-4 py-3 text-base text-ui-text">
          {errorText(data.attendance.writeError)}
        </p>
      ) : null}

      <Field label={t("list.search")}>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>

      <ul className="space-y-2">
        {lines.map((l) => {
          const recorded = l.state === "present" || l.state === "represented";
          const busy = busyOwner === l.ownerId;
          const hint = rsvpBy.get(l.ownerId);
          return (
            <li key={l.ownerId} className="rounded-lg border border-ui-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-base font-medium text-ui-text">
                    {l.unitLabels.join(", ")} · {l.ownerName ?? "—"}
                  </p>
                  <p className="text-base text-ui-text-muted">
                    {hint ? t("list.rsvpHint", { answer: tRsvp(hint) }) : t("list.rsvpNone")}
                  </p>
                  {l.state === "represented" && l.representativeName ? (
                    <p className="text-base text-ui-text">{t("list.representedBy", { name: l.representativeName })}</p>
                  ) : null}
                  {recorded ? (
                    <p className="text-base text-ui-text-muted">
                      {t("list.arrived", { time: time(l.checkedInAt) })}
                      {l.leftAt ? ` · ${t("list.left", { time: time(l.leftAt) })}` : ""}
                    </p>
                  ) : null}
                </div>
                <Badge tone={STATE_TONE[l.state]}>{t(`states.${l.state}`)}</Badge>
              </div>
              {writable ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {!recorded ? (
                    <>
                      <Button
                        variant="secondary"
                        loading={busy}
                        onClick={() => void act({ action: "present", ownerId: l.ownerId })}
                      >
                        <Icon name="check" size={20} />
                        {t("list.markPresent")}
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setRepresent(l)}>
                        <Icon name="user" size={20} />
                        {t("list.markRepresented")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        loading={busy}
                        onClick={() =>
                          void act({ action: l.leftAt ? "back" : "left", ownerId: l.ownerId })
                        }
                      >
                        {l.leftAt ? t("list.markBack") : t("list.markLeft")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void act({ action: "remove", ownerId: l.ownerId })}
                      >
                        {t("list.undo")}
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {represent ? (
        <RepresentModal
          line={represent}
          mandates={data.attendance.mandates.filter((m) => m.fromOwnerId === represent.ownerId)}
          onClose={() => setRepresent(null)}
          onSave={async (mandateId, representativeName) => {
            const ok = await act({
              action: "represented",
              ownerId: represent.ownerId,
              mandateId,
              representativeName,
            });
            if (ok) setRepresent(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RepresentModal({
  line,
  mandates,
  onClose,
  onSave,
}: {
  line: AttendanceOwnerLine;
  mandates: { id: string; toOwnerName: string | null }[];
  onClose: () => void;
  onSave: (mandateId: string, representativeName: string) => Promise<void>;
}) {
  const t = useTranslations("MeetingAttendance.represent");
  const tUi = useTranslations("Ui");
  const [mandateId, setMandateId] = useState(mandates[0]?.id ?? "");
  const [name, setName] = useState(mandates[0]?.toOwnerName ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("title", { name: line.ownerName ?? "—" })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tUi("cancel")}
          </Button>
          {mandates.length > 0 ? (
            <Button
              disabled={!mandateId || busy}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await onSave(mandateId, name);
                setBusy(false);
              }}
            >
              {t("save")}
            </Button>
          ) : null}
        </>
      }
    >
      {mandates.length === 0 ? (
        <div className="space-y-3">
          <p className="text-base text-ui-text">{t("noMandate")}</p>
          <p className="text-base text-ui-text-muted">{t("noMandateHint")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t("mandate")}>
            <Select
              value={mandateId}
              onChange={(e) => {
                setMandateId(e.target.value);
                setName(mandates.find((m) => m.id === e.target.value)?.toOwnerName ?? "");
              }}
            >
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.toOwnerName ?? "—"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("representativeName")} hint={t("representativeHint")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function ChangeMeetingModal({
  voting,
  place,
  startsAt,
  busy,
  onClose,
  onSave,
}: {
  voting: VotingDetail;
  place: string | null;
  startsAt: string;
  busy: boolean;
  onClose: () => void;
  onSave: (startsAt: string, place: string) => Promise<void>;
}) {
  const t = useTranslations("MeetingAttendance.change");
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [when, setWhen] = useState(toLocal(startsAt));
  const [where, setWhere] = useState(place ?? voting.place ?? "");
  return (
    <Modal
      open
      onClose={onClose}
      title={t("title")}
      footer={
        <Button
          loading={busy}
          disabled={!when || !where.trim()}
          onClick={() => void onSave(new Date(when).toISOString(), where.trim())}
        >
          {t("save")}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t("when")} required>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label={t("where")} required>
          <Input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={255} />
        </Field>
        <p className="text-base text-ui-text-muted">{t("hint")}</p>
      </div>
    </Modal>
  );
}

// ── Printable invitation ───────────────────────────────

function InvitationBox({
  voting,
  building,
  overview,
}: {
  voting: VotingDetail;
  building: BuildingInfo | null;
  overview: BoardData["overview"];
}) {
  const t = useTranslations("MeetingAttendance.invitationPdf");
  const errorText = useErrorText();
  const format = useFormatter();
  const [busy, setBusy] = useState<"generic" | "noEmail" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Statutory paragraphs: SK HOA template only (legal content rule).
  const statutory =
    building?.country === "sk" && (getDisplayTemplateSlug(building.templateSlug) ?? "hoa") === "hoa";
  const noEmail = overview.owners.filter((o) => !o.hasEmail);
  const total = overview.eligibleWeight;

  async function download(kind: "generic" | "noEmail" | "all") {
    setBusy(kind);
    setError(null);
    try {
      const [{ pdf }, { default: InvitationPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./InvitationPDF"),
      ]);
      const chair = (voting.officials ?? []).find((o) => o.role === "chair")?.name;
      const owners = kind === "generic" ? [] : kind === "noEmail" ? noEmail : overview.owners;
      const doc = (
        <InvitationPDF
          statutory={statutory}
          data={{
            community: {
              name: building?.name ?? "",
              address: building?.address ?? "",
              ico: building?.ico ?? null,
            },
            when: format.dateTime(new Date(overview.voting.startsAt), {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
            place: overview.voting.place ?? voting.place ?? "",
            convenedBy: chair ?? voting.createdBy?.name ?? "",
            issuedOn: format.dateTime(new Date(), { day: "numeric", month: "long", year: "numeric" }),
            agenda: [...(voting.items ?? [])]
              .sort((a, b) => a.idx - b.idx)
              .map((i) => ({ idx: i.idx, title: i.title, description: i.description })),
          }}
          labels={{
            title: t("title"),
            addressee: t("addressee"),
            units: t("units"),
            share: t("share"),
            when: t("when"),
            place: t("place"),
            agenda: t("agenda"),
            rsvpHint: t("rsvpHint"),
            convenedBy: t("convenedBy"),
            issuedOn: t("issuedOn"),
            icoLabel: t("ico"),
          }}
          addressees={owners.map((o) => ({
            name: o.ownerName ?? "—",
            units: o.unitLabels.join(", "),
            share: `${format.number(total > 0 ? (o.weight / total) * 100 : 0, {
              maximumFractionDigits: 2,
            })} %`,
          }))}
        />
      );
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "generic" ? "pozvanka.pdf" : "pozvanky.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError(errorText(undefined));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-ui-border pt-4">
      <h3 className="text-lg font-bold text-ui-text">{t("heading")}</h3>
      <p className="text-base text-ui-text-muted">{t("hint")}</p>
      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button variant="secondary" loading={busy === "generic"} disabled={busy !== null} onClick={() => void download("generic")}>
          <Icon name="download" size={20} />
          {t("generic")}
        </Button>
        <Button
          variant="secondary"
          loading={busy === "noEmail"}
          disabled={busy !== null || noEmail.length === 0}
          onClick={() => void download("noEmail")}
        >
          <Icon name="download" size={20} />
          {t("noEmail", { count: noEmail.length })}
        </Button>
        <Button
          variant="secondary"
          loading={busy === "all"}
          disabled={busy !== null || overview.owners.length === 0}
          onClick={() => void download("all")}
        >
          <Icon name="download" size={20} />
          {t("all", { count: overview.owners.length })}
        </Button>
      </div>
    </div>
  );
}

// ── Export (§7) ────────────────────────────────────────

const MODE_KEY = "meeting-attendance-export-mode";

function ExportBox({ voting, building }: { voting: VotingDetail; building: BuildingInfo | null }) {
  const t = useTranslations("MeetingAttendance.export");
  const tRoot = useTranslations();
  // Document heading per regime (src/lib/legal-copy; HOA = sheetFilled / sheetBlank).
  const lc = getLegalCopy(building?.templateSlug, building?.country);
  const tUnitType = useTranslations("UnitType");
  const locale = useLocale();
  const format = useFormatter();
  const errorText = useErrorText();
  const [mode, setMode] = useState<"owner" | "unit">("owner");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      if (saved === "owner" || saved === "unit") setMode(saved);
    } catch {
      /* per-browser convenience only */
    }
  }, []);

  function changeMode(m: "owner" | "unit") {
    setMode(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }

  // "Len byty" (unit type, src/lib/unit-type.ts): rows without non-residential
  // units / garages; totals still count every owner. Off by default.
  const [residentialOnly, setResidentialOnly] = useState(false);
  const base = `/api/votings/${voting.id}/attendance/export?mode=${mode}&locale=${locale}${
    residentialOnly ? "&units=residential" : ""
  }`;

  async function downloadPdf(doc: "blank" | "filled") {
    setBusy(doc);
    setError(null);
    try {
      const res = await fetch(`${base}&doc=${doc}&format=json`);
      if (!res.ok) {
        setError(errorText(await readError(res)));
        return;
      }
      const data = (await res.json()) as {
        community: { name: string };
        voting: { title: string; startsAt: string; place: string | null };
        columns: string[];
        rows: {
          unit: string;
          owner: string;
          sharePct: number;
          state: string;
          representedBy: string | null;
          arrivedAt: string | null;
          leftAt: string | null;
        }[];
        totals: { eligibleOwners: number; presentOwners: number; representedOwners: number; presentSharePct: number };
      };
      const [{ pdf }, { default: AttendancePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./AttendancePDF"),
      ]);
      const time = (iso: string | null) =>
        iso ? format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" }) : "";
      const WIDTH: Record<string, number> = {
        unit: 1,
        owner: 3,
        share: 1,
        signature: 3,
        representedBy: 2.5,
        state: 1.5,
        arrivedAt: 1,
        leftAt: 1,
      };
      const columns = data.columns.map((c) => ({ key: c, label: t(`columns.${c}`), width: WIDTH[c] ?? 1 }));
      const rows = data.rows.map((r) => ({
        unit: r.unit,
        owner: r.owner,
        share: `${r.sharePct} %`,
        signature: "",
        representedBy: r.representedBy ?? "",
        state: t(`states.${r.state}`),
        arrivedAt: time(r.arrivedAt),
        leftAt: time(r.leftAt),
      }));
      const when = format.dateTime(new Date(data.voting.startsAt), {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const doc_ = (
        <AttendancePDF
          community={data.community.name || building?.name || ""}
          title={tRoot(doc === "blank" ? lc.keys.attendanceBlankHeading : lc.keys.attendanceHeading)}
          subtitle={`${data.voting.title} · ${when}${data.voting.place ? ` · ${data.voting.place}` : ""}`}
          columns={columns}
          rows={rows}
          footer={
            doc === "blank"
              ? t("totalsBlank", { eligible: data.totals.eligibleOwners })
              : t("totals", {
                  present: data.totals.presentOwners,
                  represented: data.totals.representedOwners,
                  eligible: data.totals.eligibleOwners,
                  share: data.totals.presentSharePct,
                })
          }
        />
      );
      const blob = await pdf(doc_).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc === "blank" ? "harok-na-podpis" : "prezencna-listina"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError(errorText(undefined));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-ui-border pt-4">
      <h3 className="text-lg font-bold text-ui-text">{t("heading")}</h3>
      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}
      <Field label={t("modeLabel")}>
        <Select value={mode} onChange={(e) => changeMode(e.target.value === "unit" ? "unit" : "owner")}>
          <option value="owner">{t("modeOwner")}</option>
          <option value="unit">{t("modeUnit")}</option>
        </Select>
      </Field>
      <label className="flex min-h-11 items-start gap-3 text-base text-ui-text">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={residentialOnly}
          onChange={(e) => setResidentialOnly(e.target.checked)}
        />
        <span>
          {tUnitType("exportResidentialOnly")}
          <span className="block text-ui-text-muted">{tUnitType("exportResidentialOnlyHint")}</span>
        </span>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button variant="secondary" loading={busy === "blank"} onClick={() => void downloadPdf("blank")}>
          <Icon name="download" size={20} />
          {t("blankPdf")}
        </Button>
        <Button variant="secondary" loading={busy === "filled"} onClick={() => void downloadPdf("filled")}>
          <Icon name="download" size={20} />
          {t("filledPdf")}
        </Button>
        <a
          href={`${base}&doc=filled&format=xlsx`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ui-border-strong bg-ui-surface px-4 py-2 text-base font-medium text-ui-text hover:bg-ui-surface-muted"
        >
          <Icon name="download" size={20} />
          {t("filledXlsx")}
        </a>
      </div>
      <p className="text-base text-ui-text-muted">{t("note")}</p>
    </div>
  );
}

// ── Owner ──────────────────────────────────────────────

export interface OwnState {
  votingId: string;
  status: string;
  startsAt: string;
  place: string | null;
  postId: string | null;
  postActive: boolean;
  eligible: boolean;
  myRsvp: MeetingRsvpValue | null;
  myAttendance: { state: "present" | "represented" | "absent" | "not_recorded"; representativeName: string | null } | null;
  counts: { yes: number; maybe: number; no: number };
}

export function MeetingOwnerCard({
  votingId,
  initial,
  title,
}: {
  votingId: string;
  /** Server-loaded state (Domov) — skips the first fetch. */
  initial?: OwnState;
  /** Shown on Domov with a link to the agenda (voting detail). */
  title?: string;
}) {
  const t = useTranslations("MeetingAttendance");
  const errorText = useErrorText();
  const format = useFormatter();
  const [state, setState] = useState<OwnState | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/votings/${votingId}/meeting`).catch(() => null);
    if (res?.ok) setState(await res.json());
  }, [votingId]);

  useEffect(() => {
    if (!initial) void load();
  }, [load, initial]);

  if (!state || !state.eligible) return null;

  async function answer(status: MeetingRsvpValue | null) {
    if (!state?.postId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/community/posts/${state.postId}/rsvp`,
      status === null
        ? { method: "DELETE" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) setError(errorText(await readError(res)));
    await load();
  }

  const closed = state.status === "closed";
  const started = new Date(state.startsAt).getTime() <= Date.now();

  return (
    <Card as="section" className="mb-6 space-y-3">
      <h2 className="text-lg font-bold text-ui-text">{t("owner.heading")}</h2>
      {title ? <p className="break-words text-base font-medium text-ui-text">{title}</p> : null}
      <p className="flex items-start gap-2 text-base font-medium text-ui-text">
        <Icon name="calendar" size={20} className="mt-0.5 shrink-0 text-ui-text-muted" />
        {format.dateTime(new Date(state.startsAt), {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {state.place ? (
        <p className="flex items-start gap-2 text-base text-ui-text">
          <Icon name="building" size={20} className="mt-0.5 shrink-0 text-ui-text-muted" />
          <span className="break-words">{state.place}</span>
        </p>
      ) : null}
      <p className="text-base text-ui-text">{t("owner.inPerson")}</p>

      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}

      {closed ? (
        <p className="text-base font-medium text-ui-text">
          {state.myAttendance?.state === "present"
            ? t("owner.recordedPresent")
            : state.myAttendance?.state === "represented"
              ? t("owner.recordedRepresented", { name: state.myAttendance.representativeName ?? "—" })
              : t("owner.notRecorded")}
        </p>
      ) : null}

      {state.postId ? (
        <>
          <MeetingRsvpButtons
            value={state.myRsvp}
            busy={busy}
            readOnly={closed || started || !state.postActive}
            onSelect={(s) => void answer(s)}
            onWithdraw={() => void answer(null)}
          />
          <p className="text-base text-ui-text-muted">
            {t("rsvp.counts", { yes: state.counts.yes, maybe: state.counts.maybe, no: state.counts.no })}
          </p>
        </>
      ) : null}
      {closed ? <p className="text-base text-ui-text-muted">{t("owner.disagree")}</p> : null}
      {title ? (
        <Link
          href={`/voting/${votingId}`}
          className="inline-flex min-h-11 items-center gap-1 text-base font-medium text-ui-text underline underline-offset-2"
        >
          {t("owner.agendaLink")}
          <Icon name="chevronRight" size={20} />
        </Link>
      ) : null}
    </Card>
  );
}
