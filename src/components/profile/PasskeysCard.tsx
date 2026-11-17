"use client";

// BYT-20261117-002 Phase 6: manage the signed-in user's passkeys (list with
// created / last used, add on this device, delete with a confirmation that
// states the consequence). Self-contained — mount it on the profile page.
// Loads the list once when mounted; nothing is polled.
//
// A new passkey is inactive until the owner clicks the link e-mailed to them
// ("čaká na potvrdenie e-mailom"); the link can be sent again from here.
import { useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  LoadingBlock,
} from "@/components/ui";
import type { PasskeySummary } from "@/lib/webauthn";

export default function PasskeysCard() {
  const t = useTranslations("Passkeys");
  const format = useFormatter();
  const locale = useLocale();
  const [resending, setResending] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [supported, setSupported] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PasskeySummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/passkeys");
    if (res.ok) {
      const json = await res.json();
      setPasskeys(json.passkeys ?? []);
    } else {
      setPasskeys([]);
      setError("generic");
    }
  }

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void load();
  }, []);

  function errorText(code: string) {
    const key = `errors.${code}`;
    return t.has(key) ? t(key) : t("errors.generic");
  }

  function when(iso: string) {
    return format.dateTime(new Date(iso), {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function add() {
    setError(null);
    setNotice(null);
    setAdding(true);
    try {
      const optRes = await fetch("/api/passkeys/register/options", { method: "POST" });
      const opt = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        setError(optRes.status === 429 ? "RATE_LIMITED" : opt.error || "generic");
        return;
      }
      let response;
      try {
        response = await startRegistration(opt.options);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(
          name === "NotAllowedError" || name === "AbortError"
            ? "PASSKEY_CANCELLED"
            : name === "InvalidStateError"
            ? "PASSKEY_ALREADY_REGISTERED"
            : "REGISTRATION_FAILED"
        );
        return;
      }
      const res = await fetch("/api/passkeys/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, locale }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? "RATE_LIMITED" : json.error || "generic");
        return;
      }
      const mail = json.activationEmail as { sentTo?: string; error?: string } | undefined;
      if (mail?.sentTo) {
        setNotice(t("addedPending", { email: mail.sentTo }));
      } else {
        setNotice(t("addedPendingNoEmail"));
        if (mail?.error) setError(mail.error);
      }
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function resend(p: PasskeySummary) {
    setError(null);
    setNotice(null);
    setResending(p.id);
    try {
      const res = await fetch("/api/passkeys/activation-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, locale }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? "RATE_LIMITED" : json.error || "generic");
        return;
      }
      setNotice(t("activationResent", { email: json.sentTo }));
    } finally {
      setResending(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/passkeys?id=${encodeURIComponent(deleting.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "generic");
        return;
      }
      setDeleting(null);
      setNotice(t("deleted"));
      await load();
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <Card as="section">
      <h2 className="mb-1 text-xl font-bold text-ui-text">{t("title")}</h2>
      <p className="mb-4 text-base text-ui-text-muted">{t("intro")}</p>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-ui-danger px-4 py-3 text-base text-ui-danger"
        >
          <Icon name="alert" size={20} />
          <span>{errorText(error)}</span>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 text-base font-medium text-ui-success">
          {notice}
        </p>
      )}

      {passkeys === null ? (
        <LoadingBlock />
      ) : passkeys.length === 0 ? (
        <EmptyState icon="key" title={t("emptyTitle")} description={t("emptyHelp")} />
      ) : (
        <ul className="mb-4 divide-y divide-ui-border border-y border-ui-border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ui-text">
                  <Icon name="key" size={20} />
                  {p.deviceLabel || t("unnamedDevice")}
                  {!p.activatedAt && <Badge tone="warning">{t("pendingBadge")}</Badge>}
                </p>
                {!p.activatedAt && (
                  <p className="text-base text-ui-text">{t("pendingHelp")}</p>
                )}
                <p className="text-base text-ui-text-muted">
                  {t("createdAt", { date: when(p.createdAt) })}
                </p>
                <p className="text-base text-ui-text-muted">
                  {p.lastUsedAt ? t("lastUsedAt", { date: when(p.lastUsedAt) }) : t("neverUsed")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!p.activatedAt && (
                  <Button
                    variant="secondary"
                    loading={resending === p.id}
                    disabled={resending !== null}
                    onClick={() => resend(p)}
                  >
                    <Icon name="mail" size={20} />
                    {t("resendActivation")}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDeleting(p)}>
                  <Icon name="trash" size={20} />
                  {t("delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <Button variant="secondary" fullWidth loading={adding} onClick={add} className="mt-4">
          <Icon name="plus" size={20} />
          {t("add")}
        </Button>
      ) : (
        <p className="mt-4 text-base text-ui-text-muted">{t("notSupported")}</p>
      )}

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t("deleteTitle")}
        description={t("deleteConsequence", {
          device: deleting?.deviceLabel || t("unnamedDevice"),
        })}
        confirmLabel={t("delete")}
        loading={deleteBusy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}
