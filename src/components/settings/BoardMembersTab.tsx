"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import type { GovernanceModel, BoardMemberRole } from "@/types";
import { ActionMenu, Badge, Button, Card, ConfirmDialog, Field, Input, LoadingBlock, Modal, Select } from "@/components/ui";
import Notice, { type NoticeState } from "./Notice";

interface BoardMemberRow {
  id: string;
  userId: string;
  role: BoardMemberRole;
  electedAt: string;
  termEndsAt: string | null;
  isActive: boolean;
  userName: string | null;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

interface BoardMembersTabProps {
  canEdit: boolean;
}

const ROLE_LABELS_BY_MODEL: Record<GovernanceModel, BoardMemberRole[]> = {
  chairman_council: ["chairman", "council_member"],
  committee: ["committee_chairman", "committee_member"],
  chairman_only: ["chairman"],
};

export default function BoardMembersTab({ canEdit }: BoardMembersTabProps) {
  const t = useTranslations("BoardMembers");
  const th = useTranslations("SettingsHub");
  const tc = useTranslations("Common");
  const [members, setMembers] = useState<BoardMemberRow[]>([]);
  const [governanceModel, setGovernanceModel] = useState<GovernanceModel | string>("chairman_council");
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<NoticeState>(null);
  const [toRemove, setToRemove] = useState<BoardMemberRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<BoardMemberRole>("chairman");
  const [electedAt, setElectedAt] = useState("");
  const [termEndsAt, setTermEndsAt] = useState("");

  useEffect(() => {
    fetch("/api/board-members")
      .then((r) => r.json())
      .then((boardData) => {
        setMembers(boardData.members || []);
        const gm = (boardData.governanceModel || "chairman_council") as GovernanceModel;
        setGovernanceModel(gm);
        setRole((ROLE_LABELS_BY_MODEL[gm] ?? ROLE_LABELS_BY_MODEL.chairman_council)[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // The user picker is only needed once the add form opens — fetch it then.
  const openAdd = () => {
    setAdding(true);
    if (users === null) {
      fetch("/api/users")
        .then((r) => r.json())
        .then((usersData) =>
          setUsers(
            (usersData || []).map((u: UserOption) => ({ id: u.id, name: u.name, email: u.email })),
          ),
        )
        .catch(() => setUsers([]));
    }
  };

  const closeAdd = () => {
    setAdding(false);
    setUserId("");
    setElectedAt("");
    setTermEndsAt("");
  };

  const availableRoles = ROLE_LABELS_BY_MODEL[governanceModel as GovernanceModel] || [];
  const roleLabel = (r: string) => (t.has(`role_${r}`) ? t(`role_${r}`) : r);

  const handleAdd = async () => {
    if (!userId || !role || !electedAt) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/board-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role, electedAt, termEndsAt: termEndsAt || null }),
      });
      if (!res.ok) throw new Error();
      const boardData = await fetch("/api/board-members").then((r) => r.json());
      setMembers(boardData.members || []);
      closeAdd();
      setMessage({ type: "success", text: t("memberAdded") });
    } catch {
      setMessage({ type: "error", text: t("memberAddFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!toRemove) return;
    setRemoving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/board-members?id=${toRemove.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMembers((prev) => prev.filter((m) => m.id !== toRemove.id));
      setMessage({ type: "success", text: t("memberRemoved") });
    } catch {
      setMessage({ type: "error", text: t("memberRemoveFailed") });
    } finally {
      setRemoving(false);
      setToRemove(null);
    }
  };

  const isTermExpiring = (end: string | null) => {
    if (!end) return false;
    const e = new Date(end);
    const now = new Date();
    return e.getTime() - now.getTime() < 60 * 24 * 60 * 60 * 1000 && e > now;
  };
  const isTermExpired = (end: string | null) => (end ? new Date(end) < new Date() : false);

  if (loading) return <LoadingBlock />;

  const activeMembers = members.filter((m) => m.isActive);

  return (
    <Card as="section" padding="lg" aria-labelledby="board-heading" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="board-heading" className="text-xl font-semibold text-ui-text">
            {t("title")}
          </h2>
          <p className="mt-1 text-base text-ui-text-muted">{t(`model_${governanceModel}`)}</p>
        </div>
        {canEdit ? <Button onClick={openAdd}>{t("addMember")}</Button> : null}
      </div>

      <Notice state={message} />

      {activeMembers.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("noMembers")}</p>
      ) : (
        <ul className="space-y-3">
          {activeMembers.map((member) => {
            const name = member.userName || "—";
            return (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-ui-border bg-ui-surface-muted p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium text-ui-text break-words">{name}</span>
                    <Badge tone="info">{roleLabel(member.role)}</Badge>
                    {isTermExpired(member.termEndsAt) ? <Badge tone="danger">{t("termExpired")}</Badge> : null}
                    {isTermExpiring(member.termEndsAt) && !isTermExpired(member.termEndsAt) ? (
                      <Badge tone="warning">{t("termExpiring")}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-base text-ui-text-muted">
                    {t("electedOn", { date: new Date(member.electedAt).toLocaleDateString() })}
                    {member.termEndsAt
                      ? ` · ${t("termUntil", { date: new Date(member.termEndsAt).toLocaleDateString() })}`
                      : ""}
                  </p>
                </div>
                {canEdit ? (
                  <ActionMenu
                    label={th("actionsFor", { name })}
                    items={[{ label: t("remove"), tone: "danger", onSelect: () => setToRemove(member) }]}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={adding && canEdit}
        onClose={closeAdd}
        title={t("addMember")}
        footer={
          <>
            <Button variant="secondary" onClick={closeAdd}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleAdd} loading={saving} disabled={!userId || !electedAt}>
              {tc("save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("userLabel")} required>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{users === null ? tc("loading") : t("selectUser")}</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("roleLabel")} required>
            <Select value={role} onChange={(e) => setRole(e.target.value as BoardMemberRole)}>
              {availableRoles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("electedAtLabel")} required>
            <Input type="date" value={electedAt} onChange={(e) => setElectedAt(e.target.value)} />
          </Field>
          <Field label={t("termEndsAtLabel")}>
            <Input type="date" value={termEndsAt} onChange={(e) => setTermEndsAt(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={toRemove !== null}
        tone="danger"
        title={th("removeMemberTitle", { name: toRemove?.userName || "" })}
        description={th("removeMemberBody")}
        confirmLabel={t("remove")}
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => setToRemove(null)}
      />
    </Card>
  );
}
