import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import plugin from "../plugin/index.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin/manifest.json", import.meta.url), "utf8"));

function context(overrides = {}, sharedSecrets = new Map()) {
  const controller = new AbortController();
  const actions = new Map();
  const triggers = [];
  const statuses = [];
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
      setResource: () => {},
      onFlowsChanged: () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    },
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
    assert.equal(Object.keys(initial.urls).length, 7);
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
