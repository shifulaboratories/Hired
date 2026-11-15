/**
 * Setup recipes, one per AI client.
 *
 * The server speaks plain MCP Streamable HTTP with the token in the URL path,
 * which is the widest-support shape there is: no headers to configure, no OAuth
 * dance, and every recipe below is a single copy-paste. Clients that only speak
 * stdio get there through the `mcp-remote` bridge, so "my client isn't listed"
 * is never a dead end.
 *
 * Config formats were checked against each vendor's own documentation. They do
 * drift, so every card also carries a `docs` link, and the generic card at the
 * bottom works when a vendor has moved on without telling us.
 */

export type SetupStep = { text: string; code?: string; codeLabel?: string };

export type McpClientRecipe = {
  id: string;
  name: string;
  /** Grouping for the picker. */
  category: "chat" | "editor" | "terminal" | "any";
  /** One line under the name in the picker. */
  tagline: string;
  /** True when the client speaks remote HTTP MCP natively (no bridge needed). */
  native: boolean;
  docs: string;
  /** Link text. Defaults to "<name> MCP docs", which reads badly for the generic cards. */
  docsLabel?: string;
  steps: (url: string) => SetupStep[];
  /**
   * The page in the client where a server gets added, when the vendor has one
   * with a stable address. The setup panel turns it into a single button that
   * copies the URL and opens that page, so at most a paste is left. `href`
   * takes the connection URL so a client that can pre-fill its form from the
   * link gets it there too. Optional: a CLI or a config file has no page.
   */
  launch?: { href: (url: string) => string; label: string; prefills?: boolean };
};

const SERVER_NAME = "hired";

/** JSON with the URL substituted, pretty-printed the way a config file wants. */
const json = (value: unknown) => JSON.stringify(value, null, 2);

