// Thin client wrappers around the existing owner endpoints. Request bodies are
// exactly what the old owners pages sent; nothing here is new server API.

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "";
}

/**
 * Link a self-registration to an owner record and admit it.
 * 1. POST /api/admin/shell-users/[shellId]/merge — moves the record's flats,
 *    shares and history onto the registered account, deletes the record.
 * 2. POST /api/registrations/[userId]/approve {flatId: null, role: "owner"} —
 *    the merge alone leaves the account in status 'pending' (it would keep
 *    counting in the nav badge and could not use the app). No flat is passed:
 *    the flats came from the merge.
 * Returns null on success, otherwise an error message ("" = generic).
 */
export async function mergeAndApprove(shellId: string, userId: string): Promise<string | null> {
  const merged = await fetch(`/api/admin/shell-users/${shellId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId: userId }),
  });
  if (!merged.ok) return errorOf(merged);
  return approveRegistration(userId, null, "owner");
}

/** POST /api/registrations/[id]/approve {flatId, role}. */
export async function approveRegistration(
  userId: string,
  flatId: string | null,
  role: string
): Promise<string | null> {
  const res = await fetch(`/api/registrations/${userId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flatId, role }),
  });
  return res.ok ? null : errorOf(res);
}

/** POST /api/registrations/[id]/reject. */
export async function rejectRegistration(userId: string): Promise<string | null> {
  const res = await fetch(`/api/registrations/${userId}/reject`, { method: "POST" });
  return res.ok ? null : errorOf(res);
}
