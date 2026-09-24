import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";
import { request } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import plugin from "../plugin/index.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin/manifest.json", import.meta.url), "utf8"));

function context(overrides = {}, sharedSecrets = new Map()) {
  const controller = new AbortController();
  const actions = new Map();
  const triggers = [];
  const statuses = [];
  const resources = [];
  const config = {
    enabled: true,
    port: 0,
    initialTimerSeconds: 3600,
    donateSecondsPerReal: 60,
    bitsPerUnit: 100,
    bitsSecondsPerUnit: 60,
    subTier1Seconds: 600,
    subTier2Seconds: 1200,
    subTier3Seconds: 3000,
    subPrimeSeconds: 900,
    warningThresholds: [3600, 900, 300, 60],
    ...overrides,
  };
  return {
    controller,
    actions,
    triggers,
    statuses,
    resources,
    sharedSecrets,
    ctx: {
      signal: controller.signal,
      config: { get: async () => config },
      secrets: {
        get: async (key) => sharedSecrets.get(key) || null,
        set: async (key, value) => { sharedSecrets.set(key, value); },
        delete: async (key) => { sharedSecrets.delete(key); },
      },
      registerAction: (name, handler) => actions.set(name, handler),
      emitTrigger: (name, payload) => triggers.push({ name, payload }),
      setStatus: (status) => statuses.push(status),
      setResource: (key, items) => resources.push({ key, items }),
      onFlowsChanged: () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    },
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("donation IDs survive more than 1000 contributions and a restart", async () => {
  const secrets = new Map();
  const first = context({ warningThresholds: [] }, secrets);
  try {
    await plugin.activate(first.ctx);
    for (let index = 0; index < 1100; index++) {
      await first.actions.get("record-donate")({ amountCents: 100, eventKey: "livepix:donation:" + index });
    }
    await plugin.deactivate();
    const stored = JSON.parse(secrets.get("catopanda-subathon-state-v1"));
    assert.ok(stored.idLedger.tail.length < 256);
    const second = context({ warningThresholds: [] }, secrets);
    await plugin.activate(second.ctx);
    const before = await second.actions.get("get-state")({});
    const replay = await second.actions.get("record-donate")({ amountCents: 100, eventKey: "livepix:donation:0" });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.secondsAdded, 0);
    const after = await second.actions.get("get-state")({});
    assert.deepEqual(after.totals, before.totals);
    assert.equal(after.timer.remainingSeconds, before.timer.remainingSeconds);
    assert.equal(after.totals.donate, 110000);
    await second.actions.get("reset-state")({ scope: "ledger" });
    assert.equal((await second.actions.get("record-donate")({ amountCents: 100, eventKey: "livepix:donation:0" })).accepted, true);
  } finally { await plugin.deactivate(); }
});

test("failed contribution storage rolls back totals, time and ID before retry", async () => {
  const fixture = context();
  const save = fixture.ctx.secrets.set;
  try {
    await plugin.activate(fixture.ctx);
    const before = await fixture.actions.get("get-state")({});
    fixture.ctx.secrets.set = async () => { throw new Error("disk full"); };
    const input = { amountCents: 500, eventKey: "livepix:donation:retry" };
    await assert.rejects(fixture.actions.get("record-donate")(input), /disk full/);
    const failed = await fixture.actions.get("get-state")({});
    assert.deepEqual(failed.totals, before.totals);
    assert.equal(failed.timer.remainingSeconds, before.timer.remainingSeconds);
    assert.equal(fixture.triggers.filter((entry) => entry.name === "contribution").length, 0);
    fixture.ctx.secrets.set = save;
    assert.equal((await fixture.actions.get("record-donate")(input)).accepted, true);
    fixture.ctx.secrets.set = async () => { throw new Error("disk full"); };
    await assert.rejects(fixture.actions.get("reset-state")({ scope: "ledger" }), /disk full/);
    fixture.ctx.secrets.set = save;
    assert.equal((await fixture.actions.get("record-donate")(input)).duplicate, true);
    assert.equal((await fixture.actions.get("get-state")({})).totals.donate, 500);
  } finally { fixture.ctx.secrets.set = save; await plugin.deactivate(); }
});

test("readers see committed totals while a contribution write is pending", async () => {
  const fixture = context();
  const save = fixture.ctx.secrets.set;
  let release, entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await plugin.activate(fixture.ctx);
    fixture.ctx.secrets.set = async (key, value) => { entered(); await gate; return save(key, value); };
    const pending = fixture.actions.get("record-donate")({ amountCents: 500, eventKey: "pending" });
    await writing;
    assert.equal((await fixture.actions.get("get-state")({})).totals.donate, 0);
    release();
    assert.equal((await pending).accepted, true);
    assert.equal((await fixture.actions.get("get-state")({})).totals.donate, 500);
  } finally { release(); fixture.ctx.secrets.set = save; await plugin.deactivate(); }
});

test("SDK 0.5 shutdown closes SSE and idle sockets, drains mutations and reuses the port", { timeout: 5000 }, async () => {
  const secrets = new Map();
  const fixture = context({}, secrets);
  let idle;
  let reader;
  try {
    await plugin.activate(fixture.ctx);
    const state = await fixture.actions.get("get-state")({});
    const base = new URL(state.urls.brbStage).origin;
    const port = Number(new URL(base).port);
    idle = connect({ host: "127.0.0.1", port });
    await once(idle, "connect");
    reader = (await fetch(base + "/events")).body.getReader();
    await reader.read();
    const contribution = fixture.actions.get("record-donate")({ amountCents: 700, eventKey: "shutdown-1" });
    fixture.controller.abort();
    await plugin.deactivate();
    assert.equal((await contribution).accepted, true);
    await reader.cancel().catch(() => {});
    const second = context({ port }, secrets);
    await plugin.activate(second.ctx);
    const restored = await second.actions.get("get-state")({});
    assert.equal(restored.server.listening, true);
    assert.equal(restored.totals.donate, 700);
    const duplicate = await second.actions.get("record-donate")({ amountCents: 700, eventKey: "shutdown-1" });
    assert.equal(duplicate.accepted, false);
  } finally {
    idle?.destroy();
    await reader?.cancel().catch(() => {});
    await plugin.deactivate();
  }
});

