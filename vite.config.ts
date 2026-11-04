import { defineConfig, loadEnv } from "vite";

// 頁面在 /stocks，API 在 /api/watch（FRONTEND-CONTRACT §0 F-1）。
//   npm run dev        → 使用 mocks/（瀏覽器內攔截 fetch，不需要後端）
//   npm run dev:api    → 不載入 mock，/api 轉送到 VITE_API_TARGET
//   build:preview      → 單一 HTML 預覽版（含 mock、記憶體路由）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "/stocks/",
    plugins: [{
      name: "stocks-no-slash",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/stocks" || req.url?.startsWith("/stocks?")) { res.statusCode = 302; res.setHeader("Location", "/stocks/" + req.url.slice(7)); res.end(); return; }
          next();
        });
      },
    }],
    server: { proxy: env.VITE_API_TARGET ? { "/api": { target: env.VITE_API_TARGET, changeOrigin: true } } : undefined },
    build: {
      outDir: mode === "preview" ? "dist-preview" : "dist",
      assetsInlineLimit: mode === "preview" ? 100_000_000 : 4096,
      cssCodeSplit: mode !== "preview",
      rollupOptions: mode === "preview" ? { output: { inlineDynamicImports: true } } : undefined,
    },
    test: { environment: "node" },
  };
});
