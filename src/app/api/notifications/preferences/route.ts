import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { hasEDeliveryConsent } from "@modules/accounting/src/lib/e-delivery";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const [pref] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, session.user.id))
    .limit(1);

  return NextResponse.json({
    newPost: pref?.newPost ?? true,
    votingStarted: pref?.votingStarted ?? true,
    // Accounting AC 426 — derived boolean; opt-in, default off.
    eDeliveryConsent: hasEDeliveryConsent(
      pref
        ? { consentAt: pref.evyuctConsentAt, withdrawnAt: pref.evyuctWithdrawnAt }
        : null
    ),
  });
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json();
  const { newPost, votingStarted, eDeliveryConsent } = body;

  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, session.user.id))
    .limit(1);

  // AC 426 — grant sets a fresh consent timestamp + source; withdraw stamps
  // withdrawnAt (consentAt is kept for the audit trail). Only touched when
  // the caller sends eDeliveryConsent, so plain notification toggles don't
  // disturb the consent record.
  const consentPatch =
    eDeliveryConsent === undefined
      ? {}
      : eDeliveryConsent
        ? {
            evyuctConsentAt: sql`now()`,
            evyuctConsentSource: "owner_ui",
            evyuctWithdrawnAt: null,
          }
        : { evyuctWithdrawnAt: sql`now()` };

  if (existing) {
    const [updated] = await db
      .update(notificationPreferences)
      .set({
        newPost: newPost ?? existing.newPost,
        votingStarted: votingStarted ?? existing.votingStarted,
        ...consentPatch,
      })
      .where(eq(notificationPreferences.userId, session.user.id))
      .returning();

    return NextResponse.json({
      newPost: updated.newPost,
      votingStarted: updated.votingStarted,
      eDeliveryConsent: hasEDeliveryConsent({
        consentAt: updated.evyuctConsentAt,
        withdrawnAt: updated.evyuctWithdrawnAt,
      }),
    });
  }

  const [created] = await db
    .insert(notificationPreferences)
    .values({
      userId: session.user.id,
      newPost: newPost ?? true,
      votingStarted: votingStarted ?? true,
      // A first-time save with the consent toggle ON records consent; OFF or
      // absent leaves it null (opt-in default).
      ...(eDeliveryConsent
        ? { evyuctConsentAt: sql`now()`, evyuctConsentSource: "owner_ui" }
        : {}),
    })
    .returning();

  return NextResponse.json(
    {
      newPost: created.newPost,
      votingStarted: created.votingStarted,
      eDeliveryConsent: hasEDeliveryConsent({
        consentAt: created.evyuctConsentAt,
        withdrawnAt: created.evyuctWithdrawnAt,
      }),
    },
    { status: 201 }
  );
}
