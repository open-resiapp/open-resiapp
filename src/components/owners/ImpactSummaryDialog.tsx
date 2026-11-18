"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Button, Field, Input, Modal } from "@/components/ui";
import type { ImpactLine, ImpactPlan } from "@/lib/ownership";

// BYT-20261118-007 §6 — shared impact summary. Fed by a read-only planX()
// that the mutation re-runs (plan hash), so what the board sees here is what
// will happen. Lists ONLY the non-empty groups of the plan. Confirm is
// disabled while blockers exist; hard delete / anonymise also require typing
// the person's name.

const DATE_KEYS = new Set(["date"]);

export interface ImpactSummaryDialogProps {
  open: boolean;
  title: string;
  plan: ImpactPlan | null;
  confirmLabel: string;
  /** Typed confirmation (hard delete, anonymise). */
  requireName?: string;
  /** Extra content (e.g. the country-specific anonymise notice). */
  notice?: React.ReactNode;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ImpactSummaryDialog(props: ImpactSummaryDialogProps) {
  const t = useTranslations("OwnerLifecycle");
  const format = useFormatter();
  const [typed, setTyped] = useState("");
  const { plan } = props;

  const fmt = (params?: Record<string, string | number>) => {
    if (!params) return {};
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] =
        DATE_KEYS.has(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? format.dateTime(new Date(v), { dateStyle: "long" })
          : k === "kind" && typeof v === "string"
            ? t(`kinds.${v}`)
            : v;
    }
    return out;
  };

  const groups: { key: "archive" | "move" | "keep" | "destroy"; lines: ImpactLine[] }[] = plan
    ? (["archive", "move", "keep", "destroy"] as const)
        .map((key) => ({ key, lines: plan[key].filter((l) => l.count > 0) }))
        .filter((g) => g.lines.length > 0)
    : [];

  const blocked = !plan || plan.blockers.length > 0;
  const nameOk = !props.requireName || typed.trim() === props.requireName.trim();

  return (
    <Modal
      open={props.open}
      onClose={props.loading ? () => {} : props.onCancel}
      title={props.title}
      footer={
        <>
          <Button variant="secondary" onClick={props.onCancel} disabled={props.loading} data-autofocus="">
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={props.onConfirm}
            loading={props.loading}
            disabled={blocked || !nameOk}
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      {!plan ? (
        <p className="text-ui-text-muted">{t("loadingPlan")}</p>
      ) : (
        <div className="space-y-4 text-base">
          <p className="text-ui-text">{t(`summary.${plan.action}`, fmt(plan.summary))}</p>

          {props.error && (
            <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
              {props.error}
            </p>
          )}

          {plan.blockers.length > 0 && (
            <section className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3">
              <h3 className="mb-1 font-semibold text-ui-danger">{t("groups.blockers")}</h3>
              <ul className="ml-5 list-disc text-ui-text">
                {plan.blockers.map((b, i) => (
                  <li key={i}>{t(`blockers.${b.code}`, fmt(b.params))}</li>
                ))}
              </ul>
            </section>
          )}

          {groups.map((g) => (
            <section key={g.key}>
              <h3 className="mb-1 font-semibold text-ui-text">{t(`groups.${g.key}`)}</h3>
              <ul className="ml-5 list-disc text-ui-text">
                {g.lines.map((l) => (
                  <li key={`${l.group}-${l.key}`}>{t(`lines.${l.key}`, { count: l.count })}</li>
                ))}
              </ul>
            </section>
          ))}

          {plan.warnings.length > 0 && (
            <section className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 px-4 py-3">
              <h3 className="mb-1 font-semibold text-ui-text">{t("groups.warnings")}</h3>
              <ul className="ml-5 list-disc text-ui-text">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{t(`warnings.${w.code}`, fmt(w.params))}</li>
                ))}
              </ul>
            </section>
          )}

          {props.notice}

          {props.requireName && !blocked && (
            <Field label={t("typeNameLabel", { name: props.requireName })} htmlFor="impact-type-name">
              <Input
                id="impact-type-name"
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
