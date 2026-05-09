const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const INTEGRANTES = ["Fauno","Casty","Chapa","Duty","Franky","Gordo","Juani","Nono","Oso","Colo"];
const GALARDONES = ["mvp","colaborador","revelacion","borrachin","boyscout","uruguayo","goat","curry"];

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

let state;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
} catch {
  const pins = {};
  for (const n of INTEGRANTES) pins[n] = String(crypto.randomInt(1000, 10000));
  state = { pins, votes: {}, sessions: {} };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log("=== INITIAL PINS GENERATED (one-time, save them now) ===");
  for (const n of INTEGRANTES) console.log(`  ${n.padEnd(8)} ${pins[n]}`);
  console.log("=========================================================");
}
state.sessions = state.sessions || {};
state.votes = state.votes || {};

let writeQueue = Promise.resolve();
function saveState() {
  writeQueue = writeQueue.then(() =>
    fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
  );
  return writeQueue;
}

function parseCookies(req) {
  const out = {};
  const c = req.headers.cookie;
  if (!c) return out;
  for (const pair of c.split(";")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}

function getUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = state.sessions[sid];
  return s ? s.name : null;
}

function publicState(viewer) {
  const totalVoters = Object.keys(state.votes).filter(v => Object.keys(state.votes[v]).length > 0).length;
  const out = {
    me: viewer,
    integrantes: INTEGRANTES,
    galardones: GALARDONES,
    myVotes: state.votes[viewer] || {},
    totalVoters,
    expectedVoters: INTEGRANTES.length,
    revealed: !!state.revealed,
  };
  if (state.revealed) {
    const tallies = {};
    for (const a of GALARDONES) tallies[a] = {};
    for (const voter of Object.keys(state.votes)) {
      for (const award of Object.keys(state.votes[voter])) {
        const target = state.votes[voter][award];
        tallies[award][target] = (tallies[award][target] || 0) + 1;
      }
    }
    out.tallies = tallies;
  }
  return out;
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/login", async (req, res) => {
  const { name, pin } = req.body || {};
  if (!INTEGRANTES.includes(name)) return res.status(400).json({ error: "nombre invalido" });
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: "pin invalido" });
  if (state.pins[name] !== pin) return res.status(401).json({ error: "pin incorrecto" });
  const sid = crypto.randomBytes(24).toString("hex");
  state.sessions[sid] = { name, createdAt: new Date().toISOString() };
  await saveState();
  res.cookie("sid", sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 90 * 24 * 3600 * 1000,
    path: "/",
  });
  res.json(publicState(name));
});

app.post("/api/logout", async (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid && state.sessions[sid]) {
    delete state.sessions[sid];
    await saveState();
  }
  res.clearCookie("sid", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/state", (req, res) => {
  const name = getUser(req);
  if (!name) return res.status(401).json({ error: "no auth" });
  res.json(publicState(name));
});

app.post("/api/vote", async (req, res) => {
  const name = getUser(req);
  if (!name) return res.status(401).json({ error: "no auth" });
  const { award, target } = req.body || {};
  if (!GALARDONES.includes(award)) return res.status(400).json({ error: "galardon invalido" });
  if (target !== null && !INTEGRANTES.includes(target)) return res.status(400).json({ error: "target invalido" });
  state.votes[name] = state.votes[name] || {};
  if (target === null) delete state.votes[name][award];
  else state.votes[name][award] = target;
  await saveState();
  res.json(publicState(name));
});

function adminAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

app.post("/api/admin/wipe-votes", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).json({ error: "no admin" });
  state.votes = {};
  await saveState();
  res.json({ ok: true, votes: state.votes });
});

app.get("/api/admin/voters", (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).json({ error: "no admin" });
  const byVoter = {};
  for (const name of Object.keys(state.votes)) {
    const count = Object.keys(state.votes[name]).length;
    if (count > 0) byVoter[name] = count;
  }
  const voted = Object.keys(byVoter);
  const missing = INTEGRANTES.filter(n => !voted.includes(n));
  res.json({
    expected: INTEGRANTES.length,
    totalCategories: GALARDONES.length,
    voters: byVoter,
    voted,
    missing,
  });
});

app.post("/api/admin/reveal", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).json({ error: "no admin" });
  const { revealed } = req.body || {};
  state.revealed = !!revealed;
  await saveState();
  res.json({ ok: true, revealed: state.revealed });
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`colombianazo listening on ${port}`));
