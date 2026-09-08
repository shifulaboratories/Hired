"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SERVER_ZONE } from "@/lib/time";
import { setTimeZoneAction } from "@/server/actions";

/**
 * Whose calendar the screen is drawing.
 *
 * Server components take the zone as an argument — they have the userId and can
 * read it. Client components cannot, and threading it down through every card
 * that prints "Tomorrow" would be a prop on half the tree, so it arrives here
 * once from the layout instead.
 *
 * What arrives is always a NAME, never the stored empty string. Empty means
 * "this machine's clock", which is the server's on one side of a hydration and
 * the reader's on the other — two different days for one render, and React
 * throws the markup away. The layout resolves it before it gets here.
 *
 * The default outside the provider stays empty, because a component rendered
 * there is rendered in a browser and the browser's clock is the reader's.
 */
const ViewerZone = createContext(SERVER_ZONE);

export function useViewerZone(): string {
  return useContext(ViewerZone);
}

/**
 * Provides the zone, and fills it in the first time somebody with none is seen.
 *
 * The seeding is the whole reason a person never has to find this setting:
 * `Intl` already knows where the browser is, so the first page load after this
 * ships stores it, the server starts agreeing with the clock in the corner of
 * the screen, and Settings is there for the one case the browser is wrong —
 * a laptop in one place and a job search in another.
 *
 * It fires once per mount and only when nothing is stored; the action refuses
 * to overwrite a zone that has been set, so a second tab racing the first
 * cannot undo a deliberate choice.
 */
export function ViewerZoneProvider({
  zone,
  stored,
  children,
}: {
  /** An IANA name, always — the host's own if this person has not set one. */
  zone: string;
  /** What is actually on the profile. Empty is what the seeding below fills. */
  stored: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const seeded = useRef(false);

  useEffect(() => {
    if (stored || seeded.current) return;
    seeded.current = true;
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!guess) return;
    // The refresh is what makes the server components on screen re-render with
    // the zone that was just stored. It is dropped if this provider has gone —
    // a refresh landing after the reader has already navigated away is a tree
    // React has to reconcile against a page nobody is looking at.
    let live = true;
    setTimeZoneAction(guess, { seeded: true })
      .then((result) => {
        if (live && !result.skipped) router.refresh();
      })
      // Nothing to tell anyone: the app keeps using the server's clock, which
      // is what it did before this existed.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [stored, router]);

  return <ViewerZone.Provider value={zone}>{children}</ViewerZone.Provider>;
}
