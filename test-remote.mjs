#!/usr/bin/env node
/**
 * Connect to the hosted server with the official SDK, the way a client does.
 *
 * Everything else that checks /mcp speaks HTTP by hand, which proves the wire
 * format and not the thing that matters: whether the transport a real client
 * ships with can talk to it. This uses StreamableHTTPClientTransport from
 * @modelcontextprotocol/sdk — the same code path Claude, Cursor and the
 * connector UIs run — and fails loudly if any step a client takes does not
 * work.
 *
 *   node test-remote.mjs                    # against production
 *   node test-remote.mjs http://localhost:5017/mcp
 *   MINDJACK_API_KEY=mj_live_... node test-remote.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.argv[2] || "https://api.mindjack.xyz/mcp";
const KEY = process.env.MINDJACK_API_KEY || "";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : " — " + detail}`);
  if (!ok) failures++;
}

const transport = new StreamableHTTPClientTransport(new URL(URL_), {
  requestInit: { headers: KEY ? { "X-API-Key": KEY } : {} },
});
const client = new Client({ name: "mindjack-remote-test", version: "1.0.0" },
                          { capabilities: {} });

console.log(`\nconnecting to ${URL_}${KEY ? " with a key" : " with no key"}\n`);
await client.connect(transport);

const info = client.getServerVersion();
check("the SDK completed the handshake", !!info, "no serverInfo");
check(`server introduces itself as mindjack (got ${info?.name} ${info?.version})`,
      info?.name === "mindjack");

const { tools } = await client.listTools();
check(`tools/list returns 24 tools (got ${tools.length})`, tools.length === 24);
check("every tool carries a description the model can read",
      tools.every((t) => t.description && t.inputSchema));

const free = await client.callTool({ name: "get_coverage", arguments: {} });
const freeBody = JSON.parse(free.content[0].text);
check("a free tool answers with real data",
      !freeBody.error && Object.keys(freeBody).length > 2,
      JSON.stringify(freeBody).slice(0, 160));

const mint = freeBody.example_mint || freeBody.example ||
             "So11111111111111111111111111111111111111112";
const paid = await client.callTool({ name: "check_token", arguments: { mint } });
const paidBody = JSON.parse(paid.content[0].text);
if (KEY) {
  check("with a key, the paid tool answers",
        !paidBody.error, JSON.stringify(paidBody).slice(0, 200));
} else {
  check("without a key, the paid tool asks for payment instead of answering",
        paidBody.error === "payment_required" || !!paidBody.accepts,
        `THE PAYWALL DID NOT HOLD: ${JSON.stringify(paidBody).slice(0, 200)}`);
}

const unknown = await client.callTool({ name: "no_such_tool", arguments: {} });
check("an unknown tool comes back as an errored result, not a thrown protocol error",
      unknown.isError === true);

await client.close();

console.log(`\n${failures === 0 ? "OK — a real MCP client can connect, list and call."
                                : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
