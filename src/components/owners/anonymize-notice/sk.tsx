"use client";

import { useTranslations } from "next-intl";

// BYT-20261118-007 §8 — SK statutory basis of what anonymise keeps.
// Legally regulated copy: NOT parametrised across countries (CLAUDE.md).
// TODO(decision): legal-copy sign-off (retention horizons) before release.
export default function AnonymizeNoticeSk() {
  const t = useTranslations("OwnerLifecycle.anonymizeNoticeSk");
  return (
    <section className="rounded-lg border border-ui-border bg-ui-surface-muted px-4 py-3 text-ui-text">
      <h3 className="mb-1 font-semibold">{t("title")}</h3>
      <p>{t("body")}</p>
    </section>
  );
}
