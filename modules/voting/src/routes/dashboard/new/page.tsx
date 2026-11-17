"use client";

import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { hasPermission } from "@/lib/permissions";
import type { UserRole, QuorumType } from "@/types";
import {
  getAvailableQuorumTypes,
  getVotingRules,
  type Country,
} from "@modules/voting/src/rules";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { VOTING_TEMPLATES, resolveQuorum, type VotingTemplate } from "./templates";

interface Entrance {
  id: string;
  name: string;
}

// BYT-20260609-008: a voting holds an ordered list of items (resolutions),
// each with its own quorum type.
interface ItemDraft {
  key: number;
  title: string;
  description: string;
  quorumType: string;
  confirmQuorum: boolean;
}

const DEFAULT_DAYS = 14;

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultEnd(country: Country): Date {
  const min = getVotingRules(country).perRollamMinDays;
  // One day above the statutory minimum so "start = now at submit" still passes.
  const days = min ? Math.max(DEFAULT_DAYS, min + 1) : DEFAULT_DAYS;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export default function NovaHlasovaniePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const t = useTranslations("VotingNew");
  const w = useTranslations("VotingWizard");
  const tCommon = useTranslations("Common");
  const format = useFormatter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "active" | "draft">(null);
  const [error, setError] = useState("");
  const [itemsError, setItemsError] = useState("");
  const [title, setTitle] = useState("");
  const [votingType, setVotingType] = useState("written");
  const [initiatedBy, setInitiatedBy] = useState("board");
  const [country, setCountry] = useState<Country>("sk");
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [entranceId, setEntranceId] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(defaultEnd("sk")));
  const endTouched = useRef(false);
  const nextKey = useRef(1);
  const [removeIdx, setRemoveIdx] = useState<number | null>(null);

  const newItem = (over?: Partial<ItemDraft>): ItemDraft => ({
    key: nextKey.current++,
    title: "",
    description: "",
    quorumType: "simple_all",
    confirmQuorum: false,
    ...over,
  });
  const [items, setItems] = useState<ItemDraft[]>(() => [
    { key: 0, title: "", description: "", quorumType: "simple_all", confirmQuorum: false },
  ]);

  const role = (session?.user?.role || "owner") as UserRole;
  const allowedQuorumTypes = getAvailableQuorumTypes(country, votingType);

  // Country: single existing fetch (ShellCommunity does not carry it).
  useEffect(() => {
    fetch("/api/building")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b?.country === "cz" || b?.country === "sk") setCountry(b.country);
      })
      .catch(() => {});
  }, []);

  // Country changes the statutory minimum — move the default end date unless
  // the chairman already picked one.
  useEffect(() => {
    if (!endTouched.current) setEndsAt(toLocalInput(defaultEnd(country)));
  }, [country]);

  // Re-validate item quorum types after a country / voting type change.
  useEffect(() => {
    setItems((prev) =>
      prev.some((it) => !allowedQuorumTypes.includes(it.quorumType as QuorumType))
        ? prev.map((it) =>
            allowedQuorumTypes.includes(it.quorumType as QuorumType)
              ? it
              : { ...it, quorumType: resolveQuorum("simple_all", allowedQuorumTypes) }
          )
        : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, votingType]);

  useEffect(() => {
    fetch("/api/entrances")
      .then((r) => r.json())
      .then((data) => setEntrances(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/documents/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.projects) setProjects(data.projects);
      })
      .catch(() => {});
  }, []);

  // Pre-select the project when arriving from a project's "start formal vote".
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("projectId");
    if (p) setSelectedProjectId(p);
  }, []);

  if (!hasPermission(role, "createVoting")) {
    return (
      <div className="py-12 text-center text-lg text-ui-text-muted">
        {t("noPermission")}
      </div>
    );
  }

  function chooseTemplate(tpl: VotingTemplate) {
    setTemplateId(tpl.id);
    const quorum = resolveQuorum(tpl.preferredQuorum, allowedQuorumTypes);
    if (tpl.id === "custom") {
      setTitle("");
      setItems([newItem()]);
    } else {
      setTitle(w(`templates.${tpl.id}.title`));
      setItems(
        tpl.itemKeys.map((k) =>
          newItem({
            title: w(`templates.${tpl.id}.items.${k}.title`),
            description: w(`templates.${tpl.id}.items.${k}.text`),
            quorumType: quorum,
            confirmQuorum: tpl.confirmQuorum,
          })
        )
      );
    }
    setError("");
    setItemsError("");
    setStep(2);
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      newItem({ quorumType: resolveQuorum("simple_all", allowedQuorumTypes) }),
    ]);
  }
  function removeItem(i: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }
  function askRemove(i: number) {
    const it = items[i];
    if (!it.title.trim() && !it.description.trim()) removeItem(i);
    else setRemoveIdx(i);
  }
  function moveItem(i: number, dir: -1 | 1) {
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function updateItem(i: number, field: "title" | "description" | "quorumType", value: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  function changeVotingType(v: string) {
    setVotingType(v);
    // Quorum types for the new voting type are re-validated by the effect above.
  }

  function goToHow() {
    if (!title.trim()) {
      setItemsError(w("titleRequired"));
      return;
    }
    if (items.some((it) => !it.title.trim())) {
      setItemsError(t("itemTitleRequired"));
      return;
    }
    setItemsError("");
    setStep(3);
  }

  const showRestrictionNote = votingType === "meeting" || initiatedBy === "owners_quarter";

  async function submit(status: "active" | "draft") {
    setLoading(status);
    setError("");

    const cleanItems = items.map((it) => ({
      title: it.title.trim(),
      description: it.description.trim() || null,
      quorumType: it.quorumType,
    }));

    // "Start = now" unless the chairman picked another start.
    const start = showStart && startsAt ? new Date(startsAt) : new Date();
    const end = new Date(endsAt);
    if (!endsAt || Number.isNaN(end.getTime())) {
      setError(w("endRequired"));
      setLoading(null);
      return;
    }
    if (end <= start) {
      setError(w("endBeforeStart"));
      setLoading(null);
      return;
    }
    if (votingType === "written") {
      const minDays = getVotingRules(country).perRollamMinDays;
      if (minDays) {
        const minEnd = new Date(start);
        minEnd.setDate(minEnd.getDate() + minDays);
        if (end < minEnd) {
          setError(w("minDuration", { days: minDays }));
          setLoading(null);
          return;
        }
      }
    }

    try {
      const res = await fetch("/api/votings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: "",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          status,
          votingType,
          initiatedBy,
          items: cleanItems,
          entranceId: entranceId || null,
          documentProjectId: selectedProjectId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("createFailed"));
        setLoading(null);
        return;
      }

      const voting = await res.json();
      router.push(`/voting/${voting.id}`);
    } catch {
      setError(t("createFailed"));
      setLoading(null);
    }
  }

  const steps = [w("stepTemplate"), w("stepItems"), w("stepHow")];
  const dateFmt = (iso: string) =>
    format.dateTime(new Date(iso), { day: "numeric", month: "long", year: "numeric" });
  const typeLabel = votingType === "meeting" ? t("votingTypeMeeting") : t("votingTypeWritten");

  return (
    <div className="mx-auto max-w-2xl pb-8">
      <PageHeader
        title={t("title")}
        backHref="/voting"
        backLabel={tCommon("backToList")}
        description={w("stepOf", { current: step, total: 3 })}
      />

      <ol className="mb-6 flex gap-2" aria-label={w("stepsLabel")}>
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={step === i + 1 ? "step" : undefined}
            className={cn(
              "flex-1 border-t-4 pt-2 text-sm font-medium",
              step === i + 1
                ? "border-ui-primary text-ui-text"
                : step > i + 1
                  ? "border-ui-primary/50 text-ui-text-muted"
                  : "border-ui-border text-ui-text-muted"
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger"
        >
          {error}
        </div>
      )}

      {/* STEP 1 — template */}
      {step === 1 && (
        <section aria-labelledby="step1-h">
          <h2 id="step1-h" className="mb-1 text-xl font-semibold text-ui-text">
            {w("stepTemplate")}
          </h2>
          <p className="mb-4 text-base text-ui-text-muted">{w("templatePrompt")}</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {VOTING_TEMPLATES.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => chooseTemplate(tpl)}
                  className={cn(
                    "flex h-full min-h-28 w-full items-start gap-4 rounded-xl border bg-ui-surface p-4 text-left transition-colors hover:bg-ui-surface-muted",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus",
                    templateId === tpl.id ? "border-ui-primary" : "border-ui-border"
                  )}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ui-surface-muted text-ui-text">
                    <Icon name={tpl.icon} size={24} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg font-semibold text-ui-text">
                      {w(`templates.${tpl.id}.name`)}
                    </span>
                    <span className="mt-1 block text-base text-ui-text-muted">
                      {w(`templates.${tpl.id}.desc`)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* STEP 2 — items */}
      {step === 2 && (
        <section aria-labelledby="step2-h" className="space-y-5">
          <div>
            <h2 id="step2-h" className="mb-1 text-xl font-semibold text-ui-text">
              {w("stepItems")}
            </h2>
            <p className="text-base text-ui-text-muted">{t("itemsHelp")}</p>
          </div>

          <Field label={t("titleLabel")} required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </Field>

          {itemsError && (
            <div
              role="alert"
              className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger"
            >
              {itemsError}
            </div>
          )}

          <ul className="space-y-4">
            {items.map((item, i) => (
              <li key={item.key}>
                <Card padding="md" className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-ui-text">
                      {t("itemNumber", { number: i + 1 })}
                    </h3>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => moveItem(i, -1)}
                        disabled={i === 0}
                        aria-label={t("moveUp")}
                      >
                        <Icon name="chevronDown" size={20} className="rotate-180" />
                        <span className="hidden sm:inline">{t("moveUp")}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => moveItem(i, 1)}
                        disabled={i === items.length - 1}
                        aria-label={t("moveDown")}
                      >
                        <Icon name="chevronDown" size={20} />
                        <span className="hidden sm:inline">{t("moveDown")}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => askRemove(i)}
                        disabled={items.length === 1}
                        className="text-ui-danger"
                      >
                        <Icon name="trash" size={20} />
                        {t("removeItem")}
                      </Button>
                    </div>
                  </div>

                  <Field label={w("itemTitleLabel")} required>
                    <Input
                      value={item.title}
                      onChange={(e) => updateItem(i, "title", e.target.value)}
                      placeholder={t("itemTitlePlaceholder")}
                    />
                  </Field>
                  <Field label={w("itemTextLabel")}>
                    <Textarea
                      value={item.description}
                      onChange={(e) => updateItem(i, "description", e.target.value)}
                      rows={3}
                      placeholder={t("itemDescriptionPlaceholder")}
                    />
                  </Field>
                  <Field
                    label={w("quorumLabel")}
                    hint={
                      <>
                        {w(`quorum.${item.quorumType}.hint`)}
                        {item.confirmQuorum && (
                          <span className="mt-1 block font-medium text-ui-text">
                            {w("quorumConfirm")}
                          </span>
                        )}
                      </>
                    }
                  >
                    <Select
                      value={item.quorumType}
                      onChange={(e) => updateItem(i, "quorumType", e.target.value)}
                    >
                      {allowedQuorumTypes.map((q) => (
                        <option key={q} value={q}>
                          {w(`quorum.${q}.label`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </Card>
              </li>
            ))}
          </ul>

          <Button type="button" variant="secondary" fullWidth onClick={addItem}>
            <Icon name="plus" size={20} />
            {t("addItem")}
          </Button>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              {w("back")}
            </Button>
            <Button type="button" className="flex-1" onClick={goToHow}>
              {w("next")}
            </Button>
          </div>
        </section>
      )}

      {/* STEP 3 — how and when */}
      {step === 3 && (
        <section aria-labelledby="step3-h" className="space-y-6">
          <h2 id="step3-h" className="text-xl font-semibold text-ui-text">
            {w("stepHow")}
          </h2>

          <div role="radiogroup" aria-label={t("votingTypeLabel")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                { v: "written", name: t("votingTypeWritten"), desc: w("typeWrittenDesc"), icon: "mail" },
                { v: "meeting", name: t("votingTypeMeeting"), desc: w("typeMeetingDesc"), icon: "users" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={votingType === o.v}
                onClick={() => changeVotingType(o.v)}
                className={cn(
                  "flex min-h-28 items-start gap-3 rounded-xl border-2 bg-ui-surface p-4 text-left transition-colors hover:bg-ui-surface-muted",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus",
                  votingType === o.v ? "border-ui-primary" : "border-ui-border"
                )}
              >
                <Icon name={o.icon} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold text-ui-text">{o.name}</span>
                  <span className="mt-1 block text-base text-ui-text-muted">{o.desc}</span>
                </span>
                {votingType === o.v && <Icon name="check" size={24} />}
              </button>
            ))}
          </div>

          {showRestrictionNote && (
            <div className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 px-4 py-3 text-base text-ui-text">
              {votingType === "meeting" ? t("meetingNote") : t("ownersQuarterNote")}
            </div>
          )}

          <div className="space-y-3">
            <Field label={t("endsAtLabel")} hint={w("endHint", { days: defaultDaysHint(country) })} required>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => {
                  endTouched.current = true;
                  setEndsAt(e.target.value);
                }}
              />
            </Field>
            {showStart ? (
              <Field label={t("startsAtLabel")} required>
                <Input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </Field>
            ) : (
              <p className="text-base text-ui-text-muted">
                {w("startsNow")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setStartsAt(toLocalInput(new Date()));
                    setShowStart(true);
                  }}
                  className="min-h-11 font-medium text-ui-text underline underline-offset-2"
                >
                  {w("changeStart")}
                </button>
              </p>
            )}
          </div>

          <div>
            <button
              type="button"
              aria-expanded={showMore}
              onClick={() => setShowMore((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between rounded-lg border border-ui-border px-4 text-left text-base font-medium text-ui-text hover:bg-ui-surface-muted"
            >
              {w("moreOptions")}
              <Icon name="chevronDown" size={20} className={cn(showMore && "rotate-180")} />
            </button>
            {showMore && (
              <div className="mt-3 space-y-4 rounded-lg border border-ui-border p-4">
                <Field label={t("initiatedByLabel")}>
                  <Select value={initiatedBy} onChange={(e) => setInitiatedBy(e.target.value)}>
                    <option value="board">{t("initiatedByBoard")}</option>
                    <option value="owners_quarter">{t("initiatedByOwnersQuarter")}</option>
                  </Select>
                </Field>
                {entrances.length > 0 && (
                  <Field label={t("entranceScopeLabel")}>
                    <Select value={entranceId} onChange={(e) => setEntranceId(e.target.value)}>
                      <option value="">{t("scopeAll")}</option>
                      {entrances.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {projects.length > 0 && (
                  <Field label={t("projectLabel")}>
                    <Select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                    >
                      <option value="">{t("noProject")}</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )}
          </div>

          <Card padding="md" as="section" aria-labelledby="summary-h">
            <h3 id="summary-h" className="mb-2 text-lg font-semibold text-ui-text">
              {w("summary")}
            </h3>
            <dl className="space-y-1 text-base">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-ui-text-muted">{w("summaryTitle")}</dt>
                <dd className="font-medium text-ui-text">{title}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-ui-text-muted">{w("summaryItems")}</dt>
                <dd className="font-medium text-ui-text">{items.length}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-ui-text-muted">{w("summaryType")}</dt>
                <dd className="font-medium text-ui-text">{typeLabel}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-ui-text-muted">{w("summaryEnd")}</dt>
                <dd className="font-medium text-ui-text">{endsAt ? dateFmt(endsAt) : "—"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-base text-ui-text-muted">{w("summaryNote")}</p>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button
              type="button"
              size="lg"
              loading={loading === "active"}
              disabled={loading !== null}
              onClick={() => submit("active")}
              className="sm:flex-1"
            >
              {w("launch")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              loading={loading === "draft"}
              disabled={loading !== null}
              onClick={() => submit("draft")}
              className="sm:flex-1"
            >
              {w("saveDraft")}
            </Button>
          </div>
          <div>
            <Button type="button" variant="ghost" onClick={() => setStep(2)} disabled={loading !== null}>
              <Icon name="chevronLeft" size={20} />
              {w("back")}
            </Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={removeIdx !== null}
        title={w("removeTitle")}
        description={w("removeDescription")}
        confirmLabel={t("removeItem")}
        cancelLabel={tCommon("cancel")}
        tone="danger"
        onConfirm={() => {
          if (removeIdx !== null) removeItem(removeIdx);
          setRemoveIdx(null);
        }}
        onCancel={() => setRemoveIdx(null)}
      />
    </div>
  );
}

function defaultDaysHint(country: Country): number {
  const min = getVotingRules(country).perRollamMinDays;
  return min ? Math.max(DEFAULT_DAYS, min + 1) : DEFAULT_DAYS;
}
