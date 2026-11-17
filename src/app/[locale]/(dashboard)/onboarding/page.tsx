import type { ComponentProps } from "react";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import { getOnboardingStatus } from "@/lib/onboarding.server";
import type { UserRole } from "@/types";
import { Badge, ButtonLink, Card, Icon, PageHeader, buttonClasses } from "@/components/ui";

// RES-20260609-001. Guided setup checklist. Every step's "done" state is
// derived from data (getOnboardingStatus) — no stored progress, so the page
// is resumable for free. Resolved on the server: no client fetch, no second
// request for what the shell already loads.
type StepKey = "community" | "units" | "owners" | "posts";

const STEPS: { key: StepKey; href: ComponentProps<typeof Link>["href"] }[] = [
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

  const status = await getOnboardingStatus();
  const doneCount = STEPS.filter((s) => status.steps[s.key]).length;
  const next = STEPS.find((s) => !status.steps[s.key]);
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
          const done = status.steps[step.key];
          return (
            <Card as="li" key={step.key} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
                    done ? "bg-ui-success/15 text-ui-success" : "bg-ui-surface-muted text-ui-text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Icon name="check" size={20} /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ui-text">
                    {t(`steps.${step.key}.title`)}
                    <Badge tone={done ? "success" : "neutral"}>{done ? t("stateDone") : t("stateOpen")}</Badge>
                  </p>
                  <p className="mt-0.5 text-base text-ui-text-muted">{t(`steps.${step.key}.body`)}</p>
                </div>
              </div>
              <Link
                href={step.href}
                className={buttonClasses({ variant: "secondary", className: "shrink-0" })}
              >
                {done ? t("review") : t("start")}
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
