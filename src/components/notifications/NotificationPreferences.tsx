"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ConfirmDialog, Icon, cn } from "@/components/ui";

export interface NotificationPrefs {
  newPost: boolean;
  votingStarted: boolean;
  eDeliveryConsent: boolean;
}

/**
 * Stored model (notification_preferences): newPost, votingStarted (both
 * default true) and the e-delivery consent (opt-in, default false).
 *
 * UI: vote + notice notifications are presented as ON (default) with the
 * ability to switch them off tucked behind "Ďalšie možnosti". The settlement
 * e-delivery stays a prominent, explicit opt-in.
 */
export default function NotificationPreferences({ initial }: { initial: NotificationPrefs }) {
  const t = useTranslations("Notifications");
  const tp = useTranslations("ProfileHub");
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [confirmEDelivery, setConfirmEDelivery] = useState(false);
  const [failed, setFailed] = useState(false);

  async function savePref(key: keyof NotificationPrefs, value: boolean) {
    const previous = prefs[key];
    setFailed(false);
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      // Send ONLY the changed field — the consent record must not be
      // re-stamped when an unrelated notification toggle flips (AC 426).
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPrefs((p) => ({ ...p, [key]: previous }));
      setFailed(true);
    }
  }

  return (
    <div className="space-y-5">
      {/* AC 426 — electronic delivery of the annual vyúčtovanie. Opt-in;
          non-consenting owners receive it by post (listinné doručenie). */}
      <SwitchRow
        label={tp("eDeliveryLabel")}
        description={tp("eDeliveryDesc")}
        checked={prefs.eDeliveryConsent}
        onText={tp("on")}
        offText={tp("off")}
        onChange={() => (prefs.eDeliveryConsent ? setConfirmEDelivery(true) : savePref("eDeliveryConsent", true))}
      />

      <div className="flex flex-wrap items-center gap-2 text-base text-ui-text">
        <Icon name="bell" size={20} className="text-ui-text-muted" />
        <span>{tp("defaultOnNote")}</span>
        <Badge tone="success">{tp("on")}</Badge>
      </div>

      <details className="group rounded-lg border border-ui-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-base font-medium text-ui-text [&::-webkit-details-marker]:hidden">
          {tp("moreOptions")}
          <Icon name="chevronDown" size={20} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-ui-border p-4">
          <SwitchRow
            label={t("prefNewPost")}
            description={t("prefNewPostDesc")}
            checked={prefs.newPost}
            onText={tp("on")}
            offText={tp("off")}
            onChange={() => savePref("newPost", !prefs.newPost)}
          />
          <SwitchRow
            label={t("prefVotingStarted")}
            description={t("prefVotingStartedDesc")}
            checked={prefs.votingStarted}
            onText={tp("on")}
            offText={tp("off")}
            onChange={() => savePref("votingStarted", !prefs.votingStarted)}
          />
        </div>
      </details>

      {failed ? (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {tp("saveFailed")}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmEDelivery}
        tone="danger"
        title={tp("eDeliveryWithdrawTitle")}
        description={tp("eDeliveryWithdrawBody")}
        confirmLabel={tp("eDeliveryWithdrawConfirm")}
        onConfirm={() => {
          setConfirmEDelivery(false);
          savePref("eDeliveryConsent", false);
        }}
        onCancel={() => setConfirmEDelivery(false)}
      />
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onText,
  offText,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onText: string;
  offText: string;
  onChange: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-base font-medium text-ui-text">{label}</p>
        <p className="text-base text-ui-text-muted">{description}</p>
      </div>
      <Button
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? onText : offText}`}
        variant={checked ? "primary" : "secondary"}
        onClick={onChange}
        className={cn("min-w-28 shrink-0 self-start sm:self-center")}
      >
        <Icon name={checked ? "check" : "x"} size={20} />
        {checked ? onText : offText}
      </Button>
    </div>
  );
}
