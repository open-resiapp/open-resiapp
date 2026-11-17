"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { Button, Card, ConfirmDialog, Icon, PageHeader } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import { revokeInvitationAction } from "@/app/[locale]/(dashboard)/owners/actions";
import type { OwnerDetailData } from "@/lib/owners-board";
import type { UserRole } from "@/types";
import OwnerEditForm, { type ShareWarning } from "./OwnerEditForm";
import { OwnerStatusBadge } from "./OwnerStatusBadge";
import ShellClaimDialog from "./ShellClaimDialog";
import ShellMergeDialog from "./ShellMergeDialog";

const roleKeys: Record<UserRole, string> = {
  admin: "roleAdmin",
  owner: "roleOwner",
  tenant: "roleTenant",
  vote_counter: "roleVoteCounter",
  caretaker: "roleCaretaker",
};

type Dialog =
  | { kind: "none" }
  | { kind: "claim"; mode: "email" | "qr" }
  | { kind: "merge" }
  | { kind: "revoke" }
  | { kind: "deactivate" }
  | { kind: "delete" };

/**
 * Owner detail (BYT-20261117-002 Phase 5): same actions as before — edit,
 * activate/deactivate, delete, invite / QR / merge for owner records — now on
 * the UI kit, with confirmations stating the consequence. Data comes from the
 * server page; mutations use the existing endpoints, then router.refresh().
 */
