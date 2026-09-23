import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import plugin from "../../plugin/index.mjs";

// Run after `pnpm.cmd build:packages` in the host checkout. A missing host is an error.
const hostRoot = resolve(process.env.OSC_FLOW_STUDIO_ROOT || fileURLToPath(new URL("../../../osc-flow-studio/", import.meta.url)));
const hostImport = (path) => import(pathToFileURL(resolve(hostRoot, path)).href);
const { FlowEngine } = await hostImport("packages/flow-engine/dist/index.js");
const { FlowSchema, buildStreamTriggerOutput } = await hostImport("packages/core/dist/index.js");
const { TwitchEventSubSession } = await hostImport("packages/twitch-client/dist/index.js");
const { assertNodeOutputContract, assertNodeOutputEnvelope } = await hostImport("packages/flow-engine/tests/helpers/node-output-contract.ts");
const manifest = JSON.parse(readFileSync(new URL("../../plugin/manifest.json", import.meta.url), "utf8"));
const template = manifest.templates.find((entry) => entry.id === "catopanda-subathon-twitch").flow;
const prefix = "action.x.catopanda-subathon.";

async function fixture() {
  const actions = new Map();
  const secrets = new Map();
  const triggers = [];
  const controller = new AbortController();
  await plugin.activate({
    signal: controller.signal,
    config: { get: async () => ({ enabled: true, port: 0, initialTimerSeconds: 3600,
      subTier1Seconds: 600, subTier2Seconds: 1200, subTier3Seconds: 3000,
      subPrimeSeconds: 900, warningThresholds: [] }) },
    secrets: { get: async (key) => secrets.get(key) || null,
      set: async (key, value) => { secrets.set(key, value); },
      delete: async (key) => { secrets.delete(key); } },
    registerAction: (name, handler) => actions.set(name, handler),
    emitTrigger: (name, payload) => triggers.push({ name, payload }),
    setStatus() {}, setResource() {}, onFlowsChanged() {},
    log: { info() {}, warn() {}, error() {} },
  });
  return { actions, triggers, state: () => actions.get("get-state")({}),
    close: async () => { controller.abort(); await plugin.deactivate(); } };
}

function withProbes(input, nodeId) {
  const flow = structuredClone(input);
  const node = flow.nodes.find((item) => item.id === nodeId);
  const schema = manifest.nodeTypes.find((item) => item.type === node.type).outputSchema;
  for (const [id, root] of [["probe-json", "$json"], ["probe-node", `$node["${nodeId}"]`]]) {
    flow.nodes.push({ id, type: "action.x.contract-probe.capture",
      ...Object.fromEntries(schema.map(({ path }) => [`field_${path}`, { mode: "expression", expression: `{{ ${root}.${path} }}` }])) });
  }
  flow.edges.push({ id: "probe-immediate", source: nodeId, target: "probe-json" },
    { id: "probe-downstream", source: "probe-json", target: "probe-node" });
  return FlowSchema.parse({ ...flow, enabled: true });
}

async function execute(f, input, entryNodeId, trigger, observedNodeId, enabled = true) {
  const captures = new Map();
  const calls = [];
  const flow = observedNodeId ? withProbes(input, observedNodeId) : FlowSchema.parse(input);
  const result = await new FlowEngine().execute(flow, {
    osc: {}, variables: {}, pluginConfigs: { "catopanda-subathon": { enabled }, "contract-probe": { enabled: true } },
    entryNodeId, triggerNodeId: entryNodeId, trigger, nodeOutputStore: {},
    executePluginAction: async ({ nodeType, nodeId, data }) => {
      if (nodeType === "action.x.contract-probe.capture") {
        captures.set(nodeId, data);
        return { captured: true };
      }
      calls.push(nodeType);
      assert.ok(nodeType.startsWith(prefix));
      return f.actions.get(nodeType.slice(prefix.length))(data);
    },
  });
  for (const envelope of Object.values(result.nodeOutputStore)) assertNodeOutputEnvelope(envelope);
  if (observedNodeId && result.nodeOutputStore[observedNodeId]?.status === "success") {
    const node = flow.nodes.find((item) => item.id === observedNodeId);
    const schema = manifest.nodeTypes.find((item) => item.type === node.type).outputSchema;
    const sample = result.nodeOutputStore[observedNodeId];
    assertNodeOutputContract(sample, schema, { nodeId: observedNodeId, nodeType: node.type,
      requiredPaths: schema.map((field) => field.path) });
    const stable = Object.fromEntries(schema.map(({ path }) => [`field_${path}`, sample.data[path]]));
    assert.deepEqual(captures.get("probe-json"), stable, "immediate $json fields match runtime output");
    assert.deepEqual(captures.get("probe-node"), stable, "non-direct $node fields match runtime output");
  }
  return { result, calls, captures };
}

