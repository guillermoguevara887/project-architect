import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MemoOS",
    short_name: "MemoOS",
    description: "Hub personal para Project Architect y Journey.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#171b24",
    theme_color: "#171b24",
    icons: [
      {
        src: "/memoos-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/memoos-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
