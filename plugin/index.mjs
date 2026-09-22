/**
 * CatOPanda Subathon for OSC Flow Studio.
 *
 * One persistent countdown, three independent goal ladders (Donate, Subs,
 * Bits) and six OBS overlays served from 127.0.0.1. Contributions arrive
 * through flow actions, so any trigger (Twitch, LivePix, a chat command, a
 * webhook) can feed the subathon; the plugin never talks to a payment API.
 */
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { createServer } from "node:http";
import { loadIdLedger } from "./id-ledger.mjs";

const PLUGIN_VERSION = "0.4.5";
const PORT_RETRY_MS = 15_000;
const STATE_KEY = "catopanda-subathon-state-v1";
const MAX_RECENT_EVENTS = 50;
const MAX_TIMER_SECONDS = 31_536_000;
const CONTRIBUTION_TYPES = ["donate", "subs", "bits"];
const FONT_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf"]);
const OVERLAY_PATHS = new Set([
  "/overlay/brb-stage",
  "/overlay/goals-footer",
  "/overlay/goals-totem",
  "/overlay/progress-triple",
  "/overlay/progress-pill",
  "/overlay/timer-giant",
  "/overlay/alerts",
]);
const STATIC_FILES = new Map([
  ["/overlay.css", ["overlay.css", "text/css; charset=utf-8"]],
  ["/overlay.js", ["overlay.js", "text/javascript; charset=utf-8"]],
  ["/assets/catopanda-logo.png", ["assets/catopanda-logo.png", "image/png"]],
  ["/assets/catopanda-avatar.png", ["assets/catopanda-avatar.png", "image/png"]],
  ["/assets/catopanda-background.png", ["assets/catopanda-background.png", "image/png"]],
]);
const DEFAULT_GOALS = [
  { id: "donate-100", type: "donate", title: "Chat escolhe o outfit", target: 10000, order: 1 },
  { id: "donate-150", type: "donate", title: "Cantar uma música", target: 15000, order: 2 },
  { id: "donate-200", type: "donate", title: "Jogar terror sem luz", target: 20000, order: 3 },
  { id: "donate-300", type: "donate", title: "Cosplay surpresa", target: 30000, order: 4 },
  { id: "subs-50", type: "subs", title: "Karaokê com o chat", target: 50, order: 5 },
  { id: "bits-10000", type: "bits", title: "Desafio escolhido ao vivo", target: 10000, order: 6 },
];
const DEFAULT_WARNINGS = [3600, 900, 300, 60];
const ALERT_POSITIONS = ["top-right", "top-left", "top-center", "bottom-right", "bottom-left", "bottom-center"];

let activeRuntime = null;

function asNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asText(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeWarnings(raw) {
  const source = Array.isArray(raw) ? raw : DEFAULT_WARNINGS;
  const seconds = source
    .map((value) => Math.round(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= MAX_TIMER_SECONDS);
  return [...new Set(seconds)].sort((a, b) => b - a);
}

function normalizeConfig(raw) {
  return {
    enabled: raw.enabled !== false,
    port: Math.round(asNumber(raw.port, 8798, 0, 65535)),
    initialTimerSeconds: Math.round(asNumber(raw.initialTimerSeconds, 259200, 0, MAX_TIMER_SECONDS)),
    donateSecondsPerReal: asNumber(raw.donateSecondsPerReal, 60, 0, 86400),
    bitsPerUnit: asNumber(raw.bitsPerUnit, 100, 1, 1000000),
    bitsSecondsPerUnit: asNumber(raw.bitsSecondsPerUnit, 60, 0, 86400),
    subTier1Seconds: asNumber(raw.subTier1Seconds, 600, 0, 604800),
    subTier2Seconds: asNumber(raw.subTier2Seconds, 1200, 0, 604800),
    subTier3Seconds: asNumber(raw.subTier3Seconds, 3000, 0, 604800),
    subPrimeSeconds: asNumber(raw.subPrimeSeconds, 600, 0, 604800),
    warningThresholds: normalizeWarnings(raw.warningThresholds),
    goals: raw.goals ?? null,
    legacyGoalsJson: typeof raw.goalsJson === "string" ? raw.goalsJson : "",
    maxTotemGoals: Math.round(asNumber(raw.maxTotemGoals, 3, 1, 8)),
    brbTransparent: raw.brbTransparent === true,
    goalsTransparent: raw.goalsTransparent !== false,
    progressTransparent: raw.progressTransparent !== false,
    timerTransparent: raw.timerTransparent !== false,
    overlayScale: asNumber(raw.overlayScale, 1, 0.5, 2),
    effectsEnabled: raw.effectsEnabled !== false,
    celebrateGoals: raw.celebrateGoals !== false,
    celebrateContributions: raw.celebrateContributions !== false,
    celebrationSeconds: Math.round(asNumber(raw.celebrationSeconds, 6, 2, 30)),
    alertsPosition: ALERT_POSITIONS.includes(raw.alertsPosition) ? raw.alertsPosition : "top-right",
    fontFamily: asText(raw.fontFamily, "Fredoka").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 80) || "Fredoka",
    fontSource: asText(
      raw.fontSource,
      "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito+Sans:wght@600;700;800&display=swap",
    ),
    colorCoral: asColor(raw.colorCoral, "#ff6255"),
    colorPurple: asColor(raw.colorPurple, "#9b44e8"),
    colorCyan: asColor(raw.colorCyan, "#58cffa"),
    colorPanel: asColor(raw.colorPanel, "#211633"),
    colorText: asColor(raw.colorText, "#fffafd"),
    brbEyebrow: asText(raw.brbEyebrow, "SUBATHON CATOPANDA").slice(0, 120),
    brbTitle: asText(raw.brbTitle, "A LIVE JÁ VOLTA!").slice(0, 160),
    brbSubtitle: asText(raw.brbSubtitle, "Enquanto isso, o cronômetro continua correndo.").slice(0, 240),
    brbStatus: asText(raw.brbStatus, "Retornamos em instantes").slice(0, 120),
  };
}

// The editor uses text so both pt-BR commas and decimal points survive typing.
// Keep cents inside the runtime: LivePix events and saved totals already use cents.
function goalTarget(item, type) {
  if (item.amount === undefined || item.amount === null || String(item.amount).trim() === "") {
    return Math.round(asNumber(item.target, 0, 0, Number.MAX_SAFE_INTEGER));
  }
  const text = String(item.amount).trim();
  if (text.length > 40 || !/^(?:\d+(?:[.,]\d+)?|[.,]\d+|\d{1,3}(?:\.\d{3})+,\d+)$/.test(text)) {
    throw new Error("alvo inválido: use um valor como 52,01 ou 52.01");
  }
  const decimal = text.includes(",") ? text.replaceAll(".", "").replace(",", ".") : text;
  if (type !== "donate") {
    const count = Number(decimal);
    if (!Number.isFinite(count) || count <= 0 || count > Number.MAX_SAFE_INTEGER) throw new Error("alvo fora do limite");
    return count;
  }
  const [whole, fraction = ""] = decimal.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2))
    + (Number(fraction[2] || "0") >= 5 ? 1n : 0n);
  if (cents < 1n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("alvo fora do limite em reais");
  return Number(cents);
}