test("state, contributions, goals, routes and persistence", async () => {
  const secrets = new Map();
  const first = context({}, secrets);
  await plugin.activate(first.ctx);
  try {
    const initial = await first.actions.get("get-state")({});
    assert.equal(initial.timer.formatted, "01:00:00");
    assert.equal(initial.timer.running, false);
    assert.match(initial.urls.brbStage, /^http:\/\/127\.0\.0\.1:\d+\/overlay\/brb-stage$/);
    assert.match(initial.urls.alerts, /\/overlay\/alerts$/);
    assert.equal(Object.keys(initial.urls).length, 10);
    assert.match(initial.urls.dashboard, /\/dashboard$/);
    assert.match(initial.urls.goalsActive, /\/overlay\/goals-active$/);
    assert.match(initial.urls.goalsList, /\/overlay\/goals-list$/);
    assert.equal(initial.display.effects.alertsPosition, "top-right");
    assert.deepEqual(initial.display.effects, {
      enabled: true,
      celebrateGoals: true,
      celebrateContributions: true,
      celebrationSeconds: 6,
      alertsPosition: "top-right",
    });

    const base = initial.urls.brbStage.replace("/overlay/brb-stage", "");
    const health = await fetch(base + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, plugin: "catopanda-subathon", version: manifest.version });
    assert.equal(health.headers.get("access-control-allow-origin"), null);
    for (const url of Object.values(initial.urls)) {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /CatOPanda Subathon/);
    }
    for (const path of ["/overlay.css", "/overlay.js", "/theme.css", "/api/state"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
    }
    assert.equal((await fetch(base + "/custom-font")).status, 404);
    assert.equal((await fetch(base + "/nope")).status, 404);
    assert.equal((await fetch(base + "/api/state", { method: "POST" })).status, 405);

    await first.actions.get("timer-control")({ operation: "set", seconds: 10 });
    await first.actions.get("timer-control")({ operation: "resume", seconds: 0 });
    await wait(1100);
    const ticking = await first.actions.get("get-state")({});
    assert.ok(ticking.timer.remainingSeconds <= 9);
    await first.actions.get("timer-control")({ operation: "pause", seconds: 0 });

    // Values may arrive as strings when a formula produced them.
    const donate = await first.actions.get("record-donate")({
      amountCents: "500",
      eventKey: "donate-1",
      actorName: "Apoiador",
      source: "livepix",
    });
    assert.equal(donate.accepted, true);
    assert.equal(donate.duplicate, false);
    assert.equal(donate.secondsAdded, 300);
    assert.equal(donate.total, 500);
    assert.match(donate.formatted, /^\d{2}:\d{2}:\d{2}$/);
    const duplicate = await first.actions.get("record-donate")({
      amountCents: 500,
      eventKey: "donate-1",
      actorName: "Apoiador",
    });
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.secondsAdded, 0);

    const bits = await first.actions.get("record-bits")({ bits: 250, eventKey: "bits-1", actorName: "Viewer" });
    assert.equal(bits.secondsAdded, 150);
    assert.equal(bits.total, 250);

    const subs = await first.actions.get("record-sub")({ tier: "2000", count: 2, eventKey: "subs-1", actorName: "Gifter" });
    assert.equal(subs.secondsAdded, 2400);
    assert.equal(subs.total, 2);

    const generic = await first.actions.get("record-contribution")({
      contributionType: "Sub",
      value: 1,
      tier: "Tier 3",
      eventKey: "generic-1",
      actorName: "Alguém",
      source: "streamelements",
    });
    assert.equal(generic.secondsAdded, 3000);
    assert.equal(generic.total, 3);

    await assert.rejects(
      () => first.actions.get("record-contribution")({ contributionType: "coins", value: 5 }),
      /tipo de contribuição inválido/,
    );
    await assert.rejects(
      () => first.actions.get("record-donate")({ amountCents: 0 }),
      /maior que zero/,
    );

    const contribution = first.triggers.find((event) => event.name === "contribution");
    assert.equal(contribution.payload.type, "donate");
    assert.equal(contribution.payload.valueLabel.replace(/ /g, " "), "R$ 5");
    assert.equal(contribution.payload.addedLabel, "00:05:00");
    assert.equal(contribution.payload.source, "livepix");
    assert.equal(contribution.payload.actorDisplayName, "Apoiador");

    const beforeCorrection = await first.actions.get("get-state")({});
    const corrected = await first.actions.get("set-total")({ contributionType: "donate", value: 30000 });
    const afterCorrection = await first.actions.get("get-state")({});
    assert.equal(corrected.timerChanged, false);
    assert.equal(afterCorrection.timer.remainingSeconds, beforeCorrection.timer.remainingSeconds);
    assert.equal(afterCorrection.goals.filter((goal) => goal.completed).length, 4);
    const goalEvents = first.triggers.filter((event) => event.name === "goal-completed");
    assert.equal(goalEvents.length, 4);
    assert.equal(goalEvents[0].payload.goalId, "donate-100");
    assert.equal(goalEvents[0].payload.nextTitle, "Karaokê com o chat");
    assert.equal(goalEvents[3].payload.completedCount, 4);
    assert.equal(afterCorrection.history.length, 4);
  } finally {
    await plugin.deactivate();
  }

  const second = context({}, secrets);
  await plugin.activate(second.ctx);
  try {
    const restored = await second.actions.get("get-state")({});
    assert.equal(restored.totals.donateCents, 30000);
    assert.equal(restored.totals.subs, 3);
    assert.equal(restored.totals.bits, 250);
    assert.equal(restored.lastSupport.actorName, "Alguém");
  } finally {
    await plugin.deactivate();
  }
});

test("added time counts supporter seconds only and survives a restart", async () => {
  const secrets = new Map();
  const first = context({}, secrets);
  await plugin.activate(first.ctx);
  try {
    const initial = await first.actions.get("get-state")({});
    assert.equal(initial.totals.addedSeconds, 0);
    assert.equal(initial.totals.addedLabel, "0min");

    await first.actions.get("record-donate")({ amountCents: 1000, eventKey: "added-1" });
    await first.actions.get("record-donate")({ amountCents: 1000, eventKey: "added-1" });
    await first.actions.get("record-bits")({ bits: 150, eventKey: "added-2" });
    await first.actions.get("record-sub")({ count: 2, tier: "2000", eventKey: "added-3" });
    await first.actions.get("timer-control")({ operation: "add", seconds: 5000 });
    await first.actions.get("timer-control")({ operation: "subtract", seconds: 100 });

    const state = await first.actions.get("get-state")({});
    // 600 (R$ 10) + 90 (150 Bits) + 2400 (two Tier 2 subs); the duplicate and the manual add do not count.
    assert.equal(state.totals.addedSeconds, 3090);
    assert.equal(state.totals.addedLabel, "51min 30s");
    const lastContribution = first.triggers.filter((event) => event.name === "contribution").at(-1);
    assert.equal(lastContribution.payload.totalAddedSeconds, 3090);
    assert.equal(lastContribution.payload.totalAddedLabel, "51min 30s");
  } finally {
    await plugin.deactivate();
  }

  const second = context({}, secrets);
  await plugin.activate(second.ctx);
  try {
    assert.equal((await second.actions.get("get-state")({})).totals.addedSeconds, 3090);
    const before = await second.actions.get("get-state")({});
    const corrected = await second.actions.get("set-total")({ contributionType: "added-time", value: 43500 });
    assert.deepEqual(corrected, { type: "added-time", total: 43500, timerChanged: false });
    const after = await second.actions.get("get-state")({});
    assert.equal(after.totals.addedLabel, "12h 05min");
    assert.equal(after.timer.remainingSeconds, before.timer.remainingSeconds);
    await second.actions.get("reset-state")({ scope: "totals" });
    assert.equal((await second.actions.get("get-state")({})).totals.addedSeconds, 0);
  } finally {
    await plugin.deactivate();
  }
});

test("state saved before the added-time counter hydrates it as zero", async () => {
  const secrets = new Map([["catopanda-subathon-state-v1", JSON.stringify({
    revision: 4,
    timer: { remainingSeconds: 900, running: false },
    totals: { donateCents: 500, subs: 1, bits: 0 },
  })]]);
  const fixture = context({}, secrets);
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    assert.equal(state.totals.donateCents, 500);
    assert.equal(state.totals.addedSeconds, 0);
    assert.equal(state.totals.addedLabel, "0min");
  } finally {
    await plugin.deactivate();
  }
});

test("score marks categories without goals so the overlays can leave them out", async () => {
  const fixture = context({
    goals: [{ id: "donate-50", type: "donate", title: "Meta", amount: "50", order: 1 }],
  });
  await plugin.activate(fixture.ctx);
  try {
    await fixture.actions.get("record-bits")({ bits: 500, eventKey: "no-goal-bits" });
    const state = await fixture.actions.get("get-state")({});
    assert.equal(state.score.donate.hasGoals, true);
    assert.equal(state.score.subs.hasGoals, false);
    assert.equal(state.score.bits.hasGoals, false);
    // Time from a category without goals still reaches the timer and the counter.
    assert.equal(state.totals.bits, 500);
    assert.equal(state.totals.addedSeconds, 300);
  } finally {
    await plugin.deactivate();
  }
});

