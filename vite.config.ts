import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = parseInt(process.env.PORT || env.PORT || env.VITE_PORT || '3000', 10);
  const targetAiUrl = (env.VITE_AI_BASE_URL || 'http://localhost:20128/v1').replace(/\/+$/, '');
  const targetHost = targetAiUrl.replace(/\/v1\/?$/, '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      port,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        // Proxy opcional para contornar problemas de CORS caso o endpoint local bloqueie requisições do navegador
        '/api/ai-proxy': {
          target: targetHost,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/ai-proxy/, ''),
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
    },
  };
});
