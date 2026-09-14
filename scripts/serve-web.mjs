import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);

function optionValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const host = optionValue('--host', process.env.HOST || '127.0.0.1');
const port = Number(optionValue('--port', process.env.PORT || '8080'));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid port: ${port}`);
}

const contentTypes = new Map([
  ['.atlas', 'text/plain; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function sendText(response, statusCode, message) {
  const body = `${message}\n`;
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}

function parseRange(header, fileSize) {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : fileSize - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || start >= fileSize || end < start) {
    return false;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, 'Method not allowed');
    return;
  }

  let pathname;
  try {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendText(response, 400, 'Invalid URL');
    return;
  }

  const relativePath = pathname.replace(/^[/\\]+/, '');
  let filePath = resolve(webRoot, relativePath);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
      fileStats = await stat(filePath);
    }
  } catch {
    sendText(response, 404, 'Not found');
    return;
  }

  if (!fileStats.isFile()) {
    sendText(response, 404, 'Not found');
    return;
  }

  const range = parseRange(request.headers.range, fileStats.size);
  if (range === false) {
    response.writeHead(416, {
      'Content-Range': `bytes */${fileStats.size}`,
    });
    response.end();
    return;
  }

  const statusCode = range ? 206 : 200;
  const start = range?.start ?? 0;
  const end = range?.end ?? fileStats.size - 1;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': Math.max(0, end - start + 1),
    'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
  };

  if (range) {
    headers['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`;
  }

  response.writeHead(statusCode, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  try {
    await pipeline(createReadStream(filePath, { start, end }), response);
  } catch (error) {
    if (!response.destroyed) response.destroy(error);
  }
});

server.listen(port, host, () => {
  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log(`AnimeeWorld web mockup: http://${displayHost}:${port}/`);
  console.log('Press Ctrl+C to stop.');
});
