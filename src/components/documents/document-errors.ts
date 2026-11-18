// Maps API error codes ("document.send.board_only") to i18n keys in the
// `DocumentVisibility.errors` namespace ("document_send_board_only").
// BYT-20261118-005. Unknown codes fall back to "generic".
import { DOCUMENT_ERROR_CODES } from "@/lib/documents";

export function documentErrorKey(code: unknown): string {
  return typeof code === "string" &&
    (DOCUMENT_ERROR_CODES as readonly string[]).includes(code)
    ? code.replace(/\./g, "_")
    : "generic";
}
