import type { MetadataRoute } from "next";

/**
 * Installed to a home screen this is a workspace, not a document reader, so it
 * opens standalone and lands on the list you work from. The theme colour matches
 * the dark canvas because dark is the default theme — a light splash followed by a
 * dark app is the flash everyone notices.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hired",
    short_name: "Hired",
    description:
      "Everything you've ever done, kept in one place you can talk to — and the resumes, applications and contacts that come out of it.",
    start_url: "/",
    display: "standalone",
    // The sRGB of --background in the dark theme. A manifest cannot read a CSS
    // variable, so this is the one place the value is written twice; if the
    // dark background ever moves, it moves here too.
    background_color: "#0d0e10",
    theme_color: "#0d0e10",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
