"use client";

import type { ComponentProps } from "react";
import { cn } from "./cn";
import { controlClasses, useFieldControl } from "./Field";

export interface InputProps extends ComponentProps<"input"> {
  /** Force error styling (otherwise inherited from the surrounding Field). */
  invalid?: boolean;
}

export function Input({ className, invalid: invalidProp, ...props }: InputProps) {
  const { invalid, ...a11y } = useFieldControl({ ...props, invalid: invalidProp });
  return <input {...props} {...a11y} className={cn(controlClasses(invalid), className)} />;
}
