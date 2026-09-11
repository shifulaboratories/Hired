"use client";

import { useState, useTransition } from "react";
import { MailIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendDigestNowAction, setDigestSettingsAction } from "@/server/actions";

/**
 * The two emails this app can send, and the switches that turn them on.
 *
 * Both off until somebody asks. Nothing else in this product reaches out, and
 * the first upgrade after this shipped must not be the day that changed — so
 * there is no default-on, no admin override and no "we noticed you have not
 * logged in" third message.
 *
 * The copy says what each one does and, for the nudge, what it does NOT do:
 * "sends nothing on a quiet day" is the sentence that makes somebody willing
 * to turn a daily email on.
 */
export function DigestPanel({
  initial,
}: {
  initial: {
    weeklyDigest: boolean;
    dailyNudge: boolean;
    digestHour: number;
    emailConfigured: boolean;
  };
}) {
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();

  const save = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    start(async () => {
      try {
        await setDigestSettingsAction({
          weeklyDigest: next.weeklyDigest,
          dailyNudge: next.dailyNudge,
          digestHour: next.digestHour,
        });
      } catch (error) {
        setValues(values);
        toast.error(error instanceof Error ? error.message : "Could not save that.");
      }
    });
  };

  const sendNow = (kind: "weekly" | "nudge") =>
    start(async () => {
      const outcome = await sendDigestNowAction(kind);
      if (outcome.sent) toast.success(`Sent to ${outcome.to}.`);
      else toast.error(outcome.reason);
    });

  const on = values.weeklyDigest || values.dailyNudge;

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <MailIcon className="text-muted-foreground size-3.5" />
          Email
        </p>
        <p className="text-muted-foreground text-xs">
          {values.emailConfigured
            ? "Nothing leaves this app unless you ask for it. These two can."
            : "This instance cannot send mail yet — an admin needs to set it up under Admin → Configuration → Email. Until then these switches do nothing."}
        </p>
      </div>

      <Row
        title="A summary on Monday"
        detail="Where the search stands, what moved last week, what is coming, and the one thing worth fixing."
        checked={values.weeklyDigest}
        disabled={pending || !values.emailConfigured}
        onChange={(weeklyDigest) => save({ weeklyDigest })}
        onSend={() => sendNow("weekly")}
      />

      <Row
        title="A nudge when something is due"
        detail="An offer to answer, a company to chase, a task. Sends nothing on a day nothing is due."
        checked={values.dailyNudge}
        disabled={pending || !values.emailConfigured}
        onChange={(dailyNudge) => save({ dailyNudge })}
        onSend={() => sendNow("nudge")}
      />

      {on && (
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Sent at</span>
          <Select
            value={String(values.digestHour)}
            onValueChange={(hour) => save({ digestHour: Number(hour) })}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, hour) => (
                <SelectItem key={hour} value={String(hour)}>
                  {String(hour).padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">your time</span>
        </label>
      )}
    </div>
  );
}

function Row({
  title,
  detail,
  checked,
  disabled,
  onChange,
  onSend,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  onSend: () => void;
}) {
  return (
    <div className="bg-muted/40 flex items-start justify-between gap-3 rounded-md px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {checked && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-faint"
            onClick={onSend}
            disabled={disabled}
            aria-label="Send me one now"
            title="Send me one now"
          >
            <SendIcon />
          </Button>
        )}
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}