function isDefaultGoalsTable(value) {
  try {
    return Array.isArray(value)
    && value.length === DEFAULT_GOALS.length
    && value.every((goal, index) => {
      const expected = DEFAULT_GOALS[index];
      return goal
        && goal.id === expected.id
        && goal.type === expected.type
        && goal.title === expected.title
        && goalTarget(goal, goal.type) === expected.target
        && Number(goal.order) === expected.order;
    });
  } catch {
    // An edited invalid target is not an untouched default table.
    return false;
  }
}

function parseGoals(config, log) {
  const errors = [];
  const report = (message) => {
    errors.push(message);
    log.warn(message);
  };
  let parsed = config.goals;
  try {
    // Version 0.1 stored the goals as JSON text. Keep reading it until the
    // user touches the table, so an upgrade never drops a configured ladder.
    if (
      config.legacyGoalsJson
      && (!Array.isArray(parsed) || parsed.length === 0 || isDefaultGoalsTable(parsed))
    ) {
      parsed = JSON.parse(config.legacyGoalsJson);
    }
    parsed ??= DEFAULT_GOALS;
    if (!Array.isArray(parsed)) throw new Error("o valor precisa ser uma lista");
  } catch (error) {
    report("Configuração de metas inválida: " + describe(error) + ". Corrija a lista na aba Metas; os dados salvos foram mantidos.");
    return { goals: [], errors };
  }
  const ids = new Set();
  const goals = [];
  for (const [index, item] of parsed.entries()) {
    try {
      const type = String(item && item.type ? item.type : "").toLowerCase();
      if (!CONTRIBUTION_TYPES.includes(type)) {
        throw new Error("tipo inválido na meta " + String(index + 1));
      }
      const target = goalTarget(item, type);
      if (target <= 0) throw new Error("alvo inválido na meta " + String(index + 1));
      const id = asText(item.id, type + "-" + String(index + 1)).slice(0, 80);
      if (ids.has(id)) throw new Error("id duplicado: " + id);
      ids.add(id);
      goals.push({
        id,
        type,
        title: asText(item.title, "Meta " + String(index + 1)).slice(0, 160),
        target,
        order: asNumber(item.order, index + 1, -100000, 100000),
      });
    } catch (error) {
      // A bad row must never replace the user's entire ladder with sample goals.
      report("Meta " + String(index + 1) + ": " + describe(error)
        + ". Corrija esta linha na aba Metas; as outras metas continuam funcionando.");
    }
  }
  return { goals: goals.sort((a, b) => a.order - b.order), errors };
}

function initialState(config) {
  return {
    version: 1,
    revision: 0,
    timer: {
      remainingSeconds: config.initialTimerSeconds,
      running: false,
      anchorAt: Date.now(),
      finishedEmitted: false,
      finishedAt: "",
      warningsFired: [],
    },
    totals: { donateCents: 0, subs: 0, bits: 0, addedSeconds: 0 },
    ledger: [],
    lastSupport: null,
    history: [],
  };
}

function hydrateState(raw, config, log) {
  if (!raw) return initialState(config);
  try {
    const parsed = JSON.parse(raw);
    const next = initialState(config);
    const timer = parsed.timer && typeof parsed.timer === "object" ? parsed.timer : {};
    const totals = parsed.totals && typeof parsed.totals === "object" ? parsed.totals : {};
    next.revision = Math.max(0, Math.round(Number(parsed.revision) || 0));
    next.timer.remainingSeconds = Math.round(
      asNumber(timer.remainingSeconds, config.initialTimerSeconds, 0, MAX_TIMER_SECONDS),
    );
    next.timer.running = Boolean(timer.running);
    next.timer.anchorAt = asNumber(timer.anchorAt, Date.now(), 0, Number.MAX_SAFE_INTEGER);
    next.timer.finishedEmitted = Boolean(timer.finishedEmitted);
    next.timer.finishedAt = typeof timer.finishedAt === "string" ? timer.finishedAt : "";
    next.timer.warningsFired = Array.isArray(timer.warningsFired)
      ? timer.warningsFired.map(Number).filter(Number.isFinite)
      : [];
    next.totals.donateCents = Math.max(0, Math.round(Number(totals.donateCents) || 0));
    next.totals.subs = Math.max(0, Math.round(Number(totals.subs) || 0));
    next.totals.bits = Math.max(0, Math.round(Number(totals.bits) || 0));
    // State saved by earlier versions has no counter: it starts at zero, and "definir total" can correct it.
    next.totals.addedSeconds = Math.max(0, Math.round(Number(totals.addedSeconds) || 0));
    next.ledger = Array.isArray(parsed.ledger)
      ? parsed.ledger.filter((key) => typeof key === "string")
      : [];
    next.idLedger = parsed.idLedger;
    next.lastSupport = parsed.lastSupport && typeof parsed.lastSupport === "object" ? parsed.lastSupport : null;
    next.history = Array.isArray(parsed.history)
      ? parsed.history.filter((entry) => entry && typeof entry === "object").slice(-20)
      : [];
    return next;
  } catch (error) {
    throw new Error("Cannot restore Subathon state: " + describe(error));
  }
}

