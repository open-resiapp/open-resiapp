import "server-only";

import type { GetPromptResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { isAccountingReader } from "@modules/accounting/src/lib/authz";
import { resolveActionLocale, translatorFor } from "./actions/format";
import { APP_LOCALES, type AppLocale } from "./actions/types";
import { logMcpCall } from "./audit";
import { isBoard } from "./authz";
import type { ToolContext } from "./tools/types";

// MCP prompts (BYT-20261118-012 §6): user-invoked templates ("slash
// commands" in Claude) for recurring routines. A prompt only returns a
// localised user message that tells the model which tools to call in which
// order — it reads and writes nothing itself. Only prompts the principal can
// actually run are registered for the request (prompts/list = what fits the
// role); the tools they name still enforce role + scope on every call.

interface PromptDef {
  name: string;
  /** Catalog key under Mcp.prompts. */
  key: string;
  /** English description for prompts/list (constant). */
  description: string;
  visible: (ctx: ToolContext) => boolean;
  args: z.ZodObject;
  /** ICU values for Mcp.prompts.<key>.text. */
  values: (args: Record<string, string | undefined>, ctx: ToolContext) => Record<string, string>;
}

const localeArg = z
  .enum(APP_LOCALES)
  .optional()
  .describe("Language of the routine (sk | en | cs); defaults to the community's language.");

const reader = (ctx: ToolContext) =>
  isAccountingReader(ctx.principal.role, ctx.principal.boardRoles);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const PROMPTS: readonly PromptDef[] = [
  {
    name: "treasurer_monthly_check",
    key: "treasurerMonthlyCheck",
    description:
      "Monthly treasurer routine: what needs attention, unmatched payments, inbox invoices, debtors, deadlines and the repair-fund outlook — ends with a short summary and proposed next steps.",
    visible: (ctx) => ctx.enabledModules.has("accounting") && reader(ctx),
    args: z.object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional()
        .describe("Month to check as YYYY-MM; defaults to the current month."),
      locale: localeArg,
    }),
    values: (a, ctx) => ({ month: a.month ?? currentMonth(), community: ctx.root.name }),
  },
  {
    name: "meeting_preparation",
    key: "meetingPreparation",
    description:
      "Owners' meeting preparation for the chairman: agenda from open topics, voting drafts and participation, finance items (závierka, vyúčtovanie, fund), governing documents and the legal basis.",
    visible: (ctx) => ctx.enabledModules.has("voting") && isBoard(ctx.principal),
    args: z.object({
      votingId: z.string().uuid().optional().describe("Meeting voting to prepare, if it already exists."),
      locale: localeArg,
    }),
    values: (a, ctx) => ({ votingId: a.votingId ?? "-", community: ctx.root.name }),
  },
  {
    name: "my_payments_check",
    key: "myPaymentsCheck",
    description:
      "For an owner: my balance, arrears and overpayments, how and how much to pay (IBAN, VS, QR), my last settlement and meter readings — in plain language.",
    visible: (ctx) => ctx.enabledModules.has("accounting") && ctx.isDomOwner,
    args: z.object({ locale: localeArg }),
    values: (_a, ctx) => ({ community: ctx.root.name }),
  },
];

export function visiblePromptNames(ctx: ToolContext): string[] {
  if (ctx.principal.status !== "active" || !ctx.principal.scopes.includes("read")) return [];
  return PROMPTS.filter((p) => p.visible(ctx)).map((p) => p.name);
}

/** Registers the principal's prompts on the per-request server. */
export async function registerPrompts(server: McpServer, ctx: ToolContext): Promise<void> {
  const names = new Set(visiblePromptNames(ctx));
  if (names.size === 0) return;
  const listLocale = resolveActionLocale(undefined, ctx.root);
  const tList = await translatorFor(listLocale);

  for (const def of PROMPTS) {
    if (!names.has(def.name)) continue;
    server.registerPrompt(
      def.name,
      {
        title: tList(`Mcp.prompts.${def.key}.title`),
        description: def.description,
        argsSchema: def.args,
      },
      (async (rawArgs: Record<string, string | undefined>): Promise<GetPromptResult> => {
        const started = Date.now();
        let code = "ok";
        try {
          const locale: AppLocale = resolveActionLocale(rawArgs?.locale, ctx.root);
          const t = await translatorFor(locale);
          const text = t(`Mcp.prompts.${def.key}.text`, def.values(rawArgs ?? {}, ctx));
          return {
            description: t(`Mcp.prompts.${def.key}.title`),
            messages: [{ role: "user", content: { type: "text", text } }],
          };
        } catch (err) {
          code = "internal";
          throw err;
        } finally {
          logMcpCall({
            userId: ctx.principal.userId,
            clientId: ctx.principal.clientId,
            tool: `prompt:${def.name}`,
            args: rawArgs ?? null,
            resultCode: code,
            durationMs: Date.now() - started,
          });
        }
      }) as never
    );
  }
}
