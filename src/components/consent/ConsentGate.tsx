"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import ConsentForm from "./ConsentForm";

interface ConsentGateProps {
  children: React.ReactNode;
}

export default function ConsentGate({ children }: ConsentGateProps) {
  const t = useTranslations("Common");
  const [needsConsent, setNeedsConsent] = useState<boolean | null>(null);
  const [policyVersion, setPolicyVersion] = useState("");

  async function checkConsent() {
    try {
      const res = await fetch("/api/consents");
      if (!res.ok) return;
      const data = await res.json();
      setNeedsConsent(data.needsConsent);
      setPolicyVersion(data.currentPolicyVersion);
    } catch {
      // If consent check fails, let the user through rather than blocking
      setNeedsConsent(false);
    }
  }

  useEffect(() => {
    checkConsent();
  }, []);

  if (needsConsent === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-base text-gray-500">{t("loading")}</div>
      </div>
    );
  }

  if (needsConsent) {
    return (
      <div className="py-8">
        <ConsentForm
          policyVersion={policyVersion}
          onSuccess={() => setNeedsConsent(false)}
        />
      </div>
    );
  }

  return <>{children}</>;
}
