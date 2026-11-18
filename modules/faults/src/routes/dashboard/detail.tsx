import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { Card, PageHeader } from "@/components/ui";
import { HomeSection } from "@/components/home/HomeSection";

import { getFaultActor } from "../../lib/authz.server";
import {
  listCategories,
  listContractors,
  listFaultManagers,
  listLinkableExpenses,
} from "../../lib/catalogs.server";
import { getFaultForBoard, getFaultForResident } from "../../lib/queries.server";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { BoardFaultPanel } from "../../components/BoardFaultPanel";
import { FaultHistory } from "../../components/FaultHistory";
import { FaultPhotos } from "../../components/FaultPhotos";
import { FaultPriorityBadge, FaultStatusBadge } from "../../components/badges";
import { ReporterActions } from "../../components/ReporterActions";
import { categoryLabels } from "./list";

// /poruchy/[id] — board: reporter's part + board panel + full history;
// resident: status, public messages, and (own report, still `new`) edit /
// withdraw. Not visible → 404 (no existence leak).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FaultDetailPage({
  id,
  justCreated,
}: {
  id: string;
  justCreated: boolean;
}) {
  if (!UUID_RE.test(id)) notFound();
  const actor = await getFaultActor();
  if (!actor) notFound();
  const [t, format] = await Promise.all([getTranslations("Faults"), getFormatter()]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  if (actor.board) {
    const fault = await getFaultForBoard(actor.root.id, id, actor.board);
    if (!fault) notFound();
    const full = actor.board === "full";
    const [categories, managers, contractors, expenses] = await Promise.all([
      listCategories(actor.root.id),
      listFaultManagers(actor.root.id),
      listContractors(actor.root.id),
      full && (await isModuleEnabled("accounting"))
        ? listLinkableExpenses(actor.root.id)
        : Promise.resolve(null),
    ]);
    const money = (cents: number) => format.number(cents / 100, {
        style: "currency",
        currency: actor.root.country === "cz" ? "CZK" : "EUR",
      });

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title={fault.title}
          backHref="/poruchy"
          backLabel={t("detail.backToList")}
          description={
            <span className="flex flex-wrap gap-2">
              <FaultStatusBadge status={fault.status} label={t(`status.${fault.status}`)} />
              <FaultPriorityBadge priority={fault.priority} label={t(`priority.${fault.priority}`)} />
            </span>
          }
          className="mb-0"
        />
        <Card as="section" padding="md" className="space-y-3">
          <h2 className="text-lg font-semibold text-ui-text">{t("detail.reportHeading")}</h2>
          <dl className="space-y-2 text-base">
            <div>
              <dt className="text-ui-text-muted">{t("detail.reporter")}</dt>
              <dd>{fault.reporterName ?? t("detail.reporterUnknown")}</dd>
            </div>
            <div>
              <dt className="text-ui-text-muted">{t("detail.where")}</dt>
              <dd className="break-words">
                {fault.locationLabel}
                {fault.locationNote ? ` — ${fault.locationNote}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-ui-text-muted">{t("detail.reportedAt")}</dt>
              <dd>{date(fault.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-ui-text-muted">{t("detail.visibility")}</dt>
              <dd>{t(`visibility.${fault.visibility}`)}</dd>
            </div>
            {fault.description ? (
              <div>
                <dt className="text-ui-text-muted">{t("report.descriptionLabel")}</dt>
                <dd className="whitespace-pre-line break-words">{fault.description}</dd>
              </div>
            ) : null}
          </dl>
          <FaultPhotos photos={fault.photos} />
        </Card>

        <BoardFaultPanel
          fault={fault}
          access={actor.board}
          categories={categoryLabels(categories, t as unknown as (k: string) => string)}
          users={managers.map((m) => ({ value: m.id, label: m.name }))}
          contractors={contractors.map((c) => ({ value: c.id, label: c.phone ? `${c.name} (${c.phone})` : c.name }))}
          expenses={
            expenses
              ? expenses.map((x) => ({
                  value: x.id,
                  label: `${x.supplierName} · ${x.invoiceNo} · ${money(x.amountCents)}`,
                }))
              : null
          }
        />

        <HomeSection title={t("detail.history")}>
          <FaultHistory events={fault.events} />
        </HomeSection>
      </div>
    );
  }

  const fault = await getFaultForResident(actor.userId, actor.root.id, id);
  if (!fault) notFound();
  const editable = fault.isMine && fault.status === "new";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={fault.title}
        backHref="/poruchy"
        backLabel={t("detail.backToList")}
        description={<FaultStatusBadge status={fault.status} label={t(`status.${fault.status}`)} />}
        className="mb-0"
      />
      {justCreated ? (
        <Card padding="md" role="status" className="border-ui-success/40 bg-ui-success/10">
          <p className="text-base text-ui-text">{t("detail.createdNotice")}</p>
        </Card>
      ) : null}
      <Card as="section" padding="md" className="space-y-3">
        <dl className="space-y-2 text-base">
          <div>
            <dt className="text-ui-text-muted">{t("detail.where")}</dt>
            <dd className="break-words">
              {fault.locationLabel}
              {fault.locationNote ? ` — ${fault.locationNote}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-ui-text-muted">{t("detail.reportedAt")}</dt>
            <dd>{date(fault.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-ui-text-muted">{t("detail.whoSees")}</dt>
            <dd>{t(`visibilityHint.${fault.visibility}`)}</dd>
          </div>
          {fault.description ? (
            <div>
              <dt className="text-ui-text-muted">{t("report.descriptionLabel")}</dt>
              <dd className="whitespace-pre-line break-words">{fault.description}</dd>
            </div>
          ) : null}
        </dl>
        <FaultPhotos photos={fault.photos} />
      </Card>

      {editable ? <ReporterActions fault={fault} /> : null}

      <HomeSection title={t("detail.progress")}>
        <ol className="space-y-3">
          {[...fault.publicEvents].reverse().map((e, i) => (
            <li key={`${e.createdAt}-${i}`} className="rounded-lg border border-ui-border px-3 py-2 text-base">
              <p className="font-medium text-ui-text">
                {e.status ? t(`status.${e.status}`) : t("detail.reported")}
              </p>
              {e.message ? <p className="mt-1 break-words text-ui-text">{e.message}</p> : null}
              <p className="mt-1 text-ui-text-muted">{date(e.createdAt)}</p>
            </li>
          ))}
        </ol>
      </HomeSection>
    </div>
  );
}
