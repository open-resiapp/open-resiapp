export type ClassValue = string | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Shared keyboard focus ring. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:ring-offset-2 focus-visible:ring-offset-ui-bg";

/** Focus ring for a wrapper (label) whose focusable child is visually hidden (sr-only input nested inside it). */
export const focusWithinRing =
  "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ui-focus has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ui-bg";