function materializeTimer(runtime, now = Date.now()) {
  const timer = runtime.state.timer;
  if (!timer.running) {
    timer.anchorAt = now;
    return timer.remainingSeconds;
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - timer.anchorAt) / 1000));
  if (elapsedSeconds > 0) {
    timer.remainingSeconds = Math.max(0, timer.remainingSeconds - elapsedSeconds);
    timer.anchorAt += elapsedSeconds * 1000;
  }
  return timer.remainingSeconds;
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

/** "12h 05min", "5min 30s" or "45s": reads as a sentence on stream, unlike hh:mm:ss. */
function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return String(hours) + "h " + String(minutes).padStart(2, "0") + "min";
  if (minutes > 0) return String(minutes) + "min" + (seconds ? " " + String(seconds).padStart(2, "0") + "s" : "");
  return seconds ? String(seconds) + "s" : "0min";
}

function currentForType(state, type) {
  if (type === "donate") return state.totals.donateCents;
  if (type === "subs") return state.totals.subs;
  return state.totals.bits;
}

function formatAmount(type, value) {
  if (type === "donate") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value / 100);
  }
  const formatted = new Intl.NumberFormat("pt-BR").format(value);
  if (type === "bits") return formatted + " Bits";
  return formatted + (value === 1 ? " Sub" : " Subs");
}

/** "R$ 40 / R$ 100" for money; "40 / 50 Subs" for counts, so the unit appears once. */
function formatPair(type, current, target, separator) {
  if (type === "donate") return formatAmount(type, current) + separator + formatAmount(type, target);
  return new Intl.NumberFormat("pt-BR").format(current) + separator + formatAmount(type, target);
}

function calculatedGoals(runtime) {
  let currentAssigned = false;
  return runtime.goals.map((goal) => {
    const current = currentForType(runtime.state, goal.type);
    const completed = current >= goal.target;
    const progress = Math.min(100, Math.max(0, Math.round((current / goal.target) * 100)));
    let status = completed ? "done" : "next";
    if (!completed && !currentAssigned) {
      status = "current";
      currentAssigned = true;
    }
    return {
      ...goal,
      current,
      completed,
      progress,
      status,
      currentLabel: formatAmount(goal.type, current),
      targetLabel: formatAmount(goal.type, goal.target),
      amountLabel: formatPair(goal.type, current, goal.target, " / "),
    };
  });
}

function targetForType(runtime, type) {
  const targets = runtime.goals.filter((goal) => goal.type === type).map((goal) => goal.target);
  return targets.length ? Math.max(...targets) : 1;
}

function overlayUrls(runtime) {
  const base = "http://127.0.0.1:" + String(runtime.port);
  return {
    brbStage: base + "/overlay/brb-stage",
    goalsFooter: base + "/overlay/goals-footer",
    goalsTotem: base + "/overlay/goals-totem",
    progressTriple: base + "/overlay/progress-triple",
    progressPill: base + "/overlay/progress-pill",
    timerGiant: base + "/overlay/timer-giant",
    alerts: base + "/overlay/alerts",
  };
}

function snapshot(runtime) {
  const remainingSeconds = materializeTimer(runtime);
  const goals = calculatedGoals(runtime);
  const currentGoal = goals.find((goal) => !goal.completed) || goals[goals.length - 1] || null;
  const currentIndex = currentGoal ? goals.findIndex((goal) => goal.id === currentGoal.id) : -1;
  const nextGoal = currentIndex >= 0 ? goals[currentIndex + 1] || null : null;
  const score = {};
  for (const type of CONTRIBUTION_TYPES) {
    const current = currentForType(runtime.state, type);
    const target = targetForType(runtime, type);
    score[type] = {
      hasGoals: runtime.goals.some((goal) => goal.type === type),
      current,
      target,
      progress: Math.min(100, Math.max(0, Math.round((current / target) * 100))),
      currentLabel: formatAmount(type, current),
      targetLabel: formatAmount(type, target),
    };
  }
  const nextWarning = runtime.config.warningThresholds.find(
    (threshold) => remainingSeconds > threshold,
  );
  return {
    version: 1,
    revision: runtime.state.revision,
    timer: {
      remainingSeconds,
      formatted: formatTime(remainingSeconds),
      running: runtime.state.timer.running,
      finishedAt: runtime.state.timer.finishedAt,
      nextWarningSeconds: nextWarning ?? null,
      inFinalStretch: runtime.config.warningThresholds.length > 0
        && remainingSeconds <= runtime.config.warningThresholds[0]
        && remainingSeconds > 0,
    },
    totals: {
      donate: runtime.state.totals.donateCents,
      donateCents: runtime.state.totals.donateCents,
      subs: runtime.state.totals.subs,
      bits: runtime.state.totals.bits,
      addedSeconds: runtime.state.totals.addedSeconds,
      addedLabel: formatDuration(runtime.state.totals.addedSeconds),
    },
    goals,
    goalErrors: runtime.goalErrors,
    completedGoals: goals.filter((goal) => goal.completed).length,
    currentGoal,
    nextGoal,
    score,
    lastSupport: runtime.state.lastSupport,
    history: runtime.state.history,
    display: {
      maxTotemGoals: runtime.config.maxTotemGoals,
      transparent: {
        brb: runtime.config.brbTransparent,
        goals: runtime.config.goalsTransparent,
        progress: runtime.config.progressTransparent,
        timer: runtime.config.timerTransparent,
      },
      effects: {
        enabled: runtime.config.effectsEnabled,
        celebrateGoals: runtime.config.celebrateGoals,
        celebrateContributions: runtime.config.celebrateContributions,
        celebrationSeconds: runtime.config.celebrationSeconds,
        alertsPosition: runtime.config.alertsPosition,
      },
      copy: {
        eyebrow: runtime.config.brbEyebrow,
        title: runtime.config.brbTitle,
        subtitle: runtime.config.brbSubtitle,
        status: runtime.config.brbStatus,
      },
    },
    urls: overlayUrls(runtime),
    server: {
      listening: runtime.server !== null,
      port: runtime.port,
      error: runtime.bindError,
    },
  };
}

