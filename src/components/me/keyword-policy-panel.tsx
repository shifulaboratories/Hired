"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChipInput } from "@/components/chip-input";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import {
  KEYWORD_POLICIES,
  POLICY_BLURB,
  POLICY_LABEL,
  type KeywordPolicy,
} from "@/lib/keyword-policy";
import {
  createTransferableAction,
  deleteTransferableAction,
  saveProfileAction,
  updateTransferableAction,
} from "@/server/actions";

/**
 * How close to a posting's words a document may get, and what transfers.
 *
 * Applicant tracking systems screen on exact tokens, so a person who has run
 * Salesforce for three years gets cut over HubSpot — a tool they could be
 * productive in inside a week. Three named levels rather than a slider, because
 * a number between 1 and 10 tells an assistant nothing it can act on, and
 * because each level has to say in words what it permits.
 *
 * The transfers below are what makes the top level safe to use: a recorded
 * bridge is one the PERSON stands behind and can answer for in a room. Nothing
 * is inferred, and a bridge they have not written down does not exist.
 */

type Row = { id: string; have: string; covers: string[]; note: string };

export function KeywordPolicyPanel({
  policy: initial,
  transferables,
}: {
  policy: KeywordPolicy;
  transferables: Row[];
}) {
  const [policy, setPolicy] = useState<KeywordPolicy>(initial);
  // Removed rows are hidden locally until the revalidate catches up, the same
  // way the extras panel does it — the list itself comes from the server so an
  // add and a refresh cannot disagree about what exists.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const rows = transferables.filter((row) => !removed.has(row.id));

  const choose = (next: KeywordPolicy) => {
    setPolicy(next);
    startTransition(async () => {
      await saveProfileAction({ keywordPolicy: next });
    });
  };

  const add = () => {
    startTransition(async () => {
      // A placeholder rather than an empty string: createTransferable refuses a
      // nameless transfer, and it should — a tool that can file one is a tool
      // that can file nothing at all. "New group" is the same shape the extras
      // panel uses beside this one.
      await createTransferableAction({ have: "New tool", covers: [], note: "" });
      toast.success("Added. Say what it is and what it covers.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Keywords</CardTitle>
        <p className="text-muted-foreground mt-1 text-sm">
          Screening software matches exact words. This is how close to a posting&rsquo;s own
          wording your documents are allowed to get. None of these lets anything claim you did
          work somewhere you didn&rsquo;t.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          {KEYWORD_POLICIES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => choose(option)}
              aria-pressed={policy === option}
              className={cn(
                "block w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
                policy === option
                  ? "border-ring bg-accent"
                  : "border-input hover:bg-accent/50",
              )}
            >
              <div className="text-[13.5px] font-medium">{POLICY_LABEL[option]}</div>
              <div className="text-muted-foreground mt-0.5 text-[12.5px]">
                {POLICY_BLURB[option]}
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-[13px]">What transfers</Label>
              <p className="text-muted-foreground mt-0.5 text-[12.5px]">
                Something you have actually used, and the tools it covers. Only these are
                offered, and only on the third setting — nothing is guessed for you.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={add} disabled={pending}>
              <PlusIcon /> Add
            </Button>
          </div>

          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <TransferableRow
                key={row.id}
                row={row}
                onRemoved={() => setRemoved((old) => new Set(old).add(row.id))}
              />
            ))}
          </AnimatePresence>

          {rows.length === 0 && (
            <p className="text-faint text-[12.5px]">
              Nothing yet. &ldquo;Salesforce&rdquo; covering &ldquo;HubSpot, Pipedrive&rdquo; is
              the shape of it.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TransferableRow({ row, onRemoved }: { row: Row; onRemoved: () => void }) {
  const [values, setValues] = useState({ have: row.have, covers: row.covers, note: row.note });
  const { state, push } = useAutosave<typeof values>((next) =>
    updateTransferableAction(row.id, next),
  );

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  return (
    <motion.div
      layout
      exit={{ opacity: 0, height: 0 }}
      className="group border-input space-y-2 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <Input
          value={values.have}
          onChange={(event) => set({ have: event.target.value })}
          placeholder="What you have used, e.g. Salesforce"
          className="h-9 flex-1 md:h-8"
        />
        <SaveIndicator state={state} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${values.have || "transferable"}`}
          className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => {
            onRemoved();
            void deleteTransferableAction(row.id).then(() => toast.success("Removed."));
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      <ChipInput
        noun="tool it covers"
        values={values.covers}
        onChange={(covers) => set({ covers })}
        placeholder="Covers: HubSpot, Pipedrive"
      />
      <Input
        value={values.note}
        onChange={(event) => set({ note: event.target.value })}
        placeholder="Why it transfers — the answer you would give if asked"
        className="h-9 md:h-8"
      />
    </motion.div>
  );
}
