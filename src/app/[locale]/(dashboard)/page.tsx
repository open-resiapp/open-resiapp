"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/navigation";
import PostCard from "@/components/nastenka/PostCard";
import { hasPermission } from "@/lib/permissions";
import type { UserRole, PostCategory } from "@/types";

interface EventData {
  id: string;
  title: string;
  eventDate: string | null;
  eventLocation: string | null;
  entranceName: string | null;
  rsvp?: { yes: number; maybe: number; no: number };
}

interface PostData {
  id: string;
  title: string;
  content: string;
  category: PostCategory;
  isPinned: boolean;
  createdAt: string;
  entranceName: string | null;
  author: { id: string; name: string } | null;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations("Dashboard");
  const tEvents = useTranslations("Community.events");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const role = (session?.user?.role || "owner") as UserRole;
  const [events, setEvents] = useState<EventData[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);

  const canSeeCommunity = hasPermission(role, "viewCommunity");

  useEffect(() => {
    fetch("/api/posts")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PostData[]) => setPosts(data.slice(0, 3)))
      .catch(() => {})
      .finally(() => setLoadingPosts(false));
  }, []);

  useEffect(() => {
    if (!canSeeCommunity) {
      setLoadingEvents(false);
      return;
    }
    fetch("/api/community/posts?type=event")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: EventData[]) => {
        const now = Date.now();
        const upcoming = data
          .filter((e) => e.eventDate && new Date(e.eventDate).getTime() >= now)
          .slice(0, 3);
        setEvents(upcoming);
      })
      .catch(() => {})
      .finally(() => setLoadingEvents(false));
  }, [canSeeCommunity]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6 dark:text-gray-100">
        {t("welcome", { name: session?.user?.name ?? "" })}
      </h1>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("recentPosts")}
          </h2>
          <Link
            href="/board"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("viewAll")}
          </Link>
        </div>

        {loadingPosts ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("loadingPosts")}</p>
        ) : posts.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center dark:bg-gray-800 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-300">{t("noPosts")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                title={post.title}
                content={post.content}
                category={post.category}
                authorName={post.author?.name || tCommon("unknown")}
                createdAt={post.createdAt}
                isPinned={post.isPinned}
                entranceName={post.entranceName}
              />
            ))}
          </div>
        )}
      </section>

      {canSeeCommunity && (
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("upcomingEvents")}
            </h2>
            <Link
              href="/komunita/udalosti"
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              {t("viewAll")}
            </Link>
          </div>

          {loadingEvents ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("loadingEvents")}</p>
          ) : events.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center dark:bg-gray-800 dark:border-gray-700">
              <p className="text-sm text-gray-600 mb-3 dark:text-gray-300">
                {t("noUpcomingEvents")}
              </p>
              <Link
                href="/komunita/udalosti/nova"
                className="inline-block px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                {tEvents("newEvent")}
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((event) => (
                <Link
                  key={event.id}
                  href="/komunita/udalosti"
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow block dark:bg-gray-800 dark:border-gray-700"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">📅</span>
                    {event.eventDate && (
                      <span className="text-sm font-medium text-pink-700 dark:text-pink-300">
                        {format.dateTime(new Date(event.eventDate), {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1 line-clamp-2 dark:text-gray-100">
                    {event.title}
                  </h3>
                  {event.eventLocation && (
                    <p className="text-sm text-gray-600 mb-2 line-clamp-1 dark:text-gray-300">
                      {event.eventLocation}
                    </p>
                  )}
                  {event.rsvp && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {tEvents("counts", {
                        yes: event.rsvp.yes,
                        maybe: event.rsvp.maybe,
                        no: event.rsvp.no,
                      })}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