async function persist(runtime, required = false, state = runtime.state) {
  try {
    await runtime.ctx.secrets.set(STATE_KEY, JSON.stringify(state));
  } catch (error) {
    runtime.ctx.log.warn("não foi possível persistir o estado: " + describe(error));
    if (required) throw error;
  }
}

/**
 * Overlays poll /api/poll instead of holding an SSE stream. Chromium (and the
 * CEF inside OBS) allows six HTTP/1.1 connections per host, so six open streams
 * left every further Browser Source loading forever. Events are kept in a short
 * numbered buffer so a poll delivers each one exactly once.
 */
function recordEvent(runtime, eventName, payload) {
  runtime.eventSeq += 1;
  runtime.recentEvents.push({ seq: runtime.eventSeq, name: eventName, payload });
  if (runtime.recentEvents.length > MAX_RECENT_EVENTS) runtime.recentEvents.shift();
}

function pollResponse(runtime, sinceText) {
  const since = Number(sinceText);
  // No cursor, or one from before a restart: start from now and replay nothing,
  // so reloading a Browser Source never repeats an alert.
  const events = sinceText === null || !Number.isInteger(since) || since < 0 || since > runtime.eventSeq
    ? []
    : runtime.recentEvents.filter((event) => event.seq > since);
  return { seq: runtime.eventSeq, state: snapshot(runtime), events };
}

function broadcast(runtime, eventName, payload) {
  if (eventName !== "state") recordEvent(runtime, eventName, payload);
  if (runtime.clients.size === 0) return;
  const message = "event: " + eventName + "\ndata: " + JSON.stringify(payload) + "\n\n";
  for (const client of runtime.clients) {
    try {
      client.write(message);
    } catch {
      runtime.clients.delete(client);
    }
  }
}

function emitState(runtime) {
  if (runtime.stopped) return;
  broadcast(runtime, "state", snapshot(runtime));
}

function queueMutation(runtime, callback) {
  if (runtime.stopped) return Promise.resolve({ ok: false, error: "plugin desativado" });
  const pending = runtime.queue.then(callback);
  runtime.queue = pending.catch(() => undefined);
  return pending;
}

function contributionSeconds(runtime, type, value, tier) {
  if (type === "donate") {
    return Math.max(0, Math.round((value / 100) * runtime.config.donateSecondsPerReal));
  }
  if (type === "bits") {
    return Math.max(0, Math.round((value / runtime.config.bitsPerUnit) * runtime.config.bitsSecondsPerUnit));
  }
  const secondsPerSub = tier === "prime"
    ? runtime.config.subPrimeSeconds
    : tier === "3000"
      ? runtime.config.subTier3Seconds
      : tier === "2000"
        ? runtime.config.subTier2Seconds
        : runtime.config.subTier1Seconds;
  return Math.max(0, Math.round(value * secondsPerSub));
}

/**
 * Twitch EventSub reports a Prime sub as tier 1000, so an automatic flow cannot
 * tell one apart; `prime` only ever arrives from a block the user filled in, or
 * from a source that does say so (chat tags carry `sub_plan: Prime`). Anything
 * unrecognised falls back to tier 1, which is what Twitch would have sent.
 */
function normalizeTier(value) {
  const text = asText(value, "1000");
  if (/prime/i.test(text)) return "prime";
  if (text === "2" || text === "2000" || /tier ?2/i.test(text)) return "2000";
  if (text === "3" || text === "3000" || /tier ?3/i.test(text)) return "3000";
  return "1000";
}

function normalizeType(value) {
  const text = asText(value, "").toLowerCase();
  if (text === "donate" || text === "donation" || text === "pix") return "donate";
  if (text === "subs" || text === "sub" || text === "subscription") return "subs";
  if (text === "bits" || text === "bit" || text === "cheer") return "bits";
  return "";
}

function newlyCompletedGoals(before, after) {
  const beforeCompleted = new Set(before.filter((goal) => goal.completed).map((goal) => goal.id));
  return after.filter((goal) => goal.completed && !beforeCompleted.has(goal.id));
}

function emitGoalCompleted(runtime, goal, goals) {
  const index = goals.findIndex((entry) => entry.id === goal.id);
  const next = goals.slice(index + 1).find((entry) => !entry.completed) || null;
  const payload = {
    goalId: goal.id,
    type: goal.type,
    title: goal.title,
    target: goal.target,
    targetLabel: goal.targetLabel,
    total: goal.current,
    completedCount: goals.filter((entry) => entry.completed).length,
    nextTitle: next ? next.title : "",
    timerChanged: false,
  };
  broadcast(runtime, "goal-completed", payload);
  runtime.ctx.emitTrigger("goal-completed", payload);
}

