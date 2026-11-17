import { cn } from "@/components/ui";

export type NoticeState = { type: "success" | "error"; text: string } | null;

/** Inline success / error message with kit tokens. Renders nothing when empty. */
export default function Notice({ state, className }: { state: NoticeState; className?: string }) {
  if (!state) return null;
  const isError = state.type === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-4 py-3 text-base font-medium",
        isError
          ? "border-ui-danger/40 bg-ui-danger/10 text-ui-danger"
          : "border-ui-success/40 bg-ui-success/10 text-ui-success",
        className,
      )}
    >
      {state.text}
    </p>
  );
}
