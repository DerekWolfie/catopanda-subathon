import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 8799;
const outputDirectory = resolve("docs", "screenshots");
const maximumBytes = 5 * 1024 * 1024;

mkdirSync(outputDirectory, { recursive: true });

const server = createServer((request, response) => {
  const match = /^\/capture\/([a-z0-9-]+\.png)$/.exec(request.url || "");
  if (request.method !== "POST" || !match) {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  let receivedBytes = 0;

  request.on("data", (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > maximumBytes) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", () => {
    if (receivedBytes > maximumBytes) return;
    const target = resolve(outputDirectory, match[1]);
    writeFileSync(target, Buffer.concat(chunks));
    response.writeHead(204, { "Access-Control-Allow-Origin": "*" }).end();
  });
});

server.listen(port, host, () => {
  console.log(`QA capture receiver ready at http://${host}:${port}`);
});
