import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { notificationPreferences, users } from "@/db/schema";
import { redirect } from "@/i18n/navigation";
import { listUserFlats } from "@/lib/legacy-compat";
import { hasEDeliveryConsent } from "@modules/accounting/src/lib/e-delivery";
import ProfileView from "@/components/profile/ProfileView";

// Account data comes from the shell (useShell) inside ProfileView; the flats
// and the stored notification preferences are loaded here, on the server,
// instead of client fetches on mount. Defaults mirror /api/notifications/
// preferences: vote + notice notifications on, e-delivery consent opt-in.
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) {
    redirect({ href: "/login", locale });
    return null;
  }
  const userId = session.user.id;

  const [flatRows, [pref], [self]] = await Promise.all([
    listUserFlats(userId),
    db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1),
    // BYT-20261118-003: the owner sees their own last sign-in (only their own).
    db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ]);

  return (
    <ProfileView
      lastLoginAt={self?.lastLoginAt ? self.lastLoginAt.toISOString() : null}
      flats={flatRows.map((f) => ({
        id: f.flatId,
        flatNumber: f.flatNumber,
        entranceName: f.entranceName,
      }))}
      prefs={{
        newPost: pref?.newPost ?? true,
        votingStarted: pref?.votingStarted ?? true,
        eDeliveryConsent: hasEDeliveryConsent(
          pref ? { consentAt: pref.evyuctConsentAt, withdrawnAt: pref.evyuctWithdrawnAt } : null,
        ),
      }}
    />
  );
}
