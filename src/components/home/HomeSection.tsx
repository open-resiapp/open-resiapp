import type { ComponentProps, ReactNode } from "react";

import { Icon, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";

// Labelled block of the home / Dom screens: a heading with an optional
// text link on the right ("Všetky oznamy"). Server component.

export function HomeSection({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: ComponentProps<typeof Link>["href"]; label: string };
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-ui-text">{title}</h2>
        {link ? (
          <Link
            href={link.href}
            className={cn(
              "inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-base font-medium text-ui-text underline underline-offset-4",
              focusRing
            )}
          >
            {link.label}
            <Icon name="chevronRight" size={20} />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
