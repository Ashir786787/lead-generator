import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Small loopback fixture site used to exercise the real fetcher (robots.txt,
 * redirects, ports, content types) without touching the public internet.
 */
export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Fixture Dental Studio</title>
    <meta name="generator" content="WordPress 6.5" />
    <script src="https://widget.intercom.io/widget/abc123"></script>
  </head>
  <body>
    <a href="mailto:hello@fixture-dental.test">Email us</a>
    <a href="tel:+971501234567">Call us</a>
    <a href="https://wa.me/971501234567">WhatsApp</a>
    <a href="/about">About</a>
    <form action="/contact" method="post">
      <input type="email" name="email" />
      <textarea name="message"></textarea>
      <button type="submit">Send</button>
    </form>
  </body>
</html>`;

const ABOUT_HTML = `<!doctype html><html lang="en"><head><title>About</title></head>
<body><p>Our story.</p></body></html>`;

/** Exposes the Host header the fixture server actually received. */
function hostHtml(request: http.IncomingMessage): string {
  return `<!doctype html><html lang="en"><head><title>Host</title></head>
<body><p>host=${request.headers.host ?? ""}</p></body></html>`;
}

/**
 * Start the fixture site on an ephemeral loopback port.
 *
 * Routes:
 *  - GET /robots.txt          disallows /private
 *  - GET /                     rich business page (chat widget, contacts, form)
 *  - GET /about                plain page
 *  - GET /private              HTML that robots.txt forbids
 *  - GET /redirect-internal   302 -> /about
 *  - GET /redirect-external   302 -> https://example.org/
 *  - GET /file.json            JSON payload (non-HTML)
 *  - GET /missing              404
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    const html = (body: string) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    };

    switch (url.pathname) {
      case "/robots.txt":
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
        return;
      case "/":
        html(INDEX_HTML);
        return;
      case "/about":
        html(ABOUT_HTML);
        return;
      case "/host":
        html(hostHtml(request));
        return;
      case "/private":
        html("<html><body>Members only</body></html>");
        return;
      case "/private/public":
        html("<html><body>Public inside private</body></html>");
        return;
      case "/redirect-internal":
        response.writeHead(302, { location: "/about" });
        response.end();
        return;
      case "/redirect-external":
        response.writeHead(302, { location: "https://example.org/" });
        response.end();
        return;
      case "/file.json":
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
        return;
      default:
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
