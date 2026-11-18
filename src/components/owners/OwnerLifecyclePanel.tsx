"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { ActionMenu, Button, Card, ConfirmDialog, Field, Input, Modal, cn } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import {
  anonymizeAction,
  deleteAction,
  mergeAction,
  planAnonymizeAction,
  planDeleteAction,
  planMergeAction,
  planRemoveAction,
  removeAction,
  restoreAction,
} from "@/app/[locale]/(dashboard)/owners/lifecycle-actions";
import type { ImpactPlan, LifecycleErrorCode, OwnershipPeriod } from "@/lib/ownership";
import ImpactSummaryDialog from "./ImpactSummaryDialog";
import { AnonymizeNotice } from "./anonymize-notice";

// BYT-20261118-007 — owner detail: ownership timeline ("Vlastníctvo") and the
// lifecycle actions (remove from community / restore, merge, anonymise,
// delete). Every action opens the ImpactSummaryDialog first; nothing runs
// without its explicit confirm.

export interface MergeOption {
  id: string;
  name: string;
  email: string | null;
  flatLabel: string | null;
  suggested: boolean;
}

type Action = "remove" | "merge" | "anonymize" | "delete";

interface Props {
  owner: { id: string; name: string };
  history: OwnershipPeriod[];
  restorable: { auditId: string; date: string } | null;
  mergeOptions: MergeOption[];
  country: "sk" | "cz";
}

