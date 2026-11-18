"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import {
  ActionMenu,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  cn,
  type ActionMenuItem,
} from "@/components/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { revokeInvitationAction } from "@/app/[locale]/(dashboard)/owners/actions";
import {
  OWNER_STATUSES,
  type OwnerRow,
  type OwnerStatus,
  type OwnersBoardData,
} from "@/lib/owners-board";
import type { OwnerHealthData } from "@/lib/owner-health";
import AddOwnerModal from "./AddOwnerModal";
import InvitationModal from "./InvitationModal";
import { OwnerStatusBadge } from "./OwnerStatusBadge";
import UnitTypeBadge from "@/components/units/UnitTypeBadge";
import OwnersHealth, { type CheckFilter } from "./OwnersHealth";
import OwnersInbox from "./OwnersInbox";
import PendingApprovalModal from "./PendingApprovalModal";
import ShellClaimDialog from "./ShellClaimDialog";
import ShellMergeDialog from "./ShellMergeDialog";
import { rejectRegistration } from "./owner-requests";

// "former" (BYT-20261118-007): former owners, hidden from every other filter.
export type OwnersFilter = OwnerStatus | "all" | "former";

// Same ring as the kit's internal `focusRing` (not exported from the barrel).
const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:ring-offset-2 focus-visible:ring-offset-ui-bg";

type Dialog =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "generic" }
  | { kind: "claim"; id: string; name: string; email: string | null; mode: "email" | "qr" }
  | { kind: "merge"; row: OwnerRow }
  | { kind: "revoke"; row: OwnerRow }
  | { kind: "approve"; row: OwnerRow }
  | { kind: "reject"; row: OwnerRow };

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface OwnersBoardProps {
  data: OwnersBoardData;
  initialFilter: OwnersFilter;
  locale: string;
  /** BYT-20261118-003: "Na riešenie" queue + ownership checks. */
  health: OwnerHealthData;
  initialCheck: CheckFilter;
  /** `?unit=<id>` — show only the owners of one unit (link from a check). */
  initialUnit: string | null;
}

