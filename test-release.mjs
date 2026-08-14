// 1.1.0 yayin oncesi E2E: gercek MCP el sikismasi + canli API cagrilari.
// Calistirma: MINDJACK_API_KEY=mj_live_... node test-release.mjs
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["src/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg); pending.delete(msg.id);
      }
    } catch {}
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + " timeout")); } }, 30000);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const NEW_TOOLS = ["token_wallets", "token_web", "wallet_network",
                   "kol_leaderboard", "kol_record", "funder_networks",
                   "search_tokens"];

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "release-test", version: "0" },
  });
  console.log("1) initialize:", init.result?.serverInfo?.name,
              init.result?.serverInfo?.version);
  notify("notifications/initialized", {});

  const list = await rpc("tools/list", {});
  const names = (list.result?.tools || []).map((t) => t.name);
  console.log("2) tools/list:", names.length, "arac");
  const missing = NEW_TOOLS.filter((n) => !names.includes(n));
  console.log("   yeni 7:", missing.length ? "EKSIK: " + missing : "hepsi var");
  const badSchema = (list.result?.tools || []).filter(
    (t) => !t.inputSchema || t.inputSchema.type !== "object");
  console.log("   sema:", badSchema.length ? "BOZUK: " + badSchema.map(t=>t.name) : "24/24 gecerli");

  async function callTool(name, args) {
    const r = await rpc("tools/call", { name, arguments: args });
    const txt = r.result?.content?.[0]?.text || JSON.stringify(r).slice(0, 200);
    let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 120) }; }
    return parsed;
  }

  const s = await callTool("search_tokens", { q: "bonk", limit: 1 });
  console.log("3) search_tokens:", s.tokens ? s.tokens.length + " sonuc, ilk: " + (s.tokens[0]?.symbol || "?") : JSON.stringify(s).slice(0, 140));

  const k = await callTool("kol_leaderboard", { limit: 2, sort: "profit" });
  console.log("4) kol_leaderboard:", k.kols ? k.kols.map(x => x.name + " " + x.lifetime?.realized_sol).join(", ") : JSON.stringify(k).slice(0, 140));

  const f = await callTool("funder_networks", { min_wallets: 1000, limit: 2 });
  console.log("5) funder_networks:", f.funders ? f.funders.map(x => (x.funder_known?.name || "anon") + ":" + x.wallets_funded).join(", ") : JSON.stringify(f).slice(0, 140));

  const cov = await callTool("get_coverage", {});
  console.log("6) get_coverage (free):", cov.index ? "OK, tokens=" + cov.index.tokens_indexed : JSON.stringify(cov).slice(0, 100));
} catch (e) {
  console.error("HATA:", e.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
