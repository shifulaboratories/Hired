"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  CircleHelpIcon,
  LockIcon,
  MessageSquareWarningIcon,
  PencilIcon,
} from "lucide-react";
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

/** In the profile a rule binds everything written, not one job. */
const PROFILE_RULE_NOTE = "Followed in every document.";

const ADD_LABEL: Record<Exclude<SectionKind, "evidence">, string> = {
  rules: "Add rules",
  caveats: "Add caveats",
  open: "Add open question",
};

/** A `##` section and everything under it until the next one. */
type Block = {
  /** The headed section, or null for the untitled opening text. */
  head: BackgroundSection | null;
  members: BackgroundSection[];
  start: number;
  end: number;
};

function blocksOf(sections: BackgroundSection[], text: string): Block[] {
  const blocks: Block[] = [];
  for (const section of sections) {
    const opensBlock = Boolean(section.heading) && !section.inline;
    const last = blocks[blocks.length - 1];
    if (opensBlock || !last) {
      blocks.push({ head: opensBlock ? section : null, members: [section], start: section.offset, end: text.length });
    } else {
      last.members.push(section);
    }
  }
  for (let i = 0; i < blocks.length - 1; i += 1) blocks[i].end = blocks[i + 1].start;
  return blocks;
}

/** Past this many headed sections, an outline to jump between them earns its row. */
const OUTLINE_AT = 4;

export function BackgroundEditor({
  value,
  onChange,
  placeholder,
  mode = "role",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /**
   * "profile" is the personal background: none of it reaches a resume anyway,
   * so the usable-words line would be a count of nothing. The markings still
   * mean something there — a RULE in it binds every document.
   */
  mode?: "role" | "profile";
}) {
  const [editing, setEditing] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  // One section open for editing on its own: where it starts and how long it
  // is right now. The rest of the text is untouched around it.
  const [slice, setSlice] = useState<{ start: number; length: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const sliceRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    // Land where they clicked rather than at the top of a very long document.
    const at = caret ?? box.value.length;
    box.setSelectionRange(at, at);
  }, [editing, caret]);

  useEffect(() => {
    if (slice) sliceRef.current?.focus();
    // Focus once when a section opens, not on every keystroke inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice?.start]);

  const sections = parseBackground(value);
  const blocks = blocksOf(sections, value);
  const headed = blocks.filter((block) => block.head);
  const totalWords = countWords(value);
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

  const keyOf = (block: Block) => `${block.head?.heading ?? ""}@${blocks.indexOf(block)}`;
  const toggle = (block: Block) =>
    setCollapsed((old) => {
      const next = new Set(old);
      const key = keyOf(block);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
        // The one count on the page: how much is written, and how much of it
        // Claude may actually write a resume from.
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium tabular-nums">
            {totalWords.toLocaleString()}
          </span>{" "}
          words
          {mode === "role" && (
            <>
              ,{" "}
              <span className="text-foreground font-medium tabular-nums">
                {evidenceWords.toLocaleString()}
              </span>{" "}
              usable on a resume
            </>
          )}
          . Rules, caveats and open questions are read by Claude but never written into a document.
          Mark one line with{" "}
          <code className="bg-inset rounded px-1 font-mono text-[11px]">RULE:</code>,{" "}
          <code className="bg-inset rounded px-1 font-mono text-[11px]">CAVEAT:</code> or{" "}
          <code className="bg-inset rounded px-1 font-mono text-[11px]">OPEN:</code> in capitals.
        </p>
      )}

      {!editing && headed.length >= OUTLINE_AT && (
        <nav aria-label="Sections" className="flex flex-wrap gap-1">
          {headed.map((block) => {
            const head = block.head as BackgroundSection;
            const Icon = head.kind === "evidence" ? null : KIND_STYLE[head.kind].icon;
            return (
              <button
                key={keyOf(block)}
                type="button"
                onClick={() => {
                  setCollapsed((old) => {
                    const next = new Set(old);
                    next.delete(keyOf(block));
                    return next;
                  });
                  document
                    .getElementById(`bg-${blocks.indexOf(block)}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="bg-inset hover:bg-accent text-muted-foreground hover:text-foreground flex max-w-56 items-center gap-1 truncate rounded-md px-2 py-0.5 text-[11.5px] transition-colors"
              >
                {Icon && <Icon className="size-3 shrink-0" />}
                <span className="truncate">{head.heading}</span>
              </button>
            );
          })}
        </nav>
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
          onClick={() => {
            // Never steal a click somebody aimed at selecting text, and never
            // swap the whole text in while one section is open on its own.
            if (!window.getSelection()?.isCollapsed || slice) return;
            setCaret(null);
            setEditing(true);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
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
              {blocks.map((block, index) => {
                const key = keyOf(block);
                const open = slice !== null && slice.start === block.start;
                if (open) {
                  return (
                    <Textarea
                      key={key}
                      ref={sliceRef}
                      id={`bg-${index}`}
                      value={value.slice(slice.start, slice.start + slice.length)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const next = event.target.value;
                        onChange(
                          value.slice(0, slice.start) + next + value.slice(slice.start + slice.length),
                        );
                        setSlice({ start: slice.start, length: next.length });
                      }}
                      onBlur={() => setSlice(null)}
                      className="min-h-32 resize-y font-mono text-[13px] leading-relaxed"
                    />
                  );
                }
                const folded = collapsed.has(key);
                return (
                  <div key={key} id={`bg-${index}`} className="group/block relative scroll-mt-20">
                    {block.head && (
                      <div className="absolute top-1 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSlice({ start: block.start, length: block.end - block.start });
                          }}
                          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1"
                          aria-label={`Edit ${block.head.heading} on its own`}
                          title="Edit this section on its own"
                        >
                          <PencilIcon className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(block);
                          }}
                          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1"
                          aria-label={folded ? `Show ${block.head.heading}` : `Fold ${block.head.heading}`}
                          aria-expanded={!folded}
                        >
                          <ChevronDownIcon className={cn("size-3 transition-transform", folded && "-rotate-90")} />
                        </button>
                      </div>
                    )}
                    {folded && block.head ? (
                      <Section section={{ ...block.head, body: "" }} folded mode={mode} />
                    ) : (
                      <div className="space-y-4">
                        {block.members.map((section, memberIndex) => (
                          <Section key={memberIndex} section={section} mode={mode} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  section,
  folded = false,
  mode = "role",
}: {
  section: BackgroundSection;
  folded?: boolean;
  mode?: "role" | "profile";
}) {
  const { kind, heading, body } = section;
  if (kind === "evidence") {
    return (
      <section className="px-2">
        {heading && (
          <h3 className="mb-1.5 pr-14 text-[13px] font-semibold tracking-tight">
            {heading}
            {folded && <span className="text-muted-foreground ml-1.5 font-normal">folded</span>}
          </h3>
        )}
        {!folded && <Markdown text={body} />}
      </section>
    );
  }

  const { label, icon: Icon, className } = KIND_STYLE[kind];
  const note = mode === "profile" && kind === "rules" ? PROFILE_RULE_NOTE : KIND_STYLE[kind].note;
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
      {!folded && <Markdown text={body} />}
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
