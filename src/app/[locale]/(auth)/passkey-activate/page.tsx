// BYT-20261117-002 Phase 6: passkey activation link page. Public (the link
// may be opened on another device); the signed token in `?t=` identifies
// the user and the exact passkey. Rendering this page (GET — also what mail
// scanners do) never activates anything; only the button's POST does.
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Icon } from "@/components/ui";
import PasskeyActivateButton from "@/components/profile/PasskeyActivateButton";
import { describePasskeyActivation } from "@/lib/webauthn.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t: raw } = await searchParams;
  const token = typeof raw === "string" ? raw : null;
  const t = await getTranslations("Passkeys.activatePage");
  const tPk = await getTranslations("Passkeys");
  const format = await getFormatter();
  let view: Awaited<ReturnType<typeof describePasskeyActivation>>;
  try {
    view = await describePasskeyActivation(token);
  } catch {
    // Token secret not configured on this install.
    view = { status: "invalid" };
  }

  if (view.status !== "pending") {
    return (
      <Card as="section">
        <div className="mb-3 flex items-center gap-2 text-ui-text">
          <Icon name={view.status === "active" ? "check" : "alert"} size={28} />
          <h1 className="text-xl font-bold">{t(`state.${view.status}.title`)}</h1>
        </div>
        <p className="mb-4 text-base text-ui-text">{t(`state.${view.status}.body`)}</p>
        <ButtonLink href="/profile" variant="secondary" size="lg" fullWidth>
          {t("goToProfile")}
        </ButtonLink>
      </Card>
    );
  }

  return (
    <Card as="section">
      <h1 className="mb-2 text-xl font-bold text-ui-text">{t("title")}</h1>
      <p className="mb-2 text-base text-ui-text">
        {t("device", { device: view.deviceLabel || tPk("unnamedDevice") })}
      </p>
      <p className="mb-4 text-base text-ui-text-muted">
        {tPk("createdAt", {
          date: format.dateTime(new Date(view.createdAt), {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })}
      </p>
      <p className="mb-4 text-base text-ui-text">{t("explain")}</p>
      <PasskeyActivateButton token={token ?? ""} />
    </Card>
  );
}
