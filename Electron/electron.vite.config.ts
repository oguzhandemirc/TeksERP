import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildIdentity, channelPlugin } from "./build-identity";

// Paket kimliği derleme ANINDA kayıttan (ortak: dağıtım kaydı; eski kanal yolu: TEKSERP_KANAL) — bkz. build-identity.ts.
const channel = buildIdentity(process.env);

export default defineConfig(({ command }) => ({
  main: {
    plugins: [externalizeDepsPlugin(), channelPlugin(channel)],
    build: {
      outDir: "out/main",
      lib: {
        entry: resolve(__dirname, "electron/main.ts"),
        formats: ["es"],
        fileName: () => "main.js",
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "shared") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), channelPlugin(channel)],
    build: {
      outDir: "out/preload",
      lib: {
        entry: resolve(__dirname, "electron/preload.ts"),
        formats: ["cjs"],
        fileName: () => "preload.cjs",
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "shared") },
    },
  },
  renderer: {
    root: ".",
    plugins: [react(), tailwindcss(), channelPlugin(channel)],
    // Keşif sonuç vermezse bağlanılan sunucu kanaldan; geliştirmede `.env` (localhost) geçerli kalır.
    // Açık `VITE_API_BASE_URL` ortamı bugünkü gibi önceliklidir — paketleme kapısı paketi kanalla ölçer.
    define:
      command === "build"
        ? { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL ?? channel.erpUrl) }
        : {},
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "shared"),
      },
    },
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: { index: resolve(__dirname, "index.html") },
      },
    },
    server: { port: 5174 },
  },
}));
