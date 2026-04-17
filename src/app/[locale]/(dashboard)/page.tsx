"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

function StatCard({
  title,
  value,
  href,
  color,
}: {
  title: string;
  value: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className={`text-sm font-medium ${color} mb-1`}>{title}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </Link>
  );
}

interface EventData {
  id: string;
  title: string;
  eventDate: string | null;
  eventLocation: string | null;
  entranceName: string | null;
  rsvp?: { yes: number; maybe: number; no: number };
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations("Dashboard");
  const tEvents = useTranslations("Community.events");
  const format = useFormatter();
  const role = (session?.user?.role || "owner") as UserRole;
  const [events, setEvents] = useState<EventData[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  const canSeeCommunity = hasPermission(role, "viewCommunity");

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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {t("welcome", { name: session?.user?.name ?? "" })}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title={t("boardTitle")}
          value={t("boardValue")}
          href="/board"
          color="text-blue-600"
        />

        <StatCard
          title={t("votingTitle")}
          value={t("votingValue")}
          href="/voting"
          color="text-green-600"
        />

        {hasPermission(role, "manageUsers") && (
          <StatCard
            title={t("ownersTitle")}
            value={t("ownersValue")}
            href="/owners"
            color="text-purple-600"
          />
        )}
      </div>

      {canSeeCommunity && (
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {t("upcomingEvents")}
            </h2>
            <Link
              href="/komunita/udalosti"
              className="text-sm text-blue-600 hover:underline"
            >
              {t("viewAll")}
            </Link>
          </div>

          {loadingEvents ? (
            <p className="text-sm text-gray-500">{t("loadingEvents")}</p>
          ) : events.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center">
              <p className="text-sm text-gray-600 mb-3">
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
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow block"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">📅</span>
                    {event.eventDate && (
                      <span className="text-sm font-medium text-pink-700">
                        {format.dateTime(new Date(event.eventDate), {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1 line-clamp-2">
                    {event.title}
                  </h3>
                  {event.eventLocation && (
                    <p className="text-sm text-gray-600 mb-2 line-clamp-1">
                      {event.eventLocation}
                    </p>
                  )}
                  {event.rsvp && (
                    <p className="text-sm text-gray-500">
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
