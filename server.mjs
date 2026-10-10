import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const browserAssets = new Map([
  ['/vendor/transformers.js', path.join(appDir, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.web.js')],
  ['/vendor/ort-wasm-simd-threaded.asyncify.mjs', path.join(appDir, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.asyncify.mjs')],
  ['/vendor/ort-wasm-simd-threaded.asyncify.wasm', path.join(appDir, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.asyncify.wasm')]
]);
try {
  const envText = await readFile(path.join(appDir, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* Environment variables may be supplied by the host instead. */ }
const validImage = value => typeof value === 'string' && value.length < 9_000_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
const send = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
};

const pyExe = path.join(appDir, '.venv', 'Scripts', 'python.exe');
const modelScript = path.join(appDir, 'local_vton_service.py');
let localModelProcess;
if (process.env.DISABLE_LOCAL_VTON !== '1' && existsSync(pyExe) && existsSync(modelScript) && existsSync(path.join(appDir, 'local-model', 'weights', 'model.safetensors'))) {
  localModelProcess = spawn(pyExe, [modelScript], { cwd: appDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HF_HOME: path.join(appDir, 'local-model', 'hf-cache') } });
  localModelProcess.stdout.on('data', chunk => console.log(String(chunk).trim()));
  localModelProcess.stderr.on('data', chunk => console.error('Local model:', String(chunk).trim()));
  localModelProcess.on('exit', code => console.log(`Local model stopped (${code ?? 'unknown'})`));
}

async function isLocalModelReady() {
  try {
    const r = await fetch('http://127.0.0.1:4174/health', { signal: AbortSignal.timeout(900) });
    if (!r.ok) return false;
    return Boolean((await r.json()).ready);
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/config') {
    return send(res, 200, {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
    });
  }
  if (req.method === 'GET' && browserAssets.has(req.url)) {
    try {
      const file = await readFile(browserAssets.get(req.url));
      const type = req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return res.end(file);
    } catch { return send(res, 503, { error: 'The on-device image model is not installed. Run npm install and restart the app.' }); }
  }
  if (req.method === 'GET' && req.url === '/vendor/supabase.js') {
    try {
      const file = await readFile(path.join(appDir, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return res.end(file);
    } catch { return send(res, 500, { error: 'Supabase client is not installed. Run npm install.' }); }
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    const disabled = process.env.DISABLE_LOCAL_VTON === '1';
    return send(res, 200, { virtualTryOn: !disabled && await isLocalModelReady(), mode: disabled ? 'disabled' : 'local-cpu', installed: !disabled && existsSync(pyExe) && existsSync(modelScript) && existsSync(path.join(appDir, 'local-model', 'weights', 'model.safetensors')) });
  }
  if (req.method === 'POST' && req.url === '/api/try-on') {
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 24_000_000) return send(res, 413, { error: 'The selected images are too large. Use smaller photos and try again.' });
      }
      const body = JSON.parse(raw || '{}');
      if (!validImage(body.personImage)) return send(res, 400, { error: 'Add a supported full-body photo in Profile before trying on clothes.' });
      if (!Array.isArray(body.garments) || body.garments.length < 1 || body.garments.length > 2 || body.garments.some(g => !validImage(g.image))) {
        return send(res, 400, { error: 'Choose one or two photographed clothing pieces.' });
      }
      const categories = body.garments.map(g => g.category);
      const supported = ['Tops', 'Bottoms', 'Dresses & one-pieces', 'Outerwear'];
      if (categories.some(category => !supported.includes(category))) return send(res, 400, { error: 'The free local model supports tops, outerwear, bottoms, and one-piece outfits. Shoes and accessories are not supported yet.' });
      if (new Set(categories.map(c => c === 'Outerwear' ? 'Tops' : c)).size !== categories.length) return send(res, 400, { error: 'Choose at most one top or outerwear piece, plus one bottom. A one-piece outfit must be tried on by itself.' });
      if (categories.includes('Dresses & one-pieces') && categories.length > 1) return send(res, 400, { error: 'Try a dress or one-piece by itself.' });
      if (!(await isLocalModelReady())) return send(res, 503, { error: 'The free local model is not installed or is still loading. Finish the one-time setup and wait until the app says Local model ready.' });
      const local = await new Promise((resolve, reject) => {
        const request = http.request({
          hostname: '127.0.0.1', port: 4174, path: '/try-on', method: 'POST',
          headers: { 'Content-Type': 'application/json' }, timeout: 2 * 60 * 60 * 1000
        }, response => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { raw += chunk; });
          response.on('end', () => {
            try { resolve({ status: response.statusCode || 502, payload: JSON.parse(raw) }); }
            catch { reject(new Error('The local model returned an invalid response.')); }
          });
        });
        request.on('timeout', () => request.destroy(new Error('Local try-on timed out after two hours.')));
        request.on('error', reject);
        request.end(JSON.stringify(body));
      });
      return send(res, local.status, local.payload);
    } catch (error) {
      console.error('Local try-on failed:', error?.cause?.code || error?.name || 'unknown error');
      return send(res, 502, { error: error?.message?.includes('timed out') ? 'The local CPU model took too long. Try again only if you can leave the app open for an extended period.' : 'Local try-on could not finish. Check that the local model is installed, then try again.' });
    }
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const file = await readFile(path.join(appDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(file);
    } catch { return send(res, 500, { error: 'Could not load the app.' }); }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Forme is ready at http://${host}:${port}`));
