import Link from "next/link";
import { cn } from "@/lib/utils";
import { inlineSegments, toBlocks, type Segment } from "@/lib/markdown-lite";

/**
 * The little Markdown this app renders: headings, lists, paragraphs, bold and
 * code. No dependency, because markdown-lite already parses it.
 *
 * Shared by the background reader and the assistant drawer. The drawer turns
 * in-app paths into links, because its system prompt asks the model to write
 * them as /applications/<id> — and a path that is not a link is a dead end.
 */

/** The app's own top-level screens. A path is linked only when it starts with one. */
const APP_PATH = /(^|[\s(])(\/(?:applications|me|crm|resumes|tasks|archive|settings|analytics|docs)(?:\/[\w-]+)*)/g;

function withPathLinks(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(APP_PATH)) {
    const at = match.index! + match[1].length;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={at} href={match[2]} className="underline underline-offset-2">
        {match[2]}
      </Link>,
    );
    last = at + match[2].length;
  }
  if (last === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text, linkPaths = false }: { text: string; linkPaths?: boolean }) {
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
                  <Inline segments={inlineSegments(item)} linkPaths={linkPaths} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            <Inline segments={inlineSegments(block.text)} linkPaths={linkPaths} />
          </p>
        );
      })}
    </div>
  );
}

function Inline({ segments, linkPaths }: { segments: Segment[]; linkPaths: boolean }) {
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
        return <span key={index}>{linkPaths ? withPathLinks(segment.text) : segment.text}</span>;
      })}
    </>
  );
}
