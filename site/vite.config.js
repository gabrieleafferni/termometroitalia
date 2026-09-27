import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // percorsi relativi: il sito funziona sia su GitHub Pages (/termometroitalia/) sia su un dominio proprio
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        carburanti: resolve(import.meta.dirname, "carburanti.html"),
        metodo: resolve(import.meta.dirname, "metodo.html"),
      },
    },
  },
});
