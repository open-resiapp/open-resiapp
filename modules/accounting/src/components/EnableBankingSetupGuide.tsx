"use client";

// Step-by-step setup of the instance's own Enable Banking application
// (BYT-20261118-001) — self-host path, restricted mode (free for the HOA's
// own account). Shown on Pokročilé → Prepojenie s bankou. The admin enters
// the application id + private key right here (step 4, stored encrypted in
// the DB); env vars remain an alternative and win when set (cloud). When the
// instance is configured the guide collapses to a short status line.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card } from "@/components/ui";
import EnableBankingCredentialsForm, {
  type CredentialsInfo,
} from "./EnableBankingCredentialsForm";

const STEP_KEYS = ["account", "app", "key", "credentials", "link", "connect"] as const;

const KEYGEN_COMMAND =
  'openssl req -new -newkey rsa:2048 -nodes -x509 -days 3650 -keyout enable-banking.pem -out enable-banking.crt -subj "/CN=open-resiapp"';

export default function EnableBankingSetupGuide({
  info,
  isAdmin = true,
}: {
  info: CredentialsInfo & { redirectUrl: string | null };
  /** Setup steps (application, key) are for the administrator only. */
  isAdmin?: boolean;
}) {
  const t = useTranslations("Accounting.bankConnection");
  const { configured, appIdMasked, redirectUrl } = info;
  const [open, setOpen] = useState(!configured);

  if (!isAdmin) {
    // Treasurer: no server-side steps, just the state and who to ask.
    return (
      <Card as="section" aria-labelledby="eb-guide-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="eb-guide-title" className="text-lg font-semibold text-ui-text">
            {t("guideTitle")}
          </h2>
          {configured ? (
            <Badge tone="success">
              {t("statusConfigured", { appId: appIdMasked ?? "" })}
            </Badge>
          ) : (
            <Badge tone="warning">{t("statusNotConfigured")}</Badge>
          )}
        </div>
        {!configured && (
          <p className="mt-2 text-base text-ui-text">{t("askAdmin")}</p>
        )}
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="eb-guide-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="eb-guide-title" className="text-lg font-semibold text-ui-text">
          {t("guideTitle")}
        </h2>
        {configured ? (
          <Badge tone="success">
            {t("statusConfigured", { appId: appIdMasked ?? "" })}
          </Badge>
        ) : (
          <Badge tone="warning">{t("statusNotConfigured")}</Badge>
        )}
      </div>
      <p className="mt-1 text-base text-ui-text-muted">{t("guideIntro")}</p>

      {configured && (
        <Button
          variant="ghost"
          className="mt-2"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("guideHide") : t("guideShow")}
        </Button>
      )}

      {/* Collapsed but configured: keep replace / remove within reach. */}
      {!open && info.source === "db" && (
        <div className="mt-4">
          <EnableBankingCredentialsForm info={info} />
        </div>
      )}

      {open && (
        <ol className="mt-4 space-y-5">
          {STEP_KEYS.map((key, i) => (
            <li key={key} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ui-surface-muted text-base font-semibold text-ui-text"
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="text-base font-semibold text-ui-text">
                  {t(`step_${key}_title`)}
                </h3>
                <p className="text-base text-ui-text-muted">
                  {t(`step_${key}_body`)}
                </p>
                {key === "account" && (
                  <a
                    href="https://enablebanking.com/cp/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-base font-medium text-ui-primary hover:underline"
                  >
                    {t("openControlPanel")}
                  </a>
                )}
                {key === "app" && (
                  <CopyValue
                    label={t("redirectUrlLabel")}
                    value={redirectUrl}
                    missing={t("redirectUrlMissing")}
                  />
                )}
                {key === "key" && (
                  <CopyValue label={t("keygenLabel")} value={KEYGEN_COMMAND} />
                )}
                {key === "credentials" && (
                  <>
                    <EnableBankingCredentialsForm info={info} />
                    {info.source !== "env" && (
                      <details className="text-base text-ui-text-muted">
                        <summary className="min-h-11 cursor-pointer py-2 font-medium text-ui-text">
                          {t("envAlternative")}
                        </summary>
                        <p className="mb-2">{t("envAlternativeBody")}</p>
                        <pre className="overflow-x-auto rounded-lg bg-ui-surface-muted p-3 font-mono text-sm text-ui-text">
                          {`ENABLE_BANKING_APP_ID=<application id>
ENABLE_BANKING_PRIVATE_KEY_FILE=/run/secrets/enable-banking.pem
# ${t("envOrInline")}
# ENABLE_BANKING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n…"`}
                        </pre>
                      </details>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {open && (
        <p className="mt-5 border-t border-ui-border pt-3 text-base text-ui-text-muted">
          {t("guideCost")}
        </p>
      )}
    </Card>
  );
}

function CopyValue({
  label,
  value,
  missing,
}: {
  label: string;
  value: string | null;
  missing?: string;
}) {
  const t = useTranslations("Accounting.bankConnection");
  const [copied, setCopied] = useState(false);

  if (!value) {
    return (
      <p role="alert" className="text-base font-medium text-ui-danger">
        {missing}
      </p>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (http, permissions) — the value stays selectable.
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-base font-medium text-ui-text">{label}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-ui-surface-muted p-3 font-mono text-sm text-ui-text">
          {value}
        </code>
        <Button variant="secondary" onClick={copy}>
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}