export default function OwnersBoard({
  data,
  initialFilter,
  locale,
  health,
  initialCheck,
  initialUnit,
}: OwnersBoardProps) {
  const t = useTranslations("Owners.board");
  const tHealth = useTranslations("OwnerHealth");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const router = useRouter();

  const [filter, setFilter] = useState<OwnersFilter>(initialFilter);
  const [unitFilter, setUnitFilter] = useState<string | null>(
    initialUnit && data.units.some((u) => u.id === initialUnit) ? initialUnit : null
  );
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server data is the source of truth: re-render the server page (list,
  // inbox, nav badge, share-sum banner) after every mutation.
  const refresh = () => router.refresh();
  const close = () => setDialog({ kind: "none" });

  const tLife = useTranslations("OwnerLifecycle");
  const formerCount = useMemo(() => data.people.filter((p) => p.formerUntil).length, [data.people]);

  const counts = useMemo(() => {
    const c: Record<OwnerStatus, number> = { no_account: 0, invited: 0, pending: 0, active: 0 };
    for (const p of data.people) if (!p.formerUntil) c[p.status] += 1;
    return c;
  }, [data.people]);

  // Client-side search over the already loaded list — no requests per keystroke.
  const searchIndex = useMemo(
    () =>
      new Map(
        data.people.map((p) => [
          p.id,
          fold([p.name, p.email ?? "", ...p.flats.map((f) => f.flatNumber)].join(" ")),
        ])
      ),
    [data.people]
  );

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return data.people.filter(
      (p) =>
        (filter === "former" ? !!p.formerUntil : !p.formerUntil) &&
        (filter === "all" || filter === "former" || p.status === filter) &&
        (!unitFilter || p.flats.some((f) => f.unitId === unitFilter)) &&
        (!q || (searchIndex.get(p.id) ?? "").includes(q))
    );
  }, [data.people, filter, unitFilter, query, searchIndex]);

  const unitFilterLabel = unitFilter
    ? data.units.find((u) => u.id === unitFilter)?.flatNumber ?? ""
    : "";

  function chooseUnit(next: string | null) {
    setUnitFilter(next);
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("unit", next);
      else url.searchParams.delete("unit");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* ignore */
    }
    if (next) {
      setFilter("all");
      document.getElementById("owners-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function chooseFilter(next: OwnersFilter) {
    setFilter(next);
    // Keep the choice in the URL (reload / back) without a server round trip.
    try {
      const url = new URL(window.location.href);
      if (next === "all") url.searchParams.delete("status");
      else url.searchParams.set("status", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* ignore */
    }
  }

  const fmtDate = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  function claim(row: { id: string; name: string; email: string | null }, mode: "email" | "qr") {
    setDialog({ kind: "claim", id: row.id, name: row.name, email: row.email, mode });
  }

  async function revoke(row: OwnerRow) {
    setBusy(true);
    setError(null);
    const res = await revokeInvitationAction(row.id).catch(() => ({ ok: false as const, error: "failed" as const }));
    setBusy(false);
    close();
    if (!res.ok) setError(t(`errors.${res.error}`));
    refresh();
  }

  async function reject(row: OwnerRow) {
    setBusy(true);
    setError(null);
    const err = await rejectRegistration(row.id);
    setBusy(false);
    close();
    if (err !== null) setError(err || tCommon("saveFailed"));
    refresh();
  }

  function rowActions(row: OwnerRow): { primary: React.ReactNode; menu: ActionMenuItem[] } {
    const openDetail: ActionMenuItem = {
      label: t("openDetailMenu"),
      onSelect: () => router.push(`/owners/${row.id}`),
    };
    const mergeItem: ActionMenuItem[] =
      row.mergeable && data.mergeCandidates.length > 0
        ? [{ label: t("mergeWithRegistration"), onSelect: () => setDialog({ kind: "merge", row }) }]
        : [];
    switch (row.status) {
      case "no_account":
        return {
          primary: (
            <Button variant="secondary" onClick={() => claim(row, "email")}>
              <Icon name="mail" size={20} />
              {t("invite")}
            </Button>
          ),
          menu: [{ label: t("printQr"), onSelect: () => claim(row, "qr") }, ...mergeItem, openDetail],
        };
      case "invited":
        return {
          primary: (
            <Button variant="secondary" onClick={() => claim(row, row.email ? "email" : "qr")}>
              <Icon name="mail" size={20} />
              {t("resend")}
            </Button>
          ),
          menu: [
            { label: t("printQr"), onSelect: () => claim(row, "qr") },
            ...mergeItem,
            openDetail,
            { label: t("revokeInvite"), tone: "danger", onSelect: () => setDialog({ kind: "revoke", row }) },
          ],
        };
      case "pending":
        return {
          primary: (
            <Button variant="secondary" onClick={() => setDialog({ kind: "approve", row })}>
              <Icon name="check" size={20} />
              {t("approve")}
            </Button>
          ),
          menu: [
            openDetail,
            { label: t("reject"), tone: "danger", onSelect: () => setDialog({ kind: "reject", row }) },
          ],
        };
      case "active":
        return {
          primary: (
            <ButtonLink variant="secondary" href={`/owners/${row.id}`}>
              {t("openDetail")}
              <Icon name="chevronRight" size={20} />
            </ButtonLink>
          ),
          menu: [],
        };
    }
  }

  const chips: Array<{ value: OwnersFilter; label: string; count: number }> = [
    { value: "all", label: t("filterAll"), count: data.people.filter((p) => !p.formerUntil).length },
    ...OWNER_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), count: counts[s] })),
    ...(formerCount > 0
      ? [{ value: "former" as const, label: tLife("formerChip"), count: formerCount }]
      : []),
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button onClick={() => setDialog({ kind: "add" })}>
              <Icon name="plus" size={20} />
              {t("addOwner")}
            </Button>
            <ButtonLink variant="ghost" href="/settings/registration-qr">
              <Icon name="qr" size={20} />
              {t("registrationQrLink")}
            </ButtonLink>
          </>
        }
      />

      <OwnersHealth
        health={health}
        inboxCount={data.inbox.length}
        inbox={
          data.inbox.length > 0 ? (
            <OwnersInbox
              items={data.inbox}
              mergeShells={data.mergeShells}
              units={data.units}
              onChanged={refresh}
            />
          ) : null
        }
        initialCheck={initialCheck}
        onClaim={claim}
        onAddOwner={() => setDialog({ kind: "add" })}
        onShowUnit={(unitId) => chooseUnit(unitId)}
        onChanged={refresh}
      />

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
          {error}
        </p>
      )}

      <div id="owners-list" className="mb-4 flex scroll-mt-24 flex-col gap-3">
        {unitFilter ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ui-border bg-ui-surface-muted px-4 py-3">
            <span className="text-base text-ui-text">{tHealth("unitFilter", { unit: unitFilterLabel })}</span>
            <Button variant="secondary" onClick={() => chooseUnit(null)}>
              <Icon name="x" size={20} />
              {tHealth("clearUnitFilter")}
            </Button>
          </div>
        ) : null}
        <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={filter === c.value}
              onClick={() => chooseFilter(c.value)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium transition-colors",
                focusRingClass,
                filter === c.value
                  ? "border-ui-primary bg-ui-primary text-ui-primary-text"
                  : "border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-muted"
              )}
            >
              {t("chip", { label: c.label, count: c.count })}
            </button>
          ))}
        </div>
        <div className="relative max-w-md">
          <label htmlFor="owners-search" className="sr-only">
            {t("searchLabel")}
          </label>
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-text-muted"
          />
          <Input
            id="owners-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-10"
          />
        </div>
      </div>

      {data.people.length === 0 ? (
        <EmptyState icon="users" title={t("emptyAll")} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search"
          title={t("emptyFiltered")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                chooseFilter("all");
                chooseUnit(null);
              }}
            >
              {t("clearFilters")}
            </Button>
          }
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {/* Column headings — desktop only; on mobile each row is a stacked card. */}
          <div
            aria-hidden="true"
            className="hidden border-b border-ui-border bg-ui-surface-muted px-5 py-3 text-base font-medium text-ui-text-muted md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)] md:gap-4"
          >
            <span>{t("colPerson")}</span>
            <span>{t("colFlats")}</span>
            <span>{t("colStatus")}</span>
            <span className="text-right">{t("colAction")}</span>
          </div>
          <ul className="divide-y divide-ui-border">
            {visible.map((row) => {
              const { primary, menu } = rowActions(row);
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 px-4 py-4 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)] md:items-center md:gap-4 md:px-5"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/owners/${row.id}`}
                        className={cn(
                          "text-lg font-medium text-ui-text underline-offset-4 hover:underline break-words",
                          focusRingClass
                        )}
                      >
                        {row.name}
                      </Link>
                      {row.email ? <p className="break-all text-ui-text-muted">{row.email}</p> : null}
                    </div>
                    <span className="md:hidden">
                      <OwnerStatusBadge status={row.status} deactivated={row.deactivated} />
                    </span>
                  </div>

                  <div className="min-w-0 text-ui-text">
                    {row.flats.length === 0 && row.formerUntil ? (
                      <span className="text-ui-text-muted">
                        {tLife("formerUntil", { date: fmtDate(row.formerUntil) })}
                      </span>
                    ) : row.flats.length === 0 ? (
                      <span className="text-ui-text-muted">{t("noFlat")}</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {row.flats.map((f) => (
                          <li key={f.unitId} className="flex flex-wrap items-center gap-2">
                            <span>
                              {t("flatWithShare", {
                                flat: f.flatNumber,
                                share: `${f.shareNum}/${f.shareDen}`,
                              })}
                            </span>
                            <UnitTypeBadge type={f.unitType} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="min-w-0">
                    <span className="hidden md:inline-flex">
                      <OwnerStatusBadge status={row.status} deactivated={row.deactivated} />
                    </span>
                    {row.invite ? (
                      <p className="text-ui-text-muted md:mt-1">
                        {t("invitedOn", { date: fmtDate(row.invite.sentAt) })}
                        {" · "}
                        {row.invite.expired ? (
                          <span className="font-medium text-ui-warning">
                            {t("inviteExpired", { date: fmtDate(row.invite.expiresAt) })}
                          </span>
                        ) : (
                          t("inviteValidUntil", { date: fmtDate(row.invite.expiresAt) })
                        )}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {primary}
                    {menu.length > 0 ? (
                      <ActionMenu label={t("moreFor", { name: row.name })} items={menu} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {dialog.kind === "add" && (
        <AddOwnerModal
          units={data.units}
          onClose={close}
          onCreated={refresh}
          onInvite={(owner, mode) => claim(owner, mode)}
          onGenericLink={() => setDialog({ kind: "generic" })}
        />
      )}

      <InvitationModal isOpen={dialog.kind === "generic"} onClose={close} units={data.units} />

      {dialog.kind === "claim" && (
        <ShellClaimDialog
          key={`${dialog.id}-${dialog.mode}`}
          shellId={dialog.id}
          shellName={dialog.name}
          existingEmail={dialog.email}
          mode={dialog.mode}
          locale={locale}
          onClose={() => {
            close();
            refresh();
          }}
        />
      )}

      {dialog.kind === "merge" && (
        <ShellMergeDialog
          shellId={dialog.row.id}
          shellName={dialog.row.name}
          candidates={data.mergeCandidates}
          onClose={close}
          onMerged={() => {
            close();
            refresh();
          }}
        />
      )}

      {dialog.kind === "approve" && (
        <PendingApprovalModal
          user={{ id: dialog.row.id, name: dialog.row.name, email: dialog.row.email ?? "" }}
          units={data.units}
          onClose={close}
          onApproved={() => {
            close();
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={dialog.kind === "revoke"}
        tone="danger"
        title={t("confirmRevokeTitle")}
        description={dialog.kind === "revoke" ? t("confirmRevokeBody", { name: dialog.row.name }) : ""}
        confirmLabel={t("confirmRevokeAction")}
        cancelLabel={t("keep")}
        loading={busy}
        onConfirm={() => dialog.kind === "revoke" && revoke(dialog.row)}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog.kind === "reject"}
        tone="danger"
        title={t("confirmRejectTitle")}
        description={dialog.kind === "reject" ? t("confirmRejectBody", { name: dialog.row.name }) : ""}
        confirmLabel={t("confirmRejectAction")}
        loading={busy}
        onConfirm={() => dialog.kind === "reject" && reject(dialog.row)}
        onCancel={close}
      />
    </div>
  );
}