test("poll delivers each overlay event once and never replays on a fresh cursor", async () => {
  const fixture = context({
    goals: [{ id: "donate-10", type: "donate", title: "Meta", amount: "10", order: 1 }],
  });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    const base = new URL(state.urls.brbStage).origin;
    const poll = async (query = "") => (await fetch(base + "/api/poll" + query)).json();

    const first = await poll();
    assert.equal(first.seq, 0);
    assert.deepEqual(first.events, []);
    assert.equal(first.state.timer.formatted, state.timer.formatted);

    await fixture.actions.get("record-donate")({ amountCents: 1000, eventKey: "poll-1", actorName: "Luna" });
    const second = await poll("?since=" + String(first.seq));
    assert.deepEqual(second.events.map((event) => event.name), ["contribution", "goal-completed"]);
    assert.equal(second.events[0].payload.actorName, "Luna");
    assert.equal(second.state.totals.donate, 1000);

    assert.deepEqual((await poll("?since=" + String(second.seq))).events, []);
    // A reloaded Browser Source has no cursor, and one from before a restart is ahead of the server.
    assert.deepEqual((await poll()).events, []);
    assert.deepEqual((await poll("?since=999")).events, []);
  } finally {
    await plugin.deactivate();
  }
});

test("SSE stream carries state plus contribution and goal events", async () => {
  const fixture = context({});
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    const base = state.urls.brbStage.replace("/overlay/brb-stage", "");
    const controller = new AbortController();
    const response = await fetch(base + "/events", { signal: controller.signal });
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function readUntil(marker) {
      while (!buffer.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed");
        buffer += decoder.decode(value, { stream: true });
      }
    }
    await readUntil("event: state");
    await fixture.actions.get("set-total")({ contributionType: "donate", value: 9990 });
    await fixture.actions.get("record-donate")({ amountCents: 10, eventKey: "sse-1", actorName: "Luna" });
    await readUntil("event: contribution");
    await readUntil("event: goal-completed");
    const contributionLine = buffer.split("\n").find((line, index, lines) =>
      lines[index - 1] === "event: contribution" && line.startsWith("data: "));
    const payload = JSON.parse(contributionLine.slice(6));
    assert.equal(payload.actorName, "Luna");
    assert.equal(payload.secondsAdded, 6);
    controller.abort();
  } finally {
    await plugin.deactivate();
  }
});

test("timer warnings fire once per mark and re-arm when time is added back", async () => {
  const fixture = context({ warningThresholds: [5, 1] });
  await plugin.activate(fixture.ctx);
  try {
    await fixture.actions.get("timer-control")({ operation: "set", seconds: 6 });
    await fixture.actions.get("timer-control")({ operation: "resume" });
    // Two ticks of slack: the 1 s interval starts at activate, so the first tick
    // after `resume` can still see zero whole seconds elapsed.
    await wait(2600);
    let warnings = fixture.triggers.filter((event) => event.name === "timer-warning");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].payload.thresholdSeconds, 5);
    await wait(1200);
    warnings = fixture.triggers.filter((event) => event.name === "timer-warning");
    assert.equal(warnings.length, 1, "the same mark never fires twice");

    await fixture.actions.get("timer-control")({ operation: "add", seconds: 60 });
    await fixture.actions.get("timer-control")({ operation: "set", seconds: 4 });
    await wait(1200);
    warnings = fixture.triggers.filter((event) => event.name === "timer-warning");
    assert.equal(warnings.length, 2, "adding time re-arms the mark");
    const snapshot = await fixture.actions.get("get-state")({});
    assert.equal(snapshot.timer.inFinalStretch, true);
  } finally {
    await plugin.deactivate();
  }
});

test("timer finishes once, reports totals and restarts on the next contribution", async () => {
  const fixture = context({ warningThresholds: [] });
  await plugin.activate(fixture.ctx);
  try {
    await fixture.actions.get("record-bits")({ bits: 100, eventKey: "b1" });
    await fixture.actions.get("timer-control")({ operation: "set", seconds: 1 });
    await fixture.actions.get("timer-control")({ operation: "resume" });
    await wait(2300);
    const finished = fixture.triggers.filter((event) => event.name === "timer-finished");
    assert.equal(finished.length, 1);
    assert.equal(finished[0].payload.totals.bits, 100);
    const stopped = await fixture.actions.get("get-state")({});
    assert.equal(stopped.timer.running, false);
    assert.equal(stopped.timer.remainingSeconds, 0);

    const revived = await fixture.actions.get("record-donate")({ amountCents: 100, eventKey: "d1" });
    assert.equal(revived.secondsAdded, 60);
    const running = await fixture.actions.get("get-state")({});
    assert.equal(running.timer.running, true);
    const toggled = await fixture.actions.get("timer-control")({ operation: "toggle" });
    assert.equal(toggled.running, false);
  } finally {
    await plugin.deactivate();
  }
});

test("a busy port costs the overlays, never the clock or the blocks", async () => {
  const { createServer } = await import("node:http");
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const port = blocker.address().port;
  const fixture = context({ port });
  let released = false;
  try {
    await plugin.activate(fixture.ctx);
    await wait(60);

    // Degraded, and the message says what to do about it.
    const status = fixture.statuses.at(-1);
    assert.equal(status.health, "degraded");
    assert.match(status.connectionState, /ocupada/);
    assert.match(status.errors[0], /Feche o programa|outra porta/);

    // Everything that is not the HTTP server keeps working.
    const donate = await fixture.actions.get("record-donate")({ amountCents: 500, eventKey: "busy-1" });
    assert.equal(donate.accepted, true);
    assert.equal(donate.secondsAdded, 300);
    assert.ok(fixture.triggers.some((event) => event.name === "contribution"));
    const state = await fixture.actions.get("get-state")({});
    assert.equal(state.server.listening, false);
    assert.match(state.server.error, /EADDRINUSE|in use/i);
    assert.equal(state.totals.donate, 500);

    await fixture.actions.get("timer-control")({ operation: "set", seconds: 5 });
    await fixture.actions.get("timer-control")({ operation: "resume" });
    await wait(1100);
    const ticking = await fixture.actions.get("get-state")({});
    assert.ok(ticking.timer.remainingSeconds <= 4, "the countdown runs with no server");
  } finally {
    if (!released) await new Promise((resolve) => blocker.close(resolve));
    await plugin.deactivate();
  }
});

test("Prime is its own tier and never falls back to Tier 1 silently", async () => {
  const fixture = context({ subPrimeSeconds: 900 });
  await plugin.activate(fixture.ctx);
  try {
    const prime = await fixture.actions.get("record-sub")({ tier: "prime", count: 1, eventKey: "p1" });
    assert.equal(prime.secondsAdded, 900);

    // Whatever a formula yields for a Prime sub reaches the same tier.
    const spelled = await fixture.actions.get("record-sub")({ tier: "Prime", count: 1, eventKey: "p2" });
    assert.equal(spelled.secondsAdded, 900);

    const tier1 = await fixture.actions.get("record-sub")({ tier: "1000", count: 1, eventKey: "p3" });
    assert.equal(tier1.secondsAdded, 600);

    const generic = await fixture.actions.get("record-contribution")({
      contributionType: "subs",
      value: 2,
      tier: "prime",
      eventKey: "p4",
    });
    assert.equal(generic.secondsAdded, 1800);

    const contribution = fixture.triggers.find((event) => event.name === "contribution");
    assert.equal(contribution.payload.tier, "prime");
  } finally {
    await plugin.deactivate();
  }
});

