"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import type { ApiKeyPermission, ConnectionType } from "@/types";
import { Badge, Button, Card, ConfirmDialog, Field, Icon, Input, LoadingBlock, Modal, Select, type BadgeTone } from "@/components/ui";

interface Connection {
  id: string;
  name: string;
  type: string;
  apiKeyPrefix: string;
  permissions: ApiKeyPermission;
  isActive: boolean;
  lastUsedAt: string | null;
  pairedAt: string;
  createdAt: string;
}

interface PendingPairing {
  id: string;
  email: string;
  connectionType: string;
  permissions: ApiKeyPermission;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface AlertData {
  failedAuth: number;
  rateLimited: number;
  lockedPairings: number;
  totalAlerts: number;
}

interface LogEntry {
  id: string;
  connectionId: string | null;
  endpoint: string;
  method: string;
  ipAddress: string | null;
  statusCode: number;
  authResult: string;
  responseTimeMs: number | null;
  createdAt: string;
}

const CONNECTION_TYPES: { value: ConnectionType; labelKey: string }[] = [
  { value: "druzstvo", labelKey: "typeDruzstvo" },
  { value: "energy", labelKey: "typeEnergy" },
  { value: "housekeeper", labelKey: "typeHousekeeper" },
  { value: "other", labelKey: "typeOther" },
];

const PERMISSIONS: { value: ApiKeyPermission; labelKey: string }[] = [
  { value: "read", labelKey: "permissionRead" },
  { value: "read_write", labelKey: "permissionReadWrite" },
  { value: "full", labelKey: "permissionFull" },
];

export default function ExternalConnectionsTab() {
  const t = useTranslations("Settings");
  const th = useTranslations("SettingsHub");
  const locale = useLocale();
  const [toRevoke, setToRevoke] = useState<Connection | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pendingPairings, setPendingPairings] = useState<PendingPairing[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [alerts, setAlerts] = useState<AlertData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [showLogs, setShowLogs] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [connectionType, setConnectionType] = useState<ConnectionType>("druzstvo");
  const [permissions, setPermissions] = useState<ApiKeyPermission>("read");

  // Rotation state
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotationEmail, setRotationEmail] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/external-connections");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections.filter((c: Connection) => c.isActive));
        setPendingPairings(
          data.pendingPairings.filter(
            (p: PendingPairing) => p.status === "pending" && new Date(p.expiresAt) > new Date()
          )
        );
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/external-connections/alerts");
      if (res.ok) {
        setAlerts(await res.json());
      }
    } catch {
      // silently fail
    }
  }, []);

  const fetchLogs = useCallback(async (page: number) => {
    try {
      const res = await fetch(`/api/external-connections/logs?page=${page}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchAlerts();
  }, [fetchData, fetchAlerts]);

  useEffect(() => {
    if (showLogs) {
      fetchLogs(logsPage);
    }
  }, [showLogs, logsPage, fetchLogs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSuccessMessage("");

    try {
      const res = await fetch("/api/external-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, connectionType, permissions }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccessMessage(
          t("pairingInitiatedDesc", { email: data.email })
        );
        setShowModal(false);
        setEmail("");
        setConnectionType("druzstvo");
        setPermissions("read");
        fetchData();
      }
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!toRevoke) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/external-connections/${toRevoke.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchData();
      }
    } catch {
      // silently fail
    } finally {
      setRevoking(false);
      setToRevoke(null);
    }
  };

  const handleRotateKey = async (connId: string) => {
    if (!rotationEmail) return;
    setSubmitting(true);

    try {
      const res = await fetch(`/api/external-connections/${connId}/rotate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: rotationEmail }),
      });

      if (res.ok) {
        setSuccessMessage(t("rotationInitiated", { email: rotationEmail }));
        setRotatingId(null);
        setRotationEmail("");
        fetchData();
      }
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  };

  const TYPE_TONE: Record<string, BadgeTone> = {
    druzstvo: "info",
    energy: "warning",
    housekeeper: "success",
    other: "neutral",
  };
  const getTypeBadge = (type: string) => {
    const typeEntry = CONNECTION_TYPES.find((ct) => ct.value === type);
    const label = typeEntry ? t(typeEntry.labelKey as Parameters<typeof t>[0]) : type;
    return <Badge tone={TYPE_TONE[type] ?? "neutral"}>{label}</Badge>;
  };

  const getPermissionLabel = (perm: ApiKeyPermission) => {
    const entry = PERMISSIONS.find((p) => p.value === perm);
    return entry ? t(entry.labelKey as Parameters<typeof t>[0]) : perm;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t("neverUsed");
    return new Date(dateStr).toLocaleDateString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const authResultLabel = (result: string) =>
    th.has(`authResult_${result}`) ? th(`authResult_${result}`) : result;
  const authResultTone = (result: string): BadgeTone =>
    result === "success"
      ? "success"
      : result === "rate_limited"
        ? "warning"
        : result === "invalid_key" || result === "insufficient_permission"
          ? "danger"
          : "neutral";

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-6">
      {/* Alerts banner */}
      {alerts && alerts.totalAlerts > 0 ? (
        <div role="alert" className="rounded-lg border border-ui-danger/40 bg-ui-danger/10 p-4">
          <h3 className="mb-2 text-base font-semibold text-ui-danger">{t("securityAlerts")}</h3>
          <ul className="space-y-1 text-base text-ui-text">
            {alerts.failedAuth > 0 ? <li>{t("alertFailedAuth", { count: alerts.failedAuth })}</li> : null}
            {alerts.rateLimited > 0 ? <li>{t("alertRateLimited", { count: alerts.rateLimited })}</li> : null}
            {alerts.lockedPairings > 0 ? <li>{t("alertLockedPairings", { count: alerts.lockedPairings })}</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 max-w-prose text-base text-ui-text-muted">{t("connectionsDescription")}</p>
        <Button onClick={() => setShowModal(true)}>{t("addConnection")}</Button>
      </div>

      {successMessage ? (
        <p role="status" className="rounded-lg border border-ui-success/40 bg-ui-success/10 p-4 text-base font-medium text-ui-success">
          {successMessage}
        </p>
      ) : null}

      {/* Active connections */}
      {connections.length === 0 && pendingPairings.length === 0 ? (
        <p className="py-8 text-center text-base text-ui-text-muted">{t("noConnections")}</p>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => (
            <Card key={conn.id} padding="lg">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ui-text break-words">{conn.name}</h3>
                    {getTypeBadge(conn.type)}
                    <Badge tone="success">{t("active")}</Badge>
                  </div>
                  <div className="space-y-1 text-base text-ui-text-muted">
                    <p>
                      {t("permissionLabel")}: {getPermissionLabel(conn.permissions)}
                    </p>
                    <p>
                      {t("connectedSince")}: {formatDate(conn.pairedAt)}
                    </p>
                    <p>
                      {t("lastActivity")}: {formatDate(conn.lastUsedAt)}
                    </p>
                    <p className="font-mono text-base">
                      {th("keyLabel")}: {conn.apiKeyPrefix}…
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRotatingId(rotatingId === conn.id ? null : conn.id);
                      setRotationEmail("");
                    }}
                  >
                    {th("rotateKeyLabel")}
                  </Button>
                  <Button variant="danger" onClick={() => setToRevoke(conn)}>
                    {t("revokeConnection")}
                  </Button>
                </div>
              </div>
              {rotatingId === conn.id ? (
                <div className="mt-4 space-y-3 rounded-lg border border-ui-border bg-ui-surface-muted p-4">
                  <p className="text-base text-ui-text">{th("rotateKeyHelp")}</p>
                  <Field label={t("connectionEmail")}>
                    <Input
                      type="email"
                      value={rotationEmail}
                      onChange={(e) => setRotationEmail(e.target.value)}
                      placeholder={t("connectionEmailPlaceholder")}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => handleRotateKey(conn.id)} loading={submitting} disabled={!rotationEmail}>
                      {t("send")}
                    </Button>
                    <Button variant="secondary" onClick={() => setRotatingId(null)}>
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ))}

          {/* Pending pairings */}
          {pendingPairings.length > 0 ? (
            <>
              <h3 className="pt-2 text-base font-semibold text-ui-text">{t("pendingPairings")}</h3>
              {pendingPairings.map((pairing) => (
                <Card key={pairing.id} padding="lg" className="border-ui-warning/50">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ui-text break-words">{pairing.email}</h3>
                    {getTypeBadge(pairing.connectionType)}
                    <Badge tone="warning">{t("pairingPending")}</Badge>
                  </div>
                  <div className="text-base text-ui-text-muted">
                    <p>
                      {t("permissionLabel")}: {getPermissionLabel(pairing.permissions)}
                    </p>
                    <p>
                      {t("expiresAt")}: {formatDate(pairing.expiresAt)}
                    </p>
                  </div>
                </Card>
              ))}
            </>
          ) : null}
        </div>
      )}

      {/* Activity log */}
      <div>
        <button
          type="button"
          aria-expanded={showLogs}
          onClick={() => setShowLogs(!showLogs)}
          className="flex min-h-11 items-center gap-2 text-base font-semibold text-ui-text"
        >
          <Icon name={showLogs ? "chevronDown" : "chevronRight"} size={20} />
          {t("activityLog")}
        </button>
        {showLogs ? (
          <div className="mt-3">
            {logs.length === 0 ? (
              <p className="text-base text-ui-text-muted">{t("noLogs")}</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-ui-border">
                  <table className="w-full text-base">
                    <thead>
                      <tr className="border-b border-ui-border bg-ui-surface-muted text-left">
                        <th className="px-3 py-2 font-medium text-ui-text-muted">{t("logTime")}</th>
                        <th className="px-3 py-2 font-medium text-ui-text-muted">{th("logAddress")}</th>
                        <th className="px-3 py-2 font-medium text-ui-text-muted">{th("logRequestType")}</th>
                        <th className="px-3 py-2 font-medium text-ui-text-muted">{t("logStatus")}</th>
                        <th className="px-3 py-2 font-medium text-ui-text-muted">{t("logAuthResult")}</th>
                        <th className="px-3 py-2 font-medium text-ui-text-muted">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id} className="border-b border-ui-border last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 text-ui-text-muted">{formatDate(log.createdAt)}</td>
                          <td className="px-3 py-2 font-mono text-ui-text">{log.endpoint}</td>
                          <td className="px-3 py-2 text-ui-text-muted">{log.method}</td>
                          <td className="px-3 py-2">
                            <Badge tone={log.statusCode < 400 ? "success" : "danger"}>{log.statusCode}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={authResultTone(log.authResult)}>{authResultLabel(log.authResult)}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-ui-text-muted">{log.ipAddress || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button variant="secondary" onClick={() => setLogsPage(Math.max(1, logsPage - 1))} disabled={logsPage <= 1}>
                    {t("logPrevPage")}
                  </Button>
                  <span className="text-base text-ui-text-muted">{t("logPage", { page: logsPage })}</span>
                  <Button variant="secondary" onClick={() => setLogsPage(logsPage + 1)} disabled={logs.length < 20}>
                    {t("logNextPage")}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Add connection */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t("addConnection")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="add-connection-form" loading={submitting}>
              {t("send")}
            </Button>
          </>
        }
      >
        <form id="add-connection-form" onSubmit={handleSubmit} className="space-y-4">
          <Field label={t("connectionType")}>
            <Select value={connectionType} onChange={(e) => setConnectionType(e.target.value as ConnectionType)}>
              {CONNECTION_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {t(ct.labelKey as Parameters<typeof t>[0])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("connectionEmail")} required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("connectionEmailPlaceholder")}
              required
            />
          </Field>
          <Field label={t("permissionLabel")}>
            <Select value={permissions} onChange={(e) => setPermissions(e.target.value as ApiKeyPermission)}>
              {PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.labelKey as Parameters<typeof t>[0])}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={toRevoke !== null}
        tone="danger"
        title={t("confirmRevoke")}
        description={t("revokeWarning")}
        confirmLabel={t("revokeConnection")}
        loading={revoking}
        onConfirm={handleRevoke}
        onCancel={() => setToRevoke(null)}
      />
    </div>
  );
}
