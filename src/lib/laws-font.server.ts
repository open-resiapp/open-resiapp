import "server-only";
import { cookies } from "next/headers";
import { LAW_FONT_COOKIE, isLawFontSize, type LawFontSize } from "@/lib/laws-progress";

/** Reader font size remembered in a cookie, or null when never chosen. */
export async function getLawFontSizeFromCookie(): Promise<LawFontSize | null> {
  const value = (await cookies()).get(LAW_FONT_COOKIE)?.value;
  return isLawFontSize(value) ? value : null;
}
