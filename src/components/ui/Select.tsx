"use client";

import type { ComponentProps } from "react";
import { cn } from "./cn";
import { controlClasses, useFieldControl } from "./Field";
import { Icon } from "./Icon";

export interface SelectProps extends ComponentProps<"select"> {
  invalid?: boolean;
}

/** Native <select> (best mobile UX) with a consistent chevron. Pass <option>s as children. */
export function Select({ className, invalid: invalidProp, children, ...props }: SelectProps) {
  const { invalid, ...a11y } = useFieldControl({ ...props, invalid: invalidProp });
  return (
    <div className="relative">
      <select
        {...props}
        {...a11y}
        className={cn(controlClasses(invalid), "appearance-none pr-10", className)}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={20}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ui-text-muted"
      />
    </div>
  );
}