export default function OwnerDetail({ data }: { data: OwnerDetailData }) {
  const t = useTranslations("Owners");
  const tBoard = useTranslations("Owners.board");
  const tShell = useTranslations("Owners.pending");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const { owner, units, mergeCandidates } = data;

  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareWarnings, setShareWarnings] = useState<ShareWarning[]>([]);

  const isShell = owner.status === "no_account" || owner.status === "invited";
  const close = () => setDialog({ kind: "none" });
  const refresh = () => router.refresh();

  async function setActive(isActive: boolean) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/users/${owner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    setBusy(false);
    close();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || tCommon("saveFailed"));
      return;
    }
    refresh();
  }

  async function handleDelete() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/users/${owner.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(res.status === 409 ? t("hasRelatedRecords") : body.error || t("deleteFailed"));
      setBusy(false);
      close();
      return;
    }
    router.push("/owners");
    router.refresh();
  }

  async function revoke() {
    setBusy(true);
    setError("");
    const res = await revokeInvitationAction(owner.id).catch(() => ({ ok: false as const, error: "failed" as const }));
    setBusy(false);
    close();
    if (!res.ok) setError(tBoard(`errors.${res.error}`));
    refresh();
  }

  function flatLine(f: OwnerDetailData["owner"]["flats"][number]) {
    const base =
      f.floor !== null && f.entranceName
        ? t("flatDisplay", { number: f.flatNumber, floor: f.floor, entrance: f.entranceName })
        : f.entranceName
          ? t("flatDisplayNoFloor", { number: f.flatNumber, entrance: f.entranceName })
          : `${t("flatLabel")} ${f.flatNumber}`;
    return `${base} – ${t("ownerShareLabel")} ${f.shareNum}/${f.shareDen}`;
  }

  const fmtDate = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={owner.name}
        backHref="/owners"
        backLabel={tBoard("backToOwners")}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <OwnerStatusBadge status={owner.status} deactivated={owner.deactivated} />
            {owner.invite ? (
              <span>
                {tBoard("invitedOn", { date: fmtDate(owner.invite.sentAt) })}
                {" · "}
                {owner.invite.expired
                  ? tBoard("inviteExpired", { date: fmtDate(owner.invite.expiresAt) })
                  : tBoard("inviteValidUntil", { date: fmtDate(owner.invite.expiresAt) })}
              </span>
            ) : null}
          </span>
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
          {error}
        </p>
      )}

      {isShell && (
        <Card as="section" className="mb-4 border-ui-warning/40">
          <h2 className="mb-1 text-lg font-semibold text-ui-text">{tShell("shellBannerTitle")}</h2>
          <p className="mb-3 text-ui-text-muted">{tShell("shellBannerHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: "claim", mode: "email" })}>
              <Icon name="mail" size={20} />
              {owner.status === "invited"
                ? tBoard("resend")
                : owner.email
                  ? tShell("sendInvitation")
                  : tShell("addEmailAndInvite")}
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "claim", mode: "qr" })}>
              <Icon name="qr" size={20} />
              {tBoard("printQr")}
            </Button>
            {owner.mergeable ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: "merge" })}>
                <Icon name="link" size={20} />
                {tShell("assignExisting")}
              </Button>
            ) : null}
            {owner.status === "invited" ? (
              <Button variant="ghost" onClick={() => setDialog({ kind: "revoke" })}>
                <Icon name="x" size={20} />
                {tBoard("revokeInvite")}
              </Button>
            ) : null}
          </div>
        </Card>
      )}

      {shareWarnings.length > 0 && (
        <Card as="section" className="mb-4 border-ui-warning/40" role="status">
          <h2 className="mb-1 font-semibold text-ui-text">{t("shareSumWarningTitle")}</h2>
          <ul className="ml-5 list-disc text-ui-text">
            {shareWarnings.map((w) => (
              <li key={w.flatId}>
                {t("shareSumWarningItem", {
                  flat: w.flatNumber,
                  sum: `${w.sumNumerator}/${w.sumDenominator}`,
                })}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" padding="lg" className="mb-6">
        {editing ? (
          <OwnerEditForm
            owner={owner}
            units={units}
            onCancel={() => setEditing(false)}
            onSaved={(warnings) => {
              setShareWarnings(warnings);
              setEditing(false);
              refresh();
            }}
          />
        ) : (
          <>
            <dl className="space-y-4">
              <div>
                <dt className="text-base font-medium text-ui-text-muted">{t("emailLabel")}</dt>
                <dd className="break-all text-base text-ui-text">{owner.email || tCommon("noDash")}</dd>
              </div>
              <div>
                <dt className="text-base font-medium text-ui-text-muted">{t("phoneLabel")}</dt>
                <dd className="text-base text-ui-text">{owner.phone || tCommon("noDash")}</dd>
              </div>
              <div>
                <dt className="text-base font-medium text-ui-text-muted">{t("roleLabel")}</dt>
                <dd className="text-base text-ui-text">{t(roleKeys[owner.role])}</dd>
              </div>
              <div>
                <dt className="text-base font-medium text-ui-text-muted">{t("flatsLabel")}</dt>
                <dd className="text-base text-ui-text">
                  {owner.flats.length === 0 ? (
                    tCommon("noDash")
                  ) : (
                    <ul className="space-y-1">
                      {owner.flats.map((f) => (
                        <li key={f.unitId} className="break-words">
                          {flatLine(f)}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-base font-medium text-ui-text-muted">{t("registered")}</dt>
                <dd className="text-base text-ui-text">
                  {format.dateTime(new Date(owner.createdAt), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-ui-border pt-6">
              <Button onClick={() => setEditing(true)}>
                <Icon name="edit" size={20} />
                {tCommon("edit")}
              </Button>
              {owner.deactivated ? (
                <Button variant="secondary" onClick={() => setActive(true)} loading={busy}>
                  {t("activate")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setDialog({ kind: "deactivate" })}>
                  {t("deactivate")}
                </Button>
              )}
              <Button variant="ghost" className="text-ui-danger" onClick={() => setDialog({ kind: "delete" })}>
                <Icon name="trash" size={20} />
                {tCommon("delete")}
              </Button>
            </div>
          </>
        )}
      </Card>

      {dialog.kind === "claim" && (
        <ShellClaimDialog
          key={dialog.mode}
          shellId={owner.id}
          shellName={owner.name}
          existingEmail={owner.email}
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
          shellId={owner.id}
          shellName={owner.name}
          candidates={mergeCandidates}
          onClose={close}
          onMerged={() => {
            // The record is gone after a merge — back to the list.
            router.push("/owners");
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={dialog.kind === "revoke"}
        tone="danger"
        title={tBoard("confirmRevokeTitle")}
        description={tBoard("confirmRevokeBody", { name: owner.name })}
        confirmLabel={tBoard("confirmRevokeAction")}
        cancelLabel={tBoard("keep")}
        loading={busy}
        onConfirm={revoke}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog.kind === "deactivate"}
        tone="danger"
        title={tBoard("confirmDeactivateTitle")}
        description={tBoard("confirmDeactivateBody", { name: owner.name })}
        confirmLabel={t("deactivate")}
        loading={busy}
        onConfirm={() => setActive(false)}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog.kind === "delete"}
        tone="danger"
        title={tBoard("confirmDeleteTitle")}
        description={tBoard("confirmDeleteBody", { name: owner.name })}
        confirmLabel={t("deleteUser")}
        loading={busy}
        onConfirm={handleDelete}
        onCancel={close}
      />
    </div>
  );
}
