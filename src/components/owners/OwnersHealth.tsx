"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { ActionMenu, Button, ButtonLink, Card, Icon, cn, type ActionMenuItem } from "@/components/ui";
import {
  dismissOwnerHealthAction,
  undoOwnerHealthDismissalAction,
} from "@/app/[locale]/(dashboard)/owners/actions";
import { CHECK_CODES, type CheckCode } from "@/lib/owner-checks";
import type { CheckEntry, OwnerHealthData, QueueEntry } from "@/lib/owner-health";
import { LAST_LOGIN_TRACKING_SINCE } from "@/lib/owner-queue";

// BYT-20261118-003 — "Na riešenie" (owner to-do queue) and "Kontrola údajov"
// (informative ownership checks) on /owners. Data comes from the server page
// (loadOwnerHealth, request-cached and shared with the nav badge). Each item
// has ONE primary button; "Označiť ako vyriešené" lives in the item menu.
// Mutations = server actions, then router.refresh() (no client fetch, no
// polling). Registrations (registration_pending) are rendered by the existing
// OwnersInbox, passed in as `inbox`, so "one inbox for registrations" holds.

const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:ring-offset-2 focus-visible:ring-offset-ui-bg";

export type CheckFilter = CheckCode | "all";

/** Settings → Budova a byty with the bulk unit-type mode open (FlatsTab). */
const UNIT_TYPE_BULK_HREF = "/settings?tab=building&unitTypes=1";

interface OwnersHealthProps {
  health: OwnerHealthData;
  /** The existing registrations inbox (first group of the queue), or null. */
  inbox: ReactNode;
  inboxCount: number;
  initialCheck: CheckFilter;
  onClaim: (row: { id: string; name: string; email: string | null }, mode: "email" | "qr") => void;
  onAddOwner: () => void;
  onShowUnit: (unitId: string, label: string) => void;
  onChanged: () => void;
}

