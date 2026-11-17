import { getTranslations } from "next-intl/server";

import { Card, Icon, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import type { BoardContact } from "@/lib/home.server";

// Board contacts (name, role, tel:/mailto: links) — shared by Domov and Dom.
// Data from listBoardContacts (same board_members population community-info
// shows). Server component.

const linkClass = cn(
  "inline-flex min-h-11 items-center gap-2 rounded-lg px-2 -ml-2 text-base font-medium text-ui-text underline underline-offset-4 break-all",
  focusRing
);

export async function BoardContacts({ contacts }: { contacts: BoardContact[] }) {
  const t = await getTranslations("Home.contacts");
  const tRole = await getTranslations("CommunityInfo.role");

  if (contacts.length === 0) {
    return (
      <Card>
        <p className="text-base text-ui-text-muted">{t("empty")}</p>
      </Card>
    );
  }

  return (
    <Card as="section" padding="none">
      <ul className="divide-y divide-ui-border">
        {contacts.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <p className="text-base font-semibold text-ui-text">{c.name}</p>
            <p className="text-base text-ui-text-muted">{tRole(c.role)}</p>
            {c.phone || c.email ? (
              <div className="mt-1 flex flex-col gap-0 sm:flex-row sm:flex-wrap sm:gap-x-4">
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className={linkClass}>
                    <Icon name="phone" size={20} />
                    {t("call", { phone: c.phone })}
                  </a>
                ) : null}
                {c.email ? (
                  <a href={`mailto:${c.email}`} className={linkClass}>
                    <Icon name="mail" size={20} />
                    {c.email}
                  </a>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
