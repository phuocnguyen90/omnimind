import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { JobQueue } from "../ingestion/queue";
import { VectorStore } from "../vectorstore/db";
import { lmClient } from "../index";

export function startControlServer(jobQueue: JobQueue, vectorStore: VectorStore): Promise<void> {
  if ((global as any).controlServer) {
    try { (global as any).controlServer.close(); } catch (e) {}
  }
  
  return new Promise<void>((resolve) => {
    const server = http.createServer(async (req, res) => {
    try {
      // Handle API routes
      if (req.url?.startsWith('/api/')) {
        if (req.method === 'POST' && req.url === '/api/pause') {
          jobQueue.pause();
          res.writeHead(200); res.end('PAUSED');
        } else if (req.method === 'POST' && req.url === '/api/resume') {
          jobQueue.resume();
          res.writeHead(200); res.end('RUNNING');
        } else if (req.method === 'POST' && req.url === '/api/retry') {
          jobQueue.retryFailed();
          res.writeHead(200); res.end('RETRIED');
        } else if (req.method === 'GET' && req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: jobQueue.getState(), stats: jobQueue.getStats() }));
        } else if (req.method === 'GET' && req.url === '/api/jobs/failed') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(jobQueue.getFailedJobs()));
        } else if (req.method === 'GET' && req.url === '/api/knowledge/stats') {
          const stats = await vectorStore.getStats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stats));
        } else if (req.method === 'GET' && req.url === '/api/knowledge/sources') {
          const sources = await vectorStore.getSources();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sources));
        } else if (req.method === 'GET' && req.url.startsWith('/api/knowledge/chunks?path=')) {
          const urlPath = new URL(req.url, 'http://localhost');
          const targetPath = urlPath.searchParams.get('path');
          if (!targetPath) {
            res.writeHead(400); res.end('Missing path param');
            return;
          }
          const chunks = await vectorStore.getChunksByPath(targetPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(chunks));
        } else if (req.method === 'GET' && req.url.startsWith('/api/knowledge/document?')) {
          const urlPath = new URL(req.url, 'http://localhost');
          const targetPath = urlPath.searchParams.get('path');
          const source = urlPath.searchParams.get('source');
          if (!targetPath) {
            res.writeHead(400); res.end('Missing path param');
            return;
          }
          try {
            let content = '';
            if (source === 'obsidian') {
              if (fs.existsSync(targetPath)) {
                content = fs.readFileSync(targetPath, 'utf-8');
              } else {
                const chunks = await vectorStore.getChunksByPath(targetPath);
                content = chunks.map(c => c.text).join('\n\n');
              }
            } else if (source === 'zotero') {
              const cachePath = path.join(os.homedir(), '.omnimind', 'ocr_cache', `${targetPath}.md`);
              if (fs.existsSync(cachePath)) {
                content = fs.readFileSync(cachePath, 'utf-8');
              } else {
                const chunks = await vectorStore.getChunksByPath(targetPath);
                content = chunks.map(c => c.text).join('\n\n');
              }
            } else {
              const chunks = await vectorStore.getChunksByPath(targetPath);
              content = chunks.map(c => c.text).join('\n\n');
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content }));
          } catch (err: any) {
            console.error("[Control Server] Failed to fetch document:", err);
            res.writeHead(500); res.end("Failed to fetch document");
          }
        } else if (req.method === 'GET' && req.url === '/api/models') {
          if (!lmClient) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ embeddingModels: [], visionModels: [] }));
            return;
          }
          try {
            const downloadedModels = await lmClient.system.listDownloadedModels();
            const embeddingModels = downloadedModels
              .filter((m: any) => m.type === "embedding")
              .map((m: any) => ({ identifier: m.identifier, path: m.path }));
            
            const visionModels = downloadedModels
              .filter((m: any) => m.type === "llm")
              .map((m: any) => ({ identifier: m.identifier, path: m.path }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ embeddingModels, visionModels }));
          } catch (err) {
            console.error("[Control Server] Failed to fetch downloaded models:", err);
            res.writeHead(500); res.end("Failed to fetch models");
          }
        } else if (req.method === 'GET' && req.url === '/api/config') {
          const configPath = path.join(os.homedir(), '.omnimind', 'search_config.json');
          if (fs.existsSync(configPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(fs.readFileSync(configPath, 'utf-8'));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ algorithm: 'vector', mmrDiversity: 0.5 }));
          }
        } else if (req.method === 'POST' && req.url === '/api/config') {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
            try {
              const config = JSON.parse(body);
              const configPath = path.join(os.homedir(), '.omnimind', 'search_config.json');
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              res.writeHead(400); res.end('Invalid JSON');
            }
          });
          return; // Wait for async end
        } else {
          res.writeHead(404); res.end();
        }
        return;
      }

      // Handle static files
      let filePath = req.url === '/' ? '/index.html' : req.url;
      filePath = (filePath || '').split('?')[0];
      const absPath = path.join(process.cwd(), 'ui', 'dist', filePath);
      
      const ext = String(path.extname(absPath)).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      fs.readFile(absPath, (error, content) => {
        if (error) {
          if (error.code === 'ENOENT') {
            fs.readFile(path.join(process.cwd(), 'ui', 'dist', 'index.html'), (err, content) => {
              if (err) {
                res.writeHead(500); res.end('UI not built. Run npm run build in ui/ folder.');
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, no-cache, must-revalidate' }); res.end(content, 'utf-8');
              }
            });
          } else {
            res.writeHead(500); res.end('Server error: ' + error.code);
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store, no-cache, must-revalidate' }); res.end(content, 'utf-8');
        }
      });
    } catch (err: any) {
      console.error("[Control Server] Unhandled error:", err);
      if (!res.headersSent) {
        res.writeHead(500); res.end('Internal Server Error');
      }
    }
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.warn("[Control Server] Port 4733 is in use, assuming server is already running.");
      resolve();
    } else {
      console.error("[Control Server] Server error:", e);
      resolve();
    }
  });

  server.listen(4733, () => {
    console.log("OmniMind Control Panel running at http://localhost:4733");
    resolve();
  });
  (global as any).controlServer = server;
  });
}
