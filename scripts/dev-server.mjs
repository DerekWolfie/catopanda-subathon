import plugin from "../plugin/index.mjs";

const actions = new Map();
const secrets = new Map();
const port = Number(process.env.CATOPANDA_PORT || 8798);
const config = {
  enabled: true,
  port,
  initialTimerSeconds: 260220,
  donateSecondsPerReal: 60,
  bitsPerUnit: 100,
  bitsSecondsPerUnit: 60,
  subTier1Seconds: 600,
  subTier2Seconds: 1200,
  subTier3Seconds: 3000,
  goalsTransparent: true,
  progressTransparent: true,
  timerTransparent: true,
  brbTransparent: false,
  effectsEnabled: true,
  celebrateGoals: true,
  celebrateContributions: true,
  celebrationSeconds: Number(process.env.CATOPANDA_CELEBRATION_SECONDS || 6),
  warningThresholds: [3600, 900, 300, 60],
  // Long titles on purpose: they exercise the marquee in every overlay.
  goals: [
    { id: "donate-100", type: "donate", title: "Chat escolhe o outfit", target: 10000, order: 1 },
    { id: "donate-150", type: "donate", title: "Cantar uma música", target: 15000, order: 2 },
    { id: "donate-200", type: "donate", title: "Jogar terror sem luz", target: 20000, order: 3 },
    { id: "donate-300", type: "donate", title: "Cosplay surpresa", target: 30000, order: 4 },
    { id: "subs-50", type: "subs", title: "Karaokê com o chat escolhendo as músicas mais vergonhosas", target: 50, order: 5 },
    { id: "bits-10000", type: "bits", title: "Desafio escolhido ao vivo pelo chat com castigo surpresa no final", target: 10000, order: 6 },
  ],
};
const ctx = {
  config: { get: async () => config },
  secrets: {
    get: async (key) => secrets.get(key) || null,
    set: async (key, value) => { secrets.set(key, value); },
    delete: async (key) => { secrets.delete(key); },
  },
  registerAction: (name, handler) => actions.set(name, handler),
  emitTrigger: (name, payload) => {
    process.stdout.write("[trigger] " + name + " " + JSON.stringify(payload) + "\n");
  },
  setResource: () => {},
  setStatus: (status) => {
    process.stdout.write("[status] " + JSON.stringify(status) + "\n");
  },
  onFlowsChanged: () => {},
  log: {
    info: (message) => process.stdout.write("[info] " + message + "\n"),
    warn: (message) => process.stdout.write("[warn] " + message + "\n"),
    error: (message) => process.stderr.write("[error] " + message + "\n"),
  },
};

await plugin.activate(ctx);
await actions.get("set-total")({ type: "donate", value: 24300 });
await actions.get("set-total")({ type: "subs", value: 38 });
await actions.get("set-total")({ type: "bits", value: 7200 });
await actions.get("timer-control")({ operation: "set", seconds: 260220 });
await actions.get("timer-control")({ operation: "resume", seconds: 0 });
const state = await actions.get("get-state")({});

process.stdout.write("\nCatOPanda Subathon visual QA\n");
for (const [name, url] of Object.entries(state.urls)) {
  process.stdout.write(name + ": " + url + "\n");
}

// CATOPANDA_DEMO=1 replays a contribution every few seconds so the toasts,
// the digit roll and the confetti can be inspected without a live event.
if (process.env.CATOPANDA_DEMO === "1") {
  const samples = [
    { action: "record-donate", data: { amountCents: 500, actorName: "Luna" } },
    { action: "record-bits", data: { bits: 250, actorName: "PixelPanda" } },
    { action: "record-sub", data: { tier: "2000", count: 1, actorName: "Gabi" } },
    { action: "record-donate", data: { amountCents: 2500, actorName: "Apoio anônimo" } },
  ];
  let index = 0;
  setInterval(() => {
    const sample = samples[index % samples.length];
    index += 1;
    void (async () => {
      // The sub sample crosses the 50 Subs goal every cycle, then steps back so
      // the celebration can be replayed.
      if (sample.action === "record-sub") await actions.get("set-total")({ contributionType: "subs", value: 49 });
      await actions.get(sample.action)({ ...sample.data, eventKey: "demo-" + String(Date.now()) });
      if (sample.action === "record-sub") {
        setTimeout(() => { void actions.get("set-total")({ contributionType: "subs", value: 38 }); }, config.celebrationSeconds * 1000 + 500);
      }
    })();
  }, 7000);
}

async function shutdown() {
  await plugin.deactivate();
  process.exit(0);
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
