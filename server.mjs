#!/usr/bin/env node
// Claude HQ — local server. Reads Claude Code session logs (~/.claude/projects/*/*.jsonl), the auto-memory notes,
// and git status of project folders, and serves a live 3D dashboard. Binds to 127.0.0.1 only (session data is private).
// No dependencies: Node 18+.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 4321);
const HOME = os.homedir();
const CLAUDE = path.join(HOME, ".claude");
const PROJECTS_DIR = path.join(CLAUDE, "projects");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });

const now = () => Date.now();
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const clean = (s) => String(s || "").replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ */
/* Which folder is "the project" for a path Claude touched              */
/* ------------------------------------------------------------------ */
const SKIP = [/\\appdata\\/i, /\\windows\\/i, /\\program files/i, /\\downloads\\/i, /\\\.claude\\projects\\/i, /\\temp\\/i, /\\node_modules\\/i];
const dirCache = new Map();
const isDir = (p) => {
  if (!dirCache.has(p)) { try { dirCache.set(p, fs.statSync(p).isDirectory()); } catch { dirCache.set(p, false); } }
  return dirCache.get(p);
};
function projectRoot(raw) {
  let p = raw.replace(/\//g, "\\").replace(/[\\"'`,;)\]}]+$/, "");
  if (!/^[a-z]:\\/i.test(p)) return null;
  if (SKIP.some((r) => r.test(p + "\\"))) return null;
  const parts = p.split("\\").filter(Boolean);
  const lower = p.toLowerCase();
  const home = HOME.toLowerCase();
  let root = null;
  if (lower.startsWith(path.join(home, ".claude", "skills").toLowerCase() + "\\")) root = parts.slice(0, 6).join("\\");
  else if (lower.startsWith(home + "\\onedrive\\desktop\\")) root = parts.slice(0, 5).join("\\");
  else if (lower.startsWith(home)) return null;
  else if (parts.length >= 2) root = parts.slice(0, 2).join("\\");
  if (!root) return null;
  if (root.includes("\\.claude") && !root.toLowerCase().includes("\\skills\\")) return null;
  return isDir(root) ? root : null;
}
const PATH_RE = /[A-Za-z]:[\\/][^\s"'`<>|*?\r\n]+/g;
function pathsIn(v, out = []) {
  if (typeof v === "string") { for (const m of v.matchAll(PATH_RE)) out.push(m[0]); }
  else if (Array.isArray(v)) v.forEach((x) => pathsIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => pathsIn(x, out));
  return out;
}
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/* ------------------------------------------------------------------ */
/* Session logs: parsed incrementally (files are append-only)          */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // file -> state
function newSession(file, folder) {
  return {
    file, folder, id: path.basename(file, ".jsonl"), offset: 0, rest: "", title: "", agentName: "", cwd: "", model: "",
    firstTs: 0, lastTs: 0, prompts: 0, lastPrompt: "", lastPromptTs: 0, lastText: "", lastTextTs: 0, cost: 0,
    touches: new Map(), // projectRoot -> { w, last }
    activity: [], // { ts, tool, detail, project }
    lastProject: null, lastProjectTs: 0,
  };
}
function toolDetail(name, input) {
  if (!input) return "";
  if (input.file_path) return path.basename(input.file_path);
  if (input.description) return input.description;
  if (input.command) return short(String(input.command).split("\n")[0], 80);
  if (input.pattern) return `"${short(input.pattern, 40)}"`;
  if (input.url) return input.url;
  if (input.query) return short(input.query, 60);
  if (input.prompt) return short(input.prompt, 60);
  return "";
}
function ingest(s, o) {
  const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
  if (ts) { if (!s.firstTs) s.firstTs = ts; if (ts > s.lastTs) s.lastTs = ts; }
  if (o.cwd) s.cwd = o.cwd;
  switch (o.type) {
    case "custom-title": if (o.customTitle) s.title = o.customTitle; break;
    case "agent-name": if (o.agentName) s.agentName = o.agentName; break;
    case "user": {
      // HQ's own "plan my day" runs leave a tiny session behind; never show those as agents
      if (!s.prompts && /\[claude-hq brief\]|You are the user.s chief of staff/.test(JSON.stringify(o.message?.content || ""))) s.internal = true;
      if (o.isMeta || o.turnOrigin !== "human") break;
      const c = o.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "";
      const t = clean(text);
      if (!t || t.startsWith("[SYSTEM") || t.startsWith("<")) break;
      s.prompts++; s.lastPrompt = short(t, 220); s.lastPromptTs = ts;
      break;
    }
    case "assistant": {
      const m = o.message || {};
      if (m.model) s.model = m.model;
      for (const b of m.content || []) {
        if (b.type === "text" && b.text?.trim()) { s.lastText = short(clean(b.text), 600); s.lastTextTs = ts; }
        if (b.type === "tool_use") {
          const weight = WRITE_TOOLS.has(b.name) ? 3 : 1;
          let proj = null;
          for (const p of pathsIn(b.input)) { const r = projectRoot(p); if (r) { proj = r; const t = s.touches.get(r) || { w: 0, last: 0 }; t.w += weight; t.last = Math.max(t.last, ts); s.touches.set(r, t); } }
          if (proj) { s.lastProject = proj; s.lastProjectTs = ts; }
          s.activity.push({ ts, tool: b.name, detail: toolDetail(b.name, b.input), project: proj });
          if (s.activity.length > 60) s.activity.splice(0, s.activity.length - 60);
        }
      }
      break;
    }
  }
  if (typeof o.totalCostUSD === "number") s.cost = o.totalCostUSD;
}
async function readSession(file, folder) {
  let s = sessions.get(file);
  const st = await fsp.stat(file).catch(() => null);
  if (!st) return;
  if (!s || st.size < s.offset) { s = newSession(file, folder); sessions.set(file, s); }
  s.mtime = st.mtimeMs;
  if (st.size === s.offset) return;
  await new Promise((res) => {
    const rs = fs.createReadStream(file, { start: s.offset, end: st.size - 1, encoding: "utf8", highWaterMark: 1 << 20 });
    rs.on("data", (chunk) => {
      const lines = (s.rest + chunk).split("\n");
      s.rest = lines.pop();
      for (const l of lines) { if (!l) continue; try { ingest(s, JSON.parse(l)); } catch { /* partial or odd line */ } }
    });
    rs.on("end", res); rs.on("error", res);
  });
  s.offset = st.size;
}
async function scanSessions() {
  const folders = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  await Promise.all(folders.filter((d) => d.isDirectory()).map(async (d) => {
    const dir = path.join(PROJECTS_DIR, d.name);
    const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) await readSession(path.join(dir, f), d.name);
  }));
}

/* ------------------------------------------------------------------ */
/* Auto-memory notes: one project per note                              */
/* ------------------------------------------------------------------ */
const FLAG_RE = /(not deployed|not yet|no replacement|pending|todo|to do|next step|waiting on|blocked|cancelled next month|being cancelled|hasn'?t been|has not been run|ask the user|ask first|still needs|unverified|placeholder)/i;
async function readMemory() {
  const out = [];
  for (const d of await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])) {
    const memDir = path.join(PROJECTS_DIR, d.name, "memory");
    const idx = await fsp.readFile(path.join(memDir, "MEMORY.md"), "utf8").catch(() => null);
    if (!idx) continue;
    for (const m of idx.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)\s*[—-]\s*(.*)$/gm)) {
      const [, title, file, hook] = m;
      const body = await fsp.readFile(path.join(memDir, file), "utf8").catch(() => "");
      const front = body.match(/^---[\s\S]*?---/)?.[0] || "";
      const type = front.match(/type:\s*(\w+)/)?.[1] || "";
      const text = body.replace(/^---[\s\S]*?---/, "").trim();
      const firstPath = [...front.matchAll(PATH_RE), ...hook.matchAll(PATH_RE), ...text.matchAll(PATH_RE)].map((x) => x[0]).find((p) => projectRoot(p));   // the note's own description wins
      const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s)>\]"']+/g)].map((x) => x[0].replace(/[.,]$/, "")))];
      // open loops: whole sentences that mention something unfinished; newest notes are at the bottom, so keep the last one
      const flags = text.split(/\n/).flatMap((l) => l.replace(/^[-*\s]+/, "").split(/(?<=[a-z0-9)][.!?])\s+(?=[A-Z])/)).map((l) => l.trim())
        .filter((l) => l.length > 24 && l.length < 220 && /^[A-Z"“]/.test(l) && FLAG_RE.test(l) && !/^(\*\*)?(why|how to apply)/i.test(l)).slice(-1);
      out.push({ title, file, hook, type, text, root: firstPath ? projectRoot(firstPath) : null, urls, flags, modified: front.match(/modified:\s*(\S+)/)?.[1] || null });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* git                                                                 */
/* ------------------------------------------------------------------ */
const git = (cwd, args) => new Promise((res) => execFile("git", ["-C", cwd, ...args], { timeout: 8000, windowsHide: true }, (e, out) => res(e ? null : out.trim())));
const gitCache = new Map();
async function gitInfo(root) {
  const c = gitCache.get(root);
  if (c && now() - c.at < 45e3) return c.v;
  let v = null;
  if (fs.existsSync(path.join(root, ".git"))) {
    const [status, branch, remote, ahead, log] = await Promise.all([
      git(root, ["status", "--porcelain"]), git(root, ["rev-parse", "--abbrev-ref", "HEAD"]), git(root, ["remote", "get-url", "origin"]),
      git(root, ["rev-list", "--count", "@{u}..HEAD"]), git(root, ["log", "-5", "--pretty=format:%h\x1f%s\x1f%ct"]),
    ]);
    const changes = status ? status.split("\n").filter(Boolean) : [];
    v = {
      branch, remote: remote ? remote.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/") : null,
      dirty: changes.length, changes: changes.slice(0, 12), ahead: ahead == null ? null : +ahead,
      commits: (log || "").split("\n").filter(Boolean).map((l) => { const [h, s, t] = l.split("\x1f"); return { h, s, t: +t * 1000 }; }),
    };
  }
  gitCache.set(root, { at: now(), v });
  return v;
}

/* ------------------------------------------------------------------ */
/* Build the state the UI renders                                       */
/* ------------------------------------------------------------------ */
const projectName = (root) => path.basename(root).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const statusOf = (ts) => (now() - ts < 3 * MIN ? "working" : now() - ts < 2 * HOUR ? "recent" : now() - ts < 7 * DAY ? "week" : "quiet");
const asksQuestion = (s) => {
  if (!s.lastText || s.lastTextTs < s.lastPromptTs) return null;
  const tail = s.lastText.slice(-280);
  const q = tail.match(/([^.!?\n]*\?)\s*$/);
  return q ? q[1].trim() : null;
};

let doneState = {};
try { doneState = JSON.parse(fs.readFileSync(path.join(DATA, "done.json"), "utf8")); } catch { doneState = {}; }

async function buildState() {
  const memory = await readMemory();
  const projects = new Map();
  const ensure = (root) => {
    if (!projects.has(root)) projects.set(root, { id: root.toLowerCase(), root, name: projectName(root), memory: null, sessions: [], activity: [], lastTs: 0, weight: 0 });
    return projects.get(root);
  };
  for (const m of memory) if (m.root) { const p = ensure(m.root); if (!p.memory) { p.memory = m; p.name = m.title.replace(/ project$/i, ""); } }

  const sess = [...sessions.values()].filter((s) => s.lastTs && !s.internal).sort((a, b) => b.lastTs - a.lastTs);
  for (const s of sess) {
    for (const [root, t] of s.touches) {
      if (t.w < 2 && !projects.has(root)) continue;
      const p = ensure(root);
      p.weight += t.w; p.lastTs = Math.max(p.lastTs, t.last);
      p.sessions.push({ id: s.id, title: s.title || s.agentName || "Untitled session", lastTs: t.last, weight: t.w });
    }
    for (const a of s.activity) if (a.project && projects.has(a.project)) projects.get(a.project).activity.push({ ...a, session: s.title || s.agentName });
  }
  const list = [...projects.values()];
  await Promise.all(list.map(async (p) => { p.git = await gitInfo(p.root); }));
  for (const p of list) {
    p.activity.sort((a, b) => b.ts - a.ts); p.activity = p.activity.slice(0, 40);
    p.sessions.sort((a, b) => b.lastTs - a.lastTs); p.sessions = p.sessions.slice(0, 8);
    p.status = p.lastTs ? statusOf(p.lastTs) : "quiet";
    p.live = p.memory?.urls?.find((u) => /github\.io|netlify\.app|vercel\.app|pages\.dev/.test(u)) || null;
    p.lastCommit = p.git?.commits?.[0]?.t || 0;
  }
  list.sort((a, b) => Math.max(b.lastTs, b.lastCommit) - Math.max(a.lastTs, a.lastCommit));

  // agents = sessions active in the last 36 h
  const agents = sess.filter((s) => now() - s.lastTs < 36 * HOUR).slice(0, 10).map((s) => {
    const q = asksQuestion(s);
    const state = now() - Math.max(s.lastTs, s.mtime || 0) < 2 * MIN ? "working" : q ? "waiting" : now() - s.lastTs < 2 * HOUR ? "idle" : "resting";
    return {
      id: s.id, title: s.title || s.agentName || "Claude", cwd: s.cwd, model: s.model, state, question: q,
      project: s.lastProject ? s.lastProject.toLowerCase() : null, lastTs: s.lastTs, prompts: s.prompts, cost: s.cost,
      lastPrompt: s.lastPrompt, lastText: s.lastText, activity: s.activity.slice(-12).reverse(),
    };
  });

  // the day's to-do list
  const tk = todayKey();
  const done = new Set(doneState[tk] || []);
  const today = [];
  const add = (it) => today.push({ ...it, done: done.has(it.id) });
  for (const a of agents) if (a.state === "waiting") add({ id: `reply:${a.id}`, kind: "reply", pr: 0, project: a.project, title: `Answer Claude in “${a.title}”`, why: a.question });
  for (const s of sess.filter((s) => now() - s.lastTs < 7 * DAY && now() - s.lastTs >= 36 * HOUR)) {
    const q = asksQuestion(s);
    if (q) add({ id: `reply:${s.id}`, kind: "reply", pr: 1, project: s.lastProject?.toLowerCase() || null, title: `Claude is still waiting in “${s.title || "a session"}”`, why: q });
  }
  for (const p of list) {
    if (!p.git) continue;
    if (p.git.dirty) add({ id: `commit:${p.id}`, kind: "ship", pr: 2, project: p.id, title: `Commit ${p.git.dirty} change${p.git.dirty > 1 ? "s" : ""} in ${p.name}`, why: p.git.changes.slice(0, 3).join(" · ") });
    if (p.git.ahead) add({ id: `push:${p.id}`, kind: "ship", pr: 2, project: p.id, title: `Push ${p.git.ahead} commit${p.git.ahead > 1 ? "s" : ""} in ${p.name}`, why: p.git.remote || "" });
  }
  for (const p of list) for (const f of p.memory?.flags || []) add({ id: `loop:${p.id}:${f.slice(0, 40)}`, kind: "loop", pr: 3, project: p.id, title: f.length > 110 ? f.slice(0, 108) + "…" : f, why: `from your notes on ${p.name}` });
  for (const p of list.filter((p) => p.lastTs && now() - p.lastTs < 3 * DAY).slice(0, 3)) {
    add({ id: `cont:${p.id}`, kind: "momentum", pr: 4, project: p.id, title: `Keep going on ${p.name}`, why: p.sessions[0] ? `last: ${p.sessions[0].title}` : "" });
  }
  today.sort((a, b) => a.pr - b.pr);

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todays = sess.filter((s) => s.lastTs >= +dayStart);
  const feed = sess.flatMap((s) => s.activity.map((a) => ({ ...a, session: s.title || s.agentName, sid: s.id }))).filter((a) => now() - a.ts < DAY).sort((a, b) => b.ts - a.ts).slice(0, 40);

  return {
    generatedAt: now(), date: tk, user: process.env.HQ_NAME || "Adnan",
    stats: {
      working: agents.filter((a) => a.state === "working").length, waiting: agents.filter((a) => a.state === "waiting").length,
      agents: agents.length, projects: list.length, sessionsToday: todays.length, promptsToday: todays.reduce((n, s) => n + s.prompts, 0),
      costToday: todays.reduce((n, s) => n + (s.cost || 0), 0),
    },
    projects: list.slice(0, 24).map(({ memory, ...p }) => ({ ...p, notes: memory ? { title: memory.title, hook: memory.hook, text: memory.text, file: memory.file } : null })),
    agents, today, feed,
  };
}

/* ------------------------------------------------------------------ */
/* Live updates: watch the session folder, push over SSE               */
/* ------------------------------------------------------------------ */
let state = null, building = null;
const clients = new Set();
async function refresh() {
  if (building) return building;
  building = (async () => {
    await scanSessions();
    state = await buildState();
    const msg = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const c of clients) c.write(msg);
  })().finally(() => { building = null; });
  return building;
}
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 1200); };
try { fs.watch(PROJECTS_DIR, { recursive: true }, (_, f) => { if (f && /\.(jsonl|md)$/.test(f)) soon(); }); } catch (e) { console.warn("watch unavailable, polling only", e.message); }
setInterval(refresh, 30e3); // statuses age even when nothing changes