test("goals from the native table keep type, target and order", async () => {
  const fixture = context({
    goals: [
      { id: "subs-2", type: "subs", title: "Meta de Subs", target: 2, order: 2 },
      { id: "donate-100", type: "donate", title: "Meta de Donate", target: 10000, order: 1 },
    ],
    goalsJson: JSON.stringify([
      { id: "legacy-ignored", type: "bits", title: "Meta antiga", target: 1, order: 1 },
    ]),
  });
  await plugin.activate(fixture.ctx);
  try {
    const initial = await fixture.actions.get("get-state")({});
    assert.deepEqual(initial.goals.map((goal) => goal.id), ["donate-100", "subs-2"]);
    await fixture.actions.get("set-total")({ contributionType: "donate", value: 10000 });
    const completed = await fixture.actions.get("get-state")({});
    assert.equal(completed.goals[0].completed, true);
    assert.equal(completed.goals[1].completed, false);
  } finally {
    await plugin.deactivate();
  }
});

test("Donate goal accepts reais with comma or point and completes at the exact cent", async () => {
  const fixture = context({ goals: [
    { id: "donate-fraction", type: "donate", title: "Meta fracionada", amount: "52,01", target: 999999, order: 1 },
  ] });
  await plugin.activate(fixture.ctx);
  try {
    const initial = await fixture.actions.get("get-state")({});
    assert.equal(initial.goals[0].target, 5201);
    assert.equal(initial.goals[0].targetLabel.replace(/\s/g, " "), "R$ 52,01");
    assert.equal(initial.goals[0].amountLabel.replace(/\s/g, " "), "R$ 0 / R$ 52,01");
    await fixture.actions.get("record-donate")({ amountCents: 5200, eventKey: "fraction-1" });
    assert.equal((await fixture.actions.get("get-state")({})).goals[0].completed, false);
    await fixture.actions.get("record-donate")({ amountCents: 1, eventKey: "fraction-2" });
    const completed = await fixture.actions.get("get-state")({});
    assert.equal(completed.goals[0].completed, true);
    assert.equal(completed.totals.donateCents, 5201);
    assert.equal(fixture.triggers.filter((event) => event.name === "goal-completed").length, 1);
    const base = new URL(initial.urls.brbStage).origin;
    const served = await (await fetch(base + "/api/state")).json();
    assert.equal(served.goals[0].amountLabel.replace(/\s/g, " "), "R$ 52,01 / R$ 52,01");
  } finally {
    await plugin.deactivate();
  }
});

test("decimal targets keep precision, pt-BR grouping, whole reais and fractional counts", async () => {
  const samples = [
    [52.01, "donate", 5201], ["52.01", "donate", 5201], ["52,0100", "donate", 5201],
    ["1.234,56", "donate", 123456], ["52", "donate", 5200], ["0,01", "donate", 1],
    [".5", "donate", 50], ["1.005", "donate", 101], ["1,004", "donate", 100],
    ["2,75", "subs", 2.75], ["150.5", "bits", 150.5],
  ];
  const fixture = context({ goals: samples.map(([amount, type], index) => ({
    id: `decimal-${index}`, title: `Meta ${index}`, type, amount, target: 0, order: index,
  })) });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    assert.deepEqual(state.goals.map((goal) => goal.target), samples.map((sample) => sample[2]));
  } finally {
    await plugin.deactivate();
  }
});

test("old cents survive an editor save and restart until the new Alvo is filled", async () => {
  const secrets = new Map();
  // A missing optional column is saved as empty text by the SDK table editor.
  const saved = { goals: [{ id: "old-donate", type: "donate", title: "Título editado", amount: "", target: 5201, order: 1 }] };
  const first = context(saved, secrets);
  await plugin.activate(first.ctx);
  try {
    assert.equal((await first.actions.get("get-state")({})).goals[0].target, 5201);
    await first.actions.get("record-donate")({ amountCents: 2000, eventKey: "old-donation" });
  } finally {
    await plugin.deactivate();
  }
  const second = context(saved, secrets);
  await plugin.activate(second.ctx);
  try {
    const state = await second.actions.get("get-state")({});
    assert.equal(state.goals[0].target, 5201);
    assert.equal(state.totals.donateCents, 2000);
    assert.equal((await second.actions.get("record-donate")({ amountCents: 2000, eventKey: "old-donation" })).accepted, false);
  } finally {
    await plugin.deactivate();
  }
});

test("new default table has reais, preserves legacy JSON, and edited reais take precedence", async () => {
  const defaults = manifest.configSchema.fields.find((field) => field.key === "goals").default;
  const fixture = context({ goals: defaults });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    assert.deepEqual(state.goals.map((goal) => goal.target), [10000, 15000, 20000, 30000, 50, 10000]);
  } finally { await plugin.deactivate(); }
  const legacy = JSON.stringify([{ id: "legacy-donate", type: "donate", title: "Antiga", target: 5201, order: 1 }]);
  const old = context({ goals: defaults, goalsJson: legacy });
  await plugin.activate(old.ctx);
  try {
    assert.equal((await old.actions.get("get-state")({})).goals[0].target, 5201);
  } finally { await plugin.deactivate(); }
  const edited = structuredClone(defaults);
  edited[0].amount = "52,01";
  const next = context({ goals: edited, goalsJson: legacy });
  await plugin.activate(next.ctx);
  try {
    const state = await next.actions.get("get-state")({});
    assert.equal(state.goals[0].id, "donate-100");
    assert.equal(state.goals[0].target, 5201);
    assert.equal(state.goals.length, 6);
  } finally { await plugin.deactivate(); }
});

test("version 0.1 goalsJson stays readable until the table is edited", async () => {
  const fixture = context({
    goals: [
      { id: "donate-100", type: "donate", title: "Chat escolhe o outfit", target: 10000, order: 1 },
      { id: "donate-150", type: "donate", title: "Cantar uma música", target: 15000, order: 2 },
      { id: "donate-200", type: "donate", title: "Jogar terror sem luz", target: 20000, order: 3 },
      { id: "donate-300", type: "donate", title: "Cosplay surpresa", target: 30000, order: 4 },
      { id: "subs-50", type: "subs", title: "Karaokê com o chat", target: 50, order: 5 },
      { id: "bits-10000", type: "bits", title: "Desafio escolhido ao vivo", target: 10000, order: 6 },
    ],
    goalsJson: JSON.stringify([{ id: "legacy-bits", type: "bits", title: "Meta legada", target: 500, order: 1 }]),
  });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    assert.equal(state.goals.length, 1);
    assert.equal(state.goals[0].id, "legacy-bits");
  } finally {
    await plugin.deactivate();
  }
});

function manyGoals(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `custom-${index + 1}`, type: "donate", title: `Custom goal ${index + 1}`,
    amount: `${index + 1},01`, target: 0, order: index + 1,
  }));
}

for (const count of [20, 21, 50]) {
  test(`${count} configured goals survive a restart and keep contributions`, async () => {
    const goals = manyGoals(count);
    const secrets = new Map();
    const first = context({ goals }, secrets);
    await plugin.activate(first.ctx);
    try {
      await first.actions.get("record-donate")({ amountCents: 101, eventKey: "many-goals" });
      const state = await first.actions.get("get-state")({});
      assert.deepEqual(state.goals.map((goal) => goal.id), goals.map((goal) => goal.id));
      assert.equal(state.goals[0].completed, true);
    } finally { await plugin.deactivate(); }
    const reopened = context({ goals: JSON.parse(JSON.stringify(goals)) }, secrets);
    await plugin.activate(reopened.ctx);
    try {
      const state = await reopened.actions.get("get-state")({});
      assert.equal(state.goals.length, count);
      assert.equal(state.totals.donateCents, 101);
      assert.equal(state.goals.at(-1).target, count * 100 + 1);
      assert.equal((await reopened.actions.get("record-donate")({ amountCents: 101, eventKey: "many-goals" })).accepted, false);
    } finally { await plugin.deactivate(); }
  });
}

