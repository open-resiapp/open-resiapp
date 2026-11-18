"use client";

// Enable Banking live connection (BYT-20261118-001). Any SK/CZ bank via
// PSD2: pick bank → bank login → back to the settings page.
//   variant "settings" — Pokročilé → Prepojenie s bankou: connect, pick
//                         account, renew, disconnect (full setup).
//   variant "compact"  — "Z banky" card on Platby: status + sync only, and a
//                         link to the settings page for everything else.
// Connector errors arrive as EB_* codes and are translated here.

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Badge, Button, ConfirmDialog, Field, Select } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { isEnableBankingErrorCode } from "@modules/accounting/src/lib/enable-banking-errors";

interface EbState {
  configured: boolean;
  connected: boolean;
  aspspName: string | null;
  ibanMasked: string | null;
  validUntil: string | null;
  lastSyncAt: string | null;
  accountsToPick:
    | { uid: string; ibanMasked: string | null; name: string | null }[]
    | null;
}

interface Aspsp {
  name: string;
  country: string;
}

export interface EbImportSummary {
  credits: number;
  imported: number;
  skippedDuplicates: number;
  autoMatched: number;
  needsReview: number;
  debitsSkipped: number;
}

const RENEW_WARNING_DAYS = 14;
export const BANK_SETTINGS_HREF = "/settings/advanced/bank";