function event(kind, key, metadata = {}) {
  return { integration: "twitch", kind, triggeredAt: `2026-09-22T12:00:${String(key).padStart(2, "0")}.000Z`,
    actorId: "viewer", actorDisplayName: "Viewer", metadata: { tier: "1000", ...metadata } };
}

for (const [kind, triggerId, nodeId, metadata, count] of [
  ["subscribe", "twitch-subscribe", "record-subscribe", { isGift: false }, 1],
  ["resub", "twitch-resub", "record-resub", { tier: "2000" }, 1],
  ["subGift", "twitch-sub-gift", "record-sub-gift", { total: 3 }, 3],
]) {
  test(`bundled Twitch ${kind} counts once, deduplicates replay and preserves distinct events`, async () => {
    const f = await fixture();
    try {
      const first = await execute(f, template, triggerId, event(kind, 1, metadata), nodeId);
      assert.deepEqual(first.result.errors, []);
      assert.deepEqual(first.calls, [prefix + "record-sub"]);
      const data = first.result.nodeOutputStore[nodeId].data;
      const seconds = count * (metadata.tier === "2000" ? 1200 : 600);
      assert.equal(data.accepted, true);
      assert.equal(data.duplicate, false);
      assert.equal(data.total, count);
      assert.equal(data.secondsAdded, seconds);
      const duplicate = await execute(f, template, triggerId, event(kind, 1, metadata), nodeId);
      assert.deepEqual(duplicate.result.errors, []);
      assert.equal(duplicate.result.nodeOutputStore[nodeId].data.accepted, false);
      assert.equal(duplicate.result.nodeOutputStore[nodeId].data.duplicate, true);
      assert.equal(duplicate.result.nodeOutputStore[nodeId].data.secondsAdded, 0);
      const distinct = await execute(f, template, triggerId, event(kind, 2, metadata), nodeId);
      assert.deepEqual(distinct.result.errors, []);
      const state = await f.state();
      assert.equal(state.totals.subs, 2 * count);
      assert.equal(state.totals.addedSeconds, 2 * seconds);
      assert.equal(state.timer.remainingSeconds, 3600 + 2 * seconds);
      assert.equal(state.history.length, 2);
    } finally { await f.close(); }
  });
}

for (const order of ["batch-first", "recipients-first"]) {
  test(`gift batch and recipient notifications count only the batch (${order})`, async () => {
    const f = await fixture();
    try {
      const batch = () => execute(f, template, "twitch-sub-gift", event("subGift", 3, { total: 3 }), "record-sub-gift");
      const recipients = async () => {
        for (let index = 0; index < 3; index++) {
          const { result, calls } = await execute(f, template, "twitch-subscribe",
            { ...event("subscribe", index + 4, { isGift: true }), actorId: `recipient-${index}` }, "record-subscribe");
          assert.deepEqual(result.errors, []);
          assert.deepEqual(calls, []);
          assert.equal(result.nodeOutputStore["exclude-gift-recipient"].data.pass, false);
          assert.equal(result.nodeOutputStore["record-subscribe"], undefined);
        }
      };
      if (order === "batch-first") { await batch(); await recipients(); }
      else { await recipients(); await batch(); }
      const state = await f.state();
      assert.equal(state.totals.subs, 3);
      assert.equal(state.totals.addedSeconds, 1800);
      assert.equal(state.timer.remainingSeconds, 5400);
      assert.equal(state.history.length, 1);
    } finally { await f.close(); }
  });
}

test("disabled plugin actions and disconnected branches cannot mutate accounting", async () => {
  const f = await fixture();
  try {
    const disconnected = structuredClone(template);
    disconnected.nodes.push({ id: "disconnected", type: prefix + "record-sub", count: 100, tier: "3000" });
    const active = await execute(f, disconnected, "twitch-subscribe", event("subscribe", 10, { isGift: false }), "record-subscribe");
    assert.deepEqual(active.result.errors, []);
    assert.deepEqual(active.calls, [prefix + "record-sub"]);
    assert.equal(active.result.nodeOutputStore.disconnected, undefined);
    const disabled = await execute(f, template, "twitch-resub", event("resub", 11), "record-resub", false);
    assert.deepEqual(disabled.result.errors, []);
    assert.deepEqual(disabled.calls, []);
    assert.equal(disabled.result.nodeOutputStore["record-resub"].status, "skipped");
    assert.equal(disabled.captures.size, 0);
    assert.equal((await f.state()).totals.subs, 1);
  } finally { await f.close(); }
});

