"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import DirectoryEditModal, { type DirectoryValues } from "@/components/community/DirectoryEditModal";
import { useShell } from "@/components/layout/ShellContext";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  LoadingBlock,
  PageHeader,
} from "@/components/ui";
import { hasPermission } from "@/lib/permissions";

// Neighbours' directory (read-only list of opt-in entries), linked from Dom.
// The feed merge (BYT-20261117-002 Phase 5) left it at /komunita/adresar.

interface DirectoryEntry {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  skills: string | null;
  sharePhone: boolean;
  shareEmail: boolean;
  flatNumber: string | null;
  entranceName: string | null;
}

const EMPTY_VALUES: DirectoryValues = { sharePhone: false, shareEmail: false, note: "", skills: "" };

export default function DirectoryPage() {
  const tDir = useTranslations("Community.directory");
  const t = useTranslations("Feed.directory");
  const { user } = useShell();
  const canModerate = hasPermission(user.role, "moderateCommunityResponse");

  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [toDelete, setToDelete] = useState<DirectoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/community/directory");
      if (res.ok) setEntries(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const myEntry = useMemo(() => entries.find((e) => e.userId === user.id) ?? null, [entries, user.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.name, e.skills ?? "", e.note ?? "", e.flatNumber ?? "", e.entranceName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [entries, search]);

  async function handleSave(values: DirectoryValues): Promise<boolean> {
    const res = await fetch("/api/community/directory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) await fetchEntries();
    return res.ok;
  }

  async function handleDeleteOwn(): Promise<boolean> {
    const res = await fetch("/api/community/directory", { method: "DELETE" });
    if (res.ok) await fetchEntries();
    return res.ok;
  }

  async function handleModeratorDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/community/directory/${toDelete.userId}`, { method: "DELETE" }).catch(
      () => null
    );
    setDeleting(false);
    setToDelete(null);
    if (res?.ok) await fetchEntries();
    else setError(t("failed"));
  }

  // One button only: "share" when the user has no entry yet, "edit" otherwise.
  const editLabel = myEntry ? tDir("editMine") : t("shareMine");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={tDir("title")}
        description={tDir("subtitle")}
        backHref="/dom"
        backLabel={t("backToHouse")}
        actions={
          <Button onClick={() => setShowEdit(true)}>
            <Icon name={myEntry ? "edit" : "users"} size={20} />
            {editLabel}
          </Button>
        }
      />

      {entries.length > 0 ? (
        <div className="mb-5">
          <Field label={t("search")}>
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tDir("searchPlaceholder")}
            />
          </Field>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 text-base font-medium text-ui-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <LoadingBlock />
      ) : entries.length === 0 ? (
        <EmptyState icon="users" title={t("emptyTitle")} description={t("emptyText")} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" title={t("noMatch")} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((e) => (
            <Card as="li" key={e.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ui-text break-words">{e.name}</h2>
                  <p className="text-base text-ui-text-muted">
                    {[e.flatNumber && `${tDir("flat")} ${e.flatNumber}`, e.entranceName]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                {canModerate && e.userId !== user.id ? (
                  <Button variant="ghost" className="shrink-0 text-ui-danger" onClick={() => setToDelete(e)}>
                    <Icon name="trash" size={20} />
                    {t("remove")}
                  </Button>
                ) : null}
              </div>
              <div className="space-y-1 text-base text-ui-text">
                {e.phone ? (
                  <p>
                    <span className="text-ui-text-muted">{t("phone")}: </span>
                    <a href={`tel:${e.phone}`} className="font-medium text-ui-primary underline-offset-2 hover:underline">
                      {e.phone}
                    </a>
                  </p>
                ) : null}
                {e.email ? (
                  <p className="break-all">
                    <span className="text-ui-text-muted">{t("email")}: </span>
                    <a href={`mailto:${e.email}`} className="font-medium text-ui-primary underline-offset-2 hover:underline">
                      {e.email}
                    </a>
                  </p>
                ) : null}
                {e.skills ? (
                  <p>
                    <span className="text-ui-text-muted">{tDir("skills")}: </span>
                    {e.skills}
                  </p>
                ) : null}
                {e.note ? <p className="text-ui-text-muted">{e.note}</p> : null}
              </div>
            </Card>
          ))}
        </ul>
      )}

      {showEdit ? (
        <DirectoryEditModal
          initial={
            myEntry
              ? {
                  sharePhone: myEntry.sharePhone,
                  shareEmail: myEntry.shareEmail,
                  note: myEntry.note ?? "",
                  skills: myEntry.skills ?? "",
                }
              : EMPTY_VALUES
          }
          hasEntry={!!myEntry}
          onClose={() => setShowEdit(false)}
          onSave={handleSave}
          onDelete={handleDeleteOwn}
        />
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        tone="danger"
        title={t("removeTitle")}
        description={t("removeConsequence", { name: toDelete?.name ?? "" })}
        confirmLabel={t("remove")}
        loading={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={handleModeratorDelete}
      />
    </div>
  );
}
