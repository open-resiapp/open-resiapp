"use client";

// Financie → Ročné úlohy → Odpočty a osoby (BYT-20261118-006). One fetch
// per (dom, year) — units LEFT JOIN round entries — and every filter
// (chýbajúce / nevyriešené / všetko) is derived client-side from it. No
// polling, no event refetch: the table reloads only after this page's own
// writes. Board readers (chairman) see and export; writers (treasurer /
// admin) also set up the round, resolve, enter on behalf, record building
// meters and apply person-months to the next predpis. The server enforces
// every rule — this page only hides buttons.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Tabs,
  cn,
  type BadgeTone,
} from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";
import { MeterForm, PersonsForm } from "@modules/accounting/src/components/owner/ReadingsSection";
import type {
  BoardRoundData,
  BoardUnitRow,
  InputStatus,
} from "@modules/accounting/src/lib/reading-rounds";
import {
  ROUND_METER_TYPES,
  isReadingErrorCode,
  milliToDisplay,
  parseMilli,
  type MeterType,
  type OwnerReadingEntry,
} from "@modules/accounting/src/lib/reading-rounds-format";

type Filter = "missing" | "unresolved" | "all";

const STATUS_TONE: Record<InputStatus, BadgeTone> = {
  missing: "danger",
  submitted: "info",
  late: "warning",
  resolved: "success",
};

const textLink = cn(
  "inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-base font-medium text-ui-text underline underline-offset-4",
  focusRing
);

function isMissing(u: BoardUnitRow): boolean {
  if (u.persons && u.persons.status === "missing") return true;
  return Object.values(u.meters).some((c) => c === null);
}

function isUnresolved(u: BoardUnitRow): boolean {
  if (u.persons && (u.persons.status === "submitted" || u.persons.status === "late")) return true;
  return Object.values(u.meters).some((c) => c != null && !c.resolved);
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, error: data?.error };
}

