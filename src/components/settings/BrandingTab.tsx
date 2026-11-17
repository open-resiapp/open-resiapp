"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { useShell } from "@/components/layout/ShellContext";
import { Button, Card, ConfirmDialog, Icon } from "@/components/ui";
import Notice, { type NoticeState } from "./Notice";
import {
  ACCEPTED_LOGO_MIME,
  ACCEPTED_LOGO_ACCEPT,
  MAX_LOGO_SIZE,
  MAX_LOGO_DIM,
  ICON_SIZE_192,
  ICON_SIZE_512,
  APPLE_TOUCH_SIZE,
  MASKABLE_SAFE_RATIO,
  APPLE_SAFE_RATIO,
  ICON_BG,
} from "@/lib/branding";

// BYT-20260512-008 — white-label logo upload + PWA icon generation.
//
// The square PWA icon variants (192 / 512 / maskable / apple-touch) are
// generated HERE, in the admin's browser via <canvas>, so the server needs no
// image-processing dependency. The original logo + all four PNGs are sent in
// one multipart POST.

interface PendingUpload {
  logo: File;
  logoPreview: string;
  icon512Preview: string;
  maskablePreview: string;
  icon192: Blob;
  icon512: Blob;
  maskable: Blob;
  apple: Blob;
}

/** Draw an image centred + contained on a square PNG canvas. */
function squarePng(
  img: HTMLImageElement,
  size: number,
  opaque: boolean,
  safeRatio: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no-2d-context"));
  if (opaque) {
    ctx.fillStyle = ICON_BG;
    ctx.fillRect(0, 0, size, size);
  }
  const box = size * safeRatio;
  const scale = Math.min(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob-failed"))),
      "image/png"
    )
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load-failed"));
    img.src = src;
  });
}

export default function BrandingTab({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("Branding");
  const th = useTranslations("SettingsHub");
  const tc = useTranslations("Common");
  const router = useRouter();
  const shell = useShell();
  const fileRef = useRef<HTMLInputElement>(null);

  // Logo URL comes from the server shell — no extra /api/branding fetch.
  const [currentLogoUrl, setCurrentLogoUrl] = useState<string | null>(shell.branding.logoUrl);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<NoticeState>(null);

  // Revoke object URLs when the pending preview is replaced/cleared.
  useEffect(() => {
    return () => {
      if (pending) {
        URL.revokeObjectURL(pending.logoPreview);
        URL.revokeObjectURL(pending.icon512Preview);
        URL.revokeObjectURL(pending.maskablePreview);
      }
    };
  }, [pending]);

  async function handleSelect(file: File) {
    setMessage(null);
    if (!ACCEPTED_LOGO_MIME[file.type]) {
      setMessage({ type: "error", text: t("errorType") });
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setMessage({ type: "error", text: t("errorSize") });
      return;
    }
    setBusy(true);
    try {
      const objUrl = URL.createObjectURL(file);
      const img = await loadImage(objUrl);
      if (img.width > MAX_LOGO_DIM || img.height > MAX_LOGO_DIM) {
        URL.revokeObjectURL(objUrl);
        setMessage({ type: "error", text: t("errorDim") });
        return;
      }
      const [icon192, icon512, maskable, apple] = await Promise.all([
        squarePng(img, ICON_SIZE_192, false, 1),
        squarePng(img, ICON_SIZE_512, false, 1),
        squarePng(img, ICON_SIZE_512, true, MASKABLE_SAFE_RATIO),
        squarePng(img, APPLE_TOUCH_SIZE, true, APPLE_SAFE_RATIO),
      ]);
      setPending({
        logo: file,
        logoPreview: objUrl,
        icon512Preview: URL.createObjectURL(icon512),
        maskablePreview: URL.createObjectURL(maskable),
        icon192,
        icon512,
        maskable,
        apple,
      });
    } catch {
      setMessage({ type: "error", text: t("errorProcess") });
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("logo", pending.logo);
      fd.append("icon192", pending.icon192, "icon192.png");
      fd.append("icon512", pending.icon512, "icon512.png");
      fd.append("maskable", pending.maskable, "maskable.png");
      fd.append("apple", pending.apple, "apple.png");
      const res = await fetch("/api/branding", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      const data = await res.json();
      setCurrentLogoUrl(`/api/branding/asset/logo?v=${encodeURIComponent(data.v)}`);
      setPending(null);
      if (fileRef.current) fileRef.current.value = "";
      setMessage({ type: "success", text: t("saved") });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: (err instanceof Error && err.message) || t("uploadFailed"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/branding", { method: "DELETE" });
      if (!res.ok) throw new Error("");
      setCurrentLogoUrl(null);
      setPending(null);
      if (fileRef.current) fileRef.current.value = "";
      setMessage({ type: "success", text: t("removed") });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: t("removeFailed") });
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  return (
    <Card as="section" padding="lg" aria-labelledby="branding-heading" className="space-y-5">
      <div>
        <h2 id="branding-heading" className="text-xl font-semibold text-ui-text">
          {t("title")}
        </h2>
        <p className="mt-1 text-base text-ui-text-muted">{t("description")}</p>
      </div>

      <Notice state={message} />

      <div>
        <h3 className="mb-2 text-base font-medium text-ui-text">{t("currentLogo")}</h3>
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-ui-border-strong bg-ui-surface-muted">
          {currentLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentLogoUrl} alt={t("logoAlt")} className="h-16 w-auto max-w-[220px] object-contain" />
          ) : (
            <span className="text-base text-ui-text-muted">{t("noLogo")}</span>
          )}
        </div>
      </div>

      {canEdit ? (
        <>
          {pending ? (
            <div className="space-y-3">
              <h3 className="text-base font-medium text-ui-text">{t("preview")}</h3>
              <div className="flex flex-wrap items-end gap-6">
                <div className="text-center">
                  <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-ui-border bg-ui-surface-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pending.logoPreview} alt="" className="h-14 w-auto max-w-[160px] object-contain" />
                  </div>
                  <span className="text-base text-ui-text-muted">{t("logoLabel")}</span>
                </div>
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pending.icon512Preview} alt="" className="h-20 w-20 rounded-2xl border border-ui-border object-cover" />
                  <span className="text-base text-ui-text-muted">{t("appIconLabel")}</span>
                </div>
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pending.maskablePreview} alt="" className="h-20 w-20 rounded-full border border-ui-border object-cover" />
                  <span className="text-base text-ui-text-muted">{t("maskableLabel")}</span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {/* Visually hidden native input + kit button: 44 px target, same behaviour. */}
            <input
              ref={fileRef}
              id="logo-file"
              type="file"
              accept={ACCEPTED_LOGO_ACCEPT}
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSelect(f);
              }}
            />
            <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={20} />
              {currentLogoUrl || pending ? th("logoChoose") : th("logoUpload")}
            </Button>
            {pending ? (
              <Button onClick={handleUpload} loading={busy}>
                {busy ? t("uploading") : tc("save")}
              </Button>
            ) : null}
            {currentLogoUrl && !pending ? (
              <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>
                <Icon name="trash" size={20} />
                {t("remove")}
              </Button>
            ) : null}
          </div>

          <p className="text-base text-ui-text-muted">{t("formatsHint")}</p>

          <p className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 p-3 text-base text-ui-text">
            <strong className="font-medium">{t("pwaTitle")}</strong> {t("pwaNote")}
          </p>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmRemove}
        tone="danger"
        title={t("remove")}
        description={t("removeConfirm")}
        confirmLabel={t("remove")}
        loading={busy}
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  );
}
