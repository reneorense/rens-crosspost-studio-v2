import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'api-server-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith('/api/server')) {
              try {
                const { default: handler } = await server.ssrLoadModule('./api/server.ts');
                
                let body = {};
                if (req.method === 'POST') {
                  body = await new Promise((resolve) => {
                    let chunkStr = '';
                    req.on('data', chunk => chunkStr += chunk);
                    req.on('end', () => {
                      try {
                        resolve(chunkStr ? JSON.parse(chunkStr) : {});
                      } catch {
                        resolve({});
                      }
                    });
                  });
                }
                
                const customReq = {
                  method: req.method,
                  body,
                  url: req.url,
                  headers: req.headers
                };
                
                const customRes = {
                  status: (code: number) => {
                    res.statusCode = code;
                    return customRes;
                  },
                  json: (data: any) => {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));
                    return customRes;
                  },
                  setHeader: (name: string, value: string) => {
                    res.setHeader(name, value);
                    return customRes;
                  },
                  end: () => res.end()
                };
                
                await handler(customReq, customRes);
              } catch (err: any) {
                console.error('[Vite API Middleware Error]:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message || 'Internal Dev server error' }));
              }
            } else {
              next();
            }
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
