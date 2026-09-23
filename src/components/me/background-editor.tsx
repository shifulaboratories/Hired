"use client";

import { useEffect, useRef, useState } from "react";
import { CircleHelpIcon, LockIcon, MessageSquareWarningIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CANONICAL,
  parseBackground,
  resumeEvidence,
  type BackgroundSection,
  type SectionKind,
} from "@/lib/background";
import { inlineSegments, toBlocks, type Segment } from "@/lib/markdown-lite";

/**
 * A role's background: readable by default, editable on a click.
 *
 * It was a 34rem monospace textarea, which meant people read their own career
 * history as source code — `##` and `-` and all — and scrolled a wall of it to
 * change one line. The text has been markdown since the first commit and every
 * tool writes headings into it; nothing had ever rendered it.
 *
 * Read mode is the default because reading is what mostly happens here. One
 * click anywhere in the text switches to the textarea with the caret where you
 * clicked; blur switches back. There is no save button, here or anywhere else
 * in this app — the same autosave the rest of the editor uses carries this.
 *
 * The three reserved kinds are shown with their own treatment and said out
 * loud, because a convention nobody can see is a convention that silently goes
 * wrong: a heading typed as "Caveat" instead of "Caveats" is evidence again,
 * and the only honest defence is making the classification visible on the page.
 * That goes double for shouted markers inside the text — "⚠️ OPEN:" in the
 * middle of a section — which are easy to write and easy to miss, so each one
 * is drawn as its own callout exactly where it sits.
 */

const KIND_STYLE: Record<
  Exclude<SectionKind, "evidence">,
  { label: string; note: string; icon: typeof LockIcon; className: string }
> = {
  rules: {
    label: "Rules",
    note: "Followed when anything is written about this job.",
    icon: LockIcon,
    className: "border-l-2 border-l-primary/50 bg-inset/60",
  },
  caveats: {
    label: "Caveats",
    note: "Yours. Never goes on a resume or a letter.",
    icon: MessageSquareWarningIcon,
    className: "border-warning/40 bg-warning-tint border-l-2",
  },
  open: {
    label: "Open questions",
    note: "Not settled. Kept off documents until you answer it.",
    icon: CircleHelpIcon,
    className: "border-warning/50 border border-dashed",
  },
};

const ADD_LABEL: Record<Exclude<SectionKind, "evidence">, string> = {
  rules: "Add rules",
  caveats: "Add caveats",
  open: "Add open question",
};

