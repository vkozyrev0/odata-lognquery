const http = require("http");
const target = "http://127.0.0.1:5268";

// Node 18+ keeps sockets alive by default. Kestrel often closes them after a
// 202 response, so the next poll on /async/{id} hits a dead socket (ECONNRESET).
const agent = new http.Agent({ keepAlive: false });

function onError(err, req, res) {
  console.error(`[proxy] ${req.method} ${req.url} -> ${target} failed: ${err.message}`);
  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
  }
  res.end(
    JSON.stringify({
      error: {
        message:
          "OData service is not reachable at http://127.0.0.1:5268. Start it with: dotnet run --project ODataLongQuery",
      },
    }),
  );
}

module.exports = {
  "/odata": {
    target,
    secure: false,
    changeOrigin: true,
    ws: false,
    agent,
    timeout: 120000,
    proxyTimeout: 120000,
    configure: (proxy) => {
      proxy.on("error", onError);
    },
  },
  "/async": {
    target,
    secure: false,
    changeOrigin: true,
    ws: false,
    agent,
    timeout: 120000,
    proxyTimeout: 120000,
    configure: (proxy) => {
      proxy.on("error", onError);
    },
  },
};
