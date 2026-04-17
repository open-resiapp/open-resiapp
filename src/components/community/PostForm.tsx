"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import EntranceScopePicker from "./EntranceScopePicker";
import type { CommunityPostType } from "./PostCard";

interface Entrance {
  id: string;
  name: string;
}

interface PostFormProps {
  defaultType?: CommunityPostType;
  allowedTypes?: CommunityPostType[];
  entrances: Entrance[];
  onSubmit: (values: {
    type: CommunityPostType;
    title: string;
    content: string;
    photoUrl: string | null;
    eventDate: string | null;
    eventLocation: string | null;
    entranceId: string | null;
  }) => Promise<void>;
  submitting?: boolean;
}

const ALL_TYPES: CommunityPostType[] = [
  "sale",
  "free",
  "borrow",
  "help_request",
  "help_offer",
  "event",
];

export default function PostForm({
  defaultType = "sale",
  allowedTypes = ALL_TYPES,
  entrances,
  onSubmit,
  submitting,
}: PostFormProps) {
  const t = useTranslations("Community");
  const [type, setType] = useState<CommunityPostType>(defaultType);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [entranceId, setEntranceId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowedTypes.includes(type)) setType(allowedTypes[0]);
  }, [allowedTypes, type]);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t("photoTooLarge"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", "community-posts");
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");
      const { url } = await res.json();
      setPhotoUrl(url);
    } catch {
      setError(t("photoUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !content.trim()) {
      setError(t("titleAndContentRequired"));
      return;
    }
    if (type === "event" && (!eventDate || !eventLocation)) {
      setError(t("eventNeedsDateAndLocation"));
      return;
    }
    await onSubmit({
      type,
      title: title.trim(),
      content: content.trim(),
      photoUrl,
      eventDate: type === "event" ? eventDate : null,
      eventLocation: type === "event" ? eventLocation : null,
      entranceId,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("form.type")}
        </label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CommunityPostType)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
        >
          {allowedTypes.map((typeKey) => (
            <option key={typeKey} value={typeKey}>
              {t(`type.${typeKey}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("form.title")}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("form.content")}
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
        />
      </div>

      {type === "event" && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("form.eventDate")}
            </label>
            <input
              type="datetime-local"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("form.eventLocation")}
            </label>
            <input
              type="text"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              maxLength={255}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("form.entrance")}
        </label>
        <EntranceScopePicker
          entrances={entrances}
          value={entranceId}
          onChange={setEntranceId}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("form.photo")}
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handlePhoto}
          disabled={uploading}
          className="block text-sm"
        />
        {uploading && <p className="text-sm text-gray-500 mt-1">{t("uploading")}</p>}
        {photoUrl && (
          <div className="mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="" className="max-h-32 rounded-lg" />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || uploading}
        className="w-full px-4 py-3 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
      >
        {submitting ? t("sending") : t("form.submit")}
      </button>
    </form>
  );
}
