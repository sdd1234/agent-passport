import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { wallet: ["ethers"], react: ["react", "react-dom"] },
      },
    },
  },
  server: { port: Number(process.env.WEB_PORT || 5173), proxy: { "/api": process.env.PASSPORT_API_URL || "http://127.0.0.1:8080" } },
});
