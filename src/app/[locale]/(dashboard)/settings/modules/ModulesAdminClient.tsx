"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import type { InstalledModuleView } from "@/lib/modules/install";
import type { Permission } from "@/lib/modules/sdk";
import {
  approveStagedAction,
  toggleModuleAction,
  uninstallAction,
  uploadModuleAction,
} from "./actions";
import { Badge, Button, Card, ConfirmDialog, Field, Input, PageHeader, type BadgeTone } from "@/components/ui";

interface StagedView {
  stagingId: string;
  name: string;
  version: string;
  declaredPermissions: Permission[];
  isUpgrade: boolean;
  previousVersion: string | null;
  warnings: string[];
}

interface Props {
  installed: InstalledModuleView[];
  canManageUsers?: boolean;
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_");

export default function ModulesAdminClient({ installed }: Props) {
  const tMcp = useTranslations("Mcp.module");
  const [staged, setStaged] = useState<StagedView | null>(null);
  const [approved, setApproved] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [toUninstall, setToUninstall] = useState<string | null>(null);
  const [mcpToggle, setMcpToggle] = useState<"enabled" | "disabled" | null>(null);
  // Enabled modules feed the shell nav (ShellData) — refresh the server
  // layout after install / uninstall / toggle so the sidebar follows.
  const router = useRouter();
  const tm = useTranslations("ModulesAdmin");

  const permLabel = (p: Permission) => (tm.has(`perm_${slug(p)}`) ? tm(`perm_${slug(p)}`) : p);
  const statusTone: Record<InstalledModuleView["status"], BadgeTone> = {
    enabled: "success",
    disabled: "neutral",
    failed: "danger",
  };

  function reset() {
    setStaged(null);
    setApproved(new Set());
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setSuccess(null);
    const res = await uploadModuleAction(fd);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStaged({
      stagingId: res.staged.stagingId,
      name: res.staged.manifest.name,
      version: res.staged.manifest.version,
      declaredPermissions: res.staged.declaredPermissions,
      isUpgrade: res.staged.isUpgrade,
      previousVersion: res.staged.previousVersion,
      warnings: res.staged.warnings,
    });
    setApproved(new Set(res.staged.declaredPermissions));
    form.reset();
  }

  async function handleApprove() {
    if (!staged) return;
    setError(null);
    const res = await approveStagedAction(staged.stagingId, Array.from(approved));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSuccess(tm("installedOk", { name: res.name }));
    reset();
    router.refresh();
  }

  function toggleApproved(p: Permission) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function handleUninstall(name: string) {
    setToUninstall(null);
    startTransition(async () => {
      const res = await uninstallAction(name);
      if (!res.ok) {
        setError(tm.has(`errors.${res.error}`) ? tm(`errors.${res.error}`) : res.error);
      } else {
        setSuccess(tm("uninstalledOk", { name }));
        router.refresh();
      }
    });
  }

  function handleToggle(name: string, next: "enabled" | "disabled") {
    // BYT-20261117-001: enabling MCP sends community data to the AI provider
    // a member connects; disabling revokes every connection — confirm first.
    if (name === "mcp") {
      setMcpToggle(next);
      return;
    }
    runToggle(name, next);
  }

  function runToggle(name: string, next: "enabled" | "disabled") {
    startTransition(async () => {
      const res = await toggleModuleAction(name, next);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const moduleDescription = (name: string) =>
    tm.has(`desc_${slug(name)}`) ? tm(`desc_${slug(name)}`) : tm("desc_default");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={tm("title")}
        description={tm("intro")}
        backHref="/settings/advanced"
        backLabel={tm("backToAdvanced")}
        className="mb-0"
      />

      {error ? (
        <p role="alert" className="rounded-lg border border-ui-danger/40 bg-ui-danger/10 p-3 text-base font-medium text-ui-danger">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="rounded-lg border border-ui-success/40 bg-ui-success/10 p-3 text-base font-medium text-ui-success">
          {success}
        </p>
      ) : null}

      <Card as="section" padding="lg" aria-labelledby="install-heading" className="space-y-4">
        <h2 id="install-heading" className="text-xl font-semibold text-ui-text">
          {tm("installTitle")}
        </h2>
        {!staged ? (
          <form onSubmit={handleUpload} className="space-y-3">
            <Field label={tm("zipLabel")} hint={tm("zipHint")}>
              <Input type="file" name="file" accept=".zip" required />
            </Field>
            <Button type="submit">{tm("uploadZip")}</Button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-base text-ui-text">
              <strong>{staged.name}</strong> v{staged.version}
              {staged.isUpgrade ? (
                <Badge tone="warning" className="ml-2">
                  {tm("upgradeFrom", { version: staged.previousVersion ?? "" })}
                </Badge>
              ) : null}
            </p>
            {staged.warnings.length > 0 ? (
              <ul className="space-y-1 text-base text-ui-warning">
                {staged.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="text-base font-medium text-ui-text">{tm("permissionsRequested")}</legend>
              {staged.declaredPermissions.map((p) => (
                <label key={p} className="flex min-h-11 items-center gap-3 text-base text-ui-text">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-ui-primary"
                    checked={approved.has(p)}
                    onChange={() => toggleApproved(p)}
                  />
                  {permLabel(p)}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleApprove} loading={pending}>
                {tm("approveInstall")}
              </Button>
              <Button variant="secondary" onClick={reset}>
                {tm("cancel")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <section aria-labelledby="installed-heading" className="space-y-3">
        <h2 id="installed-heading" className="text-xl font-semibold text-ui-text">
          {tm("installedTitle")}
        </h2>
        {installed.length === 0 ? (
          <p className="text-base text-ui-text-muted">{tm("noModules")}</p>
        ) : (
          <ul className="space-y-3">
            {installed.map((m) => (
              <Card as="li" key={m.name} padding="lg">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ui-text">
                      {m.name}
                      <span className="text-base font-normal text-ui-text-muted">v{m.version}</span>
                      <Badge tone={statusTone[m.status]}>{tm(`status_${m.status}`)}</Badge>
                    </p>
                    <p className="text-base text-ui-text">{moduleDescription(m.name)}</p>
                    {m.failureCount > 0 ? (
                      <p className="text-base text-ui-warning">{tm("failures", { count: m.failureCount })}</p>
                    ) : null}
                    <p className="text-base text-ui-text-muted">
                      {tm("grants")}:{" "}
                      {m.grantedPermissions.length === 0 ? "—" : m.grantedPermissions.map(permLabel).join(", ")}
                    </p>
                    {m.name === "mcp" && (
                      <p className="max-w-prose text-base text-ui-warning">{tMcp("description")}</p>
                    )}
                    {m.lastFailureMessage ? (
                      <p className="text-base text-ui-danger">
                        {tm("lastError")}: {m.lastFailureMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    <div className="flex flex-wrap gap-2">
                      {m.status === "enabled" ? (
                        <Button variant="secondary" onClick={() => handleToggle(m.name, "disabled")} disabled={pending}>
                          {tm("disable")}
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => handleToggle(m.name, "enabled")} disabled={pending}>
                          {tm("enable")}
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        onClick={() => setToUninstall(m.name)}
                        disabled={pending || m.hasData}
                        title={m.hasData ? tm("uninstallBlockedHasData") : undefined}
                      >
                        {tm("uninstall")}
                      </Button>
                    </div>
                    {m.hasData ? (
                      <p className="max-w-xs text-base text-ui-text-muted sm:text-right">
                        {tm("uninstallBlockedHasData")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={toUninstall !== null}
        tone="danger"
        title={tm("uninstall")}
        description={tm("uninstallConfirm", { name: toUninstall ?? "" })}
        confirmLabel={tm("uninstall")}
        onConfirm={() => toUninstall && handleUninstall(toUninstall)}
        onCancel={() => setToUninstall(null)}
      />
      <ConfirmDialog
        open={mcpToggle !== null}
        tone={mcpToggle === "disabled" ? "danger" : "default"}
        title={mcpToggle === "disabled" ? tm("disable") : tm("enable")}
        description={mcpToggle === "disabled" ? tMcp("disableWarning") : tMcp("enableWarning")}
        confirmLabel={mcpToggle === "disabled" ? tm("disable") : tm("enable")}
        onConfirm={() => {
          const next = mcpToggle;
          setMcpToggle(null);
          if (next) runToggle("mcp", next);
        }}
        onCancel={() => setMcpToggle(null)}
      />
    </div>
  );
}
