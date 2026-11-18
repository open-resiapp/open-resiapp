/**
 * BYT-20261118-005 — board-internal documents / owner folder negative checks
 * (run: `pnpm test:documents-visibility`).
 *
 * Self-contained tsx script — NO database. Guards the pure pieces every read
 * path goes through:
 *   - canSeeDocPath (list, download, project docs + count, post attachments,
 *     feed, MCP, e-mail send) — full-set assertions, not presence checks;
 *   - the /api/uploads category allowlist (G1 storage bypass);
 *   - signedUrl key policy + a source scan that no caller signs a document key;
 *   - a source scan that no read path calls canSeeDocPath without the subject.
 * DB-backed paths (404 + no access-log row, documentCount, unit-note bodies in
 * responses) are listed at the bottom as manual checks.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  canSeeDocPath,
  isBoardOnDocPath,
  type DocumentAudience,
  type UserMembershipLite,
} from "@/lib/documents";
import { canReadUploadCategory, canWriteUploadCategory } from "@/lib/uploads-access";
import { assertSignableKey, isProxyOnlyKey } from "@/lib/storage-keys";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function sameSet(a: string[], b: string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// ── Fixture: one building, two units ─────────────────────────────────────
const ROOT = "/root/";
const UNIT_1 = "/root/u1/"; // owned by A and co-owner B
const UNIT_2 = "/root/u2/"; // owned by neighbour N

type Person = { id: string; mems: UserMembershipLite[] };
const board: Person = { id: "board", mems: [{ entityPath: ROOT, role: "admin" }] };
const A: Person = { id: "A", mems: [{ entityPath: UNIT_1, role: "owner" }] };
const B: Person = { id: "B", mems: [{ entityPath: UNIT_1, role: "owner" }] };
const N: Person = { id: "N", mems: [{ entityPath: UNIT_2, role: "owner" }] };
const tenant: Person = { id: "T", mems: [{ entityPath: UNIT_1, role: "tenant" }] };
const caretaker: Person = { id: "C", mems: [{ entityPath: ROOT, role: "caretaker" }] };
// Board member who is also the subject owner (Notes #2 — admin role wins).
const boardOwnerA: Person = {
  id: "A",
  mems: [
    { entityPath: ROOT, role: "admin" },
    { entityPath: UNIT_1, role: "owner" },
  ],
};
// After A sells: C2 owns unit 1, A's membership is archived (not loaded).
const nextOwner: Person = { id: "C2", mems: [{ entityPath: UNIT_1, role: "owner" }] };
const everyone = { board, A, B, N, tenant, caretaker, nextOwner };

type Doc = {
  id: string;
  path: string;
  audience: DocumentAudience;
  subjectUserId: string | null;
};
const DOCS: Doc[] = [
  { id: "root-admin", path: ROOT, audience: "admin", subjectUserId: null },
  { id: "unit-admin", path: UNIT_1, audience: "admin", subjectUserId: null },
  { id: "subjectA-admin", path: UNIT_1, audience: "admin", subjectUserId: "A" },
  { id: "subjectA-owner", path: UNIT_1, audience: "owner", subjectUserId: "A" },
  { id: "root-owner", path: ROOT, audience: "owner", subjectUserId: null },
  { id: "root-resident", path: ROOT, audience: "resident", subjectUserId: null },
  { id: "unit1-owner", path: UNIT_1, audience: "owner", subjectUserId: null },
  { id: "unit2-owner", path: UNIT_2, audience: "owner", subjectUserId: null },
];

function visibleIds(p: Person): string[] {
  return DOCS.filter((d) =>
    canSeeDocPath(p.mems, d.path, d.audience, {
      viewerId: p.id,
      subjectUserId: d.subjectUserId,
    })
  ).map((d) => d.id);
}

console.log("resolver — exact visible set per role (AC: full id set, not presence)");
const expected: Record<keyof typeof everyone, string[]> = {
  board: DOCS.map((d) => d.id),
  A: ["subjectA-owner", "root-owner", "root-resident", "unit1-owner"],
  B: ["root-owner", "root-resident", "unit1-owner"],
  N: ["root-owner", "root-resident", "unit2-owner"],
  tenant: ["root-resident"],
  caretaker: ["root-resident"],
  nextOwner: ["root-owner", "root-resident", "unit1-owner"],
};
for (const [name, person] of Object.entries(everyone)) {
  const got = visibleIds(person);
  check(
    `${name} sees exactly ${expected[name as keyof typeof everyone].length} docs`,
    sameSet(got, expected[name as keyof typeof everyone]),
    `got [${got.join(", ")}]`
  );
}

console.log("resolver — board-only never reaches non-board, incl. the subject");
for (const id of ["root-admin", "unit-admin", "subjectA-admin"]) {
  for (const [name, person] of Object.entries(everyone)) {
    if (name === "board") continue;
    check(`${id} hidden from ${name}`, !visibleIds(person).includes(id));
  }
}

console.log("resolver — owner folder is per person, not per unit");
check("co-owner B does not see A's folder doc", !visibleIds(B).includes("subjectA-owner"));
check("next owner does not see A's folder doc", !visibleIds(nextOwner).includes("subjectA-owner"));
check("neighbour does not see A's folder doc", !visibleIds(N).includes("subjectA-owner"));

console.log("resolver — board member who is the subject (Notes #2: admin wins)");
check(
  "board+subject sees own board-only doc",
  visibleIds(boardOwnerA).includes("subjectA-admin")
);

console.log("resolver — fail closed without a viewer");
check(
  "subject doc with viewerId mismatch is hidden",
  !canSeeDocPath(A.mems, UNIT_1, "owner", { viewerId: "", subjectUserId: "A" })
);

console.log("board gate (visibility PATCH / audit / send)");
check("board is board on unit line", isBoardOnDocPath(board.mems, UNIT_1));
check("caretaker is not board", !isBoardOnDocPath(caretaker.mems, ROOT));
check("owner A is not board", !isBoardOnDocPath(A.mems, UNIT_1));

console.log("project documentCount (G2) — counts only visible docs");
// 3 visible + 2 board-only in one project.
const project: Doc[] = [
  { id: "p1", path: ROOT, audience: "owner", subjectUserId: null },
  { id: "p2", path: ROOT, audience: "owner", subjectUserId: null },
  { id: "p3", path: ROOT, audience: "resident", subjectUserId: null },
  { id: "p4", path: ROOT, audience: "admin", subjectUserId: null },
  { id: "p5", path: UNIT_1, audience: "admin", subjectUserId: null },
];
const count = (p: Person) =>
  project.filter((d) =>
    canSeeDocPath(p.mems, d.path, d.audience, { viewerId: p.id, subjectUserId: d.subjectUserId })
  ).length;
check("owner count = 3", count(A) === 3, `got ${count(A)}`);
check("board count = 5", count(board) === 5, `got ${count(board)}`);

console.log("/api/uploads allowlist (G1)");
for (const role of ["admin", "owner", "tenant", "vote_counter", "caretaker"] as const) {
  for (const cat of ["documents", "accounting", "branding", "../documents", ""]) {
    check(`${role} cannot read "${cat}" via /api/uploads`, !canReadUploadCategory(cat, role));
    check(`${role} cannot write "${cat}" via /api/uploads`, !canWriteUploadCategory(cat, role));
  }
}
check("owner reads community-posts", canReadUploadCategory("community-posts", "owner"));
check("owner cannot read paper-votes", !canReadUploadCategory("paper-votes", "owner"));
check("vote_counter reads paper-votes", canReadUploadCategory("paper-votes", "vote_counter"));

console.log("signedUrl key policy");
check("documents/ key is proxy-only", isProxyOnlyKey("documents/e1/x.pdf"));
let threw = false;
try {
  assertSignableKey("documents/e1/x.pdf");
} catch {
  threw = true;
}
check("assertSignableKey throws for documents/", threw);
check("branding key stays signable", !isProxyOnlyKey("branding/r/logo.png"));

// ── Source scans ─────────────────────────────────────────────────────────
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const sources = [...walk(path.join(REPO, "src")), ...walk(path.join(REPO, "modules"))];

console.log("source scan — no caller signs a document key");
const signers = sources.filter((f) => {
  const src = readFileSync(f, "utf8");
  return /\.signedUrl\(/.test(src) && !f.endsWith(path.join("src", "lib", "storage.ts"));
});
check(
  "no signedUrl() caller outside storage.ts",
  signers.length === 0,
  signers.map((f) => path.relative(REPO, f)).join(", ")
);

console.log("source scan — every canSeeDocPath call passes the subject argument");
for (const f of sources) {
  const src = readFileSync(f, "utf8");
  const re = /canSeeDocPath\(([^;]*?)\)\s*[;)?:&|\n]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (f.endsWith(path.join("src", "lib", "documents.ts"))) continue;
    const args = m[1].split(",").length;
    check(
      `${path.relative(REPO, f)} call has 4 args`,
      args >= 4,
      m[0].slice(0, 80)
    );
  }
}

console.log("");
console.log("Manual (DB) checks — see spec BYT-20261118-005 AC:");
console.log("  - GET /api/documents/<board-only id> as owner/tenant/caretaker → 404, no document_access_log row");
console.log("  - GET /api/uploads/documents/<entity>/<file> → 404 for every role incl. board");
console.log("  - unit note text absent from owner/tenant/caretaker responses, MCP and exports");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
