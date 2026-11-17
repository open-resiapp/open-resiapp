"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import { Badge, Button, ConfirmDialog, LoadingBlock } from "@/components/ui";

interface ConsentStatus {
  action: "granted" | "withdrawn";
  createdAt: string;
  policyVersion: string;
}

/**
 * The consent list with grant / revoke actions. Presentation only — the
 * requests (GET/POST /api/consents) and the sign-out after withdrawing the
 * data-processing consent are unchanged. Mount it only when it is shown
 * (it fetches on mount).
 */
export default function ConsentManagement() {
  const t = useTranslations("Consent");
  const [consents, setConsents] = useState<Record<string, ConsentStatus>>({});
  const [withdrawType, setWithdrawType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConsents = useCallback(async () => {
    try {
      const res = await fetch("/api/consents");
      if (!res.ok) return;
      const data = await res.json();
      setConsents(data.consents);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConsents();
  }, [fetchConsents]);

  async function handleAction(consentType: string, action: "granted" | "withdrawn") {
    const res = await fetch("/api/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consentType, action }),
    });

    if (!res.ok) return;

    setWithdrawType(null);

    if (consentType === "data_processing" && action === "withdrawn") {
      signOut({ callbackUrl: "/login" });
      return;
    }

    fetchConsents();
  }

  if (loading) return <LoadingBlock />;

  const types = [
    { key: "data_processing", label: t("dataProcessingTitle") },
    { key: "communication", label: t("communicationTitle") },
  ];

  return (
    <>
      <ul className="divide-y divide-ui-border">
        {types.map(({ key, label }) => {
          const consent = consents[key];
          const isGranted = consent?.action === "granted";

          return (
            <li key={key} className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-base font-medium text-ui-text">{label}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone={isGranted ? "success" : "neutral"}>
                    {isGranted ? t("statusGranted") : t("statusNotGranted")}
                  </Badge>
                  {isGranted && consent.createdAt ? (
                    <span className="text-base text-ui-text-muted">
                      {t("grantedOn", { date: new Date(consent.createdAt).toLocaleDateString() })}
                    </span>
                  ) : null}
                </div>
              </div>

              <Button
                variant={isGranted ? "danger" : "secondary"}
                className="self-start sm:self-center"
                onClick={() => {
                  if (isGranted) {
                    setWithdrawType(key);
                  } else {
                    handleAction(key, "granted");
                  }
                }}
              >
                {isGranted ? t("withdraw") : t("grant")}
              </Button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 border-t border-ui-border pt-3">
        <Link
          href="/privacy-policy"
          target="_blank"
          className="inline-flex min-h-11 items-center text-base text-ui-text underline underline-offset-4"
        >
          {t("viewPrivacyPolicy")}
        </Link>
      </p>

      <ConfirmDialog
        open={withdrawType !== null}
        tone="danger"
        title={t("withdrawWarningTitle")}
        description={
          withdrawType === "data_processing"
            ? t("withdrawDataProcessingWarning")
            : t("withdrawCommunicationWarning")
        }
        confirmLabel={t("withdrawConfirm")}
        cancelLabel={t("withdrawCancel")}
        onConfirm={() => withdrawType && handleAction(withdrawType, "withdrawn")}
        onCancel={() => setWithdrawType(null)}
      />
    </>
  );
}