for (const [problem, patch] of [
  ["duplicate ID", { id: "custom-1" }],
  ["empty target", { amount: "", target: 0 }],
  ["invalid decimal", { amount: "abc" }],
  ["invalid type", { type: "unknown" }],
]) {
  test(`an invalid 21st goal (${problem}) preserves the other goals and can be corrected`, async () => {
    const goals = manyGoals(22);
    goals[20] = { ...goals[20], ...patch };
    const original = structuredClone(goals);
    const secrets = new Map();
    const fixture = context({ goals }, secrets);
    await plugin.activate(fixture.ctx);
    try {
      const state = await fixture.actions.get("get-state")({});
      assert.deepEqual(state.goals.map((goal) => goal.id), manyGoals(22).filter((_, index) => index !== 20).map((goal) => goal.id));
      assert.equal(state.goalErrors.length, 1);
      assert.match(state.goalErrors[0], /21/);
      assert.equal(fixture.statuses.at(-1).health, "degraded");
      assert.deepEqual(fixture.statuses.at(-1).errors, state.goalErrors);
      assert.deepEqual(goals, original, "invalid rows stay in the saved config for correction");
      await fixture.actions.get("record-donate")({ amountCents: 101, eventKey: "invalid-row" });
    } finally { await plugin.deactivate(); }
    const corrected = context({ goals: manyGoals(22), brbTitle: "Updated title" }, secrets);
    await plugin.activate(corrected.ctx);
    try {
      const state = await corrected.actions.get("get-state")({});
      assert.equal(state.goals.length, 22);
      assert.deepEqual(state.goalErrors, []);
      assert.equal(state.totals.donateCents, 101);
      assert.equal(state.display.copy.title, "Updated title");
      assert.equal(corrected.statuses.at(-1).health, "healthy");
    } finally { await plugin.deactivate(); }
  });
}

test("empty or malformed goal lists never restore sample goals", async () => {
  for (const config of [{ goals: [] }, { goals: [null] }, { goals: "broken" }, { goalsJson: "{" }]) {
    const fixture = context(config);
    await plugin.activate(fixture.ctx);
    try {
      const state = await fixture.actions.get("get-state")({});
      assert.equal(state.goals.length, 0);
      assert.equal(state.currentGoal, null);
      assert.equal(state.nextGoal, null);
      assert.ok(Number.isFinite(state.score.donate.progress));
    } finally { await plugin.deactivate(); }
  }
});

test("an invalid edit to the default table cannot reactivate legacy goals", async () => {
  const goals = structuredClone(manifest.configSchema.fields.find((field) => field.key === "goals").default);
  goals[0].amount = "invalid";
  const fixture = context({ goals, goalsJson: JSON.stringify(manyGoals(21)) });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    assert.deepEqual(state.goals.map((goal) => goal.id), goals.slice(1).map((goal) => goal.id));
    assert.equal(state.goalErrors.length, 1);
  } finally { await plugin.deactivate(); }
});

test("the font route only serves local font files", async () => {
  const fixture = context({ fontSource: "C:\\Windows\\System32\\drivers\\etc\\hosts", fontFamily: "Any" });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    const base = state.urls.brbStage.replace("/overlay/brb-stage", "");
    assert.equal((await fetch(base + "/custom-font")).status, 404);
    const theme = await (await fetch(base + "/theme.css")).text();
    assert.ok(!theme.includes("/custom-font"), "the stylesheet never points at a non-font path");
    assert.match(theme, /--font-display:"Any"/);
  } finally {
    await plugin.deactivate();
  }
});

test("manual subscription corrections persist goals without changing time, history, or deduplication", async () => {
  const secrets = new Map();
  const config = { goals: [{ id: "subs-3", type: "subs", title: "Three subscriptions", amount: "3", order: 1 }] };
  const fixture = context(config, secrets);
  let expected;
  await plugin.activate(fixture.ctx);
  try {
    await fixture.actions.get("record-sub")({ count: 1, tier: "1000", eventKey: "manual-preserved-event" });
    const before = await fixture.actions.get("get-state")({});
    const base = new URL(before.urls.brbStage).origin;
    const cursor = (await (await fetch(base + "/api/poll")).json()).seq;
    const result = await fixture.actions.get("set-total")({ contributionType: "subs", value: "3" });
    assert.deepEqual(result, { type: "subs", total: 3, timerChanged: false });
    const added = await fixture.actions.get("set-total")({ contributionType: "subs", operation: "add", value: 2 });
    assert.equal(added.total, 5);
    const subtracted = await fixture.actions.get("set-total")({ contributionType: "subs", operation: "subtract", value: 1, updateTimer: false });
    assert.equal(subtracted.total, 4);
    expected = await fixture.actions.get("get-state")({});
    assert.equal(expected.timer.remainingSeconds, before.timer.remainingSeconds);
    assert.equal(expected.timer.running, false);
    assert.equal(expected.totals.addedSeconds, before.totals.addedSeconds);
    assert.equal(expected.goals[0].current, 4);
    assert.equal(expected.goals[0].completed, true);
    assert.deepEqual(expected.history, before.history);
    assert.deepEqual(expected.lastSupport, before.lastSupport);
    assert.equal(fixture.triggers.filter((event) => event.name === "contribution").length, 1);
    assert.equal(fixture.triggers.filter((event) => event.name === "goal-completed").length, 1);
    const poll = await (await fetch(base + "/api/poll?since=" + cursor)).json();
    assert.equal(poll.state.totals.subs, 4);
    assert.equal(poll.events.some((event) => event.name === "contribution"), false);
    const duplicate = await fixture.actions.get("record-sub")({ count: 1, eventKey: "manual-preserved-event" });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.total, 4);
  } finally { await plugin.deactivate(); }
  const reopened = context(config, secrets);
  await plugin.activate(reopened.ctx);
  try {
    const restored = await reopened.actions.get("get-state")({});
    assert.deepEqual(restored.totals, expected.totals);
    assert.deepEqual(restored.history, expected.history);
    assert.equal(restored.timer.running, false);
    assert.equal(restored.timer.remainingSeconds, expected.timer.remainingSeconds);
    assert.equal(restored.goals[0].current, 4);
    assert.equal((await reopened.actions.get("record-sub")({ count: 1, eventKey: "manual-preserved-event" })).duplicate, true);
  } finally { await plugin.deactivate(); }
});

test("manual timer corrections use each tier and the actual signed subscription change", async () => {
  for (const [tier, seconds] of [["1000", 600], ["2000", 1200], ["3000", 3000], ["prime", 900]]) {
    const secrets = new Map();
    const fixture = context({}, secrets);
    await plugin.activate(fixture.ctx);
    try {
      const adjust = fixture.actions.get("set-total");
      await adjust({ contributionType: "subs", value: 3 });
      await adjust({ contributionType: "added-time", value: 10000 });
      const added = await adjust({ contributionType: "subs", operation: "add", value: 2, updateTimer: true, tier });
      assert.deepEqual(added, { type: "subs", total: 5, timerChanged: true });
      const increased = await fixture.actions.get("get-state")({});
      assert.equal(increased.timer.remainingSeconds, 3600 + 2 * seconds, tier);
      assert.equal(increased.totals.addedSeconds, 10000 + 2 * seconds, tier);
      const set = await adjust({ contributionType: "subs", operation: "set", value: 4, updateTimer: true, tier });
      assert.equal(set.total, 4);
      const decreased = await fixture.actions.get("get-state")({});
      assert.equal(decreased.timer.remainingSeconds, 3600 + seconds, tier);
      assert.equal(decreased.totals.addedSeconds, 10000 + seconds, tier);
      const removed = await adjust({ contributionType: "subs", operation: "subtract", value: 99, updateTimer: true, tier });
      assert.equal(removed.total, 0);
      const final = await fixture.actions.get("get-state")({});
      assert.equal(final.timer.remainingSeconds, Math.max(0, 3600 - 3 * seconds), tier);
      assert.equal(final.totals.addedSeconds, 10000 - 3 * seconds, tier);
      assert.equal(final.timer.running, false);
      assert.deepEqual(final.history, []);
      assert.equal(fixture.triggers.filter((event) => event.name === "contribution").length, 0);
    } finally { await plugin.deactivate(); }
    const reopened = context({}, secrets);
    await plugin.activate(reopened.ctx);
    try {
      const restored = await reopened.actions.get("get-state")({});
      assert.equal(restored.totals.subs, 0);
      assert.equal(restored.totals.addedSeconds, 10000 - 3 * seconds, tier);
      assert.equal(restored.timer.remainingSeconds, Math.max(0, 3600 - 3 * seconds), tier);
      assert.equal(restored.timer.running, false);
    } finally { await plugin.deactivate(); }
  }
});