export default function OwnersHealth({
  health,
  inbox,
  inboxCount,
  initialCheck,
  onClaim,
  onAddOwner,
  onShowUnit,
  onChanged,
}: OwnersHealthProps) {
  const t = useTranslations("OwnerHealth");
  const format = useFormatter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Last dismissal — the inline "Späť" (undo) notice. */
  const [undo, setUndo] = useState<{ id: string } | null>(null);
  const [showHandledQueue, setShowHandledQueue] = useState(false);
  const [showHandledChecks, setShowHandledChecks] = useState(false);
  const [checkFilter, setCheckFilter] = useState<CheckFilter>(initialCheck);

  const fmtDate = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "medium" }) : "";

  const actionable = health.queue.filter(
    (i) => i.code !== "registration_pending" && i.code !== "inactive_long"
  );
  const inactive = health.queue.filter((i) => i.code === "inactive_long");
  const queueDismissed = health.queueDismissed;

  async function dismiss(fingerprint: string) {
    setBusy(true);
    setError(null);
    const res = await dismissOwnerHealthAction(fingerprint).catch(() => ({
      ok: false as const,
      error: "failed" as const,
    }));
    setBusy(false);
    if (!res.ok) {
      setError(t(`errors.${res.error}`));
      return;
    }
    setUndo({ id: res.id });
    onChanged();
  }

  async function restore(dismissalId: string) {
    setBusy(true);
    setError(null);
    const res = await undoOwnerHealthDismissalAction(dismissalId).catch(() => ({
      ok: false as const,
      error: "failed" as const,
    }));
    setBusy(false);
    setUndo(null);
    if (!res.ok) setError(t(`errors.${res.error}`));
    onChanged();
  }

  // ── Queue rows ──────────────────────────────────────────────────────

  function queueReason(i: QueueEntry): string {
    switch (i.code) {
      case "registration_pending":
        return t("queue.registration_pending.reason", { date: fmtDate(i.since) });
      case "missing_email":
        return t("queue.missing_email.reason");
      case "invite_unfinished":
        return i.expired
          ? t("queue.invite_unfinished.reasonExpired", { date: fmtDate(i.since) })
          : t("queue.invite_unfinished.reason", { date: fmtDate(i.since) });
      case "never_logged_in":
        return t("queue.never_logged_in.reason", { date: fmtDate(i.since) });
      case "inactive_long":
        return i.since
          ? t("queue.inactive_long.reason", { date: fmtDate(i.since) })
          : t("queue.inactive_long.reasonUnknown", { date: fmtDate(LAST_LOGIN_TRACKING_SINCE) });
    }
  }

  function queuePrimary(i: QueueEntry): ReactNode {
    const person = { id: i.userId, name: i.name, email: i.email };
    switch (i.code) {
      case "missing_email":
        return (
          <ButtonLink variant="secondary" href={`/owners/${i.userId}?edit=1`}>
            <Icon name="edit" size={20} />
            {t("queue.missing_email.action")}
          </ButtonLink>
        );
      case "invite_unfinished":
        return (
          <Button
            variant="secondary"
            onClick={() => onClaim(person, i.qr ? "qr" : "email")}
            disabled={busy}
          >
            <Icon name={i.qr ? "qr" : "mail"} size={20} />
            {i.qr ? t("queue.invite_unfinished.actionQr") : t("queue.invite_unfinished.action")}
          </Button>
        );
      default:
        // never_logged_in: no password-reset flow exists for active accounts
        // and the claim QR is for owner records only — the board contacts
        // the owner from the card. TODO(decision): reuse a reset e-mail once
        // one exists (spec BYT-20261118-003, Decisions 2).
        return (
          <ButtonLink variant="secondary" href={`/owners/${i.userId}`}>
            {t("openCard")}
            <Icon name="chevronRight" size={20} />
          </ButtonLink>
        );
    }
  }

  function renderQueueRow(item: QueueEntry, handled: boolean) {
    const menu: ActionMenuItem[] = handled
      ? []
      : [{ label: t("markHandled"), onSelect: () => dismiss(item.fingerprint), disabled: busy }];
    return (
      <Card as="li" key={item.fingerprint} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-medium text-ui-text break-words">{item.name}</p>
          {item.flatNumbers.length > 0 ? (
            <p className="text-ui-text-muted">{t("flats", { flats: item.flatNumbers.join(", ") })}</p>
          ) : null}
          <p className="mt-1 text-base text-ui-text">{queueReason(item)}</p>
          {item.code === "never_logged_in" && !handled ? (
            <p className="mt-1 text-base text-ui-text-muted">{t("queue.never_logged_in.hint")}</p>
          ) : null}
          {handled && item.dismissal ? (
            <p className="mt-1 text-ui-text-muted">
              {t("handledOn", { date: fmtDate(item.dismissal.handledAt) })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
          {handled && item.dismissal ? (
            <Button variant="secondary" onClick={() => restore(item.dismissal!.id)} disabled={busy}>
              {t("restore")}
            </Button>
          ) : (
            queuePrimary(item)
          )}
          {menu.length > 0 ? <ActionMenu label={t("moreFor", { name: item.name })} items={menu} /> : null}
        </div>
      </Card>
    );
  }

  // ── Check rows ──────────────────────────────────────────────────────

  const checkCounts = useMemo(() => {
    const c = new Map<CheckCode, number>();
    for (const f of health.checks) c.set(f.code, (c.get(f.code) ?? 0) + 1);
    return c;
  }, [health.checks]);

  function chooseCheck(next: CheckFilter) {
    setCheckFilter(next);
    // Server-readable filter (?check=…) that survives reload.
    try {
      const url = new URL(window.location.href);
      if (next === "all") url.searchParams.delete("check");
      else url.searchParams.set("check", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* ignore */
    }
  }

  function checkReason(f: CheckEntry): string {
    const unit = f.unitLabels[0] ?? "";
    switch (f.code) {
      case "share_sum_mismatch":
        return f.facts.direction === "under"
          ? t("checks.share_sum_mismatch.reasonUnder", { unit, sum: `${f.facts.sumNum}/${f.facts.sumDen}` })
          : t("checks.share_sum_mismatch.reasonOver", { unit, sum: `${f.facts.sumNum}/${f.facts.sumDen}` });
      case "unit_without_owner":
        return t("checks.unit_without_owner.reason", { unit });
      case "bsm_partner_missing":
        return t("checks.bsm_partner_missing.reason", { unit, names: f.names.join(", ") });
      case "bsm_share_mismatch":
        return t("checks.bsm_share_mismatch.reason", { unit, shares: (f.facts.shares ?? []).join(" ≠ ") });
      case "bsm_too_many":
        return t("checks.bsm_too_many.reason", { unit, count: f.facts.count ?? 0 });
      case "duplicate_ordinal":
        return t("checks.duplicate_ordinal.reason", {
          ordinal: f.facts.ordinal ?? "",
          units: f.unitLabels.join(", "),
        });
      case "unit_type_unset":
        return t("checks.unit_type_unset.reason", { count: f.facts.count ?? f.unitIds.length });
    }
  }

  function renderCheckRow(f: CheckEntry, handled: boolean) {
    // unit_type_unset is ONE aggregated item over many units: no per-unit
    // menu entries, the primary button opens the bulk "set type" screen.
    const aggregated = f.code === "unit_type_unset";
    const menu: ActionMenuItem[] = handled
      ? []
      : [
          ...(aggregated ? [] : f.unitIds.slice(1)).map((id, idx) => ({
            label: t("showOwnersOf", { unit: f.unitLabels[idx + 1] ?? "" }),
            onSelect: () => onShowUnit(id, f.unitLabels[idx + 1] ?? ""),
          })),
          { label: t("markHandled"), onSelect: () => dismiss(f.fingerprint), disabled: busy },
        ];
    return (
      <Card as="li" key={f.fingerprint} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-base font-medium text-ui-text-muted">{t(`checks.${f.code}.label`)}</p>
          <p className="mt-1 text-base text-ui-text break-words">{checkReason(f)}</p>
          {f.code !== "bsm_partner_missing" && f.names.length > 0 ? (
            <p className="mt-1 text-ui-text-muted break-words">{f.names.join(", ")}</p>
          ) : null}
          {handled && f.dismissal ? (
            <p className="mt-1 text-ui-text-muted">
              {t("handledOn", { date: fmtDate(f.dismissal.handledAt) })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
          {handled && f.dismissal ? (
            <Button variant="secondary" onClick={() => restore(f.dismissal!.id)} disabled={busy}>
              {t("restore")}
            </Button>
          ) : aggregated ? (
            <ButtonLink variant="secondary" href={UNIT_TYPE_BULK_HREF}>
              {t("checks.unit_type_unset.action")}
            </ButtonLink>
          ) : f.code === "unit_without_owner" ? (
            <Button variant="secondary" onClick={onAddOwner}>
              <Icon name="plus" size={20} />
              {t("addOwner")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => onShowUnit(f.unitIds[0], f.unitLabels[0] ?? "")}>
              {t("showOwners")}
            </Button>
          )}
          {menu.length > 0 ? (
            <ActionMenu
              label={
                aggregated
                  ? t("checks.unit_type_unset.label")
                  : t("moreForCheck", { unit: f.unitLabels.join(", ") })
              }
              items={menu}
            />
          ) : null}
        </div>
      </Card>
    );
  }

  const visibleChecks =
    checkFilter === "all" ? health.checks : health.checks.filter((f) => f.code === checkFilter);
  const checkChips: Array<{ value: CheckFilter; label: string; count: number }> = [
    { value: "all", label: t("checkFilterAll"), count: health.checks.length },
    ...CHECK_CODES.filter((c) => (checkCounts.get(c) ?? 0) > 0 || checkFilter === c).map((c) => ({
      value: c,
      label: t(`checks.${c}.label`),
      count: checkCounts.get(c) ?? 0,
    })),
  ];

  const queueCount = inboxCount + actionable.length;

  return (
    <>
      <section id="queue" aria-labelledby="owners-queue-title" className="mb-8 scroll-mt-24">
        <h2 id="owners-queue-title" className="text-2xl font-semibold text-ui-text">
          {t("queueTitle", { count: queueCount })}
        </h2>
        <p className="mt-1 mb-4 text-ui-text-muted">{t("queueHint")}</p>

        {error ? (
          <p role="alert" className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
            {error}
          </p>
        ) : null}

        {/* Undo notice for the last "vyriešené" — stays until used or replaced. */}
        <div role="status" aria-live="polite">
          {undo ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-ui-border bg-ui-surface-muted px-4 py-3">
              <span className="text-base text-ui-text">{t("handledToast")}</span>
              <Button variant="secondary" onClick={() => restore(undo.id)} disabled={busy}>
                {t("undo")}
              </Button>
              <Button variant="ghost" onClick={() => setUndo(null)} aria-label={t("closeNotice")}>
                <Icon name="x" size={20} />
              </Button>
            </div>
          ) : null}
        </div>

        {inbox}

        {actionable.length > 0 ? (
          <ul className="space-y-3">
            {actionable.map((i) => (
              renderQueueRow(i, false)
            ))}
          </ul>
        ) : queueCount === 0 ? (
          <Card className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ui-success/10 text-ui-success">
              <Icon name="check" size={22} />
            </span>
            <span className="text-base text-ui-text">{t("queueEmpty")}</span>
          </Card>
        ) : null}

        {inactive.length > 0 ? (
          <details className="mt-4 group">
            <summary
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-base font-medium text-ui-text",
                focusRingClass
              )}
            >
              <Icon name="chevronDown" size={20} className="transition-transform group-open:rotate-180" />
              {t("inactiveTitle", { count: inactive.length })}
            </summary>
            <p className="mt-1 mb-3 text-ui-text-muted">{t("inactiveHint")}</p>
            <ul className="space-y-3">
              {inactive.map((i) => (
                renderQueueRow(i, false)
              ))}
            </ul>
          </details>
        ) : null}

        {queueDismissed.length > 0 ? (
          <div className="mt-4">
            <Button variant="ghost" onClick={() => setShowHandledQueue((v) => !v)} aria-expanded={showHandledQueue}>
              {showHandledQueue ? t("hideHandled") : t("showHandled", { count: queueDismissed.length })}
            </Button>
            {showHandledQueue ? (
              <ul className="mt-3 space-y-3">
                {queueDismissed.map((i) => (
                  renderQueueRow(i, true)
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section id="checks" aria-labelledby="owners-checks-title" className="mb-8 scroll-mt-24">
        <h2 id="owners-checks-title" className="text-xl font-semibold text-ui-text">
          {t("checksTitle", { count: health.checks.length })}
        </h2>
        <p className="mt-1 mb-4 text-ui-text-muted">
          {t("checksHint")}
          {health.lvChecks ? null : <> {t("checksNoLv")}</>}
        </p>

        {health.checks.length === 0 ? (
          <Card className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ui-success/10 text-ui-success">
              <Icon name="check" size={22} />
            </span>
            <span className="text-base text-ui-text">{t("checksEmpty")}</span>
          </Card>
        ) : (
          <>
            <div role="group" aria-label={t("checkFilterLabel")} className="mb-4 flex flex-wrap gap-2">
              {checkChips.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={checkFilter === c.value}
                  onClick={() => chooseCheck(c.value)}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium transition-colors",
                    focusRingClass,
                    checkFilter === c.value
                      ? "border-ui-primary bg-ui-primary text-ui-primary-text"
                      : "border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-muted"
                  )}
                >
                  {t("chip", { label: c.label, count: c.count })}
                </button>
              ))}
            </div>
            <ul className="space-y-3">
              {visibleChecks.map((f) => (
                renderCheckRow(f, false)
              ))}
            </ul>
          </>
        )}

        {health.checksDismissed.length > 0 ? (
          <div className="mt-4">
            <Button variant="ghost" onClick={() => setShowHandledChecks((v) => !v)} aria-expanded={showHandledChecks}>
              {showHandledChecks
                ? t("hideHandled")
                : t("showHandled", { count: health.checksDismissed.length })}
            </Button>
            {showHandledChecks ? (
              <ul className="mt-3 space-y-3">
                {health.checksDismissed.map((f) => (
                  renderCheckRow(f, true)
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
