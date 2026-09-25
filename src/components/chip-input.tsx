"use client";

import { useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A list of short strings, edited as chips.
 *
 * Three places in this app stored a `String[]` and edited it as one comma-joined
 * text box — role tags, skill groups on Me, skill groups on a resume. That box
 * reads as a sentence with commas in it rather than as a list, so nothing looks
 * like a value you can remove, a stray comma silently splits one entry into two,
 * and a long list becomes a single overflowing line you have to scrub through to
 * find anything.
 *
 * The values are still a `String[]` and still joined by whoever renders them —
 * the resume prints "React, TypeScript, Go" exactly as before. This is the
 * editing surface only, which is the direct-manipulation exception the working
 * agreement carves out. No tool changes, because `update_role` and
 * `update_extra` already take the array.
 *
 * Deliberately not the tag picker. That one is backed by the Tag table: rows
 * with ids, kinds and colours, shared across companies, contacts and
 * applications. These are free text with no catalogue behind them, and giving
 * them a picker would mean inventing one — the working agreement's "don't add a
 * second labelling mechanism" cuts both ways.
 */

export function ChipInput({
  values,
  onChange,
  placeholder,
  id,
  /** What one entry is called. Names the box for a screen reader. */
  noun = "item",
  /** Values to mark, compared case-insensitively — e.g. a skill with no evidence. */
  flagged = [],
  /** Why a flagged chip is marked, for its tooltip. */
  flagNote = "",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  noun?: string;
  flagged?: string[];
  flagNote?: string;
}) {
  const marked = new Set(flagged.map((value) => value.trim().toLowerCase()));
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLInputElement>(null);

  /**
   * Commit whatever is typed. Splits on commas too, so pasting a comma-joined
   * list from wherever they kept it before lands as chips rather than as one
   * long chip — which is exactly what people will do the first time.
   */
  const commit = (text: string) => {
    const added = text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      // Case-insensitive, because "Python" and "python" are one skill and
      // having both on a resume looks like a mistake.
      .filter(
        (part, index, all) =>
          all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index &&
          !values.some((existing) => existing.toLowerCase() === part.toLowerCase()),
      );
    if (added.length > 0) onChange([...values, ...added]);
    setDraft("");
  };

  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div
      className={cn(
        // Matches the Input primitive rather than approximating it: same well
        // (bg-inset + shadow-field), same radius, same focus ring, same two
        // heights. A field that is nearly the house field is worse than one
        // that plainly is not.
        "border-input bg-inset shadow-field rounded-control flex min-h-10 w-full flex-wrap items-center gap-1 border px-1.5 py-1 transition-[color,box-shadow,border-color] duration-150 md:min-h-9",
        "focus-within:border-ring focus-within:ring-ring/25 focus-within:ring-2",
      )}
      // Clicking the padding should land in the box, the way a real input does.
      onClick={() => boxRef.current?.focus()}
    >
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          title={marked.has(value.trim().toLowerCase()) ? flagNote : undefined}
          // bg-background, not bg-inset: the field itself is the inset, so an
          // inset chip inside it is invisible. A flagged chip gets a dotted
          // warning border rather than a colour alone.
          className={cn(
            "bg-background text-foreground rounded-chip flex items-center gap-1 border py-0.5 pr-0.5 pl-2 text-[12.5px]",
            marked.has(value.trim().toLowerCase()) && "border-warning border-dotted",
          )}
        >
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            title={`Remove ${value}`}
            onClick={(event) => {
              event.stopPropagation();
              remove(index);
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-chip flex size-4 items-center justify-center transition-colors duration-150"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}

      <input
        ref={boxRef}
        id={id}
        // Two of the three places this is used sit under a heading rather than
        // a <label for>, so the box names itself rather than being announced
        // as an unlabelled text field.
        aria-label={`Add a ${noun}`}
        value={draft}
        onChange={(event) => {
          // A typed comma commits rather than being stored, so the separator
          // never survives into a value.
          if (event.target.value.includes(",")) commit(event.target.value);
          else setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Never let this submit a surrounding form by accident.
            event.preventDefault();
            commit(draft);
            return;
          }
          // Backspace on an empty box takes the last chip off, which is what
          // every chip input anybody has used does.
          if (event.key === "Backspace" && !draft && values.length > 0) {
            event.preventDefault();
            remove(values.length - 1);
          }
        }}
        // Leaving the field commits what is sitting in it. Losing a typed word
        // because you clicked away is the most annoying thing this could do.
        onBlur={() => commit(draft)}
        placeholder={values.length === 0 ? placeholder : ""}
        // text-base below md is not a style choice — iOS Safari zooms the
        // viewport when you focus a field under 16px and never zooms back.
        // The Input primitive carries the same comment for the same reason.
        className="placeholder:text-faint min-w-24 flex-1 bg-transparent px-1 py-0.5 text-base outline-none md:text-sm"
      />
    </div>
  );
}