export const MCP_CLIENTS: McpClientRecipe[] = [
  {
    id: "claude",
    name: "Claude",
    category: "chat",
    tagline: "Web, desktop and mobile",
    native: true,
    // Checked against claude.com/docs/connectors/custom/remote-mcp in November
    // 2026: connectors moved from Settings to Customize, and every individual
    // plan can add one (Free is capped at one custom connector). The query
    // string pre-fills the Add custom connector dialog. Anthropic doesn't
    // document it, so it is treated as a bonus: if Claude ever ignores it, the
    // link still lands on the right page with the URL on the clipboard. The
    // token rides in the query, which puts it in this browser's history; it is
    // going to claude.ai either way, and the same person owns both ends.
    docs: "https://claude.com/docs/connectors/custom/remote-mcp",
    launch: {
      href: (url) =>
        `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Hired&connectorUrl=${encodeURIComponent(url)}`,
      label: "Add to Claude",
      prefills: true,
    },
    steps: (url) => [
      {
        text: "In Claude, open Customize → Connectors (claude.ai/customize/connectors) and choose Add → Add custom connector.",
      },
      { text: "Name it Hired and paste this as the server URL, unless both are already filled in:", code: url, codeLabel: "Connection URL" },
      {
        text: "Press Continue and leave authentication on No sign-in. The token in the URL is the sign-in. Then press Add.",
      },
      {
        text: "It shows up in Claude on the web, desktop and phone. On a Team or Enterprise plan only an Owner can add one, for the whole organization, so use a personal account: this URL opens your workspace to whoever holds it.",
      },
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    category: "terminal",
    tagline: "The CLI, in any project",
    native: true,
    docs: "https://code.claude.com/docs/en/mcp",
    steps: (url) => [
      {
        text: "Run this anywhere. --scope user makes it available in every project:",
        code: `claude mcp add --transport http --scope user ${SERVER_NAME} "${url}"`,
        codeLabel: "Terminal",
      },
      { text: "Check it took with `claude mcp list` — it should say ✔ Connected." },
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    category: "chat",
    tagline: "Custom MCP server",
    native: true,
    // Checked against OpenAI's own docs in November 2026. Developer mode is no
    // longer a step: custom servers are added straight from Plugins (what used
    // to be Connectors). There is no link that pre-fills the form, and the
    // plugin directory only lists servers that sign people in with OAuth, so
    // opening the right page with the URL already copied is as close to one
    // click as ChatGPT allows a self-hosted server today.
    docs: "https://developers.openai.com/api/docs/guides/custom-mcp-server",
    launch: { href: () => "https://chatgpt.com/plugins", label: "Copy URL and open ChatGPT" },
    steps: (url) => [
      {
        text: "In ChatGPT on the web, open Plugins (chatgpt.com/plugins), press + and choose Add custom MCP server.",
      },
      { text: "Name it Hired and paste this as the server URL:", code: url, codeLabel: "Connection URL" },
      {
        text: "Set authentication to No authentication. The token in the URL is the sign-in, so there is nothing else to fill in.",
      },
      {
        text: "Confirm the warning, choose Create as a plugin, then install it. ChatGPT asks before anything that writes; reads go through without asking.",
      },
      {
        text: "If you don't see Add custom MCP server, your plan doesn't offer it yet. OpenAI lists Business, Enterprise and Edu; on Plus and Pro it varies by account.",
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "editor",
    tagline: "~/.cursor/mcp.json",
    native: true,
    docs: "https://cursor.com/docs/context/mcp",
    steps: (url) => [
      {
        text: "Add this to ~/.cursor/mcp.json to get it everywhere, or .cursor/mcp.json inside a project to scope it there:",
        code: json({ mcpServers: { [SERVER_NAME]: { url } } }),
        codeLabel: "~/.cursor/mcp.json",
      },
      { text: "Reopen Cursor. The server shows up under Settings → MCP." },
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    category: "editor",
    tagline: "Copilot Chat, agent mode",
    native: true,
    docs: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    steps: (url) => [
      {
        text: "Add it from the terminal:",
        code: `code --add-mcp '${JSON.stringify({ name: SERVER_NAME, type: "http", url })}'`,
        codeLabel: "Terminal",
      },
      {
        text: "Or commit it to a project by hand:",
        code: json({ servers: { [SERVER_NAME]: { type: "http", url } } }),
        codeLabel: ".vscode/mcp.json",
      },
    ],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    category: "editor",
    tagline: "Cascade",
    native: true,
    docs: "https://docs.windsurf.com/windsurf/cascade/mcp",
    steps: (url) => [
      {
        text: "Add this to ~/.codeium/windsurf/mcp_config.json:",
        code: json({ mcpServers: { [SERVER_NAME]: { serverUrl: url } } }),
        codeLabel: "~/.codeium/windsurf/mcp_config.json",
      },
      { text: "Hit refresh in the Cascade MCP panel." },
    ],
  },
  {
    id: "generic-http",
    name: "Any MCP client",
    category: "any",
    tagline: "Standard remote-server config",
    native: true,
    docs: "https://modelcontextprotocol.io/docs/concepts/transports",
    docsLabel: "The MCP transport spec",
    steps: (url) => [
      {
        text: "Most clients take some version of this. If yours wants a transport name, it's Streamable HTTP:",
        code: json({ mcpServers: { [SERVER_NAME]: { type: "streamable-http", url } } }),
        codeLabel: "Config",
      },
      {
        text: "If it insists on an Authorization header instead of a token in the URL, drop the token from the path and send it as a bearer instead:",
        code: json({
          mcpServers: {
            [SERVER_NAME]: {
              type: "streamable-http",
              url: url.replace(/\/api\/mcp\/.*$/, "/api/mcp"),
              headers: { Authorization: `Bearer ${url.split("/").pop()}` },
            },
          },
        }),
        codeLabel: "Config (bearer token)",
      },
    ],
  },
  {
    id: "stdio-bridge",
    name: "Stdio-only client",
    category: "any",
    tagline: "Bridge via mcp-remote",
    native: false,
    docs: "https://github.com/geelen/mcp-remote",
    docsLabel: "mcp-remote on GitHub",
    steps: (url) => [
      {
        text: "Some clients only know how to launch a local command. mcp-remote bridges one to this server — it needs Node installed, and nothing else:",
        code: json({
          mcpServers: { [SERVER_NAME]: { command: "npx", args: ["-y", "mcp-remote", url] } },
        }),
        codeLabel: "Config",
      },
    ],
  },
  {
    id: "raw",
    name: "Your own code",
    category: "any",
    tagline: "Call the endpoint directly",
    native: true,
    docs: "https://modelcontextprotocol.io/specification",
    docsLabel: "The MCP specification",
    steps: (url) => [
      {
        text: "It's JSON-RPC 2.0 over POST. No session handshake to keep alive — every request stands alone:",
        code: `curl -s ${url} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
        codeLabel: "Terminal",
      },
      {
        text: "That's the older shape and it keeps working. On MCP 2026-07-28 there is no handshake at all: say which version you're speaking in the header and in _meta, mirror the method into Mcp-Method, and start with server/discover.",
        code: `curl -s ${url} \\\n  -H 'Content-Type: application/json' \\\n  -H 'MCP-Protocol-Version: 2026-07-28' \\\n  -H 'Mcp-Method: server/discover' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{\n        "io.modelcontextprotocol/protocolVersion":"2026-07-28",\n        "io.modelcontextprotocol/clientCapabilities":{}}}}'`,
        codeLabel: "Terminal (2026-07-28)",
      },
      {
        text: "Set Accept: text/event-stream if you'd rather have the reply as SSE. Both are supported. Send an Origin header only if you're calling from a browser — one that isn't this instance is refused.",
      },
    ],
  },
];

export const clientsById = new Map(MCP_CLIENTS.map((client) => [client.id, client]));

/** Label for a stored connection's client id, tolerant of ids we no longer ship. */
export function clientName(id: string) {
  return clientsById.get(id)?.name ?? "Other";
}

/**
 * Best guess at which client is calling, from its user-agent. Only used to show
 * "last used from …" — nothing is gated on it, so a wrong guess is cosmetic.
 */
export function guessClient(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("claude-code") || ua.includes("claude code")) return "Claude Code";
  if (ua.includes("claude")) return "Claude";
  if (ua.includes("openai") || ua.includes("chatgpt")) return "ChatGPT";
  if (ua.includes("cursor")) return "Cursor";
  if (ua.includes("code/") || ua.includes("vscode")) return "VS Code";
  if (ua.includes("windsurf") || ua.includes("codeium")) return "Windsurf";
  if (ua.includes("mcp-remote")) return "mcp-remote";
  if (ua.includes("node") || ua.includes("undici")) return "a script";
  if (ua.includes("curl")) return "curl";
  return "";
}