test("manual timer corrections clamp both time counters and never start a paused timer", async () => {
  const fixture = context({ initialTimerSeconds: 0 });
  await plugin.activate(fixture.ctx);
  try {
    const adjust = fixture.actions.get("set-total");
    await adjust({ contributionType: "subs", operation: "add", value: 1, updateTimer: true });
    const fromZero = await fixture.actions.get("get-state")({});
    assert.equal(fromZero.timer.remainingSeconds, 600);
    assert.equal(fromZero.timer.running, false);
    await fixture.actions.get("timer-control")({ operation: "set", seconds: 31535900 });
    await adjust({ contributionType: "subs", operation: "add", value: 1, updateTimer: true });
    const capped = await fixture.actions.get("get-state")({});
    assert.equal(capped.timer.remainingSeconds, 31536000);
    assert.equal(capped.totals.addedSeconds, 1200);
    assert.equal(capped.timer.running, false);
    const noTimerChange = await adjust({ contributionType: "subs", operation: "add", value: 1, updateTimer: true });
    assert.equal(noTimerChange.timerChanged, false);
    assert.equal((await fixture.actions.get("get-state")({})).totals.addedSeconds, 1800);
    await fixture.actions.get("timer-control")({ operation: "set", seconds: 20 });
    await fixture.actions.get("timer-control")({ operation: "resume" });
    await adjust({ contributionType: "subs", operation: "subtract", value: 1, updateTimer: true, tier: "3000" });
    const atZero = await fixture.actions.get("get-state")({});
    assert.equal(atZero.timer.remainingSeconds, 0);
    assert.equal(atZero.timer.running, false);
    assert.equal(atZero.totals.addedSeconds, 0);
    assert.equal(atZero.totals.subs, 2);
    const same = await adjust({ contributionType: "subs", value: 2, updateTimer: true });
    assert.equal(same.timerChanged, false);
  } finally { await plugin.deactivate(); }
});

test("invalid manual corrections reject before mutation and leave the queue usable", async () => {
  const fixture = context();
  await plugin.activate(fixture.ctx);
  try {
    const adjust = fixture.actions.get("set-total");
    await adjust({ contributionType: "subs", value: 2 });
    const stored = fixture.sharedSecrets.get("catopanda-subathon-state-v1");
    const triggers = [...fixture.triggers];
    const invalid = [
      ...[-1, 0.5, NaN, Infinity, -Infinity, "bad", "", " ", null, true, {}, [], Number.MAX_SAFE_INTEGER + 1].map((value) => ({ contributionType: "subs", value })),
      ...["multiply", "", null, true].map((operation) => ({ contributionType: "subs", value: 1, operation })),
      ...["true", "false", 1, null].map((updateTimer) => ({ contributionType: "subs", value: 1, updateTimer })),
      ...["donate", "bits", "added-time"].map((contributionType) => ({ contributionType, value: 1, updateTimer: true })),
      { contributionType: "coins", value: 1 },
      { contributionType: "subs", operation: "add", value: Number.MAX_SAFE_INTEGER },
      { contributionType: "subs", value: Number.MAX_SAFE_INTEGER, updateTimer: true },
    ];
    for (const input of invalid) {
      await assert.rejects(() => adjust(input));
      assert.equal(fixture.sharedSecrets.get("catopanda-subathon-state-v1"), stored);
      assert.deepEqual(fixture.triggers, triggers);
      const state = await fixture.actions.get("get-state")({});
      assert.equal(state.totals.subs, 2);
      assert.equal(state.timer.remainingSeconds, 3600);
      assert.equal(state.totals.addedSeconds, 0);
    }
    assert.deepEqual(await adjust({ contributionType: "subs", operation: "add", value: 1 }), { type: "subs", total: 3, timerChanged: false });
  } finally { await plugin.deactivate(); }
});

test("state saved by 0.4.6 keeps totals, timer, history and IDs, and every goal starts pending", async () => {
  const support = { type: "donate", value: 5000, valueLabel: "R$ 50", actorName: "Fã", secondsAdded: 3000,
    addedLabel: "00:50:00", source: "livepix", tier: "", receivedAt: "2026-09-22T20:00:00.000Z" };
  const legacy = {
    version: 1,
    revision: 812,
    timer: { remainingSeconds: 181234, running: false, anchorAt: 1, finishedEmitted: false, finishedAt: "", warningsFired: [] },
    totals: { donateCents: 15000, subs: 12, bits: 3400, addedSeconds: 40210 },
    ledger: [],
    idLedger: { version: 1, generation: "a1b2c3d4e5f6a1b2c3d4e5f6", pages: 0, tail: ["donate:livepix:1", "subs:twitch:9"] },
    lastSupport: support,
    history: [support],
  };
  const secrets = new Map([["catopanda-subathon-state-v1", JSON.stringify(legacy)]]);
  const first = context({}, secrets);
  await plugin.activate(first.ctx);
  try {
    const state = await first.actions.get("get-state")({});
    assert.equal(state.revision, 812);
    assert.deepEqual(
      { donate: state.totals.donate, subs: state.totals.subs, bits: state.totals.bits, addedSeconds: state.totals.addedSeconds },
      { donate: 15000, subs: 12, bits: 3400, addedSeconds: 40210 },
    );
    assert.equal(state.timer.remainingSeconds, 181234);
    assert.deepEqual(state.history, [support]);
    assert.deepEqual(state.lastSupport, support);
    assert.deepEqual(state.goals.map((goal) => goal.execution), Array(6).fill("pending"));
    assert.deepEqual(state.goals.map((goal) => goal.stage), ["reached", "reached", "open", "open", "open", "open"]);
    assert.equal(state.activeGoal, null);
    assert.deepEqual(state.goalCounts, { total: 6, reached: 2, pending: 2, inProgress: 0, done: 0 });
    assert.equal((await first.actions.get("record-donate")({ amountCents: 100, eventKey: "livepix:1" })).duplicate, true);
    assert.equal((await first.actions.get("record-sub")({ count: 1, eventKey: "twitch:9" })).duplicate, true);
    await first.actions.get("set-goal-status")({ goalId: "donate-100", status: "in-progress" });
  } finally {
    await plugin.deactivate();
  }

  const stored = JSON.parse(secrets.get("catopanda-subathon-state-v1"));
  assert.deepEqual(stored.totals, legacy.totals);
  assert.deepEqual(stored.history, legacy.history);
  assert.deepEqual(stored.lastSupport, legacy.lastSupport);
  assert.deepEqual(stored.idLedger, legacy.idLedger);
  assert.equal(stored.timer.remainingSeconds, legacy.timer.remainingSeconds);
  assert.deepEqual(stored.goalStatus, { "donate-100": "in-progress" });

  const second = context({}, secrets);
  await plugin.activate(second.ctx);
  try {
    const restored = await second.actions.get("get-state")({});
    assert.equal(restored.activeGoal.id, "donate-100");
    assert.equal(restored.totals.donate, 15000);
    assert.equal(restored.totals.addedSeconds, 40210);
  } finally {
    await plugin.deactivate();
  }
});

