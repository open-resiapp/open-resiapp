// Thin client wrappers around the existing owner endpoints. Request bodies are
// exactly what the old owners pages sent; nothing here is new server API.

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "";
}

/**
 * Link a self-registration to an owner record and admit it, atomically:
 * POST /api/admin/shell-users/[shellId]/merge {targetUserId, approve: true}
 * moves the record's flats, shares and history onto the registered account,
 * deletes the record and approves the account as owner (no flat — the flats
 * came from the merge) in one transaction. Without the approval the account
 * would stay 'pending'; if it is no longer pending, nothing is merged.
 * Returns null on success, otherwise an error message ("" = generic).
 */
export async function mergeAndApprove(shellId: string, userId: string): Promise<string | null> {
  const merged = await fetch(`/api/admin/shell-users/${shellId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId: userId, approve: true }),
  });
  return merged.ok ? null : errorOf(merged);
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
