"use client";

// "Odpočty a osoby" in Moje platby (BYT-20261118-006). Phone-first owner
// flow: persons per month as "od – do – počet" ranges, one card per meter
// type with value, date and an optional photo. Edit = void + insert in one
// transaction server-side; withdraw = void. Data comes once with the server
// render (no polling); after a change the page re-renders via router.refresh.
// The owner never learns WHY a row is read-only (resolved vs. deadline): the
// view carries only `canEdit`.

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Badge, Button, Card, ConfirmDialog, Field, Icon, Input, Select, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import {
  MAX_PERSONS,
  isReadingErrorCode,
  milliToDisplay,
  parseMilli,
  validatePersonRanges,
  type MeterType,
  type OwnerReadingEntry,
  type OwnerReadingsView,
  type PersonRange,
} from "@modules/accounting/src/lib/reading-rounds-format";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function useErrorText() {
  const t = useTranslations("ReadingRounds.errors");
  return (code: unknown) => (isReadingErrorCode(code) ? t(code) : t("generic"));
}

function useMonthName() {
  const format = useFormatter();
  return (m: number) =>
    format.dateTime(new Date(Date.UTC(2000, m - 1, 1)), { month: "long", timeZone: "UTC" });
}

const linkBtn = cn(
  "inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-base font-medium text-ui-text underline underline-offset-4",
  focusRing
);

export function ReadingsSection({
  view,
  unitEntityId,
}: {
  view: OwnerReadingsView;
  unitEntityId: string;
}) {
  const t = useTranslations("ReadingRounds.owner");
  const format = useFormatter();
  const round = view.round;

  if (!round) {
    if (!view.lastSubmissionAt) return null;
    return (
      <Card as="section" padding="lg" className="space-y-2" id="odpocty">
        <h2 className="text-xl font-semibold text-ui-text">{t("heading")}</h2>
        <p className="text-base text-ui-text-muted">
          {t("closedSummary", {
            date: format.dateTime(new Date(view.lastSubmissionAt), { dateStyle: "medium" }),
          })}
        </p>
      </Card>
    );
  }

  const persons = view.entries.filter((e) => e.kind === "persons");
  const deadline = format.dateTime(new Date(round.deadlineAt), {
    dateStyle: "long",
    timeZone: "UTC",
  });

  return (
    <section className="space-y-4" id="odpocty" aria-labelledby="odpocty-heading">
      <div className="space-y-1">
        <h2 id="odpocty-heading" className="text-xl font-semibold text-ui-text">
          {t("headingYear", { year: round.year })}
        </h2>
        <p className="text-base text-ui-text-muted">{t("deadline", { date: deadline })}</p>
        {round.acceptsInput && round.late ? (
          <p className="text-base text-ui-warning">{t("lateNotice")}</p>
        ) : null}
        {!round.acceptsInput ? (
          <p className="text-base text-ui-text-muted">{t("lockedText")}</p>
        ) : null}
      </div>

      {round.collectPersons ? (
        <PersonsCard
          roundId={round.id}
          year={round.year}
          unitEntityId={unitEntityId}
          entries={persons}
          acceptsInput={round.acceptsInput}
        />
      ) : null}

      {round.meterTypes.map((type) => (
        <MeterCard
          key={type}
          roundId={round.id}
          year={round.year}
          unitEntityId={unitEntityId}
          type={type}
          entry={view.entries.find((e) => e.kind === type) ?? null}
          last={view.lastKnown[type] ?? null}
          acceptsInput={round.acceptsInput}
        />
      ))}
    </section>
  );
}

// ── Persons ────────────────────────────────────────────