export default function EnableBankingConnection({
  variant,
  onSynced,
  onBusy,
}: {
  variant: "settings" | "compact";
  onSynced?: (summary: EbImportSummary) => void;
  onBusy?: () => void;
}) {
  const isSettings = variant === "settings";
  const t = useTranslations("Accounting.reconciliation");
  const format = useFormatter();
  const locale = useLocale();

  const [state, setState] = useState<EbState | null>(null);
  const [aspsps, setAspsps] = useState<Aspsp[] | null>(null);
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState<
    null | "connect" | "sync" | "account" | "disconnect"
  >(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const errorText = (code: string) =>
    isEnableBankingErrorCode(code)
      ? t(`ebErrors.${code}`)
      : `${t("submitError")} (${code})`;

  const load = useCallback(() => {
    fetch("/api/accounting/enable-banking")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: EbState | null) => {
        if (data) setState(data);
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  // One-shot outcome from the bank redirect (?eb=connected | EB_*).
  useEffect(() => {
    if (!isSettings) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("eb");
    if (!outcome) return;
    if (outcome === "connected") setNotice(t("ebConnectedNotice"));
    else setErrorCode(outcome);
    url.searchParams.delete("eb");
    window.history.replaceState(null, "", url.toString());
  }, [t, isSettings]);

  const needsBankList =
    isSettings &&
    state?.configured === true &&
    (!state.connected || isRenewDue(state));

  useEffect(() => {
    if (!needsBankList || aspsps) return;
    fetch("/api/accounting/enable-banking/aspsps")
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "EB_API_ERROR");
        return body as { aspsps: Aspsp[] };
      })
      .then((data) => setAspsps(data.aspsps))
      .catch((err) =>
        setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR")
      );
  }, [needsBankList, aspsps]);

  async function post(
    url: string,
    init: RequestInit
  ): Promise<Record<string, unknown>> {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? String(res.status));
    return body ?? {};
  }

  async function connect(aspspName: string) {
    if (!aspspName) return;
    setBusy("connect");
    setErrorCode(null);
    try {
      const body = await post("/api/accounting/enable-banking/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspspName, locale }),
      });
      // Off to the bank's login (SCA); the callback brings the user back.
      window.location.assign(String(body.url));
    } catch (err) {
      setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR");
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    setErrorCode(null);
    setNotice(null);
    onBusy?.();
    try {
      const summary = await post("/api/accounting/enable-banking/sync", {
        method: "POST",
      });
      onSynced?.(summary as unknown as EbImportSummary);
      load();
    } catch (err) {
      setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR");
    } finally {
      setBusy(null);
    }
  }

  async function pickAccount() {
    if (!account) return;
    setBusy("account");
    setErrorCode(null);
    try {
      await post("/api/accounting/enable-banking/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountUid: account }),
      });
      load();
    } catch (err) {
      setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setErrorCode(null);
    try {
      await post("/api/accounting/enable-banking", { method: "DELETE" });
      setConfirmDisconnect(false);
      setNotice(null);
      load();
    } catch (err) {
      setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR");
    } finally {
      setBusy(null);
    }
  }

  if (!state) return null;

  // Platby page: one line + link until a bank is connected.
  if (!isSettings && !state.connected) {
    return (
      <p className="mt-4 border-t border-ui-border pt-3 text-base text-ui-text-muted">
        {t("ebCompactHint")}{" "}
        <Link
          href={BANK_SETTINGS_HREF}
          className="font-medium text-ui-primary hover:underline"
        >
          {t("ebSettingsLink")}
        </Link>
      </p>
    );
  }
  // Settings page renders the setup guide itself when unconfigured.
  if (!state.configured) return null;

  const bankPicker = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field label={t("ebPickBank")} className="sm:min-w-64">
        <Select value={bank} onChange={(e) => setBank(e.target.value)}>
          <option value="">
            {aspsps ? t("ebPickBankPlaceholder") : t("ebLoadingBanks")}
          </option>
          {(aspsps ?? []).map((a) => (
            <option key={`${a.country}:${a.name}`} value={a.name}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="secondary"
        loading={busy === "connect"}
        disabled={!bank || busy !== null}
        onClick={() => connect(bank)}
      >
        {busy === "connect" ? t("ebRedirecting") : t("ebConnect")}
      </Button>
    </div>
  );

  const validUntil = state.validUntil ? new Date(state.validUntil) : null;
  const expired = validUntil !== null && validUntil.getTime() <= Date.now();
  const renewDue = isRenewDue(state);

  return (
    <div
      className={
        isSettings ? "space-y-3" : "mt-4 space-y-3 border-t border-ui-border pt-3"
      }
    >
      <h3 className="text-base font-semibold text-ui-text">{t("ebTitle")}</h3>

      {notice && (
        <p role="status" className="text-base text-ui-text">
          {notice}
        </p>
      )}
      {errorCode && (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {errorText(errorCode)}
        </p>
      )}

      {!state.connected && (
        <>
          <p className="text-base text-ui-text-muted">{t("ebHint")}</p>
          {bankPicker}
        </>
      )}

      {state.connected && (
        <>
          <p className="text-base text-ui-text-muted">
            {t("ebConnected", {
              bank: state.aspspName ?? "",
              iban: state.ibanMasked ?? "—",
            })}
            {state.lastSyncAt &&
              ` · ${t("fioLastSync", {
                date: format.dateTime(new Date(state.lastSyncAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}`}
          </p>
          {validUntil && (
            <p className="flex flex-wrap items-center gap-2 text-base text-ui-text-muted">
              {t("ebValidUntil", {
                date: format.dateTime(validUntil, { dateStyle: "medium" }),
              })}
              {expired ? (
                <Badge tone="danger">{t("ebExpired")}</Badge>
              ) : renewDue ? (
                <Badge tone="warning">{t("ebExpiresSoon")}</Badge>
              ) : null}
            </p>
          )}

          {state.accountsToPick && isSettings && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label={t("ebPickAccount")} className="sm:min-w-64">
                <Select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">{t("ebPickAccountPlaceholder")}</option>
                  {state.accountsToPick.map((a) => (
                    <option key={a.uid} value={a.uid}>
                      {[a.name, a.ibanMasked].filter(Boolean).join(" · ") ||
                        a.uid}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="secondary"
                loading={busy === "account"}
                disabled={!account || busy !== null}
                onClick={pickAccount}
              >
                {t("ebUseAccount")}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!state.accountsToPick && !expired && (
              <Button
                variant="secondary"
                loading={busy === "sync"}
                disabled={busy !== null}
                onClick={sync}
              >
                {busy === "sync" ? t("fioSyncing") : t("fioSync")}
              </Button>
            )}
            {isSettings ? (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => setConfirmDisconnect(true)}
              >
                {t("ebDisconnect")}
              </Button>
            ) : (
              (renewDue || state.accountsToPick) && (
                <Link
                  href={BANK_SETTINGS_HREF}
                  className="inline-flex min-h-11 items-center text-base font-medium text-ui-primary hover:underline"
                >
                  {state.accountsToPick ? t("ebPickAccount") : t("ebRenewLink")}
                </Link>
              )
            )}
          </div>

          {renewDue && isSettings && (
            <div className="space-y-2">
              <p className="text-base text-ui-text-muted">{t("ebRenewHint")}</p>
              {bankPicker}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        title={t("ebDisconnectTitle")}
        description={t("ebDisconnectConfirm")}
        confirmLabel={t("ebDisconnect")}
        tone="danger"
        loading={busy === "disconnect"}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function isRenewDue(state: EbState): boolean {
  if (!state.connected || !state.validUntil) return false;
  const msLeft = new Date(state.validUntil).getTime() - Date.now();
  return msLeft <= RENEW_WARNING_DAYS * 24 * 3600 * 1000;
}