async function recordContribution(runtime, input) {
  return queueMutation(runtime, async () => {
    const type = normalizeType(input.type);
    const value = Math.max(0, Math.round(Number(input.value) || 0));
    if (!type) throw new Error("tipo de contribuição inválido: " + asText(input.type, "(vazio)"));
    if (value <= 0) throw new Error("valor da contribuição precisa ser maior que zero");
    const eventKey = asText(input.eventKey, "");
    const ledgerKey = eventKey ? type + ":" + eventKey : "";
    const timerBefore = snapshot(runtime).timer;
    if (ledgerKey && runtime.idLedger.ids.has(ledgerKey)) {
      return {
        accepted: false,
        duplicate: true,
        secondsAdded: 0,
        total: currentForType(runtime.state, type),
        remainingSeconds: timerBefore.remainingSeconds,
        formatted: timerBefore.formatted,
      };
    }

    const previousState = structuredClone(runtime.state);
    const addedIds = ledgerKey ? [ledgerKey] : [];
    const nextLedger = await runtime.idLedger.prepare(addedIds);
    const tier = type === "subs" ? normalizeTier(input.tier) : "";
    const beforeGoals = calculatedGoals(runtime);
    materializeTimer(runtime);
    const secondsAdded = contributionSeconds(runtime, type, value, tier);
    if (type === "donate") runtime.state.totals.donateCents += value;
    if (type === "subs") runtime.state.totals.subs += value;
    if (type === "bits") runtime.state.totals.bits += value;

    const wasAtZero = runtime.state.timer.remainingSeconds === 0;
    runtime.state.timer.remainingSeconds = Math.min(
      MAX_TIMER_SECONDS,
      runtime.state.timer.remainingSeconds + secondsAdded,
    );
    // Only supporter time counts; operator adjustments in "controlar cronômetro" do not.
    runtime.state.totals.addedSeconds += secondsAdded;
    runtime.state.timer.anchorAt = Date.now();
    if (wasAtZero && secondsAdded > 0) runtime.state.timer.running = true;
    if (secondsAdded > 0) {
      runtime.state.timer.finishedEmitted = false;
      runtime.state.timer.finishedAt = "";
      rearmWarnings(runtime);
    }
    runtime.state.idLedger = nextLedger;
    const actorName = asText(input.actorName, "Apoiador");
    const source = asText(input.source, type === "donate" ? "manual" : "twitch");
    const support = {
      type,
      value,
      valueLabel: formatAmount(type, value),
      actorName,
      secondsAdded,
      addedLabel: formatTime(secondsAdded),
      source,
      tier,
      receivedAt: new Date().toISOString(),
    };
    runtime.state.lastSupport = support;
    runtime.state.history = [...runtime.state.history, support].slice(-20);
    runtime.state.revision += 1;

    const afterGoals = calculatedGoals(runtime);
    const completed = newlyCompletedGoals(beforeGoals, afterGoals);
    const nextState = runtime.state;
    runtime.state = previousState;
    await persist(runtime, true, nextState);
    runtime.state = nextState;
    runtime.idLedger.commit(nextLedger, addedIds);
    const timerAfter = snapshot(runtime).timer;
    broadcast(runtime, "contribution", { ...support, remainingSeconds: timerAfter.remainingSeconds });
    emitState(runtime);

    const total = currentForType(runtime.state, type);
    runtime.ctx.emitTrigger("contribution", {
      type,
      value,
      valueLabel: support.valueLabel,
      secondsAdded,
      addedLabel: support.addedLabel,
      total,
      remainingSeconds: timerAfter.remainingSeconds,
      totalAddedSeconds: runtime.state.totals.addedSeconds,
      totalAddedLabel: formatDuration(runtime.state.totals.addedSeconds),
      eventKey,
      source,
      tier,
      actorId: asText(input.actorId, ""),
      actorDisplayName: actorName,
    });
    for (const goal of completed) emitGoalCompleted(runtime, goal, afterGoals);
    return {
      accepted: true,
      duplicate: false,
      secondsAdded,
      total,
      remainingSeconds: timerAfter.remainingSeconds,
      formatted: timerAfter.formatted,
    };
  });
}

/** Marks that have not been crossed become armed again once time was added past them. */
function rearmWarnings(runtime) {
  const remaining = runtime.state.timer.remainingSeconds;
  runtime.state.timer.warningsFired = runtime.state.timer.warningsFired.filter(
    (threshold) => remaining <= threshold,
  );
}

async function controlTimer(runtime, input) {
  return queueMutation(runtime, async () => {
    const operation = asText(input.operation, "pause");
    const seconds = Math.round(asNumber(input.seconds, 0, 0, MAX_TIMER_SECONDS));
    materializeTimer(runtime);
    const timer = runtime.state.timer;
    if (operation === "pause") timer.running = false;
    else if (operation === "resume") timer.running = timer.remainingSeconds > 0;
    else if (operation === "toggle") timer.running = !timer.running && timer.remainingSeconds > 0;
    else if (operation === "add") timer.remainingSeconds = Math.min(MAX_TIMER_SECONDS, timer.remainingSeconds + seconds);
    else if (operation === "subtract") timer.remainingSeconds = Math.max(0, timer.remainingSeconds - seconds);
    else if (operation === "set") timer.remainingSeconds = seconds;
    else if (operation === "reset") {
      timer.remainingSeconds = runtime.config.initialTimerSeconds;
      timer.running = false;
      timer.warningsFired = [];
    } else {
      throw new Error("operação de cronômetro inválida: " + operation);
    }
    if (timer.remainingSeconds === 0) timer.running = false;
    if (timer.remainingSeconds > 0) {
      timer.finishedEmitted = false;
      timer.finishedAt = "";
    }
    rearmWarnings(runtime);
    timer.anchorAt = Date.now();
    runtime.state.revision += 1;
    await persist(runtime);
    emitState(runtime);
    const current = snapshot(runtime).timer;
    return {
      running: current.running,
      remainingSeconds: current.remainingSeconds,
      formatted: current.formatted,
    };
  });
}

