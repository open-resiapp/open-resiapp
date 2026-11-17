"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Field, Modal, Textarea } from "@/components/ui";

interface ResponseModalProps {
  open: boolean;
  /** Title of the post being answered (shown for context). */
  postTitle?: string;
  onClose: () => void;
  /** Resolve true on success; false keeps the dialog open with an error. */
  onSubmit: (content: string) => Promise<boolean>;
}

export default function ResponseModal({ open, postTitle, onClose, onSubmit }: ResponseModalProps) {
  const t = useTranslations("Feed.respond");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (submitting) return;
    setError(null);
    onClose();
  }

  async function handleSubmit() {
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(content.trim()).catch(() => false);
    setSubmitting(false);
    if (ok) {
      setContent("");
      onClose();
    } else {
      setError(t("failed"));
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("title")}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!content.trim()}>
            {t("send")}
          </Button>
        </>
      }
    >
      {postTitle ? <p className="mb-3 font-medium text-ui-text">{postTitle}</p> : null}
      <Field label={t("label")} error={error}>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          placeholder={t("placeholder")}
          data-autofocus=""
        />
      </Field>
    </Modal>
  );
}
