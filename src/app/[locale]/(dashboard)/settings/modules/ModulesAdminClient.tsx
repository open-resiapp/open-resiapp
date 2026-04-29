"use client";

import { useState, useTransition } from "react";

import type { InstalledModuleView } from "@/lib/modules/install";
import { PERMISSIONS, type Permission } from "@/lib/modules/sdk";
import {
  approveStagedAction,
  toggleModuleAction,
  uninstallAction,
  uploadModuleAction,
} from "./actions";

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
}

export default function ModulesAdminClient({ installed }: Props) {
  const [staged, setStaged] = useState<StagedView | null>(null);
  const [approved, setApproved] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStaged(null);
    setApproved(new Set());
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
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
    (e.target as HTMLFormElement).reset();
  }

  async function handleApprove() {
    if (!staged) return;
    setError(null);
    const res = await approveStagedAction(
      staged.stagingId,
      Array.from(approved)
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSuccess(`installed ${res.name}`);
    reset();
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
    if (!confirm(`Uninstall "${name}"? Module tables will be dropped.`)) return;
    startTransition(async () => {
      const res = await uninstallAction(name);
      if (!res.ok) setError(res.error);
      else setSuccess(`uninstalled ${name}`);
    });
  }

  function handleToggle(name: string, next: "enabled" | "disabled") {
    startTransition(async () => {
      const res = await toggleModuleAction(name, next);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Modules</h1>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">Install module</h2>
        {!staged ? (
          <form onSubmit={handleUpload} className="flex items-center gap-3">
            <input
              type="file"
              name="file"
              accept=".zip"
              required
              className="block text-sm"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Upload zip
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{staged.name}</strong> v{staged.version}
              {staged.isUpgrade && (
                <span className="ml-2 text-xs text-amber-700">
                  upgrade from {staged.previousVersion}
                </span>
              )}
            </p>
            {staged.warnings.length > 0 && (
              <ul className="text-xs text-amber-700">
                {staged.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">
                Permissions requested
              </legend>
              {staged.declaredPermissions.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approved.has(p)}
                    onChange={() => toggleApproved(p)}
                  />
                  <code className="rounded bg-gray-100 px-1">{p}</code>
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={pending}
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve & install
              </button>
              <button
                onClick={reset}
                className="rounded border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b px-5 py-3 text-lg font-semibold">Installed</h2>
        {installed.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">
            no modules installed
          </p>
        ) : (
          <ul>
            {installed.map((m) => (
              <li key={m.name} className="border-b px-5 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {m.name}{" "}
                      <span className="text-xs text-gray-500">v{m.version}</span>
                    </p>
                    <p className="mt-0.5 text-xs">
                      <StatusPill status={m.status} />{" "}
                      {m.failureCount > 0 && (
                        <span className="text-amber-700">
                          {m.failureCount} failure(s)
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      grants:{" "}
                      {m.grantedPermissions.length === 0
                        ? "—"
                        : m.grantedPermissions.join(", ")}
                    </p>
                    {m.lastFailureMessage && (
                      <p className="mt-1 text-xs text-red-600">
                        last error: {m.lastFailureMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {m.status === "enabled" ? (
                      <button
                        onClick={() => handleToggle(m.name, "disabled")}
                        disabled={pending}
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggle(m.name, "enabled")}
                        disabled={pending}
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Enable
                      </button>
                    )}
                    <button
                      onClick={() => handleUninstall(m.name)}
                      disabled={pending}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: "enabled" | "disabled" | "failed" }) {
  const map = {
    enabled: "bg-green-100 text-green-800",
    disabled: "bg-gray-100 text-gray-700",
    failed: "bg-red-100 text-red-800",
  } as const;
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${map[status]}`}>
      {status}
    </span>
  );
}
