import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listInstalledModules } from "@/lib/modules/install";
import type { UserRole } from "@/types";

import ModulesAdminClient from "./ModulesAdminClient";

export default async function ModulesAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    redirect("/");
  }

  const role = session.user.role as UserRole;
  const installed = await listInstalledModules();
  return (
    <ModulesAdminClient
      installed={installed}
      canManageUsers={hasPermission(role, "manageUsers")}
    />
  );
}
