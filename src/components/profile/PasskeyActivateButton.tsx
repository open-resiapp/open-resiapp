"use client";

// The single button on the passkey activation link page. Only this POST
// activates the passkey — opening the link (GET) never does.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, ButtonLink, Icon } from "@/components/ui";

export default function PasskeyActivateButton({ token }: { token: string }) {
  const t = useTranslations("Passkeys.activatePage");
  const tPk = useTranslations("Passkeys");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/passkeys/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, locale }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? "RATE_LIMITED" : json.error || "generic");
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <div role="status" className="mb-4 flex items-center gap-2 text-ui-success">
          <Icon name="check" size={28} />
          <p className="text-lg font-bold">{t("done")}</p>
        </div>
        <ButtonLink href="/voting" variant="secondary" size="lg" fullWidth>
          {t("goToVoting")}
        </ButtonLink>
      </div>
    );
  }

  const key = error ? `errors.${error}` : null;
  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-ui-danger px-4 py-3 text-base text-ui-danger"
        >
          <Icon name="alert" size={20} />
          <span>{key && tPk.has(key) ? tPk(key) : tPk("errors.generic")}</span>
        </div>
      )}
      <Button size="lg" fullWidth loading={busy} onClick={activate}>
        <Icon name="key" size={20} />
        {t("button")}
      </Button>
    </div>
  );
}