export function BackgroundEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    // Land where they clicked rather than at the top of a very long document.
    const at = caret ?? box.value.length;
    box.setSelectionRange(at, at);
  }, [editing, caret]);

  const sections = parseBackground(value);
  const evidenceWords = countWords(resumeEvidence(value));
  const counts = {
    rules: sections.filter((section) => section.kind === "rules").length,
    caveats: sections.filter((section) => section.kind === "caveats").length,
    open: sections.filter((section) => section.kind === "open").length,
  };

  /** Add a reserved section, or jump to it when it is already there. */
  const addSection = (kind: Exclude<SectionKind, "evidence">) => {
    const heading = CANONICAL[kind];
    // A `##` section first; a marked paragraph is somebody's single flagged
    // line, and the next one belongs under a proper heading.
    const existing =
      sections.find((section) => section.kind === kind && !section.inline) ??
      sections.find((section) => section.kind === kind);
    if (existing) {
      setCaret(existing.inline ? existing.offset : existing.offset + existing.heading.length + 4);
      setEditing(true);
      return;
    }
    const next = `${value.trim()}\n\n## ${heading}\n- `.replace(/^\n+/, "");
    onChange(next);
    setCaret(next.length);
    setEditing(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["rules", "caveats", "open"] as const).map((kind) => {
          const count = counts[kind];
          const { label, icon: Icon } = KIND_STYLE[kind];
          return (
            <Button
              key={kind}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => addSection(kind)}
            >
              <Icon className="size-3" />
              {count > 0 ? (
                <>
                  {label}
                  <span className="text-muted-foreground tabular-nums">{count}</span>
                </>
              ) : (
                ADD_LABEL[kind]
              )}
            </Button>
          );
        })}
        <span className="text-muted-foreground ml-auto text-xs">
          {editing ? "Markdown. Click away to read it." : "Click the text to edit"}
        </span>
      </div>
      {!editing && sections.length > 0 && (
        // The one number that says what the markings did: how much of this
        // Claude may actually write a resume from.
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium tabular-nums">
            {evidenceWords.toLocaleString()}
          </span>{" "}
          words usable on a resume. Rules, caveats and open questions are read by Claude but never
          written into a document. Mark a line inline with{" "}
          <code className="bg-inset rounded px-1 font-mono text-[11px]">RULE:</code>,{" "}
          <code className="bg-inset rounded px-1 font-mono text-[11px]">CAVEAT:</code> or{" "}
          <code className="bg-inset rounded px-1 font-mono text-[11px]">OPEN:</code> in capitals.
        </p>
      )}

      {editing ? (
        <Textarea
          ref={boxRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setEditing(false);
            setCaret(null);
          }}
          placeholder={placeholder}
          className="min-h-[24rem] resize-y font-mono text-[13px] leading-relaxed"
        />
      ) : (
        <div
          role="textbox"
          tabIndex={0}
          aria-label="Background. Press Enter to edit."
          onClick={(event) => {
            // Never steal a click somebody aimed at selecting text.
            if (!window.getSelection()?.isCollapsed) return;
            setCaret(null);
            setEditing(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setEditing(true);
            }
          }}
          className={cn(
            "min-h-40 cursor-text rounded-lg border border-transparent px-1 py-1",
            "hover:border-border focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          {sections.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm whitespace-pre-wrap">{placeholder}</p>
          ) : (
            <div className="space-y-4">
              {sections.map((section, index) => (
                <Section key={index} section={section} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ section }: { section: BackgroundSection }) {
  const { kind, heading, body } = section;
  if (kind === "evidence") {
    return (
      <section className="px-2">
        {heading && (
          <h3 className="mb-1.5 text-[13px] font-semibold tracking-tight">{heading}</h3>
        )}
        <Markdown text={body} />
      </section>
    );
  }

  const { label, note, icon: Icon, className } = KIND_STYLE[kind];
  if (section.inline) {
    // A single marked line inside other text: drawn in place, compact, with
    // the marker as they wrote it so they can see which word did it.
    return (
      <section className={cn("mx-2 rounded-md px-2.5 py-1.5", className)}>
        <div className="flex items-start gap-1.5 text-[13.5px] leading-relaxed">
          <Icon className="mt-1 size-3 shrink-0" />
          <div className="min-w-0">
            <span className="text-muted-foreground mr-1.5 text-[11px] font-medium tracking-wide uppercase">
              {heading}
            </span>
            <span className="text-muted-foreground text-[11px]">· {note}</span>
            <Markdown text={body} />
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={cn("rounded-lg px-3 py-2.5", className)}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Icon className="size-3 shrink-0" />
        <h3 className="text-[13px] font-semibold tracking-tight">{heading || label}</h3>
        {/* Its own line on a phone rather than a squeezed column beside the heading. */}
        <span className="text-muted-foreground basis-full text-[11px] sm:basis-auto">{note}</span>
      </div>
      <Markdown text={body} />
    </section>
  );
}

/** The subset of markdown the tools actually write. See markdown-lite.ts. */
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {toBlocks(text).map((block, index) => {
        if (block.type === "heading") {
          return (
            <h4
              key={index}
              className={cn(
                "font-semibold tracking-tight",
                block.level === 2 ? "text-[13px]" : "text-muted-foreground text-[12px]",
              )}
            >
              {block.text}
            </h4>
          );
        }
        if (block.type === "bullets" || block.type === "ordered") {
          const List = block.type === "bullets" ? "ul" : "ol";
          return (
            <List
              key={index}
              className={cn(
                "space-y-1 pl-5",
                block.type === "bullets" ? "list-disc" : "list-decimal",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="marker:text-muted-foreground">
                  <Inline segments={inlineSegments(item)} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            <Inline segments={inlineSegments(block.text)} />
          </p>
        );
      })}
    </div>
  );
}

function Inline({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.bold) return <strong key={index}>{segment.text}</strong>;
        if (segment.code) {
          return (
            <code key={index} className="bg-inset rounded px-1 py-0.5 font-mono text-[12px]">
              {segment.text}
            </code>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </>
  );
}

function countWords(text: string) {
  return text.replace(/[#*_`>-]/g, " ").split(/\s+/).filter(Boolean).length;
}
