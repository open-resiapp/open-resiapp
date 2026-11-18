"use client";

// Owner cast flow (BYT-20261117-002 Phase 6), built for a 390 px phone:
//   one item per screen (explicit ZA / PROTI / ZDRŽIAM SA) → review
//   "Hlasujete za byt 101" with "Zmeniť" per item → confirm with a passkey
//   or an e-mail link → receipt.
// The server records the ballot only with a confirmation proof bound to
// the exact choices (docs/domain/voting.md: a session alone is never
// enough). Every item needs an explicit choice — an unmarked item is
// never shown as abstention.
//
// A passkey created here starts inactive: the first vote with it is
// confirmed by e-mail, and that one link records the vote and activates the
// passkey. Withdrawing a ballot needs the same confirmation (passkey or
// e-mail link). A paper ballot recorded by the board is read-only here.
import { useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Badge, Button, Card, Icon, cn } from "@/components/ui";
import { EMAIL_CONFIRMATION_TTL_MS } from "@/lib/webauthn";
import type { VoteChoice } from "@/types";
import type { UserBallot, UserFlat, VotingDetail, VotingItemRow } from "./types";

const CHOICES: VoteChoice[] = ["za", "proti", "zdrzal_sa"];
const CHOICE_KEY: Record<VoteChoice, string> = {
  za: "for",
  proti: "against",
  zdrzal_sa: "abstain",
};

type Mode = "items" | "review" | "emailSent" | "receipt" | "withdraw";

interface EmailSent {
  to: string;
  expiresAt: string;
  action: "vote" | "withdraw";
  activatesPasskey: boolean;
}

interface Props {
  voting: VotingDetail;
  items: VotingItemRow[];
  userFlats: UserFlat[];
  userBallots: UserBallot[];
  hasPasskey: boolean;
  /** A passkey registered earlier still waits for its e-mail activation. */
  hasPendingPasskey: boolean;
  /** Re-fetch ballot data after a recorded / withdrawn ballot. */
  onChanged: () => Promise<void>;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429) return { ok: false as const, code: "RATE_LIMITED", json };
  if (!res.ok) {
    return {
      ok: false as const,
      code: typeof json.error === "string" ? json.error : "generic",
      json,
    };
  }
  return { ok: true as const, json };
}

/** WebAuthn browser errors → our codes. */
function webauthnErrorCode(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "PASSKEY_CANCELLED";
  if (name === "InvalidStateError") return "PASSKEY_ALREADY_REGISTERED";
  return "PASSKEY_VERIFICATION_FAILED";
}

