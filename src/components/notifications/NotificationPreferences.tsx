"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

interface Preferences {
  newPost: boolean;
  votingStarted: boolean;
  eDeliveryConsent: boolean;
}

export default function NotificationPreferences() {
  const t = useTranslations("Notifications");
  const [prefs, setPrefs] = useState<Preferences>({
    newPost: true,
    votingStarted: true,
    eDeliveryConsent: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((res) => res.json())
      .then((data) => {
        setPrefs({
          newPost: data.newPost ?? true,
          votingStarted: data.votingStarted ?? true,
          eDeliveryConsent: data.eDeliveryConsent ?? false,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  async function togglePref(key: keyof Preferences) {
    const previous = prefs[key];
    setPrefs({ ...prefs, [key]: !previous });

    try {
      // Send ONLY the changed field — the consent record must not be
      // re-stamped when an unrelated notification toggle flips (AC 426).
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: !previous }),
      });

      if (!res.ok) {
        setPrefs((p) => ({ ...p, [key]: previous }));
      }
    } catch {
      setPrefs((p) => ({ ...p, [key]: previous }));
    }
  }

  if (loading) return null;

  return (
    <div className="space-y-4">
      <ToggleRow
        label={t("prefNewPost")}
        description={t("prefNewPostDesc")}
        checked={prefs.newPost}
        onChange={() => togglePref("newPost")}
      />
      <ToggleRow
        label={t("prefVotingStarted")}
        description={t("prefVotingStartedDesc")}
        checked={prefs.votingStarted}
        onChange={() => togglePref("votingStarted")}
      />
      {/* AC 426 — electronic delivery of the annual vyúčtovanie. Opt-in;
          non-consenting owners receive it by post (listinné doručenie). */}
      <div>
        <ToggleRow
          label={t("prefEDelivery")}
          description={t("prefEDeliveryDesc")}
          checked={prefs.eDeliveryConsent}
          onChange={() => togglePref("eDeliveryConsent")}
        />
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {t("prefEDeliveryLegal")}
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-base font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-600"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
