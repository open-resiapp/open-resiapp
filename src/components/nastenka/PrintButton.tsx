"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";

// Hidden on paper (print: variant) — only the notices are printed.
export default function PrintButton() {
  const t = useTranslations("BoardPrint");
  return (
    <Button className="print:hidden" onClick={() => window.print()}>
      {t("print")}
    </Button>
  );
}