/* ------------------------------------------------------------------ */
/* Claude-written morning brief (opt-in: uses the `claude` CLI)        */
/* ------------------------------------------------------------------ */
async function brief(force) {
  const file = path.join(DATA, `brief-${todayKey()}.md`);
  if (!force) { const c = await fsp.readFile(file, "utf8").catch(() => null); if (c) return { text: c, cached: true }; }
  const s = state || (await refresh(), state);
  const payload = {
    date: s.date, todo: s.today.map(({ title, why, kind }) => ({ kind, title, why })),
    projects: s.projects.slice(0, 12).map((p) => ({ name: p.name, status: p.status, lastActive: p.lastTs ? new Date(p.lastTs).toISOString() : null, notes: p.notes?.hook, git: p.git && { dirty: p.git.dirty, ahead: p.git.ahead } })),
  };
  const prompt = `[claude-hq brief] You are the user's chief of staff. From this JSON snapshot of their projects and open items, write today's plan in Markdown: a one-line headline, then "Do first" (max 3 bullets), "Then" (max 4), and "Can wait" (max 3). Be concrete, name projects, keep each bullet under 18 words. No preamble.\n\n${JSON.stringify(payload)}`;
  const text = await new Promise((res, rej) => {
    const p = spawn(process.platform === "win32" ? "claude.cmd" : "claude", ["-p", "--output-format", "text"], { shell: process.platform === "win32", windowsHide: true });
    let out = "", err = "";
    const kill = setTimeout(() => { p.kill(); rej(new Error("timed out")); }, 180e3);
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { clearTimeout(kill); code === 0 && out.trim() ? res(out.trim()) : rej(new Error(err || `exit ${code}`)); });
    p.stdin.end(prompt);
  });
  await fsp.writeFile(file, text);
  return { text, cached: false };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const json = (res, code, v) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(v)); };
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/state") { if (!state) await refresh(); return json(res, 200, state); }
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`retry: 3000\n\n`); if (state) res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      clients.add(res); const ping = setInterval(() => res.write(": ping\n\n"), 20e3);
      req.on("close", () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (url.pathname === "/api/done" && req.method === "POST") {
      const { id, done } = await body(req); const k = todayKey();
      const set = new Set(doneState[k] || []); done ? set.add(id) : set.delete(id); doneState = { [k]: [...set] };
      await fsp.writeFile(path.join(DATA, "done.json"), JSON.stringify(doneState));
      if (state) state.today.forEach((t) => (t.done = set.has(t.id)));
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/brief" && req.method === "POST") {
      const { force } = await body(req);
      try { return json(res, 200, await brief(force)); } catch (e) { return json(res, 500, { error: String(e.message || e).slice(0, 400) }); }
    }
    if (url.pathname === "/api/open" && req.method === "POST") {      // open a project folder in Explorer
      const { root } = await body(req);
      if (state?.projects.some((p) => p.root === root)) spawn(process.platform === "win32" ? "explorer.exe" : "xdg-open", [root], { detached: true, stdio: "ignore" }).unref();
      return json(res, 200, { ok: true });
    }
    // static
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(ROOT, "public", path.normalize(rel).replace(/^(\.\.[\\/])+/, ""));
    if (!file.startsWith(path.join(ROOT, "public"))) return json(res, 403, {});
    const data = await fsp.readFile(file).catch(() => null);
    if (!data) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  } catch (e) { json(res, 500, { error: String(e) }); }
});

const t0 = now();
await refresh();
server.listen(PORT, "127.0.0.1", () => console.log(`Claude HQ → http://localhost:${PORT}  (${sessions.size} sessions, ${state.projects.length} projects, ${now() - t0} ms)`));
