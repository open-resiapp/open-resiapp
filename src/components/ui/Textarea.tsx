"use client";

import type { ComponentProps } from "react";
import { cn } from "./cn";
import { controlClasses, useFieldControl } from "./Field";

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ className, invalid: invalidProp, rows = 4, ...props }: TextareaProps) {
  const { invalid, ...a11y } = useFieldControl({ ...props, invalid: invalidProp });
  return (
    <textarea {...props} {...a11y} rows={rows} className={cn(controlClasses(invalid), "resize-y", className)} />
  );
}
