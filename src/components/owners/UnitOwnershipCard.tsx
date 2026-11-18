"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge, Button, Card } from "@/components/ui";
import { loadUnitOwnersAction } from "@/app/[locale]/(dashboard)/owners/lifecycle-actions";
import type { UnitOwnerPeriod } from "@/lib/ownership";
import TransferDialog, { type PersonOption } from "./TransferDialog";

// BYT-20261118-007 §9 — owners of one unit with "Zobraziť bývalých vlastníkov"
// (two explicit buttons, no cycling toggle) and the "Zmena vlastníka" wizard.
// Loaded on demand from the server action; no polling.

export default function UnitOwnershipCard({
  unitId,
  unitLabel,
  people,
}: {
  unitId: string;
  unitLabel: string;
  people: PersonOption[];
}) {
  const t = useTranslations("OwnerLifecycle");
  const format = useFormatter();
  const [includeFormer, setIncludeFormer] = useState(false);
  const [owners, setOwners] = useState<UnitOwnerPeriod[] | null>(null);
  const [error, setError] = useState("");
  const [transfer, setTransfer] = useState(false);

  const load = useCallback(
    async (former: boolean) => {
      const r = await loadUnitOwnersAction(unitId, former);
      if (!r.ok) {
        setError(t(`errors.${r.error}`));
        return;
      }
      setError("");
      setOwners(r.owners);
    },
    [unitId, t]
  );

  useEffect(() => {
    void load(includeFormer);
  }, [load, includeFormer]);

  const fmtDate = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const current = owners?.filter((o) => o.validTo === null) ?? [];

  return (
    <Card as="section" className="mb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ui-text">{t("unitOwnersTitle", { unit: unitLabel })}</h2>
        <Button variant="secondary" onClick={() => setTransfer(true)} disabled={current.length === 0}>
          {t("transferAction")}
        </Button>
      </div>
      <div role="group" aria-label={t("unitOwnersFilter")} className="mb-3 flex flex-wrap gap-2">
        <Button variant={includeFormer ? "ghost" : "secondary"} aria-pressed={!includeFormer} onClick={() => setIncludeFormer(false)}>
          {t("currentOwners")}
        </Button>
        <Button variant={includeFormer ? "secondary" : "ghost"} aria-pressed={includeFormer} onClick={() => setIncludeFormer(true)}>
          {t("showFormerOwners")}
        </Button>
      </div>
      {error && <p role="alert" className="text-ui-danger">{error}</p>}
      {owners === null ? (
        <p className="text-ui-text-muted">{t("loadingPlan")}</p>
      ) : owners.length === 0 ? (
        <p className="text-ui-text-muted">{t("unitNoOwners")}</p>
      ) : (
        <ul className="divide-y divide-ui-border">
          {owners.map((o) => (
            <li key={o.membershipId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-ui-text">
                {o.name} · {o.shareNum}/{o.shareDen}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-ui-text-muted">
                {o.validTo ? (
                  <>
                    <Badge tone="neutral">{t("formerChip")}</Badge>
                    {t("periodRange", { from: fmtDate(o.validFrom), to: fmtDate(o.validTo) })}
                  </>
                ) : (
                  t("periodCurrent", { from: fmtDate(o.validFrom) })
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {transfer && owners && (
        <TransferDialog
          unitId={unitId}
          unitLabel={unitLabel}
          currentOwners={current}
          people={people}
          onClose={() => {
            setTransfer(false);
            void load(includeFormer);
          }}
        />
      )}
    </Card>
  );
}
