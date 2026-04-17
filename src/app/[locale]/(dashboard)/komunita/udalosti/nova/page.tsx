"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import PostForm from "@/components/community/PostForm";
import type { CommunityPostType } from "@/components/community/PostCard";

const EVENT_TYPES: CommunityPostType[] = ["event"];

interface Entrance {
  id: string;
  name: string;
}

export default function NewEventPage() {
  const t = useTranslations("Community");
  const tEvents = useTranslations("Community.events");
  const router = useRouter();
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/entrances")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Entrance[]) => setEntrances(data))
      .catch(() => {});
  }, []);

  async function handleSubmit(values: {
    type: CommunityPostType;
    title: string;
    content: string;
    photoUrl: string | null;
    eventDate: string | null;
    eventLocation: string | null;
    entranceId: string | null;
  }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Nepodarilo sa uložiť");
      }
      router.push("/komunita/udalosti");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="text-sm text-gray-500 mb-1">
          <Link href="/komunita" className="hover:underline">
            {t("landing.title")}
          </Link>
          {" / "}
          <Link href="/komunita/udalosti" className="hover:underline">
            {tEvents("title")}
          </Link>
          {" / "}
          <span>{tEvents("newEvent")}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{tEvents("newEvent")}</h1>
      </div>

      <PostForm
        entrances={entrances}
        allowedTypes={EVENT_TYPES}
        defaultType="event"
        onSubmit={handleSubmit}
        submitting={submitting}
      />

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
