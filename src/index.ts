import { env } from "./config";
import { app } from "./app";

// === RUNTIME DETECTION ===

function getRuntime(): { name: string; version: string } {
  if (typeof Bun !== "undefined") {
    return { name: "Bun", version: Bun.version };
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    return { name: "Node.js", version: process.versions.node };
  }
  return { name: "Unknown", version: "unknown" };
}

const runtime = getRuntime();

// === START SERVER ===

console.log(`
╔═══════════════════════════════════════════════════════╗
║           🚀 Prism Invest API (Hono)                  ║
╠═══════════════════════════════════════════════════════╣
║  Server:    http://localhost:${String(env.PORT).padEnd(5)}                  ║
║  Mode:      ${env.ENV.padEnd(12)}                         ║
║  Runtime:   ${runtime.name} ${runtime.version.padEnd(15)}              ║
╚═══════════════════════════════════════════════════════╝
`);

export default {
  port: env.PORT,
  fetch(req: Request) {
    return app.fetch(req);
  },
};