function correctionFlow(data) {
  return { id: "correction", name: "Correction contract", nodes: [
    { id: "trigger", type: "trigger.x.contract-probe.manual" },
    { id: "correct", type: prefix + "set-total", ...data },
  ], edges: [{ id: "correct-total", source: "trigger", target: "correct" }] };
}

for (const operation of ["set", "add", "subtract"]) {
  for (const updateTimer of [false, true]) {
    test(`manual subscription ${operation} preserves its engine output contract with updateTimer=${updateTimer}`, async () => {
      const f = await fixture();
      try {
        await f.actions.get("record-sub")({ count: 5, tier: "1000", eventKey: "seed" });
        await f.actions.get("timer-control")({ operation: "pause" });
        const before = await f.state();
        const flow = correctionFlow({ contributionType: "subs", operation,
          value: { mode: "expression", expression: "{{ 2 }}" }, tier: "2000", updateTimer });
        const { result } = await execute(f, flow, "trigger", event("manual", 20), "correct");
        assert.deepEqual(result.errors, []);
        const expectedTotal = operation === "set" ? 2 : operation === "add" ? 7 : 3;
        const delta = updateTimer ? (expectedTotal - 5) * 1200 : 0;
        assert.deepEqual(result.nodeOutputStore.correct.data, { type: "subs", total: expectedTotal, timerChanged: updateTimer });
        const after = await f.state();
        assert.equal(after.totals.subs, expectedTotal);
        assert.equal(after.timer.remainingSeconds, before.timer.remainingSeconds + delta);
        assert.equal(after.totals.addedSeconds, Math.max(0, before.totals.addedSeconds + delta));
        assert.equal(after.timer.running, false);
        assert.deepEqual(after.history, before.history);
        assert.equal(f.triggers.filter((entry) => entry.name === "contribution").length, 1);
        assert.equal((await f.actions.get("record-sub")({ count: 5, tier: "1000", eventKey: "seed" })).duplicate, true);
      } finally { await f.close(); }
    });
  }
}

test("invalid corrections produce error envelopes and no downstream accounting output", async () => {
  const f = await fixture();
  try {
    const before = await f.state();
    const { result, captures } = await execute(f, correctionFlow({ contributionType: "subs", value: 1.5 }),
      "trigger", event("manual", 30), "correct");
    assert.equal(result.errors.length, 1);
    assert.equal(result.nodeOutputStore.correct.status, "error");
    assert.equal(captures.size, 0);
    const after = await f.state();
    assert.deepEqual(after.totals, before.totals);
    assert.deepEqual(after.timer, before.timer);
  } finally { await f.close(); }
});

test("contract validation rejects a missing field, wrong type and null runtime field", async () => {
  const f = await fixture();
  try {
    const { result } = await execute(f, correctionFlow({ contributionType: "subs", value: 2 }),
      "trigger", event("manual", 31), "correct");
    const sample = result.nodeOutputStore.correct;
    const schema = manifest.nodeTypes.find((entry) => entry.type === prefix + "set-total").outputSchema;
    for (const invalid of [{ type: "subs", timerChanged: false }, { ...sample.data, total: "2" }, { ...sample.data, total: null }]) {
      assert.throws(() => assertNodeOutputContract({ ...sample, data: invalid }, schema,
        { requiredPaths: schema.map((field) => field.path) }), /Node output contract:/);
    }
    assert.throws(() => assertNodeOutputContract(sample, [{ path: "total", type: "unsupported" }]), /unsupported type syntax/);
  } finally { await f.close(); }
});

function chatNotification(noticeType, noticeId, details, deliveryId = noticeId) {
  return JSON.stringify({ metadata: { message_type: "notification", message_id: deliveryId },
    payload: { subscription: { type: "channel.chat.notification" }, event: {
      broadcaster_user_id: "broadcaster", chatter_user_id: "viewer", chatter_user_login: "viewer",
      chatter_user_name: "Viewer", message_id: noticeId, notice_type: noticeType,
      [noticeType]: { sub_tier: "1000", ...details },
    } } });
}

