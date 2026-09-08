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
 * The default is deliberately the empty string rather than the browser's zone:
 * empty means "this machine's clock", which in a browser IS the reader's, so a
 * component rendered outside the provider still says something true.
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
  children,
}: {
  zone: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const seeded = useRef(false);

  useEffect(() => {
    if (zone || seeded.current) return;
    seeded.current = true;
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!guess) return;
    setTimeZoneAction(guess, { seeded: true })
      .then((result) => {
        if (!result.skipped) router.refresh();
      })
      // Nothing to tell anyone: the app keeps using the server's clock, which
      // is what it did before this existed.
      .catch(() => {});
  }, [zone, router]);

  return <ViewerZone.Provider value={zone}>{children}</ViewerZone.Provider>;
}