export default function OwnerBallot({
  voting,
  items,
  userFlats,
  userBallots,
  hasPasskey: hasPasskeyInitial,
  hasPendingPasskey: hasPendingPasskeyInitial,
  onChanged,
}: Props) {
  const t = useTranslations("VoteCast");
  const tVoting = useTranslations("Voting");
  const tVote = useTranslations("VoteButton");
  const format = useFormatter();
  const locale = useLocale();

  const single = userFlats.length === 1;
  const [flatId, setFlatId] = useState<string | null>(single ? userFlats[0].flatId : null);
  const [mode, setMode] = useState<Mode>(() => {
    if (!single) return "items";
    return userBallots.some((b) => b.flatId === userFlats[0].flatId) ? "receipt" : "items";
  });
  const [step, setStep] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Record<string, VoteChoice>>>({});
  const [busy, setBusy] = useState<null | "passkey" | "email" | "withdraw">(null);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<EmailSent | null>(null);
  const [hasPasskey, setHasPasskey] = useState(hasPasskeyInitial);
  const [hasPendingPasskey, setHasPendingPasskey] = useState(hasPendingPasskeyInitial);
  const [canCreatePasskey, setCanCreatePasskey] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [checkEmailResult, setCheckEmailResult] = useState(false);

  useEffect(() => setHasPasskey(hasPasskeyInitial), [hasPasskeyInitial]);
  useEffect(() => setHasPendingPasskey(hasPendingPasskeyInitial), [hasPendingPasskeyInitial]);
  useEffect(() => {
    let alive = true;
    platformAuthenticatorIsAvailable()
      .then((ok) => alive && setCanCreatePasskey(ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const flat = userFlats.find((f) => f.flatId === flatId) ?? null;
  const existing = flat ? userBallots.find((b) => b.flatId === flat.flatId) ?? null : null;
  const draft = (flatId && drafts[flatId]) || {};
  const allMarked = items.every((i) => draft[i.id]);
  const deadline = format.dateTime(new Date(voting.endsAt), {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const votingOpen = Date.now() <= new Date(voting.endsAt).getTime();

  // After "I confirmed it in the e-mail" → reload: show the receipt once the
  // ballot recorded after the e-mail was sent is there (or, for a withdraw
  // link, once the ballot is gone), else say it is not confirmed yet.
  useEffect(() => {
    if (!checkEmailResult || !emailSent) return;
    setCheckEmailResult(false);
    if (emailSent.action === "withdraw") {
      if (!existing) {
        setEmailSent(null);
        if (flatId) setDrafts((prev) => ({ ...prev, [flatId]: {} }));
        setStep(0);
        setMode("items");
      } else {
        setError("WITHDRAW_NOT_CONFIRMED_YET");
      }
      return;
    }
    const sentAt = new Date(emailSent.expiresAt).getTime() - EMAIL_CONFIRMATION_TTL_MS;
    if (existing && new Date(existing.recordedAt).getTime() >= sentAt) {
      setEmailSent(null);
      if (emailSent.activatesPasskey) {
        setHasPasskey(true);
        setHasPendingPasskey(false);
      }
      setMode("receipt");
    } else {
      setError("EMAIL_NOT_CONFIRMED_YET");
    }
  }, [checkEmailResult, emailSent, existing, flatId]);

  function errorText(code: string): string {
    const key = `errors.${code}`;
    return t.has(key) ? t(key) : t("errors.generic");
  }

  function openFlat(id: string) {
    setFlatId(id);
    setError(null);
    setEmailSent(null);
    setStep(0);
    setReturnToReview(false);
    setMode(userBallots.some((b) => b.flatId === id) ? "receipt" : "items");
  }

  function startChange() {
    if (!flat) return;
    // Pre-fill from the recorded ballot so the voter changes only what they want.
    if (existing) {
      setDrafts((prev) => ({
        ...prev,
        [flat.flatId]: { ...(existing.choices as Record<string, VoteChoice>) },
      }));
    }
    setError(null);
    setStep(0);
    setReturnToReview(false);
    setMode("items");
  }

  function choose(itemId: string, choice: VoteChoice) {
    if (!flatId) return;
    setDrafts((prev) => ({ ...prev, [flatId]: { ...(prev[flatId] || {}), [itemId]: choice } }));
  }

  function setRemaining(choice: VoteChoice) {
    if (!flatId) return;
    setDrafts((prev) => {
      const cur = { ...(prev[flatId] || {}) };
      for (const item of items) if (!cur[item.id]) cur[item.id] = choice;
      return { ...prev, [flatId]: cur };
    });
    setMode("review");
  }

  function next() {
    if (returnToReview || step >= items.length - 1) {
      setReturnToReview(false);
      setMode("review");
      return;
    }
    setStep(step + 1);
  }

  function back() {
    if (step > 0) {
      setStep(step - 1);
      return;
    }
    if (existing) setMode("receipt");
    else if (!single) setFlatId(null);
  }

  function ballotPayload() {
    return {
      votingId: voting.id,
      flatId,
      items: items
        .filter((i) => draft[i.id])
        .map((i) => ({ itemId: i.id, choice: draft[i.id] })),
      locale,
    };
  }

  async function recorded() {
    await onChanged();
    setEmailSent(null);
    setMode("receipt");
  }

  async function confirmWithPasskey() {
    setError(null);
    setBusy("passkey");
    try {
      const payload = ballotPayload();
      const opt = await postJson("/api/ballots/passkey-options", payload);
      if (!opt.ok) {
        setError(opt.code);
        return;
      }
      let response;
      try {
        response = await startAuthentication(opt.json.options);
      } catch (e) {
        setError(webauthnErrorCode(e));
        return;
      }
      const res = await postJson("/api/ballots", {
        ...payload,
        confirmation: { method: "passkey", response },
      });
      if (!res.ok) {
        setError(res.code);
        return;
      }
      await recorded();
    } finally {
      setBusy(null);
    }
  }

  // Inline first vote with a new passkey: register it (inactive), then send
  // the vote confirmation e-mail; its one link records this vote AND
  // activates the passkey. From then on the passkey alone confirms.
  async function createPasskeyAndConfirm() {
    setError(null);
    setBusy("passkey");
    let newPasskeyId: string;
    try {
      const opt = await postJson("/api/passkeys/register/options", {});
      if (!opt.ok) {
        setError(opt.code);
        return;
      }
      let response;
      try {
        response = await startRegistration(opt.json.options);
      } catch (e) {
        setError(webauthnErrorCode(e));
        return;
      }
      const reg = await postJson("/api/passkeys/register", {
        response,
        activation: "vote",
        locale,
      });
      if (!reg.ok) {
        setError(reg.code);
        return;
      }
      newPasskeyId = reg.json.id;
      setHasPendingPasskey(true);
    } finally {
      setBusy(null);
    }
    await sendEmail(newPasskeyId);
  }

  async function sendEmail(activatePasskeyId?: string) {
    setError(null);
    setBusy("email");
    try {
      const res = await postJson("/api/ballots/email-confirmation", {
        ...ballotPayload(),
        ...(activatePasskeyId ? { activatePasskeyId } : {}),
      });
      if (!res.ok) {
        setError(res.code);
        return;
      }
      setEmailSent({
        to: res.json.sentTo,
        expiresAt: res.json.expiresAt,
        action: "vote",
        activatesPasskey: Boolean(activatePasskeyId),
      });
      setMode("emailSent");
    } finally {
      setBusy(null);
    }
  }

  async function withdrawn() {
    if (!flat) return;
    setDrafts((prev) => ({ ...prev, [flat.flatId]: {} }));
    await onChanged();
    setStep(0);
    setMode("items");
  }

  async function withdrawWithPasskey() {
    if (!flat) return;
    setError(null);
    setBusy("withdraw");
    try {
      const opt = await postJson("/api/ballots/passkey-options", {
        votingId: voting.id,
        flatId: flat.flatId,
        action: "withdraw",
      });
      if (!opt.ok) {
        setError(opt.code);
        return;
      }
      let response;
      try {
        response = await startAuthentication(opt.json.options);
      } catch (e) {
        setError(webauthnErrorCode(e));
        return;
      }
      const res = await fetch(
        `/api/ballots?votingId=${voting.id}&flatId=${flat.flatId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: { method: "passkey", response } }),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(res.status === 429 ? "RATE_LIMITED" : json.error || "generic");
        return;
      }
      await withdrawn();
    } finally {
      setBusy(null);
    }
  }

  async function withdrawByEmail() {
    if (!flat) return;
    setError(null);
    setBusy("email");
    try {
      const res = await postJson("/api/ballots/email-confirmation", {
        votingId: voting.id,
        flatId: flat.flatId,
        action: "withdraw",
        locale,
      });
      if (!res.ok) {
        setError(res.code);
        return;
      }
      setEmailSent({
        to: res.json.sentTo,
        expiresAt: res.json.expiresAt,
        action: "withdraw",
        activatesPasskey: false,
      });
      setMode("emailSent");
    } finally {
      setBusy(null);
    }
  }

  const errorBox = error ? (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-ui-danger px-4 py-3 text-base text-ui-danger"
    >
      <Icon name="alert" size={20} />
      <span>{errorText(error)}</span>
    </div>
  ) : null;

  // ── Unit picker (owner of several units) ──────────────
  if (!flat) {
    return (
      <Card as="section" className="mb-6">
        <h2 className="mb-1 text-xl font-bold text-ui-text">{t("pickUnitTitle")}</h2>
        <p className="mb-4 text-base text-ui-text-muted">{t("pickUnitHelp")}</p>
        <ul className="space-y-3">
          {userFlats.map((f) => {
            const b = userBallots.find((x) => x.flatId === f.flatId);
            return (
              <li
                key={f.flatId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ui-border p-4"
              >
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-ui-text">
                    {tVoting("flatHeader", { number: f.flatNumber })}
                  </p>
                  {b ? (
                    <Badge tone="success">{t("unitVoted")}</Badge>
                  ) : (
                    <Badge tone="warning">{t("unitNotVoted")}</Badge>
                  )}
                </div>
                <Button
                  variant={b ? "secondary" : "primary"}
                  onClick={() => openFlat(f.flatId)}
                >
                  {b ? t("showVote") : t("voteForUnit")}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  }

  const unitLabel = tVoting("flatHeader", { number: flat.flatNumber });

  // ── Withdraw: confirm with a passkey or an e-mail link ──
  if (mode === "withdraw" && existing && existing.voteType !== "paper") {
    return (
      <Card as="section" className="mb-6">
        <h2 className="mb-2 text-xl font-bold text-ui-text">{tVoting("withdrawConfirm")}</h2>
        <p className="mb-2 text-base text-ui-text">{t("withdrawConsequence", { unit: unitLabel })}</p>
        <p className="mb-4 text-base text-ui-text">{t("withdrawConfirmExplain")}</p>
        {errorBox}
        <div className="flex flex-col gap-3">
          {hasPasskey && (
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={busy === "withdraw"}
              disabled={busy !== null}
              onClick={withdrawWithPasskey}
            >
              <Icon name="key" size={20} />
              {t("withdrawPasskey")}
            </Button>
          )}
          <Button
            variant={hasPasskey ? "secondary" : "danger"}
            size="lg"
            fullWidth
            loading={busy === "email"}
            disabled={busy !== null}
            onClick={withdrawByEmail}
          >
            <Icon name="mail" size={20} />
            {t("withdrawEmail")}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setMode("receipt");
            }}
          >
            <Icon name="chevronLeft" size={20} />
            {t("withdrawCancel")}
          </Button>
        </div>
      </Card>
    );
  }

  // ── Receipt ───────────────────────────────────────────
  if ((mode === "receipt" || mode === "withdraw") && existing) {
    const recordedAt = new Date(existing.recordedAt);
    // Recorded by the board from a signed paper ballot: read-only for the
    // owner (no change, no withdraw).
    const isPaper = existing.voteType === "paper";
    const methodKey =
      existing.voteType === "paper"
        ? "methodPaper"
        : existing.confirmationMethod === "passkey"
        ? "methodPasskey"
        : existing.confirmationMethod === "email"
        ? "methodEmail"
        : "methodLegacy";
    return (
      <Card as="section" className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-ui-success">
          <Icon name="check" size={28} />
          <h2 className="text-xl font-bold">{t("receiptTitle")}</h2>
        </div>
        <p className="text-base text-ui-text">{unitLabel}</p>
        <p className="mb-4 text-base text-ui-text-muted">
          {t("receiptWhen", {
            date: format.dateTime(recordedAt, {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </p>

        <ul className="mb-4 divide-y divide-ui-border border-y border-ui-border">
          {items.map((item) => {
            const c = existing.choices[item.id] as VoteChoice | undefined;
            return (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <span className="min-w-0 break-words text-base text-ui-text">
                  {t("itemShort", { number: item.idx + 1 })} {item.title}
                </span>
                <span className="shrink-0 text-base font-bold text-ui-text">
                  {c ? tVote(CHOICE_KEY[c]) : t("noChoiceRecorded")}
                </span>
              </li>
            );
          })}
        </ul>

        {isPaper ? (
          <p className="mb-4 text-base text-ui-text">{t("paperLockedNote")}</p>
        ) : (
          voting.status === "active" &&
          votingOpen && (
            <p className="mb-4 text-base text-ui-text">{t("changeUntil", { deadline })}</p>
          )
        )}

        <details className="mb-4 rounded-lg border border-ui-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-medium text-ui-text">
            {t("details")}
          </summary>
          <dl className="mt-2 space-y-2 text-base">
            <div>
              <dt className="text-ui-text-muted">{t("confirmedBy")}</dt>
              <dd className="text-ui-text">{t(methodKey)}</dd>
            </div>
            <div>
              <dt className="text-ui-text-muted">{tVoting("ballotHashLabel")}</dt>
              <dd className="break-all font-mono text-base text-ui-text">{existing.ballotHash}</dd>
            </div>
          </dl>
        </details>

        {errorBox}

        {!isPaper && voting.status === "active" && votingOpen && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" size="lg" fullWidth onClick={startChange}>
              {t("changeVote")}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onClick={() => {
                setError(null);
                setMode("withdraw");
              }}
            >
              {tVoting("withdrawBallot")}
            </Button>
          </div>
        )}
        {!single && (
          <Button variant="ghost" className="mt-3" onClick={() => setFlatId(null)}>
            <Icon name="chevronLeft" size={20} />
            {t("backToUnits")}
          </Button>
        )}
      </Card>
    );
  }

  // ── E-mail sent ───────────────────────────────────────
  if (mode === "emailSent" && emailSent) {
    return (
      <Card as="section" className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-ui-text">
          <Icon name="mail" size={28} />
          <h2 className="text-xl font-bold">{t("emailSentTitle")}</h2>
        </div>
        <p className="mb-2 text-base text-ui-text">{t("emailSentTo", { email: emailSent.to })}</p>
        <p className="mb-2 text-base text-ui-text">
          {t(emailSent.action === "withdraw" ? "withdrawEmailHelp" : "emailSentHelp", {
            time: format.dateTime(new Date(emailSent.expiresAt), {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </p>
        {emailSent.activatesPasskey && (
          <p className="mb-2 text-base text-ui-text">{t("emailActivatesPasskey")}</p>
        )}
        <p className="mb-4 text-base font-medium text-ui-text">
          {emailSent.action === "withdraw" ? t("withdrawNotYetDone") : t("emailNotYetRecorded")}
        </p>
        {errorBox}
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            fullWidth
            loading={reloading}
            onClick={async () => {
              setReloading(true);
              setError(null);
              try {
                await onChanged();
                setCheckEmailResult(true);
              } finally {
                setReloading(false);
              }
            }}
          >
            {t("emailDoneReload")}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={() => setMode(emailSent.action === "withdraw" ? "receipt" : "review")}
          >
            {emailSent.action === "withdraw" ? t("backToReceipt") : t("backToReview")}
          </Button>
        </div>
      </Card>
    );
  }

  // ── Review + confirm ──────────────────────────────────
  if (mode === "review") {
    // A pending passkey cannot confirm yet, and creating another one on the
    // same device fails — point to the e-mail instead.
    const pendingOnly = hasPendingPasskey && !hasPasskey;
    const passkeyPrimary = hasPasskey || (canCreatePasskey && !pendingOnly);
    return (
      <Card as="section" className="mb-6">
        <h2 className="mb-1 text-xl font-bold text-ui-text">
          {t("reviewTitle", { unit: unitLabel })}
        </h2>
        <p className="mb-4 text-base text-ui-text-muted">{tVoting("reviewHelp")}</p>
        <ul className="mb-4 divide-y divide-ui-border border-y border-ui-border">
          {items.map((item, i) => {
            const c = draft[item.id];
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base text-ui-text">
                    {t("itemShort", { number: item.idx + 1 })} {item.title}
                  </p>
                  <p className={cn("text-lg font-bold", c ? "text-ui-text" : "text-ui-warning")}>
                    {c ? tVote(CHOICE_KEY[c]) : t("noChoiceYet")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    setStep(i);
                    setReturnToReview(true);
                    setMode("items");
                  }}
                >
                  <Icon name="edit" size={20} />
                  {t("change")}
                </Button>
              </li>
            );
          })}
        </ul>

        {errorBox}

        {!allMarked ? (
          <p className="text-base font-medium text-ui-warning">{t("markAllFirst")}</p>
        ) : (
          <>
            <p className="mb-4 text-base text-ui-text">{t("confirmExplain")}</p>
            {pendingOnly && (
              <p className="mb-4 text-base text-ui-text">{t("passkeyPendingNote")}</p>
            )}
            <div className="flex flex-col gap-3">
              {passkeyPrimary && (
                <>
                  {hasPasskey ? (
                    <Button
                      size="lg"
                      fullWidth
                      loading={busy === "passkey"}
                      disabled={busy !== null}
                      onClick={confirmWithPasskey}
                    >
                      <Icon name="key" size={20} />
                      {t("confirmPasskey")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="lg"
                        fullWidth
                        loading={busy === "passkey"}
                        disabled={busy !== null}
                        onClick={createPasskeyAndConfirm}
                      >
                        <Icon name="key" size={20} />
                        {t("createPasskey")}
                      </Button>
                      <p className="text-base text-ui-text-muted">{t("createPasskeyHelp")}</p>
                    </>
                  )}
                </>
              )}
              <Button
                variant={passkeyPrimary ? "secondary" : "primary"}
                size="lg"
                fullWidth
                loading={busy === "email"}
                disabled={busy !== null}
                onClick={() => sendEmail()}
              >
                <Icon name="mail" size={20} />
                {t("confirmEmail")}
              </Button>
            </div>
          </>
        )}
        <Button
          variant="ghost"
          className="mt-3"
          disabled={busy !== null}
          onClick={() => {
            setStep(items.length - 1);
            setMode("items");
          }}
        >
          <Icon name="chevronLeft" size={20} />
          {t("back")}
        </Button>
      </Card>
    );
  }

  // ── One item per screen ───────────────────────────────
  const item = items[Math.min(step, items.length - 1)];
  const selected = draft[item.id];
  const multi = items.length > 1;
  const remaining = items.filter((i) => !draft[i.id]).length;
  const canGoBack = step > 0 || Boolean(existing) || !single;

  return (
    <Card as="section" className="mb-6">
      <p className="mb-1 text-base text-ui-text-muted">
        {multi
          ? t("stepOf", { unit: unitLabel, current: step + 1, total: items.length })
          : unitLabel}
      </p>
      {step === 0 && !returnToReview && (
        <p className="mb-3 text-base text-ui-text-muted">{tVoting("ballotIntro")}</p>
      )}
      <h2 className="mb-2 break-words text-xl font-bold text-ui-text">
        {multi && <span>{t("itemShort", { number: item.idx + 1 })} </span>}
        {item.title}
      </h2>
      {item.description && (
        <p className="mb-4 whitespace-pre-wrap break-words text-base text-ui-text">
          {item.description}
        </p>
      )}

      <div role="group" aria-label={t("choiceGroup")} className="mb-4 flex flex-col gap-3">
        {CHOICES.map((c) => {
          const on = selected === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => choose(item.id, c)}
              className={cn(
                "flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-lg font-bold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:ring-offset-2",
                on
                  ? "border-ui-primary bg-ui-primary text-ui-primary-text"
                  : "border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-muted"
              )}
            >
              {on && <Icon name="check" size={22} />}
              {tVote(CHOICE_KEY[c])}
            </button>
          );
        })}
      </div>

      {items.length > 3 && remaining > 1 && !returnToReview && (
        <details className="mb-4 rounded-lg border border-ui-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-medium text-ui-text">
            {t("setRemainingTitle", { count: remaining })}
          </summary>
          <p className="mb-3 mt-1 text-base text-ui-text-muted">{t("setRemainingHelp")}</p>
          <div className="flex flex-col gap-2">
            {CHOICES.map((c) => (
              <Button key={c} variant="secondary" fullWidth onClick={() => setRemaining(c)}>
                {t("setRemainingTo", { choice: tVote(CHOICE_KEY[c]) })}
              </Button>
            ))}
          </div>
        </details>
      )}

      <div className="flex gap-3">
        {canGoBack && (
          <Button variant="secondary" size="lg" fullWidth onClick={back}>
            <Icon name="chevronLeft" size={20} />
            {t("back")}
          </Button>
        )}
        <Button size="lg" fullWidth disabled={!selected} onClick={next}>
          {returnToReview || step >= items.length - 1 ? t("toReview") : t("next")}
          <Icon name="chevronRight" size={20} />
        </Button>
      </div>
    </Card>
  );
}
