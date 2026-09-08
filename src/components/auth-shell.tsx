import type { Viewport } from "next";

/**
 * The lit field behind the three pages you can reach without an account: sign
 * in, claim the instance, accept an invitation.
 *
 * All four layers are decoration and all four are CSS — see the front-door
 * block in globals.css. Nothing here is a client component, because nothing
 * here reacts to anything: the drift is a keyframe, the vignette is a gradient,
 * and the whole thing holds still for anyone who has asked their system to calm
 * down. The one piece that does react to a pointer is the mark, and it brings
 * its own "use client".
 *
 * `theme-light` is what holds the door to the light theme whatever the app is
 * set to. It is a class rather than a call to the theme provider on purpose:
 * the provider decides the theme in an effect, which means a dark card for one
 * frame before it flips, and a flash on the first screen a stranger sees is
 * worse than the dark card would have been. A class on the wrapper is applied
 * by the first style pass, before anything is painted.
 *
 * Why a shell rather than three copies of a `<main>`: these pages had the same
 * one-line wrapper each, which is exactly the sort of thing that drifts the
 * first time one of them is touched.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-field theme-light flex min-h-svh items-center justify-center p-6">
      <div className="auth-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="auth-plinth" aria-hidden />
      <div className="auth-vignette" aria-hidden />
      {children}
    </main>
  );
}

/**
 * The browser's own chrome, told the same thing the page was.
 *
 * The root layout sets this per `prefers-color-scheme`, which is right for
 * every page that follows the theme and wrong for these three: a phone in dark
 * mode would paint the bar above a paper-white page near-black, and that seam
 * is the exact thing the root layout's own comment is about. `--background` in
 * the light theme, in sRGB, and it has to be kept in step with it by hand.
 *
 * Each front-door page re-exports this as its own `viewport`, because Next only
 * reads the export from a page or a layout — a component cannot set it for its
 * children.
 */
export const authViewport: Viewport = {
  themeColor: "#f8f8f9",
};
