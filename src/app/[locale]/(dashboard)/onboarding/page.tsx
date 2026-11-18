import type { ComponentProps } from "react";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import { getOnboardingStatus } from "@/lib/onboarding.server";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { listTemplateSummaries } from "@/lib/templates/loader";
import type { UserRole } from "@/types";
import { Badge, ButtonLink, Card, Icon, PageHeader, buttonClasses } from "@/components/ui";

import { TemplateStep } from "./TemplateStep";

// RES-20260609-001. Guided setup checklist. Every step's "done" state is
// derived from data (getOnboardingStatus) — no stored progress, so the page
// is resumable for free. Resolved on the server: no client fetch, no second
// request for what the shell already loads.
// "template" is answered inline (TemplateStep) — the template decides the
// tree the import seeds, so it comes before everything else.
type StepKey = "template" | "community" | "units" | "owners" | "posts";

const STEPS: { key: StepKey; href: ComponentProps<typeof Link>["href"] }[] = [
  { key: "template", href: { pathname: "/onboarding", hash: "template" } },
  { key: "community", href: { pathname: "/settings", query: { tab: "community" } } },
  { key: "units", href: "/admin/import" },
  { key: "owners", href: "/settings/registration-qr" },
  { key: "posts", href: "/board" },
];

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session, t] = await Promise.all([
    params,
    auth(),
    getTranslations("Onboarding"),
  ]);
  if (!session?.user) {
    redirect({ href: "/login", locale });
    return null;
  }
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return <div className="py-12 text-center text-lg text-ui-text-muted">{t("noPermission")}</div>;
  }

  const [root, templates] = await Promise.all([getCommunityRoot(), listTemplateSummaries()]);
  const status = await getOnboardingStatus(root);
  const templateSlug = root ? (getDisplayTemplateSlug(root.templateSlug) ?? root.templateSlug) : null;
  // Pre-template installs that already have units are HOA (resolved as such
  // everywhere else) — not an open step.
  const done: Record<StepKey, boolean> = {
    ...status.steps,
    template: !!templateSlug || status.steps.units,
  };
  const doneCount = STEPS.filter((s) => done[s.key]).length;
  const next = STEPS.find((s) => !done[s.key]);
  const allDone = !next;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        backHref="/settings/advanced"
        backLabel={t("backToAdvanced")}
        actions={
          next ? (
            <ButtonLink href={next.href}>
              {t("continueWith", { step: t(`steps.${next.key}.title`) })}
            </ButtonLink>
          ) : undefined
        }
      />

      <p className="mb-4 text-base font-medium text-ui-text">
        {t("progressSteps", { done: doneCount, total: STEPS.length })}
      </p>

      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const isDone = done[step.key];
          if (step.key === "template") {
            return (
              <Card as="li" key={step.key} id="template" className="flex flex-col gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
                      isDone ? "bg-ui-success/15 text-ui-success" : "bg-ui-surface-muted text-ui-text-muted"
                    }`}
                    aria-hidden="true"
                  >
                    {isDone ? <Icon name="check" size={20} /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ui-text">
                      {t("steps.template.title")}
                      <Badge tone={isDone ? "success" : "neutral"}>{isDone ? t("stateDone") : t("stateOpen")}</Badge>
                    </p>
                    <p className="mt-0.5 text-base text-ui-text-muted">{t("steps.template.body")}</p>
                  </div>
                </div>
                <TemplateStep
                  templates={templates}
                  currentSlug={templateSlug}
                  communityExists={!!root}
                  locked={status.steps.units}
                />
              </Card>
            );
          }
          return (
            <Card as="li" key={step.key} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
                    isDone ? "bg-ui-success/15 text-ui-success" : "bg-ui-surface-muted text-ui-text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {isDone ? <Icon name="check" size={20} /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ui-text">
                    {t(`steps.${step.key}.title`)}
                    <Badge tone={isDone ? "success" : "neutral"}>{isDone ? t("stateDone") : t("stateOpen")}</Badge>
                  </p>
                  <p className="mt-0.5 text-base text-ui-text-muted">{t(`steps.${step.key}.body`)}</p>
                </div>
              </div>
              <Link
                href={step.href}
                className={buttonClasses({ variant: "secondary", className: "shrink-0" })}
              >
                {isDone ? t("review") : t("start")}
              </Link>
            </Card>
          );
        })}
      </ol>

      {allDone ? (
        <p
          role="status"
          className="mt-6 rounded-lg border border-ui-success/40 bg-ui-success/10 p-4 text-base font-medium text-ui-success"
        >
          {t("allDone")}
        </p>
      ) : null}
    </div>
  );
}