function PersonsCard({
  roundId,
  year,
  unitEntityId,
  entries,
  acceptsInput,
}: {
  roundId: string;
  year: number;
  unitEntityId: string;
  entries: OwnerReadingEntry[];
  acceptsInput: boolean;
}) {
  const t = useTranslations("ReadingRounds.owner");
  const monthName = useMonthName();
  const errorText = useErrorText();
  const router = useRouter();
  const [editing, setEditing] = useState<OwnerReadingEntry | "new" | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw(id: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounting/readings/persons/${id}/void`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(false);
    setConfirmVoid(null);
    if (!res.ok) return setError(errorText(body?.error));
    router.refresh();
  }

  const showForm = editing !== null || (entries.length === 0 && acceptsInput);

  return (
    <Card as="section" padding="lg" className="space-y-3">
      <h3 className="text-lg font-semibold text-ui-text">{t("personsHeading")}</h3>
      {/* TODO(legal copy sign-off): who counts as a person (trvalý pobyt vs.
          actually living, children, short stays) is a stanovy/zmluva question —
          neutral placeholder until Filip approves the wording. */}
      <p className="text-base text-ui-text-muted">{t("personsHelp")}</p>

      {entries.map((e) => (
        <div key={e.id} className="space-y-2 rounded-lg border border-ui-border p-3">
          <ul className="space-y-1">
            {(e.months ?? []).map((r) => (
              <li key={r.from} className="text-base text-ui-text">
                {r.from === r.to
                  ? t("rangeSingle", { month: monthName(r.from), persons: r.persons })
                  : t("range", {
                      from: monthName(r.from),
                      to: monthName(r.to),
                      persons: r.persons,
                    })}
              </li>
            ))}
          </ul>
          {e.late ? <Badge tone="warning">{t("lateBadge")}</Badge> : null}
          {e.canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={linkBtn} onClick={() => setEditing(e)}>
                <Icon name="edit" size={20} />
                {t("edit")}
              </button>
              <button type="button" className={linkBtn} onClick={() => setConfirmVoid(e.id)}>
                <Icon name="trash" size={20} />
                {t("withdraw")}
              </button>
            </div>
          ) : (
            <p className="text-base text-ui-text-muted">{t("lockedText")}</p>
          )}
        </div>
      ))}

      {showForm && acceptsInput ? (
        <PersonsForm
          key={editing && editing !== "new" ? editing.id : "new"}
          roundId={roundId}
          year={year}
          unitEntityId={unitEntityId}
          replace={editing && editing !== "new" ? editing : null}
          onCancel={editing ? () => setEditing(null) : undefined}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmVoid !== null}
        title={t("withdrawTitle")}
        description={t("withdrawBody")}
        confirmLabel={t("withdraw")}
        cancelLabel={t("cancel")}
        tone="danger"
        loading={busy}
        onConfirm={() => confirmVoid && withdraw(confirmVoid)}
        onCancel={() => setConfirmVoid(null)}
      />
    </Card>
  );
}

export function PersonsForm({
  roundId,
  year,
  unitEntityId,
  replace,
  onCancel,
  onDone,
}: {
  roundId: string;
  year: number;
  unitEntityId: string;
  replace: OwnerReadingEntry | null;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("ReadingRounds.owner");
  const monthName = useMonthName();
  const errorText = useErrorText();
  const [rows, setRows] = useState<{ from: string; to: string; persons: string }[]>(() =>
    replace?.months?.length
      ? replace.months.map((r) => ({
          from: String(r.from),
          to: String(r.to),
          persons: String(r.persons),
        }))
      : [{ from: "1", to: "12", persons: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranges: PersonRange[] = rows.map((r) => ({
    from: Number(r.from),
    to: Number(r.to),
    persons: r.persons.trim() === "" ? NaN : Number(r.persons),
  }));
  const invalid = validatePersonRanges(ranges);

  function update(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    if (invalid) return setError(errorText(invalid));
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounting/readings/persons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId,
        unitEntityId,
        ranges,
        replaceSubmissionId: replace?.id ?? null,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(errorText(body?.error));
    onDone();
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <fieldset key={i} className="space-y-2 rounded-lg border border-ui-border p-3">
          <legend className="px-1 text-base font-medium text-ui-text">
            {t("periodLegend", { n: i + 1, year })}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("fromMonth")}>
              <Select value={r.from} onChange={(e) => update(i, { from: e.target.value })}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("toMonth")}>
              <Select value={r.to} onChange={(e) => update(i, { to: e.target.value })}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("personsCount")}>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              min={0}
              max={MAX_PERSONS}
              value={r.persons}
              onChange={(e) => update(i, { persons: e.target.value.replace(/\D/g, "") })}
            />
          </Field>
          {rows.length > 1 ? (
            <button
              type="button"
              className={linkBtn}
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={20} />
              {t("removePeriod")}
            </button>
          ) : null}
        </fieldset>
      ))}
      {rows.length < 12 ? (
        <button
          type="button"
          className={linkBtn}
          onClick={() => setRows((prev) => [...prev, { from: "1", to: "12", persons: "" }])}
        >
          <Icon name="plus" size={20} />
          {t("addPeriod")}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} onClick={submit} fullWidth>
          {replace ? t("saveChanges") : t("submitPersons")}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} fullWidth>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── Meter readings ─────────────────────────────────────

function defaultDate(year: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${year}-12-31`;
  return today > yearEnd ? yearEnd : today;
}

function MeterCard({
  roundId,
  year,
  unitEntityId,
  type,
  entry,
  last,
  acceptsInput,
}: {
  roundId: string;
  year: number;
  unitEntityId: string;
  type: MeterType;
  entry: OwnerReadingEntry | null;
  last: { value: number; readingDate: string } | null;
  acceptsInput: boolean;
}) {
  const t = useTranslations("ReadingRounds.owner");
  const tType = useTranslations("ReadingRounds.meterTypes");
  const format = useFormatter();
  const errorText = useErrorText();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounting/readings/meter/${entry.id}/void`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusy(false);
    setConfirmVoid(false);
    if (!res.ok) return setError(errorText(body?.error));
    router.refresh();
  }

  const showForm = acceptsInput && (editing || !entry);

  return (
    <Card as="section" padding="lg" className="space-y-3">
      <h3 className="text-lg font-semibold text-ui-text">{tType(type)}</h3>
      {last ? (
        <p className="text-base text-ui-text-muted">
          {t("lastValue", {
            value: milliToDisplay(last.value),
            date: format.dateTime(new Date(last.readingDate), { dateStyle: "medium", timeZone: "UTC" }),
          })}
        </p>
      ) : null}

      {entry && !editing ? (
        <div className="space-y-2">
          <p className="text-2xl font-semibold text-ui-text">
            {entry.value !== null ? milliToDisplay(entry.value) : "—"}
          </p>
          {entry.readingDate ? (
            <p className="text-base text-ui-text-muted">
              {t("readOn", {
                date: format.dateTime(new Date(entry.readingDate), {
                  dateStyle: "medium",
                  timeZone: "UTC",
                }),
              })}
            </p>
          ) : null}
          {entry.late ? <Badge tone="warning">{t("lateBadge")}</Badge> : null}
          {entry.photo ? (
            <a href={entry.photo} target="_blank" rel="noopener noreferrer" className={linkBtn}>
              <Icon name="file" size={20} />
              {t("viewPhoto")}
            </a>
          ) : null}
          {entry.canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={linkBtn} onClick={() => setEditing(true)}>
                <Icon name="edit" size={20} />
                {t("edit")}
              </button>
              <button type="button" className={linkBtn} onClick={() => setConfirmVoid(true)}>
                <Icon name="trash" size={20} />
                {t("withdraw")}
              </button>
            </div>
          ) : (
            <p className="text-base text-ui-text-muted">{t("lockedText")}</p>
          )}
        </div>
      ) : null}

      {showForm ? (
        <MeterForm
          roundId={roundId}
          year={year}
          unitEntityId={unitEntityId}
          type={type}
          replace={editing ? entry : null}
          last={last}
          onCancel={editing ? () => setEditing(false) : undefined}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      ) : null}
      {!entry && !acceptsInput ? (
        <p className="text-base text-ui-text-muted">{t("notSubmitted")}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmVoid}
        title={t("withdrawTitle")}
        description={t("withdrawBody")}
        confirmLabel={t("withdraw")}
        cancelLabel={t("cancel")}
        tone="danger"
        loading={busy}
        onConfirm={withdraw}
        onCancel={() => setConfirmVoid(false)}
      />
    </Card>
  );
}

export function MeterForm({
  roundId,
  year,
  unitEntityId,
  type,
  replace,
  last,
  onCancel,
  onDone,
}: {
  roundId: string;
  year: number;
  unitEntityId: string;
  type: MeterType;
  replace: OwnerReadingEntry | null;
  last: { value: number; readingDate: string } | null;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("ReadingRounds.owner");
  const errorText = useErrorText();
  const [value, setValue] = useState(() =>
    replace?.value != null ? String(replace.value / 1000).replace(".", ",") : ""
  );
  const [date, setDate] = useState(() =>
    replace?.readingDate ? replace.readingDate.slice(0, 10) : defaultDate(year)
  );
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const milli = parseMilli(value);
  const lower = useMemo(
    () => milli !== null && last !== null && milli < last.value,
    [milli, last]
  );
  const maxDate = defaultDate(year);
  const idBase = `meter-${type}`;

  async function submit() {
    if (milli === null) return setError(errorText("value_invalid"));
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("roundId", roundId);
    fd.set("unitEntityId", unitEntityId);
    fd.set("meterType", type);
    fd.set("value", value);
    fd.set("readingDate", date);
    if (replace) fd.set("replaceReadingId", replace.id);
    if (photo) fd.set("photo", photo);
    const res = await fetch("/api/accounting/readings/meter", { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(errorText(body?.error));
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label={t("value")} htmlFor={`${idBase}-value`}>
        <Input
          id={`${idBase}-value`}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("valuePlaceholder")}
        />
      </Field>
      {lower ? (
        <p role="status" className="text-base text-ui-warning">
          {t("lowerWarning")}
        </p>
      ) : null}
      <Field label={t("readingDate")} htmlFor={`${idBase}-date`}>
        <Input
          id={`${idBase}-date`}
          type="date"
          min={`${year}-01-01`}
          max={maxDate}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label={t("photo")} htmlFor={`${idBase}-photo`} hint={t("photoHint")}>
        <input
          id={`${idBase}-photo`}
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="block min-h-11 w-full text-base text-ui-text file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-ui-border-strong file:bg-ui-surface file:px-4 file:text-base file:text-ui-text"
        />
      </Field>
      {error ? (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} onClick={submit} fullWidth>
          {replace ? t("saveChanges") : t("submitReading")}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} fullWidth>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
