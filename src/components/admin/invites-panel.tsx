"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  MailIcon,
  MailWarningIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionEmpty } from "@/components/page-header";
import { relativeDay } from "@/lib/utils";
import { useViewerZone } from "@/components/viewer-zone";
import { inviteUserAction, revokeInviteAction } from "@/server/actions";

type Invite = {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  expiresAt: string;
  emailSent: boolean;
  emailError: string;
  invitedBy: string;
};

export function InvitesPanel({
  invites,
  canInviteAdmins,
  emailReady,
  baseUrl,
}: {
  invites: Invite[];
  canInviteAdmins: boolean;
  emailReady: boolean;
  baseUrl: string;
}) {
  const zone = useViewerZone();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  // Empty is the normal invitation: they pick their own password on the accept
  // page and nobody here ever sees it. Typing one swaps that page for a
  // name-only form and puts the telling-them part on you.
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const invite = () => {
    if (!email.trim()) return;
    startTransition(async () => {
      const result = await inviteUserAction({
        email: email.trim(),
        role,
        password: password.trim() || undefined,
        mustChangePassword: mustChange,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEmail("");
      setPassword("");
      setMustChange(false);
      setLastLink(result.acceptUrl);
      if (result.passwordSet) {
        // The one thing that can go wrong silently: they get a link, no
        // password, and no idea one exists. Said loudly and left up.
        toast.warning("Invite created — send them the password yourself, it isn't in the email", {
          duration: 10000,
        });
      } else if (result.emailSent) toast.success(`Invitation emailed`);
      else toast.warning("Invite created — send the link yourself", { duration: 6000 });
    });
  };

  const visible = invites.filter((item) => !removed.has(item.id));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Invite someone</CardTitle>
          <p className="text-muted-foreground text-sm">
            {emailReady
              ? "They'll get an email with a link to pick a password."
              : "Email isn't configured yet, so you'll get a link to send them yourself. Set up Resend under Configuration to automate it."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[16rem] flex-1 space-y-1.5">
              <Label>Email address</Label>
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && invite()}
                placeholder="teammate@example.com"
                type="email"
              />
            </div>
            <div className="w-36 space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  {canInviteAdmins && <SelectItem value="ADMIN">Admin</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="default" onClick={invite} disabled={pending || !email.trim()}>
                {pending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
                Send invite
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="invite-password">Password (optional)</Label>
              <Input
                id="invite-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && invite()}
                placeholder="Leave empty and they pick their own"
                type="text"
                autoComplete="off"
                minLength={10}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {password.trim()
                ? "The accept page will only ask for their name. The password is deliberately not in the invitation email — send it to them another way, or they can't sign in."
                : "The usual way: the accept page asks them to choose one, and nobody here ever sees it."}
            </p>
            {password.trim() && (
              <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[13px]">
                <Checkbox
                  checked={mustChange}
                  onCheckedChange={(value) => setMustChange(value === true)}
                  className="mt-0.5"
                />
                <span>
                  Make them replace it when they first sign in
                  <span className="text-muted-foreground block text-xs">
                    Otherwise the password you chose stays theirs, and you know it.
                  </span>
                </span>
              </label>
            )}
          </div>

          {lastLink && <CopyableLink url={lastLink} />}
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <SectionEmpty>Nothing outstanding — everyone invited has already joined.</SectionEmpty>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {visible.map((item) => (
              <motion.div key={item.id} layout exit={{ opacity: 0, height: 0 }}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-3 py-3.5">
                    <div
                      className={
                        item.emailSent
                          ? "bg-success-tint text-success flex size-8 shrink-0 items-center justify-center rounded-lg"
                          : "bg-warning-tint text-warning flex size-8 shrink-0 items-center justify-center rounded-lg"
                      }
                    >
                      {item.emailSent ? (
                        <MailIcon className="size-4" />
                      ) : (
                        <MailWarningIcon className="size-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.email}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        invited by {item.invitedBy} · expires {relativeDay(new Date(item.expiresAt), zone)}
                        {!item.emailSent && item.emailError && (
                          <span className="text-destructive"> · {item.emailError}</span>
                        )}
                      </div>
                    </div>

                    <Badge variant={item.role === "MEMBER" ? "outline" : "default"}>
                      {item.role === "MEMBER" ? "Member" : "Admin"}
                    </Badge>

                    <CopyButton url={`${baseUrl.replace(/\/$/, "")}/invite/${item.token}`} />

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setRemoved((prev) => new Set(prev).add(item.id));
                        void revokeInviteAction(item.id);
                        toast.success("Invitation revoked");
                      }}
                      aria-label={`Revoke invite for ${item.email}`}
                    >
                      <Trash2Icon />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function CopyableLink({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
      <CopyButton url={url} withLabel />
    </div>
  );
}

function CopyButton({ url, withLabel = false }: { url: string; withLabel?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={withLabel ? "outline" : "ghost"}
      size={withLabel ? "sm" : "icon-sm"}
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        toast.success("Invite link copied");
        setTimeout(() => setCopied(false), 2000);
      }}
      aria-label="Copy invite link"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {withLabel && (copied ? "Copied" : "Copy link")}
    </Button>
  );
}