async function setTotal(runtime, input) {
  return queueMutation(runtime, async () => {
    const rawType = input.contributionType ?? input.type;
    const type = asText(rawType, "").toLowerCase() === "added-time" ? "added-time" : normalizeType(rawType);
    if (!type) throw new Error("tipo de total inválido");
    const operation = input.operation === undefined ? "set" : input.operation;
    if (!["set", "add", "subtract"].includes(operation)) throw new Error("operação de ajuste inválida");
    const updateTimer = input.updateTimer === undefined ? false : input.updateTimer;
    if (typeof updateTimer !== "boolean") throw new Error("alterar cronômetro precisa ser verdadeiro ou falso");
    if (updateTimer && type !== "subs") throw new Error("alterar cronômetro neste ajuste requer o tipo Subs");
    const rawValue = input.value === undefined ? 0 : input.value;
    const numericValue = Number(rawValue);
    if (!["number", "string"].includes(typeof rawValue) || String(rawValue).trim() === ""
      || !Number.isFinite(numericValue) || numericValue < 0
      || (type === "subs" && !Number.isSafeInteger(numericValue))) {
      throw new Error("valor do ajuste inválido: use um número não negativo e inteiro para Subs");
    }
    const value = Math.round(numericValue);
    const previous = type === "added-time" ? runtime.state.totals.addedSeconds : currentForType(runtime.state, type);
    const total = operation === "set" ? value : operation === "add" ? previous + value : Math.max(0, previous - value);
    if (!Number.isSafeInteger(total)) throw new Error("total do ajuste fora do limite");
    const change = total - previous;
    const secondsChange = updateTimer ? Math.sign(change) * contributionSeconds(runtime, "subs", Math.abs(change), normalizeTier(input.tier)) : 0;
    const addedSeconds = Math.max(0, runtime.state.totals.addedSeconds + secondsChange);
    if (updateTimer && !Number.isSafeInteger(addedSeconds)) throw new Error("tempo do ajuste fora do limite");

    const beforeGoals = calculatedGoals(runtime);
    let timerChanged = false;
    if (updateTimer && secondsChange !== 0) {
      materializeTimer(runtime);
      const timer = runtime.state.timer;
      const remaining = Math.max(0, Math.min(MAX_TIMER_SECONDS, timer.remainingSeconds + secondsChange));
      timerChanged = remaining !== timer.remainingSeconds;
      timer.remainingSeconds = remaining;
      if (remaining === 0) timer.running = false;
      else {
        timer.finishedEmitted = false;
        timer.finishedAt = "";
      }
      rearmWarnings(runtime);
      runtime.state.totals.addedSeconds = addedSeconds;
    }
    if (type === "donate") runtime.state.totals.donateCents = total;
    if (type === "subs") runtime.state.totals.subs = total;
    if (type === "bits") runtime.state.totals.bits = total;
    if (type === "added-time") runtime.state.totals.addedSeconds = total;
    runtime.state.revision += 1;
    const afterGoals = calculatedGoals(runtime);
    const completed = newlyCompletedGoals(beforeGoals, afterGoals);
    await persist(runtime);
    emitState(runtime);
    for (const goal of completed) emitGoalCompleted(runtime, goal, afterGoals);
    return { type, total, timerChanged };
  });
}

async function resetState(runtime, input) {
  return queueMutation(runtime, async () => {
    const scope = asText(input.scope, "totals");
    if (!["totals", "timer", "ledger", "all"].includes(scope)) throw new Error("escopo inválido: " + scope);
    const previousState = structuredClone(runtime.state);
    const nextLedger = scope === "all" || scope === "ledger"
      ? await loadIdLedger(runtime.ctx.secrets, "subathon-ids") : runtime.idLedger;
    if (scope === "all") runtime.state = initialState(runtime.config);
    if (scope === "totals") {
      runtime.state.totals = { donateCents: 0, subs: 0, bits: 0, addedSeconds: 0 };
      runtime.state.lastSupport = null;
      runtime.state.history = [];
    }
    if (scope === "timer") runtime.state.timer = initialState(runtime.config).timer;
    if (scope === "ledger") runtime.state.ledger = [];
    runtime.state.idLedger = nextLedger.descriptor;
    runtime.state.revision += 1;
    const nextState = runtime.state;
    runtime.state = previousState;
    await persist(runtime, true, nextState);
    runtime.state = nextState;
    runtime.idLedger = nextLedger;
    emitState(runtime);
    return { scope, ok: true };
  });
}

async function handleTimerTick(runtime) {
  if (runtime.stopped) return;
  if (!runtime.state.timer.running) {
    emitState(runtime);
    return;
  }
  const remaining = materializeTimer(runtime);
  let changed = false;
  for (const threshold of runtime.config.warningThresholds) {
    if (remaining > 0 && remaining <= threshold && !runtime.state.timer.warningsFired.includes(threshold)) {
      runtime.state.timer.warningsFired.push(threshold);
      changed = true;
      const payload = { thresholdSeconds: threshold, remainingSeconds: remaining, formatted: formatTime(remaining) };
      broadcast(runtime, "timer-warning", payload);
      runtime.ctx.emitTrigger("timer-warning", payload);
    }
  }
  if (remaining <= 0) {
    runtime.state.timer.remainingSeconds = 0;
    runtime.state.timer.running = false;
    runtime.state.timer.anchorAt = Date.now();
    if (!runtime.state.timer.finishedEmitted) {
      runtime.state.timer.finishedEmitted = true;
      runtime.state.timer.finishedAt = new Date().toISOString();
      runtime.state.revision += 1;
      changed = true;
      const payload = {
        finishedAt: runtime.state.timer.finishedAt,
        formatted: "00:00:00",
        totals: {
          donate: runtime.state.totals.donateCents,
          subs: runtime.state.totals.subs,
          bits: runtime.state.totals.bits,
          addedSeconds: runtime.state.totals.addedSeconds,
        },
      };
      broadcast(runtime, "timer-finished", payload);
      runtime.ctx.emitTrigger("timer-finished", payload);
    }
  }
  if (changed) await persist(runtime);
  emitState(runtime);
}

