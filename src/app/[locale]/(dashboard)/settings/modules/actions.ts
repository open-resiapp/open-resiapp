"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

import {
  finalizeInstall,
  setModuleStatus,
  stageZip,
  uninstallModule,
  type StagedModule,
} from "@/lib/modules/install";
import type { Permission } from "@/lib/modules/sdk";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthenticated");
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    throw new Error("insufficient permissions");
  }
  return session;
}

export async function uploadModuleAction(
  formData: FormData
): Promise<
  | { ok: true; staged: StagedModule }
  | { ok: false; error: string }
> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "no file uploaded" };
  }
  if (file.size === 0) return { ok: false, error: "empty file" };
  if (file.size > 50 * 1024 * 1024) {
    return { ok: false, error: "file too large (50MB max)" };
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const staged = await stageZip(buf);
    return { ok: true, staged };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function approveStagedAction(
  stagingId: string,
  approved: Permission[]
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const session = await requireAdmin();
  try {
    const result = await finalizeInstall(stagingId, session.user.id, approved);
    revalidatePath("/settings/modules");
    return { ok: true, name: result.name };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function uninstallAction(
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    await uninstallModule(name);
    revalidatePath("/settings/modules");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function toggleModuleAction(
  name: string,
  next: "enabled" | "disabled"
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    await setModuleStatus(name, next);
    revalidatePath("/settings/modules");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
