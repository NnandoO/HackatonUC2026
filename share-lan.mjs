// LAN access explicitly authorized without login and with full administration.
// Paperclip stays on loopback; this proxy binds ONLY the selected LAN address.
import http from 'node:http';
const host = process.env.PAPERCLIP_LAN_HOST || '172.16.5.56';
const port = Number(process.env.PAPERCLIP_LAN_PORT || 3101);
const upstreamHost = '127.0.0.1';
const upstreamPort = 3100;
function headers(req) {
  const result = {...req.headers, host: `${upstreamHost}:${upstreamPort}`};
  for (const key of Object.keys(result)) {
    if (key.startsWith('x-forwarded-') || key.startsWith('x-paperclip-cloud-') || key === 'forwarded') delete result[key];
  }
  if (result.origin) result.origin = `http://${upstreamHost}:${upstreamPort}`;
  return result;
}
const server = http.createServer((req, res) => {
  const upstream = http.request({hostname: upstreamHost, port: upstreamPort,
    path: req.url, method: req.method, headers: headers(req)}, response => {
    const responseHeaders = {...response.headers};
    if (responseHeaders.location) {
      responseHeaders.location = responseHeaders.location.replace(/^http:\/\/(?:127\.0\.0\.1|localhost):3100(?=\/|$)/, `http://${host}:${port}`);
    }
    res.writeHead(response.statusCode || 502, responseHeaders);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Paperclip no está disponible. Comprueba el servicio local.');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = http.request({hostname: upstreamHost, port: upstreamPort,
    path: req.url, method: req.method, headers: headers(req)});
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
    }
    socket.write('\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on('response', response => {
    socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
    response.resume();
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});
server.requestTimeout = 120000;
server.listen(port, host, () => console.log(`Paperclip LAN — acceso completo sin login: http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
