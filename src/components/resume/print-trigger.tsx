"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The bar above the document on a print page. It never prints.
 *
 * It used to set document.title from an effect so the saved PDF would be named
 * after the document, but Next re-applies the page's own <title> after that
 * effect runs, so every file came out as "Hired.pdf". The pages now set the
 * title through generateMetadata. It also used to tell people to set margins
 * to None; the page carries its own margin now (see globals.css), so the
 * dialog's defaults are right and there is nothing to change.
 */
export function PrintTrigger() {
  return (
    <div className="no-print mx-auto mb-6 flex w-fit items-center gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 shadow-sm">
      <p className="text-sm text-neutral-600">
        Print, then choose <strong className="font-medium text-neutral-900">Save as PDF</strong>{" "}
        as the destination.
      </p>
      <Button size="sm" onClick={() => window.print()}>
        <PrinterIcon /> Print
      </Button>
    </div>
  );
}
