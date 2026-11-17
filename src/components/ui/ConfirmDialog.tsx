"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

export type ConfirmTone = "danger" | "default";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** State the consequence ("Vlastník bude odstránený a stratí prístup."). */
  description: ReactNode;
  confirmLabel: string;
  /** Defaults to Ui.cancel. */
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useTranslations("Ui");
  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
      footer={
        <>
          {/* Cancel gets initial focus on destructive prompts (safe default). */}
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={loading}
            data-autofocus={tone === "danger" ? "" : undefined}
          >
            {cancelLabel ?? t("cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            data-autofocus={tone === "danger" ? undefined : ""}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-ui-text-muted">{description}</div>
    </Modal>
  );
}

// ── Imperative helper: `if (await confirm({...})) …` replacing window.confirm ──

export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<Confirm>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(opts);
      }),
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options ? (
        <ConfirmDialog
          open
          {...options}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** Must be used under <ConfirmProvider>. */
export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
