"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Icon, Input, Tabs } from "@/components/ui";

// Profile → how to connect Claude / ChatGPT / another AI app to the
// community via the MCP server. `mcpUrl` is resolved on the server
// (getResourceUrl) and passed down — never hardcoded here.

type AppKey = "claude" | "chatgpt" | "other";

const LINKS: Partial<Record<AppKey, string>> = {
  claude:
    "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  chatgpt: "https://help.openai.com",
};

const STEP_COUNT: Record<AppKey, number> = { claude: 5, chatgpt: 5, other: 3 };

export default function AiConnectGuide({
  mcpUrl,
  collapsible,
}: {
  mcpUrl: string | null;
  /** When true the guide sits behind a disclosure button (user already has connected apps). */
  collapsible: boolean;
}) {
  const t = useTranslations("Mcp.guide");
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState<AppKey>("claude");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    if (!mcpUrl) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  const expanded = !collapsible || open;
  const panelId = "ai-connect-guide-panel";
  const link = LINKS[app];

  const body = (
    <div id={panelId} className="space-y-5">
      <div>
        <h3 className="mb-1 text-lg font-bold text-ui-text">{t("title")}</h3>
        <p className="text-base text-ui-text-muted">{t("intro")}</p>
      </div>

      {mcpUrl ? (
        <div>
          <label htmlFor="ai-mcp-url" className="mb-1 block text-base font-semibold text-ui-text">
            {t("addressLabel")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="ai-mcp-url"
              readOnly
              value={mcpUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 font-mono"
            />
            <Button variant="secondary" onClick={copy}>
              <Icon name={copied ? "check" : "file"} size={18} aria-hidden />
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <p role="status" className="mt-1 text-base text-ui-danger">
            {copyFailed ? t("copyFailed") : ""}
          </p>
        </div>
      ) : null}

      <div>
        <Tabs
          aria-label={t("tabsLabel")}
          value={app}
          onChange={(v) => setApp(v as AppKey)}
          items={[
            { value: "claude", label: t("tabClaude") },
            { value: "chatgpt", label: t("tabChatgpt") },
            { value: "other", label: t("tabOther") },
          ]}
        />
        <div role="tabpanel" className="pt-4">
          <h4 className="mb-2 text-base font-semibold text-ui-text">{t("stepsHeading")}</h4>
          <ol className="list-decimal space-y-2 pl-6 text-base text-ui-text">
            {Array.from({ length: STEP_COUNT[app] }, (_, i) => (
              <li key={`${app}-${i}`}>{t(`${app}.${i}`)}</li>
            ))}
          </ol>
          {app !== "other" ? (
            <p className="mt-3 text-base text-ui-text-muted">{t(`${app}Note`)}</p>
          ) : null}
          {link ? (
            <p className="mt-2 text-base">
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-ui-primary underline"
              >
                {t(`${app}Link`)}
              </a>
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-ui-border bg-ui-surface-muted px-4 py-3">
        <p className="mb-1 text-base font-semibold text-ui-text">{t("safetyTitle")}</p>
        <ul className="list-disc space-y-1 pl-5 text-base text-ui-text">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>{t(`safety.${i}`)}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  if (!collapsible) return body;

  return (
    <div className="border-t border-ui-border pt-4">
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {t("toggle")}
        <Icon name={open ? "x" : "chevronDown"} size={18} aria-hidden />
      </Button>
      {expanded && open ? <div className="mt-4">{body}</div> : null}
    </div>
  );
}
