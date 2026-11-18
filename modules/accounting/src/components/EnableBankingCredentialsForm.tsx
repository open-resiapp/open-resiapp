"use client";

// Admin enters the Enable Banking application id + private key
// (BYT-20261118-001). The key is pasted or loaded from the .pem file the
// Enable Banking control panel downloads; the server verifies the pair
// against Enable Banking before storing it encrypted. The key is never sent
// back — after saving only the masked id and the key fingerprint show.

import { useState, type ChangeEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button, ConfirmDialog, Field, Input, Textarea } from "@/components/ui";
import { isEnableBankingErrorCode } from "@modules/accounting/src/lib/enable-banking-errors";

export interface CredentialsInfo {
  configured: boolean;
  source: "env" | "db" | null;
  appIdMasked: string | null;
  keyFingerprint: string | null;
  updatedAt: string | null;
  keyUnreadable: boolean;
}

interface CredentialCheck {
  appActive: boolean | null;
  redirectRegistered: boolean | null;
  environment: string | null;
}

const MAX_KEY_FILE_BYTES = 16_384;

export default function EnableBankingCredentialsForm({
  info,
}: {
  info: CredentialsInfo;
}) {
  const t = useTranslations("Accounting.bankConnection");
  const te = useTranslations("Accounting.reconciliation");
  const format = useFormatter();
  const router = useRouter();

  const hasStored = info.source === "db";
  const [editing, setEditing] = useState(!hasStored || info.keyUnreadable);
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [check, setCheck] = useState<CredentialCheck | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const errorText = (code: string) =>
    isEnableBankingErrorCode(code)
      ? te(`ebErrors.${code}`)
      : `${te("submitError")} (${code})`;

  if (info.source === "env") {
    return (
      <p className="text-base text-ui-text-muted">
        {t("credentialsFromEnv", { appId: info.appIdMasked ?? "" })}
      </p>
    );
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_KEY_FILE_BYTES) {
      setErrorCode("EB_INVALID_KEY");
      return;
    }
    setErrorCode(null);
    setPrivateKey((await file.text()).trim());
  }

  async function save() {
    setBusy("save");
    setErrorCode(null);
    setCheck(null);
    try {
      const res = await fetch("/api/accounting/enable-banking/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, privateKey }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setCheck((body?.check as CredentialCheck) ?? null);
      setPrivateKey("");
      setAppId("");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setErrorCode(null);
    try {
      const res = await fetch("/api/accounting/enable-banking/credentials", {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setConfirmDelete(false);
      setCheck(null);
      setEditing(true);
      router.refresh();
    } catch (err) {
      setErrorCode(err instanceof Error ? err.message : "EB_API_ERROR");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {errorCode && (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {errorText(errorCode)}
        </p>
      )}

      {info.keyUnreadable && (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {t("credentialsUnreadable")}
        </p>
      )}

      {check && (
        <div role="status" className="space-y-1 text-base">
          <p className="font-medium text-ui-text">{t("credentialsSaved")}</p>
          {check.environment && (
            <p className="text-ui-text-muted">
              {t("credentialsEnvironment", { environment: check.environment })}
            </p>
          )}
          {check.appActive === false && (
            <p className="font-medium text-ui-warning">{t("credentialsInactive")}</p>
          )}
          {check.redirectRegistered === false && (
            <p className="font-medium text-ui-warning">
              {t("credentialsRedirectMissing")}
            </p>
          )}
        </div>
      )}

      {hasStored && !info.keyUnreadable && !editing && (
        <>
          <p className="text-base text-ui-text-muted">
            {t("credentialsStored", {
              appId: info.appIdMasked ?? "",
              fingerprint: info.keyFingerprint ?? "",
              date: info.updatedAt
                ? format.dateTime(new Date(info.updatedAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "",
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setEditing(true)}
            >
              {t("credentialsReplace")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirmDelete(true)}
            >
              {t("credentialsDelete")}
            </Button>
          </div>
        </>
      )}

      {editing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t("appIdLabel")} hint={t("appIdHint")} required>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
            />
          </Field>
          <Field label={t("privateKeyLabel")} hint={t("privateKeyHint")} required>
            <Textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={6}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-sm"
              placeholder="-----BEGIN PRIVATE KEY-----"
            />
          </Field>
          <label className="inline-flex min-h-11 cursor-pointer items-center text-base font-medium text-ui-primary hover:underline">
            {t("privateKeyFile")}
            <input
              type="file"
              accept=".pem,.key,.txt,application/x-pem-file"
              className="sr-only"
              onChange={onFile}
            />
          </label>
          <p className="text-base text-ui-text-muted">{t("credentialsSecurity")}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              loading={busy === "save"}
              disabled={!appId.trim() || !privateKey.trim() || busy !== null}
            >
              {busy === "save" ? t("credentialsVerifying") : t("credentialsSave")}
            </Button>
            {hasStored && !info.keyUnreadable && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  setEditing(false);
                  setPrivateKey("");
                  setAppId("");
                  setErrorCode(null);
                }}
              >
                {t("credentialsCancel")}
              </Button>
            )}
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("credentialsDeleteTitle")}
        description={t("credentialsDeleteConfirm")}
        confirmLabel={t("credentialsDelete")}
        tone="danger"
        loading={busy === "delete"}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
