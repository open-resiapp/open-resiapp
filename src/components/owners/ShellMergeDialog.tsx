"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button, ConfirmDialog, Field, Input, Modal, cn } from "@/components/ui";
import type { MergeCandidate } from "@/lib/owners-board";
import { mergeAndApprove } from "./owner-requests";

interface ShellMergeDialogProps {
  shellId: string;
  shellName: string;
  /** Pending self-registrants without a flat (loaded on the server). */
  candidates: MergeCandidate[];
  onClose: () => void;
  /** Called after a successful merge (caller refreshes server data). */
  onMerged: () => void;
}

/**
 * Link an owner record (shell) to a self-registered account. Requests:
 * POST /api/admin/shell-users/[shellId]/merge {targetUserId}, then
 * POST /api/registrations/[targetUserId]/approve so the account is admitted.
 */
export default function ShellMergeDialog(props: ShellMergeDialogProps) {
  const t = useTranslations("Owners.pending");
  const tBoard = useTranslations("Owners.board");
  const tCommon = useTranslations("Common");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return props.candidates;
    return props.candidates.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [props.candidates, filter]);

  const selectedName = props.candidates.find((c) => c.id === selected)?.name ?? "";

  async function merge() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    const err = await mergeAndApprove(props.shellId, selected);
    setSubmitting(false);
    setConfirming(false);
    if (err !== null) {
      setError(err || tCommon("saveFailed"));
      return;
    }
    props.onMerged();
  }

  return (
    <>
      <Modal
        open={!confirming}
        onClose={props.onClose}
        title={t("mergeTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={props.onClose}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!selected}>
              {tBoard("continue")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-ui-text-muted">{t("mergeHint", { shellName: props.shellName })}</p>

          {error && (
            <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
              {error}
            </p>
          )}

          <Field label={tBoard("searchLabel")}>
            <Input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("mergeFilterPlaceholder")}
            />
          </Field>

          {filtered.length === 0 ? (
            <p className="text-ui-text-muted">{t("mergeNoCandidates")}</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("mergeTitle")}</legend>
              {filtered.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border-2 px-4 py-3",
                    selected === c.id
                      ? "border-ui-primary bg-ui-surface-muted"
                      : "border-ui-border hover:bg-ui-surface-muted"
                  )}
                >
                  <input
                    type="radio"
                    name="merge-target"
                    value={c.id}
                    checked={selected === c.id}
                    onChange={() => setSelected(c.id)}
                    className="mt-1 h-5 w-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ui-text">{c.name}</span>
                    <span className="block break-all text-ui-text-muted">{c.email}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={tBoard("confirmMergeTitle")}
        description={tBoard("confirmMergeBody", { name: selectedName, shellName: props.shellName })}
        confirmLabel={tBoard("confirmMergeAction")}
        loading={submitting}
        onConfirm={merge}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
