"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import MeetingRsvpButtons, { type MeetingRsvpValue } from "@/components/community/MeetingRsvpButtons";
import { Button } from "@/components/ui";

// BYT-20261118-001 §3 — the one write of the e-mail answer page. The answer
// picked in the e-mail is preselected; nothing is stored until "Potvrdiť".
// After that the owner may change or withdraw (same token, latest wins).

export default function MeetingRsvpConfirm({
  token,
  suggested,
  current,
}: {
  token: string;
  suggested: MeetingRsvpValue | null;
  current: MeetingRsvpValue | null;
}) {
  const t = useTranslations("MeetingAttendance.tokenPage");
  const tErr = useTranslations("MeetingAttendance.errors");
  const tRsvp = useTranslations("MeetingAttendance.rsvp");
  const [saved, setSaved] = useState<MeetingRsvpValue | null>(current);
  const [confirmedOnce, setConfirmedOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(status: MeetingRsvpValue | null) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meeting-rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, status }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setError(tErr.has(body.error ?? "") ? tErr(body.error as never) : tErr("generic"));
      return;
    }
    setSaved(status);
    setConfirmedOnce(true);
  }

  const pending = !confirmedOnce && suggested && suggested !== saved ? suggested : null;

  return (
    <div className="mt-4 space-y-4">
      {error ? (
        <p role="alert" className="rounded-lg border border-ui-danger/40 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger">
          {error}
        </p>
      ) : null}

      {pending ? (
        <Button size="lg" fullWidth loading={busy} onClick={() => send(pending)}>
          {t("confirm", { answer: tRsvp(pending) })}
        </Button>
      ) : (
        <p role="status" className="text-lg font-semibold text-ui-text">
          {saved ? t("saved", { answer: tRsvp(saved) }) : t("noAnswer")}
        </p>
      )}

      <MeetingRsvpButtons
        value={saved}
        busy={busy}
        legend={t("change")}
        onSelect={(s) => void send(s)}
        onWithdraw={() => void send(null)}
      />
    </div>
  );
}
