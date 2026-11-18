"use client";

// The single button on the e-mail confirmation page. Only this POST records
// the ballot (or, for a withdraw link, this DELETE withdraws it) — opening
// the link (GET) never does.
import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button, ButtonLink, Icon } from "@/components/ui";

export default function ConfirmEmailVote({
  token,
  votingId,
  action,
}: {
  token: string;
  votingId: string;
  action: "vote" | "withdraw";
}) {
  const t = useTranslations("VoteConfirmPage");
  const tCast = useTranslations("VoteCast");
  const format = useFormatter();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    recordedAt: string;
    ballotHash: string;
    passkeyActivated: boolean;
  } | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ballots", {
        method: action === "withdraw" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: { method: "email", token }, locale }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? "RATE_LIMITED" : json.error || "generic");
        return;
      }
      if (action === "withdraw") {
        setWithdrawn(true);
        return;
      }
      setDone({
        recordedAt: json.recordedAt,
        ballotHash: json.ballotHash,
        passkeyActivated: Boolean(json.passkeyActivated),
      });
    } finally {
      setBusy(false);
    }
  }

  if (withdrawn) {
    return (
      <div>
        <div role="status" className="mb-3 flex items-center gap-2 text-ui-success">
          <Icon name="check" size={28} />
          <h2 className="text-xl font-bold">{t("withdraw.done")}</h2>
        </div>
        <p className="mb-4 text-base text-ui-text">{t("withdraw.doneHelp")}</p>
        <ButtonLink href={`/voting/${votingId}`} variant="secondary" size="lg" fullWidth>
          {t("openVoting")}
        </ButtonLink>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <div className="mb-3 flex items-center gap-2 text-ui-success">
          <Icon name="check" size={28} />
          <h2 className="text-xl font-bold">{tCast("receiptTitle")}</h2>
        </div>
        <p className="mb-4 text-base text-ui-text">
          {tCast("receiptWhen", {
            date: format.dateTime(new Date(done.recordedAt), {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </p>
        <details className="mb-4 rounded-lg border border-ui-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-medium text-ui-text">
            {tCast("details")}
          </summary>
          <p className="mt-2 break-all font-mono text-base text-ui-text">{done.ballotHash}</p>
        </details>
        {done.passkeyActivated && (
          <p role="status" className="mb-4 text-base font-medium text-ui-success">
            {t("passkeyActivated")}
          </p>
        )}
        <ButtonLink href={`/voting/${votingId}`} variant="secondary" size="lg" fullWidth>
          {t("openVoting")}
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
          <span>{key && tCast.has(key) ? tCast(key) : tCast("errors.generic")}</span>
        </div>
      )}
      <Button
        size="lg"
        fullWidth
        variant={action === "withdraw" ? "danger" : "primary"}
        loading={busy}
        onClick={confirm}
      >
        <Icon name="check" size={20} />
        {action === "withdraw" ? t("withdraw.button") : t("confirmButton")}
      </Button>
    </div>
  );
}
