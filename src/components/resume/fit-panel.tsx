"use client";

import { useMemo } from "react";
import { EyeOffIcon, ScissorsIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  contentsOfPage,
  describePath,
  LINES_PER_PAGE_HINT,
  type PageLayout,
} from "@/lib/resume-pagination";
import { fitReport, removeBulletAt, setSectionVisible } from "@/lib/resume-fit";
import type { ResumeDoc } from "@/lib/resume-schema";

/**
 * What is on the last page, and what to cut to lose it.
 *
 * The badge used to state a page count and stop there, which is the least
 * useful moment to stop: knowing a resume is two pages is not the problem,
 * getting it to one is. What falls onto the last page comes from the measured
 * layout, so it is exactly what will print; the ranking of what to cut comes
 * from the same pure helper the check_resume_fit tool uses, so the editor and
 * an assistant give the same advice.
 *
 * Nothing here deletes without saying so: hiding a section is reversible and
 * offered first, and a bullet's own words are shown on the button that removes
 * it, because that button is deleting something the person actually did.
 */
export function FitPanel({
  doc,
  layout,
  onChange,
}: {
  doc: ResumeDoc;
  layout: PageLayout;
  /**
   * Apply a cut. The message names what went, so the editor can offer it back
   * — this panel is where a bullet is furthest from the text it deletes.
   */
  onChange: (next: ResumeDoc, message: string) => void;
}) {
  const pages = layout.pages;
  const fill = Math.round(layout.lastPageFill * 100);

  const overflow = useMemo(
    () => (pages > 1 ? contentsOfPage(layout, pages) : []),
    [layout, pages],
  );
  const report = useMemo(() => fitReport(doc, LINES_PER_PAGE_HINT), [doc]);

  // Only what is on the last page, coarsest first, and only things a person
  // recognises — the section box around them is not a thing you can move.
  const onLastPage = overflow
    .filter((row) => !/^s\d+$/.test(row.key))
    .slice(0, 6)
    .map((row) => ({ ...row, label: describePath(doc, row.key) }))
    .filter((row) => row.label);

  const longest = report.bullets.slice(0, 4);
  const hideable = report.sections.filter((section) => section.visible && section.items > 0);

  if (pages < 2) {
    return (
      <Badge variant="success" className="ml-1 hidden tabular-nums sm:inline-flex">
        1 page · {fill}% full
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="ml-1 hidden sm:inline-flex">
          <Badge variant="warning" className="cursor-pointer tabular-nums">
            <ScissorsIcon className="size-2.5" />
            {pages} pages · make it fit
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70svh] w-96 overflow-y-auto">
        <div className="space-y-3">
          <div>
            <div className="text-[13px] font-medium">
              Page {pages} is {fill}% full
            </div>
            <p className="text-muted-foreground text-xs">
              Measured from the rendered document, so this is what will print.
            </p>
          </div>

          {onLastPage.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
                What is on page {pages}
              </div>
              <ul className="space-y-1">
                {onLastPage.map((row) => (
                  <li key={row.key} className="text-[12.5px] leading-snug">
                    {row.label}
                    {row.partial && (
                      <span className="text-muted-foreground"> — continues from the page before</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hideable.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
                  Hide a section
                </div>
                <p className="text-muted-foreground mb-2 text-xs">
                  Kept in the document, off the page. The biggest single lever, and undoable.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {hideable.map((section) => (
                    <Button
                      key={section.path}
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        onChange(
                          setSectionVisible(doc, Number(section.path.slice(1)), false),
                          `"${section.heading}" hidden`,
                        )
                      }
                    >
                      <EyeOffIcon className="size-3" />
                      {section.heading}
                      <span className="text-muted-foreground tabular-nums">{section.items}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}

          {longest.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
                  Longest bullets
                </div>
                <ul className="space-y-1.5">
                  {longest.map((bullet) => (
                    <li key={bullet.path} className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px]">{bullet.text}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {bullet.entry} · {bullet.lines} line{bullet.lines > 1 ? "s" : ""}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        aria-label={`Remove the bullet "${bullet.text.slice(0, 40)}"`}
                        onClick={() => onChange(removeBulletAt(doc, bullet.path), "Bullet removed")}
                      >
                        <Trash2Icon />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
