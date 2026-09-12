(function () {
  "use strict";

  const pathToView = {
    "/": "brb-stage",
    "/overlay/brb-stage": "brb-stage",
    "/overlay/goals-footer": "goals-footer",
    "/overlay/goals-totem": "goals-totem",
    "/overlay/progress-triple": "progress-triple",
    "/overlay/progress-pill": "progress-pill",
    "/overlay/timer-giant": "timer-giant",
    "/overlay/alerts": "alerts",
  };
  const labels = { donate: "Donate", subs: "Subs", bits: "Bits" };
  const params = new URLSearchParams(window.location.search);
  const view = pathToView[window.location.pathname] || "brb-stage";
  const active = document.querySelector('[data-view="' + view + '"]');
  if (active) active.classList.add("is-active");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Toasts, banners and confetti live on their own Browser Source
  // (/overlay/alerts) so they never cover a goal card or the mascot. A single
  // source setup opts back in with ?alerts=1 on any other overlay.
  const alertsEnabled = view === "alerts" || ["1", "true", "yes"].includes(String(params.get("alerts") || "").toLowerCase());
  const ALERT_POSITIONS = ["top-right", "top-left", "top-center", "bottom-right", "bottom-left", "bottom-center"];

  const scale = Number(params.get("scale"));
  if (Number.isFinite(scale) && scale >= 0.5 && scale <= 2) {
    document.documentElement.style.setProperty("--overlay-scale", String(scale));
  }

  let effects = { enabled: true, celebrateGoals: true, celebrateContributions: true, celebrationSeconds: 6 };
  let firstRender = true;
  const lastTimerText = new Map();

  function setText(selector, value) {
    const text = value === undefined || value === null ? "" : String(value);
    for (const element of document.querySelectorAll(selector)) {
      if (element.classList.contains("marquee")) {
        setMarqueeText(element, text);
        continue;
      }
      element.textContent = text;
    }
  }

  /**
   * Long titles scroll instead of ending in an ellipsis. The text lives in an
   * inner span so only the span moves (transform), and a title is re-measured
   * only when its text changes, so the state push every second never restarts
   * the animation.
   */
  function setMarqueeText(element, text) {
    let inner = element.querySelector(".marquee__inner");
    if (!inner) {
      element.replaceChildren();
      inner = append(element, "span", "marquee__inner", text);
    } else if (inner.textContent === text) {
      return;
    } else {
      inner.textContent = text;
    }
    element.dataset.marqueeDirty = "1";
  }

  function appendMarquee(parent, tag, className, text) {
    const element = append(parent, tag, (className ? className + " " : "") + "marquee");
    append(element, "span", "marquee__inner", text);
    element.dataset.marqueeDirty = "1";
    return element;
  }

  function applyMarquees() {
    for (const element of document.querySelectorAll(".marquee[data-marquee-dirty]")) {
      delete element.dataset.marqueeDirty;
      const inner = element.querySelector(".marquee__inner");
      if (!inner) continue;
      element.classList.remove("is-scrolling");
      element.style.removeProperty("--marquee-shift");
      element.style.removeProperty("--marquee-duration");
      const overflow = inner.scrollWidth - element.clientWidth;
      if (overflow > 2 && motionAllowed()) {
        element.style.setProperty("--marquee-shift", String(-overflow) + "px");
        element.style.setProperty("--marquee-duration", String(Math.max(5, Math.round(overflow / 22))) + "s");
        element.classList.add("is-scrolling");
      }
    }
  }

  function setFill(selector, value) {
    const safe = Math.min(100, Math.max(0, Number(value) || 0));
    for (const element of document.querySelectorAll(selector)) {
      element.style.setProperty("--fill", String(safe / 100));
      element.classList.toggle("is-complete", safe >= 100);
    }
  }

  function splitTitle(title) {
    const words = String(title || "A LIVE JÁ VOLTA!").trim().split(/\s+/);
    const pivot = words.length >= 4 ? 2 : Math.max(1, Math.ceil(words.length / 2));
    return [words.slice(0, pivot).join(" "), words.slice(pivot).join(" ")];
  }

  function append(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    parent.appendChild(node);
    return node;
  }

  function motionAllowed() {
    return effects.enabled && !reducedMotion.matches;
  }

  /**
   * Each digit lives in its own span, so a change rolls only that digit.
   * Separators never animate. Cheap enough to run every second.
   */
  function renderTimer(selector, formatted) {
    for (const element of document.querySelectorAll(selector)) {
      const previous = lastTimerText.get(element) || "";
      if (previous.length !== formatted.length) {
        element.replaceChildren();
        for (const char of formatted) {
          append(element, "span", /\d/.test(char) ? "digit" : "digit digit--sep", char);
        }
        lastTimerText.set(element, formatted);
        continue;
      }
      const spans = element.children;
      for (let index = 0; index < formatted.length; index += 1) {
        const char = formatted[index];
        const span = spans[index];
        if (!span || span.textContent === char) continue;
        span.textContent = char;
        if (motionAllowed()) {
          span.classList.remove("is-rolling");
          void span.offsetWidth;
          span.classList.add("is-rolling");
        }
      }
      lastTimerText.set(element, formatted);
    }
  }

  function staggerIn(list) {
    if (!firstRender || !motionAllowed()) return;
    let index = 0;
    for (const child of list.children) {
      child.style.setProperty("--enter-delay", String(Math.min(index * 45, 320)) + "ms");
      child.classList.add("is-entering");
      index += 1;
    }
  }

  function unchanged(list, signature) {
    if (list.dataset.signature === signature) return true;
    list.dataset.signature = signature;
    return false;
  }

  function renderFooterGoals(goals) {
    const list = document.querySelector("[data-goals-footer-list]");
    if (!list) return;
    if (unchanged(list, JSON.stringify(goals.map((goal) => [goal.id, goal.status, goal.progress, goal.title, goal.targetLabel])))) return;
    list.replaceChildren();
    for (const goal of goals) {
      const item = append(list, "article", "footer-goal glass-card footer-goal--" + goal.status + " goal--" + goal.type);
      item.dataset.goalId = goal.id;
      const copy = append(item, "div", "footer-goal__copy");
      appendMarquee(copy, "strong", "", goal.title);
      append(copy, "span", "", goal.targetLabel);
      const bar = append(item, "div", "footer-goal__bar");
      const fill = append(bar, "i", "bar-fill");
      fill.style.setProperty("--fill", String(goal.progress / 100));
      if (goal.completed) append(item, "span", "goal-check");
    }
    staggerIn(list);
  }

  function renderTotem(state) {
    const list = document.querySelector("[data-goals-totem-list]");
    if (!list) return;
    const pending = state.goals.filter(function (goal) { return !goal.completed; });
    const source = pending.length ? pending : state.goals.slice().reverse();
    const goals = source.slice(0, state.display.maxTotemGoals);
    const summary = String(state.completedGoals) + " de " + String(state.goals.length) + " concluídas";
    const nextLabel = state.currentGoal && !state.currentGoal.completed ? "Atual: " + state.currentGoal.title : "Todas as metas concluídas";
    if (unchanged(list, JSON.stringify([goals.map((goal) => [goal.id, goal.status, goal.progress, goal.title, goal.amountLabel]), summary, nextLabel]))) return;
    list.replaceChildren();
    for (const [displayIndex, goal] of goals.entries()) {
      const card = append(list, "article", "totem-card glass-card totem-card--" + goal.type + " goal--" + goal.type + (goal.status === "current" ? " is-current" : ""));
      card.dataset.goalId = goal.id;
      append(card, "div", "totem-card__index", String(displayIndex + 1).padStart(2, "0"));
      const content = append(card, "div", "totem-card__content");
      const meta = append(content, "div", "totem-card__meta");
      append(meta, "span", "", labels[goal.type] || goal.type);
      append(meta, "b", "", goal.amountLabel);
      appendMarquee(content, "h2", "", goal.title);
      const bar = append(content, "div", "totem-card__bar");
      const fill = append(bar, "i", "bar-fill");
      fill.style.setProperty("--fill", String(goal.progress / 100));
      append(card, "strong", "totem-card__percent", String(goal.progress) + "%");
    }
    staggerIn(list);
    setText("[data-completed-summary]", summary);
    setText("[data-totem-next]", nextLabel);
  }

  function renderScoreboard(score) {
    const board = document.querySelector("[data-scoreboard]");
    if (!board) return;
    if (unchanged(board, JSON.stringify(["donate", "subs", "bits"].map((type) => [score[type].currentLabel, score[type].progress])))) return;
    board.replaceChildren();
    for (const type of ["donate", "subs", "bits"]) {
      const item = score[type];
      const card = append(board, "article", "score-card glass-card score-card--" + type + " goal--" + type);
      card.dataset.scoreType = type;
      append(card, "span", "", labels[type]);
      append(card, "strong", "", item.currentLabel);
      const bar = append(card, "div", "score-card__bar");
      const fill = append(bar, "i", "bar-fill");
      fill.style.setProperty("--fill", String(item.progress / 100));
      card.setAttribute("aria-label", labels[type] + ": " + item.currentLabel + " de " + item.targetLabel);
    }
    staggerIn(board);
  }

  function renderTransparency(state) {
    if (params.has("transparent")) {
      const value = String(params.get("transparent")).toLowerCase();
      document.body.classList.toggle("is-transparent", !["0", "false", "no"].includes(value));
      return;
    }
    const group = view.indexOf("goals-") === 0
      ? "goals"
      : view.indexOf("progress-") === 0
        ? "progress"
        : view.indexOf("timer-") === 0
          ? "timer"
          : "brb";
    document.body.classList.toggle("is-transparent", Boolean(state.display.transparent[group]));
  }

  function render(state) {
    effects = Object.assign({}, effects, state.display.effects || {});
    document.body.classList.toggle("fx-on", motionAllowed());
    document.body.classList.toggle("alerts-on", alertsEnabled);
    const requestedPosition = String(params.get("position") || "");
    document.body.dataset.alertsPosition = ALERT_POSITIONS.includes(requestedPosition)
      ? requestedPosition
      : (effects.alertsPosition || "top-right");
    document.body.classList.toggle("is-final-stretch", Boolean(state.timer.inFinalStretch));
    document.body.classList.toggle("is-paused", !state.timer.running);
    document.body.classList.toggle("is-finished", state.timer.remainingSeconds === 0);
    renderTransparency(state);
    renderTimer("[data-timer]", state.timer.formatted);
    setText(
      "[data-timer-status]",
      state.timer.remainingSeconds === 0 ? "SUBATHON ENCERRADO" : state.timer.running ? "SUBATHON AO VIVO" : "TIMER PAUSADO",
    );
    const lastSupport = state.lastSupport
      ? "Último apoio: " + state.lastSupport.actorName + " · +" + formatAddedTime(state.lastSupport.secondsAdded)
      : "À espera do próximo apoio";
    setText("[data-last-support]", lastSupport);

    const copy = state.display.copy;
    setText('[data-copy="eyebrow"]', copy.eyebrow);
    const title = splitTitle(copy.title);
    setText('[data-copy="title-first"]', title[0]);
    setText('[data-copy="title-second"]', title[1]);
    setText('[data-copy="subtitle"]', copy.subtitle);
    setText('[data-copy="status"]', copy.status);

    const goal = state.currentGoal && !state.currentGoal.completed ? state.currentGoal : null;
    const next = state.nextGoal;
    setText("[data-current-goal-title]", goal ? goal.title : "Todas as metas concluídas");
    setText("[data-current-goal-amount]", goal ? goal.amountLabel : "100%");
    setText("[data-current-goal-percent]", goal ? String(goal.progress) + "%" : "100%");
    setFill("[data-current-goal-fill]", goal ? goal.progress : 100);
    setText("[data-next-goal-title]", next ? next.title : "Última meta");
    for (const card of document.querySelectorAll("[data-goal-card]")) {
      card.className = card.className.replace(/\bgoal--\w+\b/g, "").trim() + (goal ? " goal--" + goal.type : "");
    }

    setText("[data-pill-kind]", goal ? labels[goal.type] : "Comunidade");
    setText("[data-pill-amount]", goal ? goal.amountLabel.replace(" / ", " de ") : "Metas concluídas");
    setText("[data-pill-title]", goal ? goal.title : "Subathon completo");
    setText("[data-pill-percent]", goal ? String(goal.progress) + "%" : "100%");
    setFill("[data-pill-fill]", goal ? goal.progress : 100);

    renderFooterGoals(state.goals);
    renderTotem(state);
    renderScoreboard(state.score);
    document.body.classList.add("is-ready");
    firstRender = false;
    applyMarquees();
  }

  function formatAddedTime(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const rest = safe % 60;
    return [hours, minutes, rest].map(function (part) {
      return String(part).padStart(2, "0");
    }).join(":");
  }

  /* Contribution toast: emerges beside the timer, leaves quickly. */
  function showToast(support) {
    if (!alertsEnabled || !effects.celebrateContributions) return;
    const stack = document.querySelector("[data-toast-stack]");
    if (!stack) return;
    while (stack.children.length >= 3) stack.removeChild(stack.firstChild);
    const toast = append(stack, "div", "toast goal--" + support.type);
    append(toast, "strong", "toast__time", "+" + formatAddedTime(support.secondsAdded));
    const copy = append(toast, "div", "toast__copy");
    append(copy, "span", "toast__name", support.actorName || "Apoiador");
    append(copy, "small", "toast__value", (support.valueLabel || "") + (support.tier ? " · Tier " + support.tier.charAt(0) : ""));
    requestAnimationFrame(function () { toast.classList.add("is-in"); });
    pulseTimer();
    window.setTimeout(function () {
      toast.classList.remove("is-in");
      toast.classList.add("is-out");
      window.setTimeout(function () { toast.remove(); }, 260);
    }, Math.max(2000, effects.celebrationSeconds * 1000));
  }

  function pulseTimer() {
    if (!motionAllowed()) return;
    for (const element of document.querySelectorAll("[data-timer]")) {
      element.classList.remove("is-boost");
      void element.offsetWidth;
      element.classList.add("is-boost");
    }
  }

  let bannerTimer = 0;
  function showBanner(kind, eyebrow, title, detail, duration) {
    const banner = document.querySelector("[data-celebration]");
    if (!banner) return;
    window.clearTimeout(bannerTimer);
    banner.className = "celebration celebration--" + kind;
    setText("[data-celebration-eyebrow]", eyebrow);
    setText("[data-celebration-title]", title);
    setText("[data-celebration-next]", detail);
    banner.hidden = false;
    requestAnimationFrame(function () { banner.classList.add("is-in"); });
    bannerTimer = window.setTimeout(function () {
      banner.classList.remove("is-in");
      banner.classList.add("is-out");
      bannerTimer = window.setTimeout(function () { banner.hidden = true; }, 320);
    }, duration);
  }

  function celebrateGoal(payload) {
    if (!effects.celebrateGoals) return;
    const duration = Math.max(2000, effects.celebrationSeconds * 1000);
    for (const card of document.querySelectorAll('[data-goal-id="' + payload.goalId + '"]')) {
      card.classList.add("is-celebrating");
      window.setTimeout(function () { card.classList.remove("is-celebrating"); }, duration);
    }
    if (!alertsEnabled) return;
    showBanner(
      "goal",
      "Meta concluída",
      payload.title,
      payload.nextTitle ? "Próxima: " + payload.nextTitle : "Todas as metas concluídas",
      duration,
    );
    launchConfetti(duration);
  }

  /* Confetti on a 2D canvas: transform-only work, stops itself when every piece has fallen. */
  let confettiFrame = 0;
  function launchConfetti(duration) {
    if (!motionAllowed()) return;
    const canvas = document.querySelector("[data-confetti]");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const styles = getComputedStyle(document.documentElement);
    const palette = ["--coral", "--purple", "--cyan", "--text"].map(function (name) {
      return styles.getPropertyValue(name).trim() || "#ffffff";
    });
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(canvas.clientWidth * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
    const width = canvas.width;
    const height = canvas.height;
    const pieces = [];
    const count = Math.round(Math.min(220, Math.max(120, width / 9)));
    for (let index = 0; index < count; index += 1) {
      const fromLeft = index % 2 === 0;
      pieces.push({
        x: fromLeft ? -20 : width + 20,
        y: height * (0.55 + Math.random() * 0.35),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9) * ratio,
        vy: -(11 + Math.random() * 9) * ratio,
        size: (5 + Math.random() * 7) * ratio,
        color: palette[index % palette.length],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        wobble: Math.random() * Math.PI * 2,
        round: Math.random() < 0.3,
      });
    }
    const gravity = 0.32 * ratio;
    const drag = 0.985;
    const startedAt = performance.now();
    canvas.classList.add("is-active");
    cancelAnimationFrame(confettiFrame);
    function frame(now) {
      context.clearRect(0, 0, width, height);
      let alive = 0;
      const elapsed = now - startedAt;
      const fade = elapsed > duration - 800 ? Math.max(0, (duration - elapsed) / 800) : 1;
      for (const piece of pieces) {
        piece.vy += gravity;
        piece.vx *= drag;
        piece.vy *= drag;
        piece.x += piece.vx + Math.sin(piece.wobble) * ratio;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        piece.wobble += 0.12;
        if (piece.y < height + 40 && elapsed < duration) alive += 1;
        context.save();
        context.globalAlpha = fade;
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        if (piece.round) {
          context.beginPath();
          context.arc(0, 0, piece.size / 2, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        }
        context.restore();
      }
      if (alive > 0) {
        confettiFrame = requestAnimationFrame(frame);
      } else {
        context.clearRect(0, 0, width, height);
        canvas.classList.remove("is-active");
      }
    }
    confettiFrame = requestAnimationFrame(frame);
  }

  function flashWarning(payload) {
    if (motionAllowed()) {
      document.body.classList.remove("is-warning");
      void document.body.offsetWidth;
      document.body.classList.add("is-warning");
      window.setTimeout(function () { document.body.classList.remove("is-warning"); }, 2400);
    }
    if (alertsEnabled && payload) {
      showBanner("warning", "Reta final", "Restam " + payload.formatted, "O cronômetro segue até zerar", Math.max(2000, effects.celebrationSeconds * 1000));
    }
  }

  function announceFinished(payload) {
    pulseTimer();
    if (alertsEnabled && payload) {
      showBanner("finished", "Subathon encerrado", "00:00:00", "Obrigado a quem apoiou", Math.max(4000, effects.celebrationSeconds * 1000));
    }
  }

  async function loadState() {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + String(response.status));
    render(await response.json());
  }

  loadState().catch(function (error) {
    console.error("CatOPanda overlay state error", error);
    document.body.classList.add("is-ready");
  });

  function parse(event) {
    try {
      return JSON.parse(event.data);
    } catch (error) {
      console.error("CatOPanda overlay event error", error);
      return null;
    }
  }

  const events = new EventSource("/events");
  events.addEventListener("state", function (event) {
    const state = parse(event);
    if (state) render(state);
  });
  events.addEventListener("contribution", function (event) {
    const support = parse(event);
    if (support) showToast(support);
  });
  events.addEventListener("goal-completed", function (event) {
    const payload = parse(event);
    if (payload) celebrateGoal(payload);
  });
  events.addEventListener("timer-warning", function (event) {
    flashWarning(parse(event));
  });
  events.addEventListener("timer-finished", function (event) {
    announceFinished(parse(event));
  });
  events.addEventListener("error", function () {
    window.setTimeout(function () {
      loadState().catch(function () {});
    }, 1500);
  });
})();
