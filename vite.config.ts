import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// `vite preview` serves the production build under the same Content Security
// Policy as Cloudflare Pages (public/_headers), pointed at the local Supabase,
// so the end-to-end tests catch a change that the policy would block.
function previewHeaders(mode: string): Record<string, string> {
  const headers = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  const csp = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1];
  if (!csp) return {};
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const supabase = new URL(env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321');
  const ws = `${supabase.protocol === 'https:' ? 'wss' : 'ws'}://${supabase.host}`;
  // A separately served API (VITE_API_URL) is allowed too; in production the
  // API lives under the Supabase address and needs no extra entry.
  const api = env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : '';
  const extra = api && api !== supabase.origin ? ` ${api}` : '';
  return {
    'Content-Security-Policy': csp
      .replaceAll('https://*.supabase.co', supabase.origin)
      .replace(`wss://*.supabase.co`, `${ws}${extra}`),
  };
}

// The whole app (code, fonts, barcode decoder) is stored on the phone at
// install time so it opens and works with no signal. See src/sw.ts.
export default defineConfig(({ mode }) => ({
  // Served from a sub-path on GitHub Pages (VITE_BASE=/estate-inventory/); '/' elsewhere.
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'Estate Inventory',
        short_name: 'Estate',
        description: "Record a loved one's belongings and decide together where each one goes.",
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F2F4F1',
        theme_color: '#1D3A57',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true, headers: previewHeaders(mode) },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 600 },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts'],
  },
}) as never);