function isFontPath(source) {
  return FONT_EXTENSIONS.has(extname(source).toLowerCase());
}

function customFontCss(config) {
  const source = config.fontSource.replace(/["\\\r\n]/g, "");
  const family = config.fontFamily;
  let fontRule = "";
  if (/^https?:\/\//i.test(source)) {
    if (isFontPath(source.split(/[?#]/)[0])) {
      fontRule = '@font-face{font-family:"CatOPandaCustom";src:url("' + source + '");font-display:swap;}';
    } else {
      fontRule = '@import url("' + source + '");';
    }
  } else if (source && isFontPath(source)) {
    fontRule = '@font-face{font-family:"CatOPandaCustom";src:url("/custom-font");font-display:swap;}';
  }
  return fontRule +
    ":root{" +
    '--font-display:"' + family + '","CatOPandaCustom","Fredoka","Trebuchet MS",sans-serif;' +
    "--coral:" + config.colorCoral + ";" +
    "--purple:" + config.colorPurple + ";" +
    "--cyan:" + config.colorCyan + ";" +
    "--panel:" + config.colorPanel + ";" +
    "--text:" + config.colorText + ";" +
    "--overlay-scale:" + String(config.overlayScale) + ";" +
    "--celebration-seconds:" + String(config.celebrationSeconds) + "s;" +
    "}";
}

function contentTypeForFont(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".woff") return "font/woff";
  if (extension === ".otf") return "font/otf";
  return "font/ttf";
}

/**
 * Same-origin only: the overlays load from this server, so no page on another
 * origin needs to read the state. Browser Sources in OBS ignore CORS anyway.
 */
function commonHeaders(contentType) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

async function sendStatic(res, relativePath, contentType) {
  const fileUrl = new URL(relativePath, import.meta.url);
  const body = await readFile(fileUrl);
  res.writeHead(200, commonHeaders(contentType));
  res.end(body);
}

function sendJson(res, status, value) {
  res.writeHead(status, commonHeaders("application/json; charset=utf-8"));
  res.end(JSON.stringify(value));
}

function sendText(res, status, text) {
  res.writeHead(status, commonHeaders("text/plain; charset=utf-8"));
  res.end(text);
}

async function handleRequest(runtime, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "no-store" });
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, plugin: "catopanda-subathon", version: PLUGIN_VERSION });
    return;
  }
  if (url.pathname === "/api/state") {
    sendJson(res, 200, snapshot(runtime));
    return;
  }
  if (url.pathname === "/api/poll") {
    sendJson(res, 200, pollResponse(runtime, url.searchParams.get("since")));
    return;
  }
  // Kept for external readers; the bundled overlays poll /api/poll instead.
  if (url.pathname === "/events") {
    res.writeHead(200, {
      ...commonHeaders("text/event-stream; charset=utf-8"),
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 2000\n\n");
    runtime.clients.add(res);
    res.write("event: state\ndata: " + JSON.stringify(snapshot(runtime)) + "\n\n");
    req.on("close", () => runtime.clients.delete(res));
    return;
  }
  if (url.pathname === "/theme.css") {
    res.writeHead(200, commonHeaders("text/css; charset=utf-8"));
    res.end(customFontCss(runtime.config));
    return;
  }
  if (url.pathname === "/custom-font") {
    // Only a local font file the user pointed at is ever served; any other
    // path (or a remote URL, handled by the stylesheet) answers 404.
    const source = runtime.config.fontSource;
    if (!source || /^https?:\/\//i.test(source) || !isFontPath(source)) {
      sendText(res, 404, "Not Found");
      return;
    }
    const path = resolve(source);
    if (!existsSync(path)) {
      sendText(res, 404, "Not Found");
      return;
    }
    res.writeHead(200, commonHeaders(contentTypeForFont(path)));
    createReadStream(path).pipe(res);
    return;
  }
  if (OVERLAY_PATHS.has(url.pathname) || url.pathname === "/") {
    await sendStatic(res, "overlay.html", "text/html; charset=utf-8");
    return;
  }
  const staticEntry = STATIC_FILES.get(url.pathname);
  if (staticEntry) {
    await sendStatic(res, staticEntry[0], staticEntry[1]);
    return;
  }
  sendText(res, 404, "Not Found");
}

/**
 * Opens the overlay server, and keeps trying when the port is taken.
 *
 * A busy port used to throw out of activate, which took the whole plugin down:
 * the timer stopped counting and every flow that credited a donation reported
 * the plugin as off. Losing the overlays is bad; losing the subathon's clock
 * and its totals is much worse. So the port is the only thing that fails here,
 * it is retried on the same number (never a different one, or the URLs already
 * pasted into OBS would point at nothing), and the card says what is wrong.
 */
async function bindServer(runtime) {
  if (runtime.stopped || runtime.server) return true;
  const server = createServer((req, res) => {
    void handleRequest(runtime, req, res).catch((error) => {
      runtime.ctx.log.error("erro HTTP: " + describe(error));
      if (!res.headersSent) res.writeHead(500, commonHeaders("text/plain; charset=utf-8"));
      res.end("Internal Server Error");
    });
  });
  server.on("connection", (socket) => {
    runtime.sockets.add(socket);
    socket.once("close", () => runtime.sockets.delete(socket));
  });
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(runtime.config.port, "127.0.0.1", resolvePromise);
    });
  } catch (error) {
    try {
      server.close();
    } catch {
      // Never listened, nothing to close.
    }
    if (runtime.stopped) return false;
    runtime.bindError = describe(error);
    runtime.ctx.log.warn(
      "porta " + String(runtime.config.port) + " indisponível: " + runtime.bindError
      + "; cronômetro e blocos seguem funcionando, nova tentativa em "
      + String(PORT_RETRY_MS / 1000) + "s",
    );
    runtime.ctx.setStatus({
      health: "degraded",
      connectionState: "porta " + String(runtime.config.port) + " ocupada; sem overlays",
      errors: [
        "Não foi possível abrir a porta " + String(runtime.config.port)
        + " em 127.0.0.1. Feche o programa que a está usando ou escolha outra porta na aba Geral."
        + " O cronômetro, as metas e os blocos continuam funcionando.",
        ...runtime.goalErrors,
      ],
    });
    scheduleBind(runtime);
    return false;
  }
  if (runtime.stopped) {
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    return false;
  }
  runtime.server = server;
  runtime.bindError = "";
  const address = server.address();
  runtime.port = address && typeof address === "object" ? address.port : runtime.config.port;
  runtime.ctx.log.info("overlays prontos em http://127.0.0.1:" + String(runtime.port));
  runtime.ctx.setStatus({
    health: runtime.goalErrors.length ? "degraded" : "healthy",
    connectionState: "overlays em 127.0.0.1:" + String(runtime.port),
    errors: runtime.goalErrors,
  });
  emitState(runtime);
  return true;
}

