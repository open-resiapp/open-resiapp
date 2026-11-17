"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { ActionMenu, Badge, Button, Card, ConfirmDialog, Field, Modal, Select } from "@/components/ui";
import type { InboxItem, MergeShellOption, UnitOption } from "@/lib/owners-board";
import PendingApprovalModal from "./PendingApprovalModal";
import { mergeAndApprove, rejectRegistration } from "./owner-requests";

type Dialog =
  | { kind: "none" }
  | { kind: "approve"; item: InboxItem }
  | { kind: "pick"; item: InboxItem }
  | { kind: "merge"; item: InboxItem; shellId: string; shellName: string }
  | { kind: "reject"; item: InboxItem };

interface OwnersInboxProps {
  items: InboxItem[];
  mergeShells: MergeShellOption[];
  units: UnitOption[];
  /** Re-run the server page (list, inbox and the nav badge). */
  onChanged: () => void;
}

/**
 * "Čaká na vás (N)": self-registrations waiting for the board. Same
 * population as the nav badge. Only rendered when N > 0.
 */
export default function OwnersInbox({ items, mergeShells, units, onChanged }: OwnersInboxProps) {
  const t = useTranslations("Owners.board");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedShell, setPickedShell] = useState("");

  const close = () => {
    setDialog({ kind: "none" });
    setPickedShell("");
  };

  async function runMerge(item: InboxItem, shellId: string) {
    setBusy(true);
    setError(null);
    const err = await mergeAndApprove(shellId, item.id);
    setBusy(false);
    close();
    if (err !== null) setError(err || tCommon("saveFailed"));
    onChanged();
  }

  async function runReject(item: InboxItem) {
    setBusy(true);
    setError(null);
    const err = await rejectRegistration(item.id);
    setBusy(false);
    close();
    if (err !== null) setError(err || tCommon("saveFailed"));
    onChanged();
  }

  return (
    <section id="inbox" aria-labelledby="owners-inbox-title" className="mb-8 scroll-mt-24">
      <h2 id="owners-inbox-title" className="text-xl font-semibold text-ui-text">
        {t("inboxTitle", { count: items.length })}
      </h2>
      <p className="mt-1 mb-4 text-ui-text-muted">{t("inboxHint")}</p>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {items.map((item) => {
          const s = item.suggestion;
          const menu = s
            ? [
                { label: t("approveAsNew"), onSelect: () => setDialog({ kind: "approve", item }) },
                { label: t("mergeWithOther"), onSelect: () => setDialog({ kind: "pick", item }) },
              ]
            : item.flats.length === 0
              ? [{ label: t("mergeWithShell"), onSelect: () => setDialog({ kind: "pick", item }) }]
              : [];
          return (
            <Card as="li" key={item.id} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-lg font-medium text-ui-text break-words">{item.name}</p>
                <p className="break-all text-ui-text-muted">
                  {item.email}
                  {item.phone ? ` · ${item.phone}` : ""}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-ui-text-muted">
                  <span>
                    {t("submittedAt", {
                      date: format.dateTime(new Date(item.createdAt), { dateStyle: "medium" }),
                    })}
                  </span>
                  {!item.emailVerified ? <Badge tone="warning">{t("emailNotVerified")}</Badge> : null}
                </p>
                {item.flats.length > 0 ? (
                  <p className="mt-1 text-ui-text">
                    {t("linkedFlats", { flats: item.flats.map((f) => f.flatNumber).join(", ") })}
                  </p>
                ) : s ? (
                  <p className="mt-1 text-ui-text">
                    {s.flatNumber
                      ? t("suggestion", { name: s.shellName, flat: s.flatNumber })
                      : t("suggestionNoFlat", { name: s.shellName })}{" "}
                    <span className="text-ui-text-muted">
                      ({t("suggestionScore", { score: Math.round(s.score * 100) })})
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-ui-text-muted">{t("noSuggestion")}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                {s ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setDialog({ kind: "merge", item, shellId: s.shellId, shellName: s.shellName })
                    }
                    disabled={busy}
                  >
                    {t("mergeWith", { name: s.shellName })}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setDialog({ kind: "approve", item })} disabled={busy}>
                    {t("approve")}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDialog({ kind: "reject", item })} disabled={busy}>
                  {t("reject")}
                </Button>
                {menu.length > 0 ? <ActionMenu label={t("moreFor", { name: item.name })} items={menu} /> : null}
              </div>
            </Card>
          );
        })}
      </ul>

      {dialog.kind === "approve" && (
        <PendingApprovalModal
          user={{ id: dialog.item.id, name: dialog.item.name, email: dialog.item.email }}
          units={units}
          onClose={close}
          onApproved={() => {
            close();
            onChanged();
          }}
        />
      )}

      {dialog.kind === "pick" && (
        <Modal
          open
          onClose={close}
          title={t("pickShellTitle")}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {tCommon("cancel")}
              </Button>
              <Button
                disabled={!pickedShell}
                onClick={() => {
                  const shell = mergeShells.find((m) => m.id === pickedShell);
                  if (shell)
                    setDialog({ kind: "merge", item: dialog.item, shellId: shell.id, shellName: shell.name });
                }}
              >
                {t("continue")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-ui-text-muted">{t("pickShellIntro", { name: dialog.item.name })}</p>
            {mergeShells.length === 0 ? (
              <p>{t("pickShellEmpty")}</p>
            ) : (
              <Field label={t("pickShellLabel")}>
                <Select value={pickedShell} onChange={(e) => setPickedShell(e.target.value)}>
                  <option value="">{t("pickShellPlaceholder")}</option>
                  {mergeShells.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.flatNumber ? ` (${m.flatNumber})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={dialog.kind === "merge"}
        tone="danger"
        title={t("confirmMergeTitle")}
        description={
          dialog.kind === "merge"
            ? t("confirmMergeBody", { name: dialog.item.name, shellName: dialog.shellName })
            : ""
        }
        confirmLabel={t("confirmMergeAction")}
        loading={busy}
        onConfirm={() => dialog.kind === "merge" && runMerge(dialog.item, dialog.shellId)}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog.kind === "reject"}
        tone="danger"
        title={t("confirmRejectTitle")}
        description={dialog.kind === "reject" ? t("confirmRejectBody", { name: dialog.item.name }) : ""}
        confirmLabel={t("confirmRejectAction")}
        loading={busy}
        onConfirm={() => dialog.kind === "reject" && runReject(dialog.item)}
        onCancel={close}
      />
    </section>
  );
}