test("only one goal is in progress, done survives a restart, and shortcuts pick the right goal", async () => {
  const secrets = new Map();
  const first = context({}, secrets);
  await plugin.activate(first.ctx);
  const set = (goalId, status) => first.actions.get("set-goal-status")({ goalId, status });
  const statusEvents = () => first.triggers.filter((entry) => entry.name === "goal-status-changed").map((entry) => entry.payload);
  try {
    await first.actions.get("set-total")({ contributionType: "donate", value: 15000 });
    await assert.rejects(set("@active", "done"), /nenhuma meta está em andamento/);

    const started = await set("@next", "in-progress");
    assert.equal(started.goalId, "donate-100");
    assert.equal(started.activeGoalId, "donate-100");
    assert.equal(started.changed, true);

    // Starting another goal returns the first one to pending: never two at once.
    const switched = await set("donate-150", "Em andamento");
    assert.equal(switched.activeGoalId, "donate-150");
    let state = await first.actions.get("get-state")({});
    assert.deepEqual(state.goals.filter((goal) => goal.active).map((goal) => goal.id), ["donate-150"]);
    assert.equal(state.goals[0].execution, "pending");
    assert.equal(state.goals[0].stage, "reached");
    assert.deepEqual(statusEvents().map((event) => [event.goalId, event.previousStatus, event.status]), [
      ["donate-100", "pending", "in-progress"],
      ["donate-100", "in-progress", "pending"],
      ["donate-150", "pending", "in-progress"],
    ]);
    assert.equal(statusEvents()[2].statusLabel, "Em andamento");
    assert.equal(statusEvents()[2].activeTitle, "Cantar uma música");

    const finished = await set("@active", "done");
    assert.equal(finished.goalId, "donate-150");
    assert.equal(finished.activeGoalId, "");
    const repeated = await set("donate-150", "concluída");
    assert.equal(repeated.changed, false);
    assert.equal(statusEvents().length, 4);

    // A title written in a formula works when it is unique; the case does not matter.
    assert.equal((await set("chat escolhe o outfit", "done")).goalId, "donate-100");
    // A goal can be started before its target is reached.
    const early = await set("subs-50", "in-progress");
    assert.equal(early.activeGoalId, "subs-50");
    state = await first.actions.get("get-state")({});
    const subs = state.goals.find((goal) => goal.id === "subs-50");
    assert.equal(subs.reached, false);
    assert.equal(subs.stage, "in-progress");
    assert.equal(subs.stageLabel, "Em andamento");
    assert.equal(subs.completed, false);
    assert.equal(state.goals[0].completed, true, "completed keeps meaning target reached");

    await assert.rejects(set("@reached", "in-progress"), /somente uma meta/);
    await assert.rejects(set("nao-existe", "done"), /meta não encontrada/);
    await assert.rejects(set("donate-100", "talvez"), /situação inválida/);
    await assert.rejects(set("", "done"), /escolha a meta/);

    const reset = await set("@reached", "pending");
    assert.deepEqual(reset.goalIds, ["donate-100", "donate-150"]);
    await set("@reached", "done");
    state = await first.actions.get("get-state")({});
    assert.deepEqual(state.goalCounts, { total: 6, reached: 2, pending: 0, inProgress: 1, done: 2 });
  } finally {
    await plugin.deactivate();
  }

  const second = context({}, secrets);
  await plugin.activate(second.ctx);
  try {
    let state = await second.actions.get("get-state")({});
    assert.deepEqual(state.goals.map((goal) => goal.stage), ["done", "done", "open", "open", "in-progress", "open"]);
    assert.equal(state.activeGoal.id, "subs-50");
    await second.actions.get("reset-state")({ scope: "goal-status" });
    state = await second.actions.get("get-state")({});
    assert.deepEqual(state.goals.map((goal) => goal.execution), Array(6).fill("pending"));
    assert.equal(state.totals.donate, 15000, "clearing statuses never touches totals");
  } finally {
    await plugin.deactivate();
  }
});

test("a failed status write keeps the previous statuses and announces nothing", async () => {
  const fixture = context();
  const save = fixture.ctx.secrets.set;
  try {
    await plugin.activate(fixture.ctx);
    await fixture.actions.get("set-total")({ contributionType: "donate", value: 10000 });
    fixture.ctx.secrets.set = async () => { throw new Error("disk full"); };
    await assert.rejects(fixture.actions.get("set-goal-status")({ goalId: "donate-100", status: "in-progress" }), /disk full/);
    fixture.ctx.secrets.set = save;
    const state = await fixture.actions.get("get-state")({});
    assert.equal(state.activeGoal, null);
    assert.equal(fixture.triggers.filter((entry) => entry.name === "goal-status-changed").length, 0);
    assert.equal((await fixture.actions.get("set-goal-status")({ goalId: "donate-100", status: "in-progress" })).changed, true);
  } finally { fixture.ctx.secrets.set = save; await plugin.deactivate(); }
});

test("the goal picker lists shortcuts and every goal, and republishes only when a label changes", async () => {
  const fixture = context();
  await plugin.activate(fixture.ctx);
  try {
    const published = () => fixture.resources.filter((entry) => entry.key === "goals");
    const initial = published().at(-1).items;
    assert.deepEqual(initial.slice(0, 3).map((item) => item.value), ["@active", "@next", "@reached"]);
    assert.deepEqual(initial.slice(3).map((item) => item.value), manifest.configSchema.fields
      .find((field) => field.key === "goals").default.map((goal) => goal.id));
    assert.match(initial[3].label, /^01 · Chat escolhe o outfit · R\$\s100 · A caminho$/);
    const count = published().length;
    await wait(1100);
    assert.equal(published().length, count, "the timer tick does not republish an unchanged list");
    await fixture.actions.get("set-total")({ contributionType: "donate", value: 10000 });
    assert.match(published().at(-1).items[3].label, /· Alcançada$/);
    await fixture.actions.get("set-goal-status")({ goalId: "donate-100", status: "in-progress" });
    assert.match(published().at(-1).items[3].label, /· Em andamento$/);
  } finally {
    await plugin.deactivate();
  }
});

test("overlays receive each goal status change once through the poll", async () => {
  const fixture = context();
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    const base = new URL(state.urls.goalsList).origin;
    const start = await (await fetch(base + "/api/poll")).json();
    await fixture.actions.get("set-total")({ contributionType: "subs", value: 50 });
    await fixture.actions.get("set-goal-status")({ goalId: "subs-50", status: "in-progress" });
    const next = await (await fetch(base + "/api/poll?since=" + String(start.seq))).json();
    const statusEvents = next.events.filter((event) => event.name === "goal-status");
    assert.equal(statusEvents.length, 1);
    assert.equal(statusEvents[0].payload.title, "Karaokê com o chat");
    assert.equal(next.state.activeGoal.id, "subs-50");
    const after = await (await fetch(base + "/api/poll?since=" + String(next.seq))).json();
    assert.equal(after.events.length, 0);
    for (const path of ["/overlay/goals-active", "/overlay/goals-list"]) {
      const page = await (await fetch(base + path)).text();
      assert.match(page, /data-view="goals-active"/);
      assert.match(page, /data-goals-list/);
    }
  } finally {
    await plugin.deactivate();
  }
});