export default function OwnerLifecyclePanel({ owner, history, restorable, mergeOptions, country }: Props) {
  const t = useTranslations("OwnerLifecycle");
  const format = useFormatter();
  const router = useRouter();

  const [action, setAction] = useState<Action | null>(null);
  const [plan, setPlan] = useState<ImpactPlan | null>(null);
  const [mergePair, setMergePair] = useState<{ otherId: string; fromId: string; intoId: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [pageError, setPageError] = useState("");

  const fmtDate = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const errText = (code: LifecycleErrorCode) => t(`errors.${code}`);

  function close() {
    setAction(null);
    setPlan(null);
    setMergePair(null);
    setError("");
  }

  async function open(a: Exclude<Action, "merge">) {
    setAction(a);
    setPlan(null);
    setError("");
    const r =
      a === "remove"
        ? await planRemoveAction(owner.id)
        : a === "anonymize"
          ? await planAnonymizeAction(owner.id)
          : await planDeleteAction(owner.id);
    if (!r.ok) {
      setAction(null);
      setPageError(errText(r.error));
      return;
    }
    setPlan(r.plan);
  }

  async function openMerge(otherId: string, survivorId?: string) {
    setPicking(false);
    setAction("merge");
    setPlan(null);
    setError("");
    const r = await planMergeAction(owner.id, otherId, survivorId);
    if (!r.ok) {
      setAction(null);
      setPageError(errText(r.error));
      return;
    }
    setMergePair({ otherId, fromId: r.fromId, intoId: r.intoId });
    setPlan(r.plan);
  }

  async function confirm() {
    if (!plan || !action) return;
    setBusy(true);
    setError("");
    const r =
      action === "remove"
        ? await removeAction(owner.id, plan.hash)
        : action === "anonymize"
          ? await anonymizeAction(owner.id, plan.hash)
          : action === "delete"
            ? await deleteAction(owner.id, plan.hash)
            : await mergeAction(mergePair!.fromId, mergePair!.intoId, plan.hash);
    setBusy(false);
    if (!r.ok) {
      // plan_stale / blockers: show the fresh plan the server computed.
      if (r.plan) setPlan(r.plan);
      setError(errText(r.error));
      return;
    }
    const done = action;
    const pair = mergePair;
    close();
    if (done === "delete" || (done === "merge" && pair && pair.fromId === owner.id)) {
      router.push(done === "merge" && pair ? `/owners/${pair.intoId}` : "/owners");
    }
    router.refresh();
  }

  async function restore() {
    if (!restorable) return;
    setBusy(true);
    const r = await restoreAction(owner.id, restorable.auditId);
    setBusy(false);
    setRestoring(false);
    if (!r.ok) setPageError(errText(r.error));
    router.refresh();
  }

  const options = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    const list = mergeOptions.filter(
      (o) => !q || o.name.toLowerCase().includes(q) || (o.email ?? "").toLowerCase().includes(q)
    );
    return [...list].sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name, "sk"));
  }, [mergeOptions, pickQuery]);

  const titles: Record<Action, string> = {
    remove: t("removeTitle"),
    merge: t("mergeTitle"),
    anonymize: t("anonymizeTitle"),
    delete: t("deleteTitle"),
  };
  const confirmLabels: Record<Action, string> = {
    remove: t("removeConfirm"),
    merge: t("mergeConfirm"),
    anonymize: t("anonymizeConfirm"),
    delete: t("deleteConfirm"),
  };

  const otherName = mergePair ? (mergeOptions.find((o) => o.id === mergePair.otherId)?.name ?? "") : "";
  const hasCurrent = history.some((h) => h.validTo === null);

  return (
    <>
      {pageError && (
        <p role="alert" className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
          {pageError}
        </p>
      )}

      <Card as="section" padding="lg" className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ui-text">{t("historyTitle")}</h2>
          <ActionMenu
            label={t("actionsLabel")}
            align="end"
            items={[
              ...(hasCurrent ? [{ label: t("removeAction"), onSelect: () => void open("remove") }] : []),
              ...(restorable ? [{ label: t("restoreAction"), onSelect: () => setRestoring(true) }] : []),
              { label: t("mergeAction"), onSelect: () => setPicking(true) },
              { label: t("anonymizeAction"), onSelect: () => void open("anonymize"), tone: "danger" as const },
              { label: t("deleteAction"), onSelect: () => void open("delete"), tone: "danger" as const },
            ]}
          />
        </div>
        {history.length === 0 ? (
          <p className="text-ui-text-muted">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-ui-border">
            {history.map((h) => (
              <li key={h.membershipId} className="py-2">
                <p className="text-ui-text">
                  {t("historyUnit", { unit: h.unitLabel, share: `${h.shareNum}/${h.shareDen}` })}
                </p>
                <p className="text-ui-text-muted">
                  {h.validTo
                    ? t("periodEnded", {
                        from: fmtDate(h.validFrom),
                        to: fmtDate(h.validTo),
                        reason: h.endReason ? t(`endReasons.${h.endReason}`) : "",
                      })
                    : t("periodCurrent", { from: fmtDate(h.validFrom) })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Merge: pick the duplicate account first. */}
      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title={t("mergePickTitle")}
        footer={
          <Button variant="secondary" onClick={() => setPicking(false)}>
            {t("cancel")}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-ui-text-muted">{t("mergePickHint", { name: owner.name })}</p>
          <Field label={t("mergeSearch")} htmlFor="merge-search">
            <Input id="merge-search" value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} />
          </Field>
          {options.length === 0 ? (
            <p className="text-ui-text-muted">{t("mergeNoCandidates")}</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => void openMerge(o.id)}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-lg border border-ui-border px-4 py-2 text-left hover:bg-ui-surface-muted"
                    )}
                  >
                    <span className="text-base font-medium text-ui-text">
                      {o.name}
                      {o.suggested ? ` · ${t("mergeSuggested")}` : ""}
                    </span>
                    <span className="text-ui-text-muted">
                      {[o.email, o.flatLabel].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ImpactSummaryDialog
        open={action !== null}
        title={action ? titles[action] : ""}
        plan={plan}
        confirmLabel={action ? confirmLabels[action] : ""}
        requireName={action === "delete" || action === "anonymize" ? owner.name : undefined}
        loading={busy}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={close}
        notice={
          action === "anonymize" ? (
            <AnonymizeNotice country={country} />
          ) : action === "merge" && mergePair ? (
            <div className="space-y-2">
              <p className="font-semibold text-ui-text">{t("survivorLabel")}</p>
              <div role="group" aria-label={t("survivorLabel")} className="flex flex-wrap gap-2">
                {[
                  { id: owner.id, name: owner.name },
                  { id: mergePair.otherId, name: otherName },
                ].map((p) => (
                  <Button
                    key={p.id}
                    variant={mergePair.intoId === p.id ? "primary" : "secondary"}
                    aria-pressed={mergePair.intoId === p.id}
                    onClick={() => mergePair.intoId !== p.id && void openMerge(mergePair.otherId, p.id)}
                  >
                    {t("survivorKeep", { name: p.name })}
                  </Button>
                ))}
              </div>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={restoring}
        title={t("restoreTitle")}
        description={t("restoreBody", { date: restorable?.date ? fmtDate(restorable.date) : "" })}
        confirmLabel={t("restoreAction")}
        loading={busy}
        onConfirm={() => void restore()}
        onCancel={() => setRestoring(false)}
      />
    </>
  );
}
