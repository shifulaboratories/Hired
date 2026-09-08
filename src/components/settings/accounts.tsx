"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarIcon,
  CheckIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MailIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ClientTile } from "@/components/client-mark";
import { cn } from "@/lib/utils";
import { agoDay } from "@/lib/utils";
import {
  connectImapAccountAction,
  disconnectAccountAction,
  renameAccountAction,
  testAccountAction,
} from "@/server/actions";

/**
 * The account side of Settings → Connections: what the workspace reads on
 * your behalf.
 *
 * Three ways in, one shape out. Google and Microsoft 365 are a consent
 * screen, so their "connect" is a link; IMAP and CalDAV are a form, because
 * an app password has to be typed somewhere. All three land as the same
 * tile, open the same slide-over, and are tested and disconnected the same
 * way. Nothing read through any of them is stored, and the copy says so
 * wherever a person is about to hand over an inbox.
 */

export type AccountView = {
  id: string;
  provider: "GOOGLE" | "MICROSOFT" | "IMAP";
  providerLabel: string;
  email: string;
  label: string;
  mail: boolean;
  calendar: boolean;
  imapHost: string;
  caldavUrl: string;
  connectedAt: string;
  lastUsedAt: string | null;
  lastError: string;
};

/** The tile's mark id and the words for each half, per provider. */
export function markFor(provider: AccountView["provider"]) {
  return provider.toLowerCase();
}

