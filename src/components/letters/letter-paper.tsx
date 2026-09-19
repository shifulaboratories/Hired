import { LETTER_LABEL } from "@/lib/data/letters";
import type { LetterKind } from "@prisma/client";

/**
 * A letter, on a page.
 *
 * Deliberately not ResumePaper. A resume is a structured document with a
 * schema, six templates and a design popover; a letter is prose somebody types,
 * and the only questions worth answering about printing one are whether the
 * contact details are at the top and whether the paragraphs break sensibly.
 * Giving it templates and an accent colour would be inventing decisions nobody
 * asked to make.
 *
 * The margin is stated here in inches rather than read from a setting for the
 * same reason. One inch is what a letter has.
 */

export type LetterPaperProps = {
  kind: LetterKind;
  title: string;
  recipient: string;
  body: string;
  /** The letterhead, from their profile. Any field that is empty is skipped. */
  from: {
    name: string;
    email: string;
    phone: string;
    location: string;
    website: string;
  };
  /**
   * The date as a civil day already formatted in the person's own zone. A Date
   * would be formatted here in the server's, which is the bug the time-zone
   * sweep spent a day removing.
   */
  date: string;
};

export function LetterPaper({ kind, title, recipient, body, from, date }: LetterPaperProps) {
  const contact = [from.email, from.phone, from.location, from.website].filter(Boolean);
  // A blank line is a paragraph break; a single newline is a line break inside
  // one. That is how people type into a textarea, so it is how this reads it.
  const paragraphs = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  return (
    <article className="letter-paper">
      <style>{`
        @page { size: Letter; margin: 1in; }
        .letter-paper {
          width: 8.5in;
          min-height: 11in;
          padding: 1in;
          background: #fff;
          color: #111;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 11.5pt;
          line-height: 1.5;
        }
        @media print {
          .letter-paper { width: auto; min-height: 0; padding: 0; }
        }
        .letter-paper h1 { font-size: 15pt; font-weight: 600; margin: 0; letter-spacing: 0.01em; }
        .letter-paper .letter-contact { font-size: 9.5pt; color: #444; margin-top: 0.15in; }
        .letter-paper .letter-rule { border: 0; border-top: 1px solid #ddd; margin: 0.3in 0; }
        .letter-paper .letter-date { font-size: 10pt; color: #444; }
        .letter-paper .letter-to { margin-top: 0.25in; }
        .letter-paper p { margin: 0 0 0.16in; orphans: 2; widows: 2; }
        .letter-paper .letter-subject { margin-top: 0.25in; font-weight: 600; }
      `}</style>

      <header>
        <h1>{from.name || title || LETTER_LABEL[kind]}</h1>
        {contact.length > 0 && <div className="letter-contact">{contact.join("  ·  ")}</div>}
      </header>

      <hr className="letter-rule" />

      {date && <div className="letter-date">{date}</div>}
      {recipient && <p className="letter-to">{recipient},</p>}
      {/* The title is the person's own label for the draft ("Stripe cover
          letter"), which is a filing name rather than a subject line — so it
          only appears when there is no recipient to address, where a page with
          nothing but body text reads as a fragment. */}
      {!recipient && title && <p className="letter-subject">{title}</p>}

      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.split("\n").map((line, lineIndex, lines) => (
            <span key={lineIndex}>
              {line}
              {lineIndex < lines.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
    </article>
  );
}