function scheduleBind(runtime) {
  if (runtime.stopped || runtime.bindTimer || runtime.server) return;
  runtime.bindTimer = setTimeout(() => {
    runtime.bindTimer = null;
    runtime.binding = bindServer(runtime);
  }, PORT_RETRY_MS);
}

function registerActions(runtime) {
  const ctx = runtime.ctx;
  ctx.registerAction("record-donate", (data) =>
    recordContribution(runtime, {
      type: "donate",
      value: data.amountCents,
      eventKey: data.eventKey,
      actorName: data.actorName,
      actorId: data.actorId,
      source: asText(data.source, "manual"),
    }));
  ctx.registerAction("record-bits", (data) =>
    recordContribution(runtime, {
      type: "bits",
      value: data.bits,
      eventKey: data.eventKey,
      actorName: data.actorName,
      actorId: data.actorId,
      source: "twitch",
    }));
  ctx.registerAction("record-sub", (data) =>
    recordContribution(runtime, {
      type: "subs",
      value: data.count,
      tier: data.tier,
      eventKey: data.eventKey,
      actorName: data.actorName,
      actorId: data.actorId,
      source: "twitch",
    }));
  ctx.registerAction("record-contribution", (data) =>
    recordContribution(runtime, {
      type: data.contributionType,
      value: data.value,
      tier: data.tier,
      eventKey: data.eventKey,
      actorName: data.actorName,
      actorId: data.actorId,
      source: asText(data.source, "other"),
    }));
  ctx.registerAction("timer-control", (data) => controlTimer(runtime, data));
  ctx.registerAction("set-total", (data) => setTotal(runtime, data));
  ctx.registerAction("reset-state", (data) => resetState(runtime, data));
  ctx.registerAction("get-state", async () => snapshot(runtime));
}

function stopRuntime(runtime) {
  if (runtime.stopped) return;
  runtime.stopped = true;
  if (runtime.tickTimer) clearInterval(runtime.tickTimer);
  if (runtime.bindTimer) clearTimeout(runtime.bindTimer);
  for (const client of runtime.clients) client.end();
  runtime.clients.clear();
  if (runtime.server) {
    runtime.closing = new Promise((done) => runtime.server.close(done));
    runtime.server.closeAllConnections();
  }
  for (const socket of runtime.sockets) socket.destroy();
  runtime.sockets.clear();
}

export default {
  async activate(ctx) {
    if (activeRuntime) throw new Error("CatOPanda Subathon já está ativo");
    const config = normalizeConfig(await ctx.config.get());
    if (!config.enabled) {
      ctx.setStatus({ health: "healthy", connectionState: "desativado" });
      return;
    }
    const persisted = await ctx.secrets.get(STATE_KEY);
    const state = hydrateState(persisted, config, ctx.log);
    const idLedger = await loadIdLedger(ctx.secrets, "subathon-ids", state.idLedger, state.ledger);
    state.idLedger = idLedger.descriptor;
    state.ledger = [];
    const parsedGoals = parseGoals(config, ctx.log);
    const runtime = {
      ctx,
      config,
      goals: parsedGoals.goals,
      goalErrors: parsedGoals.errors,
      state,
      idLedger,
      clients: new Set(),
      sockets: new Set(),
      binding: null,
      closing: null,
      server: null,
      tickTimer: null,
      bindTimer: null,
      bindError: "",
      stopped: false,
      queue: Promise.resolve(),
      port: config.port,
      eventSeq: 0,
      recentEvents: [],
    };
    await persist(runtime, true);
    activeRuntime = runtime;
    runtime.onAbort = () => stopRuntime(runtime);
    ctx.signal?.addEventListener("abort", runtime.onAbort, { once: true });
    if (ctx.signal?.aborted) { stopRuntime(runtime); return; }
    registerActions(runtime);
    runtime.tickTimer = setInterval(() => {
      void queueMutation(runtime, () => handleTimerTick(runtime));
    }, 1000);
    runtime.binding = bindServer(runtime);
    await runtime.binding;
  },

  async deactivate() {
    const runtime = activeRuntime;
    if (!runtime) return;
    stopRuntime(runtime);
    runtime.ctx.signal?.removeEventListener("abort", runtime.onAbort);
    await runtime.binding;
    await runtime.closing;
    await runtime.queue;
    materializeTimer(runtime);
    await persist(runtime);
    activeRuntime = null;
  },
};
