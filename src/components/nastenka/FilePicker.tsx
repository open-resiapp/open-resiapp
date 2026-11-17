"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";

import { Button, Icon, buttonClasses } from "@/components/ui";

// Styled file picker: a real button-looking label for the hidden input plus
// the chosen file name and a remove button. The parent keeps the File.
export default function FilePicker({
  label,
  chooseLabel,
  accept,
  file,
  onChange,
  error,
}: {
  label: string;
  chooseLabel: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | null;
}) {
  const t = useTranslations("Feed.create.file");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-base font-medium text-ui-text">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          aria-labelledby={`${id}-label`}
          className="peer sr-only"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
        <label
          htmlFor={id}
          className={buttonClasses({ variant: "secondary", className: "cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ui-focus" })}
        >
          <Icon name="upload" size={20} />
          {chooseLabel}
        </label>
        {file ? (
          <span className="flex min-w-0 items-center gap-2 text-base text-ui-text">
            <Icon name="file" size={20} />
            <span className="break-all">{file.name}</span>
            <Button
              variant="ghost"
              onClick={() => {
                onChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              {t("remove")}
            </Button>
          </span>
        ) : (
          <span className="text-base text-ui-text-muted">{t("none")}</span>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
