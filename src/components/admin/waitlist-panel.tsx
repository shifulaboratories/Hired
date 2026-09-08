"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  LoaderCircleIcon,
  MailWarningIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionEmpty } from "@/components/page-header";
import { relativeDay } from "@/lib/utils";
import { useViewerZone } from "@/components/viewer-zone";
import { inviteFromWaitlistAction, removeWaitlistSignupAction } from "@/server/actions";

type Entry = {
  id: string;
  email: string;
  name: string;
  context: string;
  source: string;
  notified: boolean;
  notifyError: string;
  invitedAt: string | null;
  createdAt: string;
};

export function WaitlistPanel({ entries }: { entries: Entry[] }) {
  const zone = useViewerZone();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [lastLink, setLastLink] = useState<string | null>(null);

  const visible = entries.filter((item) => !removed.has(item.id));
  const waiting = visible.filter((item) => !item.invitedAt && !invited.has(item.id));
  const done = visible.filter((item) => item.invitedAt || invited.has(item.id));

  if (visible.length === 0) {
    return (
      <SectionEmpty>
        Nobody has asked yet. Requests from the sign-up form on your marketing site land here.
      </SectionEmpty>
    );
  }

  return (
    <div className="space-y-6">
      {lastLink && <CopyableLink url={lastLink} />}

      {waiting.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {waiting.map((item) => (
              <motion.div key={item.id} layout exit={{ opacity: 0, height: 0 }}>
                <Row
                  entry={item}
                  onInvited={(url) => {
                    setInvited((prev) => new Set(prev).add(item.id));
                    setLastLink(url);
                  }}
                  onRemoved={() => setRemoved((prev) => new Set(prev).add(item.id))}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Already invited
          </p>
          {done.map((item) => (
            <Card key={item.id} className="opacity-70">
              <CardContent className="flex flex-wrap items-center gap-3 py-3.5">
                <div className="bg-success-tint text-success flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <CheckIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.email}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    asked {relativeDay(new Date(item.createdAt), zone)}
                    {item.invitedAt && ` · invited ${relativeDay(new Date(item.invitedAt), zone)}`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setRemoved((prev) => new Set(prev).add(item.id));
                    void removeWaitlistSignupAction(item.id);
                    toast.success("Removed from the list");
                  }}
                  aria-label={`Remove ${item.email} from the waitlist`}
                >
                  <Trash2Icon />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  entry,
  onInvited,
  onRemoved,
}: {
  entry: Entry;
  onInvited: (acceptUrl: string) => void;
  onRemoved: () => void;
}) {
  const zone = useViewerZone();
  const [pending, startTransition] = useTransition();

  const invite = () =>
    startTransition(async () => {
      const result = await inviteFromWaitlistAction({ id: entry.id, role: "MEMBER" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onInvited(result.acceptUrl);
      if (result.emailSent) toast.success(`Invitation emailed to ${entry.email}`);
      else toast.warning("Invite created — send the link yourself", { duration: 6000 });
    });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-3 py-3.5">
        <div
          className={
            entry.notified
              ? "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
              : "bg-warning-tint text-warning flex size-8 shrink-0 items-center justify-center rounded-lg"
          }
          title={entry.notified ? undefined : `You weren't emailed: ${entry.notifyError}`}
        >
          {entry.notified ? <ClockIcon className="size-4" /> : <MailWarningIcon className="size-4" />}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-sm font-medium">
            {entry.name ? `${entry.name} · ${entry.email}` : entry.email}
          </div>
          {entry.context && <p className="text-muted-foreground text-xs">{entry.context}</p>}
          <div className="text-muted-foreground truncate text-xs">
            asked {relativeDay(new Date(entry.createdAt), zone)}
            {entry.source && ` · from ${entry.source}`}
          </div>
        </div>

        {!entry.notified && <Badge variant="outline">You weren&rsquo;t emailed</Badge>}

        <Button size="sm" onClick={invite} disabled={pending}>
          {pending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
          Invite
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => {
            onRemoved();
            void removeWaitlistSignupAction(entry.id);
            toast.success("Removed from the list");
          }}
          aria-label={`Remove ${entry.email} from the waitlist`}
        >
          <Trash2Icon />
        </Button>
      </CardContent>
    </Card>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success("Invite link copied");
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
