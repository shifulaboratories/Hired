"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns3Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { setPipelineFieldsAction } from "@/server/actions";
import {
  FIELDS,
  VIEW_LABEL,
  storedFields,
  type PipelineView,
} from "@/lib/pipeline-fields";

/**
 * How much each view shows before you open anything.
 *
 * It sits in the pipeline toolbar rather than in Settings, because it is about
 * the screen you are looking at and the answer is different for each of the
 * three. The catalogue is per-view for the same reason: a board card and a
 * calendar chip have nothing in common except that both can be too busy.
 *
 * The choice is stored on the profile, not in the URL: a saved view is a cut of
 * the data, and how much of each row you like seeing is not.
 */
export function FieldsMenu({
  view,
  visible,
}: {
  view: PipelineView;
  visible: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Local, not derived from the prop. The prop only moves after the action and
  // router.refresh() have both landed, so two clicks in quick succession would
  // each compute their payload from the pre-first-click set and the second
  // would silently undo the first. It also means the box responds on click
  // rather than after a round trip.
  const [on, setOn] = useState<Set<string>>(() => new Set(visible));
  useEffect(() => setOn(new Set(visible)), [visible]);
  const catalogue = FIELDS[view];

  const toggle = (key: string) => {
    const next = new Set(on);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOn(next);
    startTransition(async () => {
      try {
        await setPipelineFieldsAction(view, storedFields(view, next));
        router.refresh();
      } catch (error) {
        setOn(on);
        toast.error(error instanceof Error ? error.message : "Could not save that.");
      }
    });
  };

  const reset = () =>
    startTransition(async () => {
      try {
        // The empty array is "I have never chosen", which is what puts the
        // defaults back — including any field added to the catalogue since.
        await setPipelineFieldsAction(view, []);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not reset that.");
      }
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label={`Choose what the ${VIEW_LABEL[view].toLowerCase()} shows`}
          aria-busy={pending}
        >
          <Columns3Icon />
          Fields
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <p className="text-faint px-1 pb-1.5 text-[11.5px]">
          What the {VIEW_LABEL[view].toLowerCase()} shows before you open anything.
        </p>
        <ul>
          {catalogue.map((field) => (
            <li key={field.key}>
              <label className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-control px-1.5 py-1.5 text-[13px]">
                <Checkbox
                  checked={on.has(field.key)}
                  onCheckedChange={() => toggle(field.key)}
                  aria-label={field.label}
                />
                <span className="min-w-0 flex-1 truncate">{field.label}</span>
                {field.wide && (
                  <span className="text-faint shrink-0 text-[11px]">wide screens</span>
                )}
              </label>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground mt-1 w-full"
          onClick={reset}
          disabled={pending}
        >
          Back to the defaults
        </Button>
      </PopoverContent>
    </Popover>
  );
}
