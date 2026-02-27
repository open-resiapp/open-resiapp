"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types";
import { hasPermission } from "@/lib/permissions";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: Parameters<typeof hasPermission>[1];
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/board", label: "Nástenka", icon: "📋" },
  { href: "/voting", label: "Hlasovanie", icon: "🗳️" },
  { href: "/owners", label: "Vlastníci", icon: "👥", permission: "manageUsers" },
  { href: "/settings", label: "Nastavenia", icon: "⚙️", permission: "viewSettings" },
];

export default function Sidebar({
  role,
  isOpen,
  onClose,
}: {
  role: UserRole;
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  const visibleItems = navItems.filter(
    (item) => !item.permission || hasPermission(role, item.permission)
  );

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transform transition-transform lg:translate-x-0 lg:static lg:z-auto ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-blue-600">BytováApp</h2>
          <p className="text-sm text-gray-500 mt-1">Správa bytového domu</p>
        </div>

        <nav className="p-4 space-y-1">
          {visibleItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
