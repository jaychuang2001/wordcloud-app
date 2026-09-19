import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

// Standard TanStack Start + Nitro setup. Deploy target is picked
// automatically by the platform you deploy to (Vercel/Netlify/Cloudflare
// all auto-detect it), or set it explicitly via the NITRO_PRESET env var.
export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // src/server.ts wraps SSR responses to render a friendly error page
      // instead of a raw 500 when something throws.
      server: { entry: "server" },
    }),
    viteReact(),
    nitro(),
  ],
});