function provider(f) {
  const session = new TwitchEventSubSession();
  const pending = [];
  session.onEvent((normalized) => pending.push(normalized));
  return { close: () => session.disconnect(), async deliver(raw) {
    await session.handleMessage(raw);
    const processed = [];
    for (const normalized of pending.splice(0)) {
      const [triggerId, nodeId] = {
        subscribe: ["twitch-subscribe", "record-subscribe"],
        resub: ["twitch-resub", "record-resub"],
        sub_gift: ["twitch-sub-gift", "record-sub-gift"],
      }[normalized.kind];
      const trigger = buildStreamTriggerOutput(normalized);
      const output = await execute(f, template, triggerId, trigger, nodeId);
      assert.deepEqual(output.result.errors, []);
      processed.push({ ...output, nodeId, trigger });
    }
    return processed;
  } };
}

for (const [noticeType, details, count, seconds] of [
  ["sub", {}, 1, 600],
  ["resub", { sub_tier: "2000", is_gift: false, cumulative_months: 12, duration_months: 1 }, 1, 1200],
  ["sub_gift", { sub_tier: "3000", recipient_user_id: "recipient" }, 1, 3000],
  ["community_sub_gift", { total: 3, id: "batch" }, 3, 1800],
]) {
  test(`Twitch ${noticeType} notification reaches plugin once and preserves stable IDs across sessions`, async () => {
    const f = await fixture();
    const first = provider(f);
    const reopened = provider(f);
    try {
      const raw = chatNotification(noticeType, "canonical-1", details, "delivery-1");
      const [accepted] = await first.deliver(raw);
      assert.equal(accepted.result.nodeOutputStore[accepted.nodeId].data.accepted, true);
      assert.equal(accepted.result.nodeOutputStore[accepted.nodeId].data.total, count);
      assert.deepEqual(await first.deliver(raw), [], "same EventSub delivery emits once");
      const [replayed] = await reopened.deliver(chatNotification(noticeType, "canonical-1", details, "delivery-2"));
      assert.equal(replayed.result.nodeOutputStore[replayed.nodeId].data.duplicate, true,
        "the chat message ID deduplicates even after a session reset changes receipt time");
      const [distinct] = await reopened.deliver(chatNotification(noticeType, "canonical-2", details, "delivery-3"));
      assert.equal(distinct.result.nodeOutputStore[distinct.nodeId].data.accepted, true);
      const state = await f.state();
      assert.equal(state.totals.subs, count * 2);
      assert.equal(state.totals.addedSeconds, seconds * 2);
      assert.equal(state.timer.remainingSeconds, 3600 + seconds * 2);
      assert.equal(state.history.length, 2);
    } finally { first.close(); reopened.close(); await f.close(); }
  });
}

for (const order of ["batch-first", "recipients-first"]) {
  test(`Twitch community gifts plus gift announcements avoid overlapping accounting (${order})`, async () => {
    const f = await fixture();
    const source = provider(f);
    try {
      const batch = () => source.deliver(chatNotification("community_sub_gift", "batch-notice", { total: 3, id: "batch" }));
      const recipients = async () => {
        for (let index = 0; index < 3; index++) {
          assert.deepEqual(await source.deliver(chatNotification("sub_gift", `gift-${index}`,
            { community_gift_id: "batch", recipient_user_id: `recipient-${index}` })), []);
          const [announcement] = await source.deliver(chatNotification("resub", `resub-${index}`,
            { is_gift: true, cumulative_months: 12 }));
          assert.deepEqual(announcement.calls, []);
          assert.equal(announcement.result.nodeOutputStore["exclude-gift-resub"].data.pass, false);
          assert.equal(announcement.result.nodeOutputStore["record-resub"], undefined);
        }
      };
      if (order === "batch-first") { await batch(); await recipients(); }
      else { await recipients(); await batch(); }
      const state = await f.state();
      assert.equal(state.totals.subs, 3);
      assert.equal(state.timer.remainingSeconds, 5400);
      assert.equal(state.totals.addedSeconds, 1800);
      assert.equal(state.history.length, 1);
      await source.deliver(chatNotification("resub", "paid-resub", { is_gift: false, cumulative_months: 13 }));
      assert.equal((await f.state()).totals.subs, 4);
    } finally { source.close(); await f.close(); }
  });
}

test("legacy gifted resub flags stop their accounting branch", async () => {
  const f = await fixture();
  try {
    for (const raw of [{ isGift: true }, { is_gift: true }]) {
      const { result, calls } = await execute(f, template, "twitch-resub", event("resub", 40, { raw }), "record-resub");
      assert.deepEqual(result.errors, []);
      assert.deepEqual(calls, []);
      assert.equal(result.nodeOutputStore["exclude-gift-resub"].data.pass, false);
    }
    assert.equal((await f.state()).totals.subs, 0);
  } finally { await f.close(); }
});
