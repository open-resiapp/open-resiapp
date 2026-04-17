"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

interface Tile {
  href: string;
  titleKey: string;
  descKey: string;
  icon: string;
  bg: string;
}

const tiles: Tile[] = [
  {
    href: "/komunita/burza",
    titleKey: "tiles.marketplace.title",
    descKey: "tiles.marketplace.desc",
    icon: "🏷️",
    bg: "bg-blue-50 hover:bg-blue-100",
  },
  {
    href: "/komunita/pomoc",
    titleKey: "tiles.help.title",
    descKey: "tiles.help.desc",
    icon: "🤝",
    bg: "bg-purple-50 hover:bg-purple-100",
  },
  {
    href: "/komunita/udalosti",
    titleKey: "tiles.events.title",
    descKey: "tiles.events.desc",
    icon: "📅",
    bg: "bg-pink-50 hover:bg-pink-100",
  },
  {
    href: "/komunita/adresar",
    titleKey: "tiles.directory.title",
    descKey: "tiles.directory.desc",
    icon: "📇",
    bg: "bg-teal-50 hover:bg-teal-100",
  },
];

export default function CommunityLandingPage() {
  const t = useTranslations("Community");

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("landing.title")}</h1>
        <p className="text-base text-gray-600 mt-1">{t("landing.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={`${tile.bg} rounded-xl border border-gray-200 p-6 transition-colors block`}
          >
            <div className="text-4xl mb-3">{tile.icon}</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {t(tile.titleKey)}
            </h2>
            <p className="text-sm text-gray-600">{t(tile.descKey)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