function rawRequest(port, { method = "POST", path = "/api/goal-status", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("the dashboard changes a goal status through the same rules as the flow block", async () => {
  const fixture = context();
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    const origin = new URL(state.urls.dashboard).origin;
    const page = await fetch(state.urls.dashboard);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Painel do subathon/);
    for (const path of ["/dashboard.css", "/dashboard.js"]) assert.equal((await fetch(origin + path)).status, 200, path);

    await fixture.actions.get("set-total")({ contributionType: "donate", value: 10000 });
    const post = (body) => fetch(origin + "/api/goal-status", {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
    });
    const started = await post({ goalId: "@next", status: "in-progress" });
    assert.equal(started.status, 200);
    const result = await started.json();
    assert.equal(result.ok, true);
    assert.equal(result.activeGoalId, "donate-100");
    assert.equal(fixture.triggers.filter((entry) => entry.name === "goal-status-changed").length, 1);
    assert.equal((await fixture.actions.get("get-state")({})).activeGoal.id, "donate-100");

    const unknown = await post({ goalId: "nao-existe", status: "done" });
    assert.equal(unknown.status, 400);
    assert.match((await unknown.json()).error, /meta não encontrada/);
  } finally {
    await plugin.deactivate();
  }
});

test("pages on other sites cannot change a goal through the local server", async () => {
  const fixture = context();
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    const port = Number(new URL(state.urls.dashboard).port);
    const body = JSON.stringify({ goalId: "donate-100", status: "done" });
    const json = { "content-type": "application/json" };
    const attempts = [
      // A cross-site HTML form can only send these content types.
      { headers: { "content-type": "text/plain" }, body },
      { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "goalId=donate-100&status=done" },
      { headers: { ...json, origin: "https://evil.example" }, body },
      { headers: { ...json, "sec-fetch-site": "cross-site" }, body },
      // DNS rebinding: a hostile name that resolves to 127.0.0.1.
      { headers: { ...json, host: "evil.example:" + String(port) }, body },
    ];
    for (const attempt of attempts) {
      const response = await rawRequest(port, attempt);
      assert.equal(response.status, 403, JSON.stringify(attempt.headers));
    }
    const preflight = await rawRequest(port, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(preflight.status, 405);
    assert.equal(preflight.headers["access-control-allow-origin"], undefined);
    const oversized = await rawRequest(port, { headers: json, body: JSON.stringify({ goalId: "x".repeat(5000), status: "done" }) });
    assert.equal(oversized.status, 400);
    const after = await fixture.actions.get("get-state")({});
    assert.deepEqual(after.goals.map((goal) => goal.execution), Array(6).fill("pending"));
    assert.equal(fixture.triggers.filter((entry) => entry.name === "goal-status-changed").length, 0);
    // Same machine, no browser: curl-style clients without Origin still work with JSON.
    const local = await rawRequest(port, { headers: json, body });
    assert.equal(local.status, 200);
  } finally {
    await plugin.deactivate();
  }
});

async function dashboardPost(origin, path, body) {
  const response = await fetch(origin + path, {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("the dashboard runs the timer like the timer block and never counts it as supporter time", async () => {
  const fixture = context({ initialTimerSeconds: 7200 });
  await plugin.activate(fixture.ctx);
  try {
    const state = await fixture.actions.get("get-state")({});
    assert.equal(state.timer.initialSeconds, 7200);
    assert.equal(state.timer.initialFormatted, "02:00:00");
    const origin = new URL(state.urls.dashboard).origin;
    const timer = (body) => dashboardPost(origin, "/api/timer", body);

    let result = await timer({ operation: "resume" });
    assert.equal(result.status, 200);
    assert.equal(result.body.running, true);
    result = await timer({ operation: "pause" });
    assert.equal(result.body.running, false);
    assert.equal((await timer({ operation: "add", seconds: 600 })).body.remainingSeconds, 7800);
    assert.equal((await timer({ operation: "subtract", seconds: 300 })).body.remainingSeconds, 7500);
    assert.equal((await timer({ operation: "set", seconds: 3600 })).body.formatted, "01:00:00");
    const reset = await timer({ operation: "reset" });
    assert.equal(reset.body.remainingSeconds, 7200);
    assert.equal(reset.body.running, false);

    // Anything unreadable is refused before the countdown moves.
    for (const body of [
      { operation: "set", seconds: "abc" },
      { operation: "set" },
      { operation: "set", seconds: -5 },
      { operation: "set", seconds: 1.5 },
      { operation: "add", seconds: 0 },
      { operation: "add", seconds: 31536001 },
      { operation: "toggle" },
      { operation: "explode", seconds: 10 },
    ]) {
      const refused = await timer(body);
      assert.equal(refused.status, 400, JSON.stringify(body));
    }
    const after = await fixture.actions.get("get-state")({});
    assert.equal(after.timer.remainingSeconds, 7200);
    assert.equal(after.totals.addedSeconds, 0, "operator adjustments are not supporter time");

    const port = Number(new URL(origin).port);
    for (const path of ["/api/timer", "/api/test-alert"]) {
      const response = await rawRequest(port, {
        path,
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ operation: "set", seconds: 0, kind: "timer-finished" }),
      });
      assert.equal(response.status, 403, path);
    }
    assert.equal((await fixture.actions.get("get-state")({})).timer.remainingSeconds, 7200);
  } finally {
    await plugin.deactivate();
  }
});

test("test alerts reach the overlays once, marked as tests, and change nothing else", async () => {
  const secrets = new Map();
  const fixture = context({}, secrets);
  await plugin.activate(fixture.ctx);
  try {
    await fixture.actions.get("set-total")({ contributionType: "donate", value: 10000 });
    await fixture.actions.get("set-goal-status")({ goalId: "donate-100", status: "in-progress" });
    const before = await fixture.actions.get("get-state")({});
    const storedBefore = secrets.get("catopanda-subathon-state-v1");
    const triggersBefore = fixture.triggers.length;
    const origin = new URL(before.urls.dashboard).origin;
    const start = await (await fetch(origin + "/api/poll")).json();

    const expected = {
      "contribution-donate": "contribution",
      "contribution-subs": "contribution",
      "contribution-bits": "contribution",
      "goal-completed": "goal-completed",
      "goal-in-progress": "goal-status",
      "goal-done": "goal-status",
      "timer-warning": "timer-warning",
      "timer-finished": "timer-finished",
    };
    for (const [kind, event] of Object.entries(expected)) {
      const sent = await dashboardPost(origin, "/api/test-alert", { kind });
      assert.equal(sent.status, 200, kind);
      assert.equal(sent.body.event, event);
    }
    assert.equal((await dashboardPost(origin, "/api/test-alert", { kind: "nope" })).status, 400);

    const polled = await (await fetch(origin + "/api/poll?since=" + String(start.seq))).json();
    assert.deepEqual(polled.events.map((entry) => entry.name), Object.values(expected));
    assert.ok(polled.events.every((entry) => entry.payload.test === true));
    const donate = polled.events[0].payload;
    assert.equal(donate.actorName, "Teste do painel");
    assert.equal(donate.secondsAdded, 600);
    assert.equal(polled.events[3].payload.title, "Chat escolhe o outfit");
    assert.equal(polled.events[5].payload.status, "done");

    const after = await fixture.actions.get("get-state")({});
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.totals, before.totals);
    assert.equal(after.timer.remainingSeconds, before.timer.remainingSeconds);
    assert.deepEqual(after.goals.map((goal) => goal.execution), before.goals.map((goal) => goal.execution));
    assert.deepEqual(after.history, before.history);
    assert.equal(secrets.get("catopanda-subathon-state-v1"), storedBefore, "nothing is written");
    assert.equal(fixture.triggers.length, triggersBefore, "no flow trigger fires");
  } finally {
    await plugin.deactivate();
  }
});
