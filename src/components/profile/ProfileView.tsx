"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { useShell } from "@/components/layout/ShellContext";
import { routing } from "@/i18n/routing";
import type { UserRole } from "@/types";
import { Button, Card, Field, Icon, Input, Modal, PageHeader } from "@/components/ui";
import NotificationPreferences, { type NotificationPrefs } from "@/components/notifications/NotificationPreferences";
import PushSubscriptionManager from "@/components/notifications/PushSubscriptionManager";
import ConsentManagement from "@/components/consent/ConsentManagement";
import PasskeysCard from "@/components/profile/PasskeysCard";
import ConnectedAiApps from "@/components/profile/ConnectedAiApps";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const roleKeys: Record<UserRole, string> = {
  admin: "roleAdmin",
  owner: "roleOwner",
  tenant: "roleTenant",
  vote_counter: "roleVoteCounter",
  caretaker: "roleCaretaker",
};

export interface ProfileFlat {
  id: string;
  flatNumber: string;
  entranceName: string | null;
}

interface ProfileViewProps {
  flats: ProfileFlat[];
  prefs: NotificationPrefs;
  /** BYT-20261118-003: own users.last_login_at (ISO) — the owner's own record only. */
  lastLoginAt?: string | null;
  /** Public MCP endpoint, resolved on the server. */
  mcpUrl: string | null;
}

export default function ProfileView({ flats, prefs, lastLoginAt = null, mcpUrl }: ProfileViewProps) {
  const t = useTranslations("Profile");
  const tHealth = useTranslations("OwnerHealth");
  const format = useFormatter();
  const tp = useTranslations("ProfileHub");
  const { user, enabledModules } = useShell();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [consentsOpen, setConsentsOpen] = useState(false);

  function closePassword() {
    setPasswordOpen(false);
    setError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    setSaving(true);

    const res = await fetch("/api/profile/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error?.includes("aktuálne heslo") || data.error?.includes("current password")) {
        setError(t("wrongPassword"));
      } else {
        setError(t("passwordChangeFailed"));
      }
      setSaving(false);
      return;
    }

    closePassword();
    setSuccess(t("passwordChanged"));
    setSaving(false);
  }

  const flatsLabel = flats
    .map((f) => (f.entranceName ? `${f.flatNumber} (${f.entranceName})` : f.flatNumber))
    .join(", ");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t("title")} className="mb-2" />

      {/* Account */}
      <Card as="section" padding="lg" aria-labelledby="account-heading">
        <h2 id="account-heading" className="sr-only">
          {t("userInfo")}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-ui-text-muted">{t("nameLabel")}</dt>
          <dd className="min-w-0 break-words font-medium text-ui-text">{user.name}</dd>
          <dt className="text-ui-text-muted">{t("emailLabel")}</dt>
          <dd className="min-w-0 break-words text-ui-text">{user.email}</dd>
          <dt className="text-ui-text-muted">{t("roleLabel")}</dt>
          <dd className="text-ui-text">{t(roleKeys[user.role])}</dd>
          {flats.length > 0 ? (
            <>
              <dt className="text-ui-text-muted">{tp("flatsLabel")}</dt>
              <dd className="min-w-0 break-words text-ui-text">{flatsLabel}</dd>
            </>
          ) : null}
          {lastLoginAt ? (
            <>
              <dt className="text-ui-text-muted">{tHealth("lastLogin")}</dt>
              <dd className="text-ui-text">
                {format.dateTime(new Date(lastLoginAt), { dateStyle: "medium", timeStyle: "short" })}
              </dd>
            </>
          ) : null}
        </dl>
      </Card>

      {/* Password: collapsed behind one row */}
      <Card as="section" padding="md" className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ui-text">{t("changePassword")}</h2>
          {success ? (
            <p role="status" className="text-base font-medium text-ui-success">
              {success}
            </p>
          ) : null}
        </div>
        <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
          <Icon name="key" size={20} />
          {t("changePasswordButton")}
        </Button>
      </Card>

      {/* Passkeys: confirm a vote with fingerprint / face (Phase 6) */}
      <PasskeysCard />

      {/* Connected AI apps (MCP / OAuth grants) — only while MCP is enabled */}
      {enabledModules.includes("mcp") ? <ConnectedAiApps mcpUrl={mcpUrl} /> : null}

      {/* Notifications */}
      <Card as="section" padding="lg" aria-labelledby="notifications-heading" className="space-y-5">
        <h2 id="notifications-heading" className="text-xl font-semibold text-ui-text">
          {tp("notificationsTitle")}
        </h2>
        <NotificationPreferences initial={prefs} />
        <PushSubscriptionManager />
      </Card>

      {/* Consents: collapsed behind a disclosure, mounted (and fetched) only when opened */}
      <Card as="section" padding="md">
        <button
          type="button"
          aria-expanded={consentsOpen}
          aria-controls="consents-panel"
          onClick={() => setConsentsOpen((o) => !o)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left text-base font-semibold text-ui-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
        >
          {tp("consentsLink")}
          <Icon name="chevronDown" size={20} className={consentsOpen ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {consentsOpen ? (
          <div id="consents-panel" className="mt-3 border-t border-ui-border pt-4">
            <ConsentManagement />
          </div>
        ) : null}
      </Card>

      {/* Appearance + language */}
      <Card as="section" padding="md" aria-label={t("appearance")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 text-base font-medium text-ui-text">{t("theme")}</p>
            <ThemeToggle />
          </div>
          {routing.locales.length > 1 ? (
            <div>
              <p className="mb-2 text-base font-medium text-ui-text">{t("language")}</p>
              <LanguageSwitcher />
            </div>
          ) : null}
        </div>
      </Card>

      <Modal
        open={passwordOpen}
        onClose={closePassword}
        title={t("changePassword")}
        footer={
          <>
            <Button variant="secondary" onClick={closePassword}>
              {tp("cancel")}
            </Button>
            <Button type="submit" form="change-password-form" loading={saving}>
              {saving ? t("changing") : t("changePasswordButton")}
            </Button>
          </>
        }
      >
        <form id="change-password-form" onSubmit={handleChangePassword} className="space-y-4">
          {error ? (
            <p role="alert" className="rounded-lg border border-ui-danger/40 bg-ui-danger/10 px-4 py-3 text-base font-medium text-ui-danger">
              {error}
            </p>
          ) : null}
          <Field label={t("currentPassword")} required>
            <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
          <Field label={t("newPassword")} required>
            <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} />
          </Field>
          <Field label={t("confirmPassword")} required>
            <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
