import { cn } from "./cn";

export interface SpinnerProps {
  /** px size, default 20 */
  size?: number;
  className?: string;
}

/** Decorative spinner (aria-hidden). Pair with visible/sr-only text or use LoadingBlock. */
export function Spinner({ size = 20, className }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={cn("animate-spin motion-reduce:animate-none", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
