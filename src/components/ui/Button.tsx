import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { cn, focusRing } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ui-primary text-ui-primary-text hover:opacity-90 border border-transparent",
  secondary:
    "bg-ui-surface text-ui-text border border-ui-border-strong hover:bg-ui-surface-muted",
  danger: "bg-ui-danger text-ui-danger-text hover:opacity-90 border border-transparent",
  ghost: "bg-transparent text-ui-text border border-transparent hover:bg-ui-surface-muted",
};

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 py-2 text-base",
  lg: "min-h-14 px-6 py-3 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:pointer-events-none",
    focusRing,
    VARIANT[variant],
    SIZE[size],
    fullWidth && "w-full",
    className,
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button, sets aria-busy. */
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant,
  size,
  loading = false,
  fullWidth,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/** next-intl Link styled as a Button. */
export function ButtonLink({ variant, size, fullWidth, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, fullWidth, className })} {...rest} />;
}