export function featureWords(provider: AccountView["provider"]) {
  return {
    mail: provider === "GOOGLE" ? "Gmail" : provider === "MICROSOFT" ? "Outlook" : "IMAP",
    calendar: provider === "IMAP" ? "CalDAV" : "Calendar",
  };
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

export function AccountSheet({
  account,
  open,
  onOpenChange,
  onReconnectImap,
}: {
  account: AccountView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reconnecting an IMAP account is the form again, prefilled. */
  onReconnectImap: (account: AccountView) => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(account.label);
  const [test, setTest] = useState<
    | null
    | { error: string }
    | { mail: { ok: boolean; detail: string } | null; calendar: { ok: boolean; detail: string } | null }
  >(null);
  const [testing, startTest] = useTransition();
  const [pending, startTransition] = useTransition();
  const words = featureWords(account.provider);

  const runTest = () =>
    startTest(async () => {
      setTest(null);
      const result = await testAccountAction(account.id);
      setTest(result.ok ? { mail: result.mail, calendar: result.calendar } : { error: result.error });
      router.refresh();
    });

  const commitLabel = () =>
    startTransition(async () => {
      if (label.trim() === account.label) return;
      await renameAccountAction(account.id, label);
      toast.success("Renamed");
    });

  const remove = () =>
    startTransition(async () => {
      await disconnectAccountAction(account.id);
      toast.success(`${account.email} disconnected`);
      onOpenChange(false);
    });

  const reconnectHref =
    account.provider === "GOOGLE"
      ? "/api/auth/google?data=1"
      : account.provider === "MICROSOFT"
        ? "/api/auth/microsoft"
        : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-xl sm:p-6">
        <div className="flex items-start gap-3">
          <ClientTile client={markFor(account.provider)} size={44} />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[17px] font-semibold tracking-tight">
              {account.label || account.providerLabel}
            </SheetTitle>
            <SheetDescription className="mt-0.5 text-xs">
              {account.email}
              {" · "}
              connected {agoDay(account.connectedAt).toLowerCase()}
              {account.lastUsedAt
                ? ` · last read ${agoDay(account.lastUsedAt).toLowerCase()}`
                : " · nothing read yet"}
            </SheetDescription>
          </div>
          <Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
            {testing ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ZapIcon className="size-3.5" />
            )}
            Test
          </Button>
        </div>

        {test && "error" in test && (
          <p className="text-destructive mt-4 flex items-start gap-1.5 text-[13px]">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {test.error}
          </p>
        )}

        {account.lastError && !(test && !("error" in test)) && (
          <p className="text-destructive mt-4 flex items-start gap-1.5 text-[13px]">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            The last read failed: {account.lastError}
          </p>
        )}

        <div className="mt-6 space-y-6">
          <ul className="space-y-3">
            <Half
              on={account.mail}
              icon={<MailIcon className="size-3.5" />}
              label={words.mail}
              detail={account.provider === "IMAP" && account.imapHost ? account.imapHost : undefined}
              result={test && !("error" in test) ? test.mail : null}
            >
              Threads with the people and companies on your pipeline, matched by their address and
              domain. Searchable by an assistant.
            </Half>
            <Half
              on={account.calendar}
              icon={<CalendarIcon className="size-3.5" />}
              label={words.calendar}
              detail={account.provider === "IMAP" && account.caldavUrl ? account.caldavUrl : undefined}
              result={test && !("error" in test) ? test.calendar : null}
            >
              Interviews and calls with anyone on your pipeline, on the pipeline&apos;s calendar
              view and next to the application.
            </Half>
          </ul>

          {(!account.mail || !account.calendar) && (
            <p className="text-faint text-xs leading-snug">
              {account.provider === "IMAP"
                ? "The missing half was left out when this was connected. Reconnect and fill it in to turn it on."
                : "The missing half was unticked on the consent screen. Reconnect and tick it to turn it on."}
            </p>
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor={`label-${account.id}`}>Name</Label>
            <Input
              id={`label-${account.id}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitLabel();
              }}
              placeholder={account.providerLabel}
              className="max-w-64"
            />
            <p className="text-faint text-xs">What the tile says. &quot;Work&quot;, &quot;Old address&quot;.</p>
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground max-w-sm text-xs">
              Disconnecting {account.provider === "GOOGLE" ? "revokes the token at Google and " : ""}
              deletes the credential here. Nothing else changes: nothing from this account was ever
              stored.
            </p>
            <div className="flex gap-2">
              {reconnectHref ? (
                <Button asChild variant="outline" size="sm">
                  <a href={reconnectHref}>Reconnect</a>
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onReconnectImap(account)}>
                  Reconnect
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={remove}
                disabled={pending}
              >
                Disconnect
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Half({
  on,
  icon,
  label,
  detail,
  result,
  children,
}: {
  on: boolean;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  result: { ok: boolean; detail: string } | null;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md",
          on ? "bg-[var(--success-tint)] text-[var(--success)]" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">
          {label}
          <span className="text-faint ml-1.5 font-normal">{on ? "on" : "not connected"}</span>
          {detail && <span className="text-faint ml-1.5 font-mono text-[11px] font-normal">{detail}</span>}
        </p>
        <p className="text-muted-foreground text-xs leading-snug">{children}</p>
        {result && (
          <p
            className={cn(
              "mt-1 flex items-start gap-1 text-xs",
              result.ok ? "text-success" : "text-destructive",
            )}
          >
            {result.ok ? (
              <CheckIcon className="mt-0.5 size-3 shrink-0" />
            ) : (
              <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
            )}
            {result.detail}
          </p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// IMAP and CalDAV
// ---------------------------------------------------------------------------

type Preset = { id: string; name: string; imapHost: string; imapPort: number; caldavUrl: string; hint: string };

const PRESETS: Preset[] = [
  {
    id: "fastmail",
    name: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    caldavUrl: "https://caldav.fastmail.com/",
    hint: "Settings → Privacy & Security → Integrations → New app password, with Mail and Calendars access. One password does both.",
  },
  {
    id: "icloud",
    name: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    caldavUrl: "https://caldav.icloud.com/",
    hint: "appleid.apple.com → Sign-In and Security → App-Specific Passwords. Username is your full iCloud address. One password does both.",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    caldavUrl: "https://caldav.calendar.yahoo.com/",
    hint: "Account Security → Generate app password. Username is your full address.",
  },
  { id: "custom", name: "Something else", imapHost: "", imapPort: 993, caldavUrl: "", hint: "" },
];

export function ImapSheet({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reconnecting: the account's address and servers, never its passwords. */
  prefill: AccountView | null;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<string>(
    prefill ? (PRESETS.find((p) => p.imapHost && p.imapHost === prefill.imapHost)?.id ?? "custom") : "fastmail",
  );
  const [form, setForm] = useState({
    email: prefill?.email ?? "",
    label: prefill?.label ?? "",
    imapHost: prefill?.imapHost ?? PRESETS[0].imapHost,
    imapPort: "993",
    imapUsername: "",
    imapPassword: "",
    caldavUrl: prefill?.caldavUrl ?? PRESETS[0].caldavUrl,
    caldavUsername: "",
    caldavPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS[PRESETS.length - 1];

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const pick = (id: string) => {
    setPreset(id);
    const next = PRESETS.find((p) => p.id === id);
    if (next && next.id !== "custom") {
      set({ imapHost: next.imapHost, imapPort: String(next.imapPort), caldavUrl: next.caldavUrl });
    }
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await connectImapAccountAction({
        email: form.email,
        label: form.label,
        imapHost: form.imapHost,
        imapPort: Number(form.imapPort) || 993,
        imapUsername: form.imapUsername,
        imapPassword: form.imapPassword,
        caldavUrl: form.caldavUrl,
        caldavUsername: form.caldavUsername,
        caldavPassword: form.caldavPassword,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${result.account.email} connected`);
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-xl sm:p-6">
        <SheetTitle className="text-[17px] font-semibold tracking-tight">
          {prefill ? "Reconnect" : "Connect"} by IMAP and CalDAV
        </SheetTitle>
        <SheetDescription className="mt-1 text-xs leading-relaxed">
          Use an <strong>app password</strong> from your provider&apos;s security settings, never
          the account password. Both servers are logged in to before anything is saved. Leave
          either half blank to connect only the other.
        </SheetDescription>

        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id)}
                aria-pressed={preset === p.id}
                className={cn(
                  "flex min-h-11 items-center rounded-control border px-2.5 text-xs font-medium transition-colors md:min-h-8",
                  preset === p.id
                    ? "border-primary/50 bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          {chosen.hint && <p className="text-muted-foreground text-xs leading-snug">{chosen.hint}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email address" value={form.email} onChange={(email) => set({ email })} placeholder="you@fastmail.com" type="email" autoFocus={!prefill} />
            <Field label="Name (optional)" value={form.label} onChange={(label) => set({ label })} placeholder="Personal" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <MailIcon className="size-3.5" /> Mail
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
              <Field label="IMAP server" value={form.imapHost} onChange={(imapHost) => set({ imapHost })} placeholder="imap.example.com" />
              <Field label="Port" value={form.imapPort} onChange={(imapPort) => set({ imapPort })} placeholder="993" inputMode="numeric" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username" value={form.imapUsername} onChange={(imapUsername) => set({ imapUsername })} placeholder="Defaults to the address" />
              <Field label="App password" value={form.imapPassword} onChange={(imapPassword) => set({ imapPassword })} type="password" autoComplete="new-password" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <CalendarIcon className="size-3.5" /> Calendar
            </div>
            <Field label="CalDAV URL" value={form.caldavUrl} onChange={(caldavUrl) => set({ caldavUrl })} placeholder="https://caldav.example.com/" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username" value={form.caldavUsername} onChange={(caldavUsername) => set({ caldavUsername })} placeholder="Same as mail" />
              <Field label="App password" value={form.caldavPassword} onChange={(caldavPassword) => set({ caldavPassword })} type="password" placeholder="Same as mail" autoComplete="new-password" />
            </div>
          </div>

          {error && (
            <p className="text-destructive flex items-start gap-1.5 text-[13px]">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending || !form.email.trim()}>
              {pending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
              {pending ? "Checking" : prefill ? "Reconnect" : "Connect"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const id = `imap-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </div>
  );
}
