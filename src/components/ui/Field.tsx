"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "./cn";

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: string;
  /** Id of the control. Generated if omitted; Input/Select/Textarea inside pick it up. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, required = false, children, className }: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-base font-medium text-ui-text">
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-ui-danger">
              *
            </span>
          ) : null}
        </label>
        {hint ? (
          <p id={hintId} className="text-base text-ui-text-muted">
            {hint}
          </p>
        ) : null}
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-base font-medium text-ui-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Merge Field context into a control's props (explicit props win). */
export function useFieldControl(props: {
  id?: string;
  invalid?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
}) {
  const ctx = useContext(FieldContext);
  const describedBy =
    [props["aria-describedby"], ctx?.describedBy].filter(Boolean).join(" ") || undefined;
  const invalid = props.invalid ?? ctx?.invalid ?? false;
  return {
    id: props.id ?? ctx?.id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    required: props.required ?? (ctx?.required || undefined),
    invalid,
  };
}

export const controlClasses = (invalid: boolean) =>
  cn(
    "block w-full min-h-11 rounded-lg border bg-ui-surface px-3 py-2 text-base text-ui-text",
    "placeholder:text-ui-text-muted focus:outline-none focus:ring-2 focus:ring-ui-focus focus:ring-offset-1 focus:ring-offset-ui-bg",
    "disabled:cursor-not-allowed disabled:opacity-60",
    invalid ? "border-ui-danger" : "border-ui-border-strong",
  );