export default function ReadingsBoardPage() {
  const t = useTranslations("ReadingRounds.board");
  const tErr = useTranslations("ReadingRounds.errors");
  const access = useAccountingAccess();
  const params = useSearchParams();
  const initialYear = Number(params.get("year")) || new Date().getUTCFullYear();

  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<(BoardRoundData & { canWrite: boolean }) | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<{ unit: BoardUnitRow; input: "persons" | MeterType } | null>(null);
  const [editRound, setEditRound] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const errText = useCallback(
    (code: unknown) => (isReadingErrorCode(code) ? tErr(code) : tErr("generic")),
    [tErr]
  );

  const load = useCallback(() => {
    setLoadError(false);
    fetch(`/api/accounting/readings/board?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        setData(d);
        setSelected(new Set());
      })
      .catch(() => setLoadError(true));
  }, [year]);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === "missing") return data.units.filter(isMissing);
    if (filter === "unresolved") return data.units.filter(isUnresolved);
    return data.units;
  }, [data, filter]);

  const canWrite = Boolean(data?.canWrite) && !data?.locked;

  async function resolve(unitIds: string[], resolved: boolean) {
    if (!data?.round || unitIds.length === 0) return;
    setBusy(true);
    setError(null);
    const r = await postJson("/api/accounting/readings/resolve", {
      roundId: data.round.id,
      unitIds,
      resolved,
    });
    setBusy(false);
    if (!r.ok) return setError(errText(r.error));
    load();
  }

  async function toggleClosed() {
    if (!data?.round) return;
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/accounting/readings/round/${data.round.id}/close`, {
      closed: !data.round.closedForOwnersAt,
    });
    setBusy(false);
    if (!r.ok) return setError(errText(r.error));
    load();
  }

  async function applyPersons() {
    if (!data?.round) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounting/readings/apply-persons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId: data.round.id }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    setConfirmApply(false);
    if (!res.ok) return setError(errText(body?.error));
    setNotice(t("applyDone", { units: body.unitsUpdated, rows: body.rowsCreated }));
    load();
  }

  if (!access.canRead) {
    return <EmptyState icon="alert" title={t("forbidden")} />;
  }

  const yearOptions = Array.from(
    new Set([...(data?.years ?? []), new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1, year])
  ).sort((a, b) => b - a);

  const counts = data
    ? {
        missing: data.units.filter(isMissing).length,
        unresolved: data.units.filter(isUnresolved).length,
        all: data.units.length,
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        backHref="/accounting/predpis"
        backLabel={t("back")}
      />

      <Field label={t("year")} htmlFor="readings-year" className="max-w-xs">
        <Select
          id="readings-year"
          value={String(year)}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setData(null);
          }}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </Field>

      {loadError ? (
        <p role="alert" className="text-base text-ui-danger">
          {t("loadError")}
        </p>
      ) : !data ? (
        <LoadingBlock />
      ) : (
        <>
          {data.locked ? (
            <Card padding="md" className="flex items-start gap-2">
              <Icon name="info" size={20} />
              <p className="text-base text-ui-text">{t("lockedYear")}</p>
            </Card>
          ) : null}

          {!data.round || editRound ? (
            data.canWrite && !data.locked ? (
              <RoundForm
                year={year}
                round={editRound ? data.round : null}
                onCancel={editRound ? () => setEditRound(false) : undefined}
                onSaved={() => {
                  setEditRound(false);
                  load();
                }}
              />
            ) : (
              <EmptyState icon="calendar" title={t("noRound", { year })} />
            )
          ) : (
            <RoundSummary
              data={data}
              canWrite={canWrite}
              busy={busy}
              onEdit={() => setEditRound(true)}
              onToggleClosed={toggleClosed}
            />
          )}

          {error ? (
            <p role="alert" className="text-base text-ui-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-base text-ui-success">
              {notice}
            </p>
          ) : null}

          {data.round && counts ? (
            <>
              <Tabs
                aria-label={t("filterLabel")}
                value={filter}
                onChange={(v) => setFilter(v as Filter)}
                items={[
                  { value: "missing", label: t("filterMissing"), badge: counts.missing },
                  { value: "unresolved", label: t("filterUnresolved"), badge: counts.unresolved },
                  { value: "all", label: t("filterAll"), badge: counts.all },
                ]}
              />

              {canWrite && selected.size > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base text-ui-text">
                    {t("selectedCount", { count: selected.size })}
                  </span>
                  <Button loading={busy} onClick={() => resolve([...selected], true)}>
                    {t("bulkResolve")}
                  </Button>
                </div>
              ) : null}

              {rows.length === 0 ? (
                <p className="text-base text-ui-text-muted">{t("emptyFilter")}</p>
              ) : (
                <ul className="space-y-3">
                  {rows.map((u) => (
                    <UnitCard
                      key={u.unitEntityId}
                      unit={u}
                      meterTypes={data.round!.meterTypes}
                      canWrite={canWrite}
                      selected={selected.has(u.unitEntityId)}
                      onSelect={(on) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(u.unitEntityId);
                          else next.delete(u.unitEntityId);
                          return next;
                        })
                      }
                      onResolve={(resolved) => resolve([u.unitEntityId], resolved)}
                      onEnter={(input) => setEntry({ unit: u, input })}
                      busy={busy}
                    />
                  ))}
                </ul>
              )}

              <BuildingCard data={data} canWrite={canWrite} onChanged={load} />

              <Card as="section" padding="lg" className="space-y-3">
                <h2 className="text-xl font-semibold text-ui-text">{t("exportHeading")}</h2>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/accounting/readings/export?year=${year}&format=xlsx`}
                    className={textLink}
                  >
                    <Icon name="download" size={20} />
                    {t("exportXlsx")}
                  </a>
                  {(["persons", "meters", "building"] as const).map((part) => (
                    <a
                      key={part}
                      href={`/api/accounting/readings/export?year=${year}&format=csv&part=${part}`}
                      className={textLink}
                    >
                      <Icon name="download" size={20} />
                      {t(`exportCsv_${part}`)}
                    </a>
                  ))}
                </div>
              </Card>

              {data.round.collectPersons && canWrite ? (
                <Card as="section" padding="lg" className="space-y-3">
                  <h2 className="text-xl font-semibold text-ui-text">{t("applyHeading")}</h2>
                  <p className="text-base text-ui-text-muted">{t("applyHint")}</p>
                  <Button variant="secondary" onClick={() => setConfirmApply(true)}>
                    {t("applyButton")}
                  </Button>
                </Card>
              ) : null}
            </>
          ) : null}

          <ConfirmDialog
            open={confirmApply}
            title={t("applyHeading")}
            description={t("applyConfirm")}
            confirmLabel={t("applyButton")}
            cancelLabel={t("cancel")}
            loading={busy}
            onConfirm={applyPersons}
            onCancel={() => setConfirmApply(false)}
          />

          {entry && data.round ? (
            <Modal
              open
              onClose={() => setEntry(null)}
              title={t("entryTitle", { unit: entry.unit.label })}
            >
              <p className="mb-3 text-base text-ui-text-muted">{t("entryHint")}</p>
              {entry.input === "persons" ? (
                <BoardPersonsEntry
                  unit={entry.unit}
                  roundId={data.round.id}
                  year={data.round.year}
                  onDone={() => {
                    setEntry(null);
                    load();
                  }}
                />
              ) : (
                <MeterForm
                  roundId={data.round.id}
                  year={data.round.year}
                  unitEntityId={entry.unit.unitEntityId}
                  type={entry.input}
                  replace={meterAsEntry(entry.unit, entry.input)}
                  last={null}
                  onCancel={() => setEntry(null)}
                  onDone={() => {
                    setEntry(null);
                    load();
                  }}
                />
              )}
            </Modal>
          ) : null}
        </>
      )}
    </div>
  );
}

function meterAsEntry(unit: BoardUnitRow, type: MeterType): OwnerReadingEntry | null {
  const c = unit.meters[type];
  if (!c) return null;
  return {
    id: c.readingId,
    kind: type,
    months: null,
    value: c.value,
    readingDate: c.readingDate,
    photo: c.photo,
    late: c.late,
    canEdit: true,
    createdAt: c.submittedAt,
  };
}

/** Board persons entry: one submission at a time (replace the first). */
function BoardPersonsEntry({
  unit,
  roundId,
  year,
  onDone,
}: {
  unit: BoardUnitRow;
  roundId: string;
  year: number;
  onDone: () => void;
}) {
  const subs = unit.persons?.submissions ?? [];
  const [idx, setIdx] = useState(0);
  const t = useTranslations("ReadingRounds.board");
  const replace: OwnerReadingEntry | null = subs[idx]
    ? {
        id: subs[idx].submissionId,
        kind: "persons",
        months: subs[idx].ranges,
        value: null,
        readingDate: null,
        photo: null,
        late: false,
        canEdit: true,
        createdAt: "",
      }
    : null;
  return (
    <div className="space-y-3">
      {subs.length > 1 ? (
        <Field label={t("submissionPick")} htmlFor="board-sub">
          <Select id="board-sub" value={String(idx)} onChange={(e) => setIdx(Number(e.target.value))}>
            {subs.map((s, i) => (
              <option key={s.submissionId} value={i}>
                {s.ranges.map((r) => `${r.from}–${r.to}: ${r.persons}`).join(", ")}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <PersonsForm
        key={replace?.id ?? "new"}
        roundId={roundId}
        year={year}
        unitEntityId={unit.unitEntityId}
        replace={replace}
        onDone={onDone}
      />
    </div>
  );
}

// ── Round ──────────────────────────────────────────────

function RoundSummary({
  data,
  canWrite,
  busy,
  onEdit,
  onToggleClosed,
}: {
  data: BoardRoundData;
  canWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleClosed: () => void;
}) {
  const t = useTranslations("ReadingRounds.board");
  const tType = useTranslations("ReadingRounds.meterTypes");
  const format = useFormatter();
  const r = data.round!;
  const fmt = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeZone: "UTC" });
  const inputs = [
    ...(r.collectPersons ? [t("inputPersons")] : []),
    ...r.meterTypes.map((m) => tType(m)),
  ];
  return (
    <Card as="section" padding="lg" className="space-y-2">
      <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-ui-text">
        {t("roundHeading", { year: r.year })}
        {r.closedForOwnersAt ? (
          <Badge tone="neutral">{t("closedBadge")}</Badge>
        ) : (
          <Badge tone="success">{t("openBadge")}</Badge>
        )}
      </h2>
      <p className="text-base text-ui-text">
        {t("roundDates", { opens: fmt(r.opensAt), deadline: fmt(r.deadlineAt) })}
      </p>
      <p className="text-base text-ui-text-muted">{t("roundInputs", { inputs: inputs.join(", ") })}</p>
      <p className="text-base text-ui-text-muted">
        {r.allowLate ? t("lateAllowed") : t("lateNotAllowed")} ·{" "}
        {r.reminderDaysBefore > 0
          ? t("reminderDays", { days: r.reminderDaysBefore })
          : t("reminderOff")}
      </p>
      {canWrite ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" onClick={onEdit}>
            <Icon name="edit" size={20} />
            {t("editRound")}
          </Button>
          <Button variant="secondary" loading={busy} onClick={onToggleClosed}>
            {r.closedForOwnersAt ? t("reopenForOwners") : t("closeForOwners")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function RoundForm({
  year,
  round,
  onCancel,
  onSaved,
}: {
  year: number;
  round: BoardRoundData["round"];
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("ReadingRounds.board");
  const tType = useTranslations("ReadingRounds.meterTypes");
  const tErr = useTranslations("ReadingRounds.errors");
  const [opensAt, setOpensAt] = useState(round?.opensAt.slice(0, 10) ?? `${year + 1}-01-01`);
  const [deadlineAt, setDeadlineAt] = useState(round?.deadlineAt.slice(0, 10) ?? `${year + 1}-01-15`);
  const [collectPersons, setCollectPersons] = useState(round?.collectPersons ?? true);
  const [meterTypes, setMeterTypes] = useState<MeterType[]>(
    round?.meterTypes ?? ["heat", "water_cold", "water_hot"]
  );
  const [reminder, setReminder] = useState(String(round?.reminderDaysBefore ?? 5));
  const [allowLate, setAllowLate] = useState(round?.allowLate ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/accounting/readings/round", {
      roundId: round?.id ?? null,
      year,
      opensAt,
      deadlineAt,
      collectPersons,
      meterTypes,
      reminderDaysBefore: Number(reminder),
      allowLate,
    });
    setBusy(false);
    if (!r.ok) return setError(isReadingErrorCode(r.error) ? tErr(r.error) : tErr("generic"));
    onSaved();
  }

  const checkbox = "h-6 w-6 shrink-0 accent-ui-primary";
  const checkLabel = "flex min-h-11 items-center gap-3 text-base text-ui-text";

  return (
    <Card as="section" padding="lg" className="space-y-4">
      <h2 className="text-xl font-semibold text-ui-text">
        {round ? t("editRoundHeading", { year }) : t("newRoundHeading", { year })}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("opensAt")} htmlFor="round-opens">
          <Input id="round-opens" type="date" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </Field>
        <Field label={t("deadlineAt")} htmlFor="round-deadline">
          <Input
            id="round-deadline"
            type="date"
            value={deadlineAt}
            onChange={(e) => setDeadlineAt(e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-base font-medium text-ui-text">{t("collects")}</legend>
        <label className={checkLabel}>
          <input
            type="checkbox"
            className={checkbox}
            checked={collectPersons}
            onChange={(e) => setCollectPersons(e.target.checked)}
          />
          {t("inputPersons")}
        </label>
        {ROUND_METER_TYPES.map((m) => (
          <label key={m} className={checkLabel}>
            <input
              type="checkbox"
              className={checkbox}
              checked={meterTypes.includes(m)}
              onChange={(e) =>
                setMeterTypes((prev) =>
                  e.target.checked ? [...prev, m] : prev.filter((x) => x !== m)
                )
              }
            />
            {tType(m)}
          </label>
        ))}
      </fieldset>
      <Field label={t("reminderDaysLabel")} htmlFor="round-reminder" hint={t("reminderHint")}>
        <Input
          id="round-reminder"
          inputMode="numeric"
          value={reminder}
          onChange={(e) => setReminder(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <label className={checkLabel}>
        <input
          type="checkbox"
          className={checkbox}
          checked={allowLate}
          onChange={(e) => setAllowLate(e.target.checked)}
        />
        {t("allowLateLabel")}
      </label>
      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} onClick={save}>
          {round ? t("saveRound") : t("createRound")}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ── Unit card ──────────────────────────────────────────

function UnitCard({
  unit,
  meterTypes,
  canWrite,
  selected,
  onSelect,
  onResolve,
  onEnter,
  busy,
}: {
  unit: BoardUnitRow;
  meterTypes: MeterType[];
  canWrite: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onResolve: (resolved: boolean) => void;
  onEnter: (input: "persons" | MeterType) => void;
  busy: boolean;
}) {
  const t = useTranslations("ReadingRounds.board");
  const tType = useTranslations("ReadingRounds.meterTypes");
  const format = useFormatter();
  const anyEntry =
    (unit.persons && unit.persons.status !== "missing") ||
    Object.values(unit.meters).some((c) => c != null);
  const allResolved =
    anyEntry &&
    (!unit.persons || unit.persons.status === "resolved" || unit.persons.status === "missing") &&
    Object.values(unit.meters).every((c) => c == null || c.resolved);

  const statusBadge = (s: InputStatus) => <Badge tone={STATUS_TONE[s]}>{t(`status_${s}`)}</Badge>;

  return (
    <li>
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-3 text-lg font-semibold text-ui-text">
            {canWrite ? (
              <input
                type="checkbox"
                className="h-6 w-6 accent-ui-primary"
                checked={selected}
                onChange={(e) => onSelect(e.target.checked)}
                aria-label={t("selectUnit", { unit: unit.label })}
              />
            ) : null}
            {unit.label}
            {unit.vs ? <span className="text-base font-normal text-ui-text-muted">VS {unit.vs}</span> : null}
          </label>
          {canWrite && anyEntry ? (
            <Button variant="ghost" loading={busy} onClick={() => onResolve(!allResolved)}>
              <Icon name={allResolved ? "x" : "check"} size={20} />
              {allResolved ? t("unresolve") : t("resolve")}
            </Button>
          ) : null}
        </div>

        <dl className="divide-y divide-ui-border">
          {unit.persons ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-2">
              <dt className="text-base text-ui-text">{t("inputPersons")}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-base text-ui-text">
                {unit.persons.status !== "missing" ? (
                  <span>{t("personMonths", { total: unit.persons.total })}</span>
                ) : null}
                {statusBadge(unit.persons.status)}
                {canWrite ? (
                  <button type="button" className={textLink} onClick={() => onEnter("persons")}>
                    {unit.persons.status === "missing" ? t("enter") : t("correct")}
                  </button>
                ) : null}
              </dd>
            </div>
          ) : null}
          {meterTypes.map((m) => {
            const c = unit.meters[m] ?? null;
            const single = unit.singleReadingTypes.includes(m);
            return (
              <div key={m} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-base text-ui-text">{tType(m)}</dt>
                  <dd className="flex flex-wrap items-center gap-2 text-base text-ui-text">
                    {c ? (
                      <span>
                        {milliToDisplay(c.value)} ·{" "}
                        {format.dateTime(new Date(c.readingDate), {
                          dateStyle: "short",
                          timeZone: "UTC",
                        })}
                      </span>
                    ) : null}
                    {statusBadge(c ? c.status : "missing")}
                    {c?.byBoard ? <Badge tone="neutral">{t("byBoard")}</Badge> : null}
                    {c?.photo ? (
                      <a href={c.photo} target="_blank" rel="noopener noreferrer" className={textLink}>
                        <Icon name="file" size={20} />
                        {t("photo")}
                      </a>
                    ) : null}
                    {canWrite ? (
                      <button type="button" className={textLink} onClick={() => onEnter(m)}>
                        {c ? t("correct") : t("enter")}
                      </button>
                    ) : null}
                  </dd>
                </div>
                {single ? (
                  <p className="flex items-start gap-2 text-base text-ui-warning">
                    <Icon name="alert" size={20} />
                    {t("singleReadingWarning")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </dl>
      </Card>
    </li>
  );
}

// ── Building meters ────────────────────────────────────

function BuildingCard({
  data,
  canWrite,
  onChanged,
}: {
  data: BoardRoundData;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("ReadingRounds.board");
  const tType = useTranslations("ReadingRounds.meterTypes");
  const tErr = useTranslations("ReadingRounds.errors");
  const format = useFormatter();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [meterType, setMeterType] = useState<MeterType>("water_cold");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);

  const errText = (code: unknown) => (isReadingErrorCode(code) ? tErr(code) : tErr("generic"));

  // Informational "súčet bytov vs. hlavný merač" per meter type.
  const unitSums = useMemo(() => {
    const sums: Partial<Record<MeterType, number>> = {};
    for (const u of data.units) {
      for (const [type, c] of Object.entries(u.meters)) {
        if (c) sums[type as MeterType] = (sums[type as MeterType] ?? 0) + c.value;
      }
    }
    return sums;
  }, [data.units]);

  async function add() {
    if (!data.round) return;
    if (parseMilli(value) === null) return setError(errText("value_invalid"));
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("roundId", data.round.id);
    fd.set("meterType", meterType);
    fd.set("label", label);
    fd.set("readingDate", date);
    fd.set("value", value);
    fd.set("note", note);
    if (photo) fd.set("photo", photo);
    const res = await fetch("/api/accounting/readings/building", { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(errText(body?.error));
    setAdding(false);
    setLabel("");
    setValue("");
    setNote("");
    setPhoto(null);
    onChanged();
  }

  async function voidRow(id: string) {
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/accounting/readings/building/${id}/void`, {});
    setBusy(false);
    setConfirmVoid(null);
    if (!r.ok) return setError(errText(r.error));
    onChanged();
  }

  return (
    <Card as="section" padding="lg" className="space-y-3">
      <h2 className="text-xl font-semibold text-ui-text">{t("buildingHeading")}</h2>
      <p className="text-base text-ui-text-muted">{t("buildingHint")}</p>

      {data.building.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("buildingEmpty")}</p>
      ) : (
        <ul className="divide-y divide-ui-border">
          {data.building.map((b) => {
            const sum = unitSums[b.meterType];
            return (
              <li key={b.id} className="space-y-1 py-2">
                <p className="text-base font-semibold text-ui-text">
                  {b.label} · {tType(b.meterType)}
                </p>
                <p className="text-base text-ui-text">
                  {milliToDisplay(b.value)} ·{" "}
                  {format.dateTime(new Date(b.readingDate), { dateStyle: "medium", timeZone: "UTC" })}
                </p>
                {sum !== undefined ? (
                  <p className="text-base text-ui-text-muted">
                    {t("buildingDiff", {
                      units: milliToDisplay(sum),
                      diff: milliToDisplay(b.value - sum),
                    })}
                  </p>
                ) : null}
                {b.note ? <p className="text-base text-ui-text-muted">{b.note}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {b.photo ? (
                    <a href={b.photo} target="_blank" rel="noopener noreferrer" className={textLink}>
                      <Icon name="file" size={20} />
                      {t("photo")}
                    </a>
                  ) : null}
                  {canWrite ? (
                    <button type="button" className={textLink} onClick={() => setConfirmVoid(b.id)}>
                      <Icon name="trash" size={20} />
                      {t("void")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && !adding ? (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} />
          {t("buildingAdd")}
        </Button>
      ) : null}

      {canWrite && adding ? (
        <div className="space-y-3">
          <Field label={t("buildingLabel")} htmlFor="bm-label" hint={t("buildingLabelHint")}>
            <Input id="bm-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label={t("meterType")} htmlFor="bm-type">
            <Select id="bm-type" value={meterType} onChange={(e) => setMeterType(e.target.value as MeterType)}>
              {ROUND_METER_TYPES.map((m) => (
                <option key={m} value={m}>
                  {tType(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("readingDate")} htmlFor="bm-date">
            <Input
              id="bm-date"
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={t("value")} htmlFor="bm-value">
            <Input id="bm-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label={t("note")} htmlFor="bm-note">
            <Input id="bm-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label={t("photo")} htmlFor="bm-photo">
            <input
              id="bm-photo"
              type="file"
              accept="image/*"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="block min-h-11 w-full text-base text-ui-text"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={add}>
              {t("save")}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmVoid !== null}
        title={t("void")}
        description={t("voidConfirm")}
        confirmLabel={t("void")}
        cancelLabel={t("cancel")}
        tone="danger"
        loading={busy}
        onConfirm={() => confirmVoid && voidRow(confirmVoid)}
        onCancel={() => setConfirmVoid(null)}
      />
    </Card>
  );
}
