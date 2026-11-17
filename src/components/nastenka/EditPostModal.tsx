"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Field, Input, Modal, Textarea } from "@/components/ui";
import type { PostCategory } from "@/types";

interface EditPostModalProps {
  post: {
    id: string;
    title: string;
    content: string;
    category: PostCategory;
    isPinned: boolean;
  };
  onClose: () => void;
  onSaved: () => void;
}

// Edit a board notice (PATCH /api/posts/:id). Same three fields as the create
// form: title, text, "Dôležité" (= category urgent + pinned).
export default function EditPostModal({ post, onClose, onSaved }: EditPostModalProps) {
  const t = useTranslations("Feed");
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [important, setImportant] = useState(post.category === "urgent");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim() || !content.trim()) {
      setError(t("create.error.required"));
      return;
    }
    setSaving(true);
    setError(null);
    const wasUrgent = post.category === "urgent";
    const body: Record<string, unknown> = { title: title.trim(), content: content.trim() };
    if (important && !wasUrgent) {
      body.category = "urgent";
      body.isPinned = true;
    } else if (!important && wasUrgent) {
      body.category = "info";
      body.isPinned = false;
    }
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(t("edit.failed"));
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title={t("edit.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("create.cancel")}
          </Button>
          <Button onClick={save} loading={saving}>
            {t("edit.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("create.field.title")} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
        </Field>
        <Field label={t("create.field.text")} required>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
        </Field>
        <ImportantCheckbox checked={important} onChange={setImportant} />
        {error ? (
          <p role="alert" className="text-base font-medium text-ui-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** "Dôležité" checkbox shared by the create and edit forms. */
export function ImportantCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations("Feed.create.field");
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-ui-border p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--ui-primary)]"
      />
      <span>
        <span className="block text-base font-medium text-ui-text">{t("important")}</span>
        <span className="block text-base text-ui-text-muted">{t("importantHint")}</span>
      </span>
    </label>
  );
}
