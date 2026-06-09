"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState } from "react";
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
  const tc = useTranslations("Common");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [currentLogoUrl, setCurrentLogoUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.hasLogo && data?.v) {
          setCurrentLogoUrl(`/api/branding/asset/logo?v=${encodeURIComponent(data.v)}`);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
    if (!window.confirm(t("removeConfirm"))) return;
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
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3 dark:bg-gray-700" />
        <div className="h-32 bg-gray-200 rounded dark:bg-gray-700" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 space-y-6 dark:bg-gray-800 dark:shadow-black/40">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("title")}</h2>
        <p className="text-base text-gray-500 mt-1 dark:text-gray-400">{t("description")}</p>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-base ${
            message.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Current logo */}
      <div>
        <h3 className="text-sm font-medium text-gray-500 mb-2 dark:text-gray-400">{t("currentLogo")}</h3>
        <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
          {currentLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentLogoUrl} alt={t("logoAlt")} className="h-16 w-auto max-w-[220px] object-contain" />
          ) : (
            <span className="text-base text-gray-400 dark:text-gray-500">{t("noLogo")}</span>
          )}
        </div>
      </div>

      {canEdit && (
        <>
          {/* Pending preview (new selection, not yet saved) */}
          {pending && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("preview")}</h3>
              <div className="flex flex-wrap items-end gap-6">
                <div className="text-center">
                  <div className="flex items-center justify-center h-20 w-44 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pending.logoPreview} alt="" className="h-14 w-auto max-w-[160px] object-contain" />
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t("logoLabel")}</span>
                </div>
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pending.icon512Preview} alt="" className="h-20 w-20 rounded-2xl border border-gray-200 object-cover dark:border-gray-700" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t("appIconLabel")}</span>
                </div>
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pending.maskablePreview} alt="" className="h-20 w-20 rounded-full border border-gray-200 object-cover dark:border-gray-700" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t("maskableLabel")}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_LOGO_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSelect(f);
              }}
              className="block text-base text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-base file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:text-gray-300 dark:file:bg-blue-900/40 dark:file:text-blue-200"
            />
            {pending && (
              <button
                onClick={handleUpload}
                disabled={busy}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {busy ? t("uploading") : tc("save")}
              </button>
            )}
            {currentLogoUrl && !pending && (
              <button
                onClick={handleRemove}
                disabled={busy}
                className="px-5 py-3 text-red-600 hover:text-red-700 text-base font-medium transition-colors disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              >
                {busy ? t("removing") : t("remove")}
              </button>
            )}
          </div>

          <p className="text-sm text-gray-400 dark:text-gray-500">{t("formatsHint")}</p>

          {/* PWA caveat — installed home-screen icons don't update */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800/60 dark:text-amber-200">
            <strong className="font-medium">{t("pwaTitle")}</strong> {t("pwaNote")}
          </div>
        </>
      )}
    </div>
  );
}
