"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ApplicationDetail } from "@/components/pipeline/application-detail";
import { getApplicationForPanelAction } from "@/server/actions";

type Payload = Awaited<ReturnType<typeof getApplicationForPanelAction>>;

const OpenApplication = createContext<((id: string) => void) | null>(null);

/** Opens the panel. Null outside the provider, so a card can fall back to a link. */
export function useOpenApplication() {
  return useContext(OpenApplication);
}

/**
 * The application detail, over the board instead of instead of it.
 *
 * Opening a card used to replace the whole page, which meant losing your place
 * on the board every time you glanced at something — and the board is the thing
 * you are working from. The panel keeps the board underneath and behind it.
 *
 * The data is fetched when the panel opens rather than shipped with every card:
 * a board of thirty applications would otherwise send thirty job descriptions
 * and thirty activity timelines to the browser to show none of them.
 * `/applications/[id]` stays a real page, so links from the calendar, a
 * company or an email still work.
 */
export function ApplicationPanelProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  // Bumped to re-run the fetch below. router.refresh() cannot do it: the
  // panel's contents come from a server ACTION held in this component's state,
  // not from the route, so refreshing the page underneath leaves everything
  // here on the snapshot taken when it opened.
  const [nonce, setNonce] = useState(0);
  const router = useRouter();

  const open = useCallback((next: string) => {
    setId(next);
    setData(null);
  }, []);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getApplicationForPanelAction(id)
      .then((payload) => {
        if (live) setData(payload);
      })
      .catch((error) => {
        if (!live) return;
        toast.error(error instanceof Error ? error.message : "Could not open that.");
        setId(null);
      });
    return () => {
      live = false;
    };
  }, [id, nonce]);

  return (
    <OpenApplication.Provider value={open}>
      {children}
      <Sheet
        open={id !== null}
        onOpenChange={(next) => {
          if (next) return;
          setId(null);
          setData(null);
          // The board behind may be stale — a stage moved, a note logged.
          router.refresh();
        }}
      >
        <SheetContent className="p-5 sm:p-6">
          {data ? (
            <>
              <SheetTitle className="sr-only">
                {data.application.company} — {data.application.roleTitle}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Everything on file for this application.
              </SheetDescription>

              {/* The company's CRM link lives inside ApplicationDetail now,
                  under the role title, so the page and the panel agree. */}
              <div className="mb-3 flex items-center gap-2">
                <Button asChild variant="ghost" size="xs" className="text-muted-foreground -ml-1.5">
                  <Link href={`/applications/${data.application.id}`}>
                    <ExternalLinkIcon /> Open as a page
                  </Link>
                </Button>
              </div>

              <ApplicationDetail
                application={data.application}
                activities={data.activities}
                contacts={data.contacts}
                tasks={data.tasks}
                resumes={data.resumes}
                tagOptions={data.tagOptions}
                fieldValues={data.fieldValues}
                company={data.company}
                companies={data.companies}
                resumePreview={data.resumePreview}
                logos={data.logos}
                googleAccess={data.googleAccess}
                onServerChange={reload}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <SheetTitle className="sr-only">Loading application</SheetTitle>
              <LoaderCircleIcon className="text-faint size-5 animate-spin" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </OpenApplication.Provider>
  );
}
