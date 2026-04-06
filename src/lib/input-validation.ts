const PART_A_REGEX = /^orai_[a-f0-9]{64}$/;
const PART_B_REGEX = /^[a-zA-Z0-9+/=_-]{32,256}$/;
const APP_NAME_MAX_LENGTH = 100;

export function validatePartA(partA: string): boolean {
  return typeof partA === "string" && PART_A_REGEX.test(partA);
}

export function validatePartB(partB: string): boolean {
  return typeof partB === "string" && PART_B_REGEX.test(partB);
}

export function sanitizeAppName(name: string): string {
  if (typeof name !== "string") return "";
  // Strip HTML tags, control characters, and trim
  return name
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .substring(0, APP_NAME_MAX_LENGTH);
}

export function validateAppName(name: string): boolean {
  const sanitized = sanitizeAppName(name);
  return sanitized.length > 0 && sanitized.length <= APP_NAME_MAX_LENGTH;
}
