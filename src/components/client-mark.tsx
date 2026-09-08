import { CodeIcon, MailIcon, PlugZapIcon, TerminalIcon } from "lucide-react";
import { clientMark } from "@/lib/mcp/marks";
import { cn } from "@/lib/utils";

/**
 * A client's logo, in its own colour, on a tile tinted from that colour.
 *
 * Three recipes have no logo because they are not products — "any MCP client",
 * "stdio-only client", "your own code" — so they get a plain glyph on the
 * neutral tile instead. So does a connection whose client id we no longer ship.
 * The fallback is a first-class state, not a broken one: nothing here ever
 * renders an empty box.
 */

const FALLBACK_GLYPHS: Record<string, typeof PlugZapIcon> = {
  "generic-http": PlugZapIcon,
  "stdio-bridge": TerminalIcon,
  raw: CodeIcon,
  // An IMAP account is any provider, so it has no brand to draw.
  imap: MailIcon,
};

export function ClientMark({
  client,
  size = 18,
  className,
}: {
  client: string;
  size?: number;
  className?: string;
}) {
  const mark = clientMark(client);
  if (!mark) {
    const Glyph = FALLBACK_GLYPHS[client] ?? PlugZapIcon;
    return <Glyph className={cn("text-muted-foreground", className)} style={{ width: size, height: size }} />;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-hidden
      className={cn("text-[color:var(--mark)] dark:text-[color:var(--mark-dark)]", className)}
      style={
        {
          "--mark": mark.light,
          "--mark-dark": mark.dark ?? mark.light,
        } as React.CSSProperties
      }
    >
      <path d={mark.path} fill="currentColor" />
    </svg>
  );
}

/**
 * The logo on a rounded tile — the shape every panel header in this app already
 * uses for its icon, so a connection row lines up with everything else.
 *
 * The tile picks up a wash of the brand colour rather than a flat grey, which
 * is what makes a list of six connections scannable at a glance. `color-mix`
 * keeps that wash honest in both themes: a percentage of the mark's own colour
 * over the card, never a hand-picked pastel that only works in one of them.
 */
export function ClientTile({
  client,
  size = 36,
  className,
}: {
  client: string;
  size?: number;
  className?: string;
}) {
  const mark = clientMark(client);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl",
        mark ? "bg-[var(--tile)] dark:bg-[var(--tile-dark)]" : "bg-inset",
        className,
      )}
      style={
        mark
          ? ({
              width: size,
              height: size,
              "--tile": `color-mix(in oklch, ${mark.light} 13%, transparent)`,
              "--tile-dark": `color-mix(in oklch, ${mark.dark ?? mark.light} 16%, transparent)`,
            } as React.CSSProperties)
          : { width: size, height: size }
      }
    >
      <ClientMark client={client} size={Math.round(size * 0.5)} />
    </span>
  );
}
