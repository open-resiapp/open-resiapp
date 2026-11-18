import { getTranslations } from "next-intl/server";

import { isSmtpConfigured } from "@/lib/email";

// Admin warning: without SMTP_HOST every e-mail (claim links, notices, document
// sends, meeting invitations) is silently skipped, so the board must be told.
export default async function SmtpStatusBanner() {
  if (isSmtpConfigured()) return null;
  const t = await getTranslations("SmtpStatus");
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-ui-warning/40 bg-ui-warning/10 px-4 py-3 text-base text-ui-text"
    >
      <p className="font-semibold">{t("title")}</p>
      <p>{t("body")}</p>
    </div>
  );
}
