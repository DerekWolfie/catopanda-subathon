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
    "/overlay/goals-active": "goals-active",
    "/overlay/goals-list": "goals-list",
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

  /**
   * A scale from the URL, kept exactly as typed: 0.13, 0,13 or 1.375 all work. Values
   * outside 0.05 to 5 are held at the nearest limit; anything that is not a positive
   * number is ignored. The parameter name is matched without regard to case.
   */
  function scaleFromQuery(name) {
    for (const [key, raw] of params) {
      if (key.toLowerCase() !== name) continue;
      const value = Number(String(raw).trim().replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) return null;
      return Math.min(5, Math.max(0.05, value));
    }
    return null;
  }

  const scale = scaleFromQuery("scale");
  if (scale !== null) document.documentElement.style.setProperty("--overlay-scale", String(scale));

  // The banners live outside the views, so ?scale leaves them alone; ?bannerScale sizes them.
  const bannerScale = scaleFromQuery("bannerscale");
  if (bannerScale !== null) document.documentElement.style.setProperty("--banner-scale", String(bannerScale));

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

  /** One class per goal stage; a goal on its way keeps the current/next split of 0.4. */
  function stageClass(prefix, goal) {
    if (goal.stage === "in-progress") return prefix + "--active";
    if (goal.stage === "done") return prefix + "--done";
    if (goal.stage === "reached") return prefix + "--reached";
    return prefix + "--" + goal.status;
  }

  function renderFooterGoals(goals) {
    const list = document.querySelector("[data-goals-footer-list]");
    if (!list) return;
    if (unchanged(list, JSON.stringify(goals))) return;
    // Update cards in place so contributions never restart the footer or titles.
    const existing = new Map(Array.from(list.children, (item) => [item.dataset.goalId, item]));
    for (const [index, goal] of goals.entries()) {
      let item = existing.get(goal.id);
      if (!item) {
        item = document.createElement("article");
        const copy = append(item, "div", "footer-goal__copy");
        appendMarquee(copy, "strong", "", goal.title);
        append(copy, "span", "", goal.targetLabel);
        append(append(item, "div", "footer-goal__bar"), "i", "bar-fill");
      }
      existing.delete(goal.id);
      if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
      item.className = "footer-goal glass-card " + stageClass("footer-goal", goal) + " goal--" + goal.type;
      item.dataset.goalId = goal.id;
      setMarqueeText(item.querySelector("strong"), goal.title);
      item.querySelector(".footer-goal__copy > span").textContent = goal.stage === "open"
        ? goal.targetLabel
        : goal.targetLabel + " · " + goal.stageLabel;
      const fill = item.querySelector(".bar-fill");
      fill.style.setProperty("--fill", String(goal.progress / 100));
      const showCheck = goal.stage === "reached" || goal.stage === "done";
      const check = item.querySelector(".goal-check");
      if (showCheck && !check) append(item, "span", "goal-check");
      if (!showCheck && check) check.remove();
      const badge = item.querySelector(".goal-live");
      if (goal.active && !badge) append(item, "span", "goal-live", "Em andamento");
      if (!goal.active && badge) badge.remove();
    }
    for (const item of existing.values()) item.remove();
    staggerIn(list);
  }

  /**
   * Scrolls an overflowing track back and forth with a pause at each end, never
   * duplicating cards. Pauses while the pointer or keyboard focus is inside.
   */
  function autoScroll(viewport, track, axis, pixelsPerSecond) {
    let animation = null;
    let distance = 0;
    const translate = axis === "y" ? "translateY" : "translateX";

    function sync(restart) {
      const size = axis === "y"
        ? track.scrollHeight - viewport.clientHeight
        : track.scrollWidth - viewport.clientWidth;
      const nextDistance = Math.max(0, size);
      const shouldScroll = motionAllowed() && nextDistance > 2;
      if (!restart && shouldScroll && animation && distance === nextDistance) return;
      if (animation) animation.cancel();
      animation = null;
      distance = nextDistance;
      viewport.classList.toggle("is-scrolling", shouldScroll);
      if (!shouldScroll) return;
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      // Alternating iterations meet at each end, so two one-second holds add up.
      const duration = distance / pixelsPerSecond * 1000 + 2000;
      const pause = 1000 / duration;
      animation = track.animate([
        { transform: translate + "(0)", offset: 0 },
        { transform: translate + "(0)", offset: pause },
        { transform: translate + "(" + String(-distance) + "px)", offset: 1 - pause },
        { transform: translate + "(" + String(-distance) + "px)", offset: 1 },
      ], { duration, iterations: Infinity, direction: "alternate", easing: "linear" });
      if (viewport.matches(":hover, :focus-within")) animation.pause();
    }

    new ResizeObserver(function () { sync(false); }).observe(viewport);
    new ResizeObserver(function () { sync(false); }).observe(track);
    reducedMotion.addEventListener("change", function () { sync(false); });
    for (const event of ["pointerenter", "focusin"]) {
      viewport.addEventListener(event, function () { if (animation) animation.pause(); });
    }
    for (const event of ["pointerleave", "focusout"]) {
      viewport.addEventListener(event, function () {
        if (animation && !viewport.matches(":hover, :focus-within")) animation.play();
      });
    }
    return sync;
  }

  const footerViewport = view === "goals-footer" ? document.querySelector("[data-goals-footer-viewport]") : null;
  const syncFooterScroll = footerViewport
    ? autoScroll(footerViewport, footerViewport.querySelector("[data-goals-footer-list]"), "x", 32)
    : function () {};

  const listSpeed = Number(params.get("speed"));
  const listViewport = view === "goals-list" ? document.querySelector("[data-goals-list-viewport]") : null;
  const syncListScroll = listViewport
    ? autoScroll(
      listViewport,
      listViewport.querySelector("[data-goals-list]"),
      "y",
      Number.isFinite(listSpeed) && listSpeed >= 8 && listSpeed <= 200 ? listSpeed : 28,
    )
    : function () {};

  /** In progress first, then everything not done yet, then what is done; config order inside each group. */
  function listOrder(goals) {
    const rank = function (goal) { return goal.active ? 0 : goal.execution === "done" ? 2 : 1; };
    return goals
      .map(function (goal, index) { return [goal, index]; })
      .sort(function (a, b) { return rank(a[0]) - rank(b[0]) || a[1] - b[1]; })
      .map(function (entry) { return entry[0]; });
  }

  function listChip(goal) {
    if (goal.stage !== "open") return goal.stageLabel;
    return goal.status === "current" ? "Próxima" : "";
  }

  function goalSummary(state) {
    const counts = state.goalCounts || {};
    const total = state.goals.length;
    if (!total) return "Nenhuma meta configurada";
    return String(counts.reached || 0) + " de " + String(total) + " alcançadas · "
      + String(counts.done || 0) + (counts.done === 1 ? " concluída" : " concluídas");
  }

  let listFirstId = "";
  function renderGoalsList(state) {
    const list = document.querySelector("[data-goals-list]");
    if (!list) return;
    setText("[data-goals-list-summary]", goalSummary(state));
    const goals = listOrder(state.goals);
    if (unchanged(list, JSON.stringify(goals))) return;
    // Rows move in place, so a contribution never restarts the scroll or a title.
    const existing = new Map(Array.from(list.children, (item) => [item.dataset.goalId, item]));
    for (const [index, goal] of goals.entries()) {
      let item = existing.get(goal.id);
      if (!item) {
        item = document.createElement("li");
        append(item, "span", "list-goal__marker").setAttribute("aria-hidden", "true");
        const body = append(item, "div", "list-goal__body");
        const meta = append(body, "p", "list-goal__meta");
        append(meta, "span", "list-goal__kind");
        append(meta, "b", "list-goal__chip");
        appendMarquee(body, "strong", "list-goal__title", goal.title);
        const progress = append(body, "div", "list-goal__progress");
        append(append(progress, "div", "list-goal__bar"), "i", "bar-fill");
        append(progress, "span", "list-goal__amount");
        append(item, "strong", "list-goal__percent");
      }
      existing.delete(goal.id);
      if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
      item.className = "list-goal glass-card " + stageClass("list-goal", goal) + " goal--" + goal.type;
      item.dataset.goalId = goal.id;
      item.querySelector(".list-goal__kind").textContent = labels[goal.type] || goal.type;
      const chip = listChip(goal);
      const chipElement = item.querySelector(".list-goal__chip");
      chipElement.textContent = chip;
      chipElement.hidden = !chip;
      setMarqueeText(item.querySelector(".list-goal__title"), goal.title);
      item.querySelector(".list-goal__amount").textContent = goal.reached ? goal.targetLabel : goal.amountLabel;
      item.querySelector(".list-goal__percent").textContent = String(goal.progress) + "%";
      item.querySelector(".bar-fill").style.setProperty("--fill", String(goal.progress / 100));
    }
    for (const item of existing.values()) item.remove();
    staggerIn(list);
    // A new goal in progress moves to the top; start from there so it is seen first.
    const firstId = goals.length ? goals[0].id : "";
    const restart = firstId !== listFirstId;
    listFirstId = firstId;
    syncListScroll(restart);
  }

  let activeGoalId = "";
  function renderActiveGoal(state) {
    const card = document.querySelector("[data-active-goal]");
    if (!card) return;
    const goal = state.activeGoal;
    card.classList.toggle("is-empty", !goal);
    if (!goal) {
      activeGoalId = "";
      return;
    }
    card.className = card.className.replace(/\bgoal--\w+\b/g, "").trim() + " goal--" + goal.type;
    card.dataset.goalId = goal.id;
    setText("[data-active-goal-title]", goal.title);
    setText("[data-active-goal-kind]", labels[goal.type] || goal.type);
    setText("[data-active-goal-amount]", goal.reached ? "Meta de " + goal.targetLabel : goal.amountLabel);
    if (!firstRender && goal.id !== activeGoalId && motionAllowed()) {
      card.classList.remove("is-celebrating");
      void card.offsetWidth;
      card.classList.add("is-celebrating");
      window.setTimeout(function () { card.classList.remove("is-celebrating"); }, 1200);
    }
    activeGoalId = goal.id;
  }

  function renderTotem(state) {
    const list = document.querySelector("[data-goals-totem-list]");
    if (!list) return;
    // The goal in progress leads, then the goals still on their way.
    const active = state.goals.filter(function (goal) { return goal.active; });
    const pending = state.goals.filter(function (goal) { return !goal.completed && !goal.active; });
    const source = active.length || pending.length ? active.concat(pending) : state.goals.slice().reverse();
    const goals = source.slice(0, state.display.maxTotemGoals);
    const counts = state.goalCounts || {};
    const summary = String(counts.reached || 0) + "/" + String(state.goals.length) + " alcançadas";
    const nextLabel = state.activeGoal
      ? "Em andamento: " + state.activeGoal.title
      : state.currentGoal && !state.currentGoal.completed ? "Atual: " + state.currentGoal.title : "Todas as metas alcançadas";
    if (unchanged(list, JSON.stringify([goals.map((goal) => [goal.id, goal.status, goal.stage, goal.progress, goal.title, goal.amountLabel]), summary, nextLabel]))) return;
    list.replaceChildren();
    for (const [displayIndex, goal] of goals.entries()) {
      const focus = goal.active ? " is-active" : goal.status === "current" ? " is-current" : "";
      const card = append(list, "article", "totem-card glass-card totem-card--" + goal.type + " goal--" + goal.type + focus);
      card.dataset.goalId = goal.id;
      append(card, "div", "totem-card__index", String(displayIndex + 1).padStart(2, "0"));
      const content = append(card, "div", "totem-card__content");
      const meta = append(content, "div", "totem-card__meta");
      append(meta, "span", "", goal.active ? "Em andamento · " + (labels[goal.type] || goal.type) : labels[goal.type] || goal.type);
      append(meta, "b", "", goal.reached ? goal.targetLabel : goal.amountLabel);
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
    // A category with no goal configured has nothing to fill, so it is not shown.
    const types = ["donate", "subs", "bits"].filter((type) => score[type].hasGoals !== false);
    if (unchanged(board, JSON.stringify(types.map((type) => [type, score[type].currentLabel, score[type].progress])))) return;
    board.replaceChildren();
    board.hidden = types.length === 0;
    board.style.setProperty("--score-columns", String(Math.max(1, types.length)));
    for (const type of types) {
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
    setText("[data-added-total]", state.totals.addedLabel || "0min");

    const copy = state.display.copy;
    setText('[data-copy="eyebrow"]', copy.eyebrow);
    const title = splitTitle(copy.title);
    setText('[data-copy="title-first"]', title[0]);
    setText('[data-copy="title-second"]', title[1]);
    setText('[data-copy="subtitle"]', copy.subtitle);
    setText('[data-copy="status"]', copy.status);

    const goal = state.currentGoal && !state.currentGoal.completed ? state.currentGoal : null;
    const next = state.nextGoal;
    setText("[data-current-goal-title]", goal ? goal.title : "Todas as metas alcançadas");
    setText("[data-current-goal-amount]", goal ? goal.amountLabel : "100%");
    setText("[data-current-goal-percent]", goal ? String(goal.progress) + "%" : "100%");
    setFill("[data-current-goal-fill]", goal ? goal.progress : 100);
    setText("[data-next-goal-title]", next ? next.title : "Última meta");
    for (const card of document.querySelectorAll("[data-goal-card]")) {
      card.className = card.className.replace(/\bgoal--\w+\b/g, "").trim() + (goal ? " goal--" + goal.type : "");
    }

    setText("[data-pill-kind]", goal ? labels[goal.type] : "Comunidade");
    setText("[data-pill-amount]", goal ? goal.amountLabel.replace(" / ", " de ") : "Metas alcançadas");
    setText("[data-pill-title]", goal ? goal.title : "Subathon completo");
    setText("[data-pill-percent]", goal ? String(goal.progress) + "%" : "100%");
    setFill("[data-pill-fill]", goal ? goal.progress : 100);

    renderFooterGoals(state.goals);
    syncFooterScroll();
    renderTotem(state);
    renderActiveGoal(state);
    renderGoalsList(state);
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

  /*
   * Banners take the whole alerts layer, centered by default; ?banner=top|center|bottom
   * moves them. One plays at a time: goal banners wait their turn, and several goals
   * of the same kind queued together merge into one. The final stretch and the finish
   * interrupt whatever is on screen, because the clock does not wait.
   */
  const BANNER_POSITIONS = ["top", "center", "bottom"];
  const requestedBanner = String(params.get("banner") || "").toLowerCase();
  document.body.dataset.bannerPosition = BANNER_POSITIONS.includes(requestedBanner) ? requestedBanner : "center";
  const PARTY_EMOJIS = ["🎉", "🥳", "🎊", "🐼", "🐱", "✨", "💜", "🔥", "🙌", "🍾", "⭐", "🎈"];
  const bannerQueue = [];
  let bannerCurrent = null;
  let bannerTimer = 0;

  function bannerDuration(kind) {
    const base = Math.max(2000, effects.celebrationSeconds * 1000);
    if (kind === "finished") return Math.max(15000, base * 2.5);
    if (kind === "goal") return base;
    return Math.max(5000, base);
  }

  function queueBanner(item) {
    if (!alertsEnabled) return;
    if (item.kind === "finished") {
      bannerQueue.length = 0;
      showBanner(item);
      return;
    }
    if (item.kind === "warning") {
      if (bannerCurrent && bannerCurrent.kind === "finished") return;
      // The interrupted goal banner plays again afterwards, so nobody misses it.
      if (bannerCurrent) bannerQueue.unshift(bannerCurrent);
      showBanner(item);
      return;
    }
    const last = bannerQueue[bannerQueue.length - 1];
    if (last && last.kind === item.kind && (item.kind === "goal" || item.kind === "goal-done")) {
      last.titles = last.titles.concat(item.titles);
      return;
    }
    bannerQueue.push(item);
    if (!bannerCurrent) nextBanner();
  }

  function nextBanner() {
    const item = bannerQueue.shift();
    bannerCurrent = null;
    if (item) showBanner(item);
  }

  /** Letters pop one after another; words never break in the middle. */
  function splitLetters(parent, text, colorful) {
    const perLetter = text.length <= 64;
    let index = 0;
    text.split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        parent.appendChild(document.createTextNode(" "));
        return;
      }
      const word = append(parent, "span", "epic__word");
      const pieces = perLetter ? Array.from(part) : [part];
      for (const piece of pieces) {
        const char = append(word, "span", "epic__char" + (colorful ? " epic__char--c" + String(index % 4) : ""), piece);
        char.style.setProperty("--i", String(Math.min(index, 40)));
        index += 1;
      }
    });
  }

  function checkStamp(parent) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "epic__stamp");
    svg.setAttribute("viewBox", "0 0 52 52");
    svg.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("class", "epic__stamp-circle");
    circle.setAttribute("cx", "26");
    circle.setAttribute("cy", "26");
    circle.setAttribute("r", "23");
    const mark = document.createElementNS(ns, "path");
    mark.setAttribute("class", "epic__stamp-mark");
    mark.setAttribute("d", "M14.5 27.5 l8 8 l15.5 -17");
    svg.append(circle, mark);
    parent.appendChild(svg);
  }

  function showBanner(item) {
    const banner = document.querySelector("[data-celebration]");
    if (!banner) return;
    window.clearTimeout(bannerTimer);
    bannerCurrent = item;
    const titles = item.titles || [item.title];
    const title = titles.length > 1 && item.pluralTitle ? item.pluralTitle(titles.length) : titles[0];
    const detail = titles.length > 1 ? titles.join(" · ") : item.detail;
    const duration = bannerDuration(item.kind);

    banner.replaceChildren();
    banner.className = "celebration celebration--" + item.kind;
    banner.style.setProperty("--epic-duration", String(duration) + "ms");
    const decor = append(banner, "div", "epic__decor");
    decor.setAttribute("aria-hidden", "true");
    append(decor, "i", "epic__flash");
    if (item.kind === "warning") append(decor, "i", "epic__vignette");
    if (item.kind === "finished") append(decor, "i", "epic__disco");
    const beams = append(decor, "div", "epic__beams");
    append(beams, "i");
    append(beams, "i");
    if (item.kind === "finished") {
      const party = append(decor, "div", "epic__party");
      for (let index = 0; index < 28; index += 1) {
        const emoji = append(party, "span", "", PARTY_EMOJIS[index % PARTY_EMOJIS.length]);
        emoji.style.setProperty("--x", String(Math.round(Math.random() * 96) + 2) + "%");
        emoji.style.setProperty("--delay", String(Math.round(Math.random() * 4000)) + "ms");
        emoji.style.setProperty("--dur", String(Math.round(3800 + Math.random() * 3200)) + "ms");
        emoji.style.setProperty("--size", String((2.2 + Math.random() * 2.6).toFixed(2)) + "cqw");
        emoji.style.setProperty("--spin", String(Math.round((Math.random() - 0.5) * 120)) + "deg");
      }
    }

    const stage = append(banner, "div", "epic__stage");
    const rays = append(stage, "i", "epic__rays");
    rays.setAttribute("aria-hidden", "true");
    const rings = append(stage, "div", "epic__rings");
    rings.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) append(rings, "i");
    if (item.kind === "goal-done") {
      const stars = append(stage, "div", "epic__stars");
      stars.setAttribute("aria-hidden", "true");
      for (let index = 0; index < 8; index += 1) append(stars, "i");
    }
    const card = append(stage, "div", "epic__card");
    const shine = append(card, "i", "epic__shine");
    shine.setAttribute("aria-hidden", "true");
    if (item.kind === "warning") {
      append(card, "i", "epic__hazard epic__hazard--top").setAttribute("aria-hidden", "true");
      append(card, "i", "epic__hazard epic__hazard--bottom").setAttribute("aria-hidden", "true");
    }
    if (item.kind === "goal-done") checkStamp(card);
    append(card, "span", "epic__eyebrow", item.eyebrow);
    const titleElement = append(card, "strong", "epic__title");
    splitLetters(titleElement, title, item.kind === "finished");
    // The cascade finishes within about a second however long the title is.
    titleElement.style.setProperty("--step", String(Math.max(12, Math.min(32, Math.round(900 / Math.max(1, title.length))))) + "ms");
    if (detail) append(card, "span", "epic__detail", detail);
    if (item.sticker) append(card, "span", "epic__sticker", item.sticker);

    banner.hidden = false;
    void banner.offsetWidth;
    banner.classList.add("is-in");
    if (item.onShow) item.onShow(duration);
    bannerTimer = window.setTimeout(function () {
      banner.classList.remove("is-in");
      banner.classList.add("is-out");
      bannerTimer = window.setTimeout(function () {
        banner.hidden = true;
        banner.replaceChildren();
        nextBanner();
      }, 600);
    }, duration);
  }

  function highlightGoalCards(goalId, duration) {
    for (const card of document.querySelectorAll('[data-goal-id="' + goalId + '"]')) {
      card.classList.add("is-celebrating");
      window.setTimeout(function () { card.classList.remove("is-celebrating"); }, duration);
    }
  }

  function goalDetail(payload) {
    return (labels[payload.type] || payload.type) + " · " + payload.targetLabel;
  }

  function celebrateGoal(payload) {
    if (!effects.celebrateGoals) return;
    highlightGoalCards(payload.goalId, bannerDuration("goal"));
    queueBanner({
      kind: "goal",
      eyebrow: "Meta alcançada",
      titles: [payload.title],
      pluralTitle: function (count) { return String(count) + " metas alcançadas"; },
      detail: payload.nextTitle ? "Próxima: " + payload.nextTitle : "Todas as metas alcançadas",
      sticker: "BATEMOS!",
      onShow: function (duration) {
        confettiCannons(1);
        runConfetti(duration);
      },
    });
  }

  /* Starting or finishing a goal is news for the audience; returning one to pending is not. */
  function announceGoalStatus(payload) {
    if (!effects.celebrateGoals || payload.status === "pending") return;
    const done = payload.status === "done";
    highlightGoalCards(payload.goalId, bannerDuration(done ? "goal-done" : "goal-active"));
    if (done) {
      queueBanner({
        kind: "goal-done",
        eyebrow: "Meta concluída",
        titles: [payload.title],
        pluralTitle: function (count) { return String(count) + " metas concluídas"; },
        detail: goalDetail(payload),
        sticker: "FEITO!",
        onShow: function (duration) {
          confettiCannons(1.6);
          runConfetti(duration, [
            every(900, function () { confettiCannons(0.45); }, 3600),
            every(200, function () { confettiRain(16); }, duration - 1200),
          ]);
        },
      });
      return;
    }
    queueBanner({
      kind: "goal-active",
      eyebrow: "Meta em andamento",
      titles: [payload.title],
      detail: goalDetail(payload),
      sticker: "AGORA!",
    });
  }

  /* ---- Particles: confetti paper and firework sparks on one canvas. ---- */

  const particles = { canvas: null, context: null, ratio: 1, pieces: [], emitters: [], until: 0, frame: 0, palette: [] };
  const MAX_PIECES = 1400;

  function particlesReady() {
    if (!motionAllowed()) return false;
    const canvas = document.querySelector("[data-confetti]");
    const context = canvas && canvas.getContext("2d");
    if (!context || !canvas.clientWidth) return false;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.floor(canvas.clientWidth * ratio);
    const height = Math.floor(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const styles = getComputedStyle(document.documentElement);
    particles.palette = ["--coral", "--purple", "--cyan", "--text"].map(function (name) {
      return styles.getPropertyValue(name).trim() || "#ffffff";
    }).concat(["#ffd166"]);
    particles.canvas = canvas;
    particles.context = context;
    particles.ratio = ratio;
    return true;
  }

  function pickColor() {
    return particles.palette[Math.floor(Math.random() * particles.palette.length)];
  }

  function addPaper(x, y, vx, vy) {
    const ratio = particles.ratio;
    particles.pieces.push({
      x: x, y: y, vx: vx, vy: vy,
      size: (5 + Math.random() * 8) * ratio,
      color: pickColor(),
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.35,
      wobble: Math.random() * Math.PI * 2,
      round: Math.random() < 0.28,
    });
  }

  /** Two cannons from the lower corners; `strength` scales how many pieces fly. */
  function confettiCannons(strength) {
    if (!particlesReady()) return;
    const ratio = particles.ratio;
    const width = particles.canvas.width;
    const height = particles.canvas.height;
    const count = Math.round(Math.min(260, Math.max(120, width / 9)) * strength);
    for (let index = 0; index < count; index += 1) {
      const fromLeft = index % 2 === 0;
      addPaper(
        fromLeft ? -20 : width + 20,
        height * (0.55 + Math.random() * 0.35),
        (fromLeft ? 1 : -1) * (6 + Math.random() * 10) * ratio,
        -(11 + Math.random() * 10) * ratio,
      );
    }
  }

  function confettiRain(count) {
    if (!particlesReady()) return;
    const ratio = particles.ratio;
    const width = particles.canvas.width;
    for (let index = 0; index < count; index += 1) {
      addPaper(Math.random() * width, -20 - Math.random() * 60, (Math.random() - 0.5) * 3 * ratio, (2 + Math.random() * 3) * ratio);
    }
  }

  function firework() {
    if (!particlesReady()) return;
    const ratio = particles.ratio;
    const x = particles.canvas.width * (0.12 + Math.random() * 0.76);
    const y = particles.canvas.height * (0.1 + Math.random() * 0.4);
    const color = pickColor();
    const count = 70;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.2;
      const speed = (2.5 + Math.random() * 5.5) * ratio;
      particles.pieces.push({
        spark: true, x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: (2.2 + Math.random() * 2.2) * ratio,
        color: Math.random() < 0.2 ? "#ffffff" : color,
        life: 1, decay: 0.011 + Math.random() * 0.012,
      });
    }
  }

  /** Runs `task` every `ms` milliseconds, for `lasting` milliseconds after it starts. */
  function every(ms, task, lasting) {
    return { ms: ms, task: task, lasting: lasting, started: 0, last: 0 };
  }

  function runConfetti(duration, emitters) {
    if (!particlesReady()) return;
    const now = performance.now();
    particles.until = Math.max(particles.until, now + duration);
    for (const emitter of emitters || []) {
      emitter.started = now;
      particles.emitters.push(emitter);
    }
    particles.canvas.classList.add("is-active");
    if (!particles.frame) particles.frame = requestAnimationFrame(particleFrame);
  }

  function stopParticles() {
    particles.pieces = [];
    particles.emitters = [];
    particles.until = 0;
  }

  function particleFrame(now) {
    const canvas = particles.canvas;
    const context = particles.context;
    const ratio = particles.ratio;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    particles.emitters = particles.emitters.filter(function (emitter) {
      return now - emitter.started < emitter.lasting && now < particles.until;
    });
    for (const emitter of particles.emitters) {
      if (now - emitter.last >= emitter.ms) {
        emitter.last = now;
        emitter.task();
      }
    }
    const fade = now > particles.until - 800 ? Math.max(0, (particles.until - now) / 800) : 1;
    const alive = [];
    for (const piece of particles.pieces) {
      if (now > particles.until) continue;
      if (piece.spark) {
        piece.vy += 0.07 * ratio;
        piece.vx *= 0.97;
        piece.vy *= 0.97;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.life -= piece.decay;
        if (piece.life <= 0) continue;
        context.globalAlpha = Math.min(1, piece.life * 1.4) * fade;
        context.fillStyle = piece.color;
        context.beginPath();
        context.arc(piece.x, piece.y, piece.size * (0.4 + piece.life * 0.6), 0, Math.PI * 2);
        context.fill();
        alive.push(piece);
        continue;
      }
      piece.vy += 0.32 * ratio;
      piece.vx *= 0.985;
      piece.vy *= 0.985;
      piece.x += piece.vx + Math.sin(piece.wobble) * ratio;
      piece.y += piece.vy;
      piece.rotation += piece.spin;
      piece.wobble += 0.12;
      if (piece.y > height + 40) continue;
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
      alive.push(piece);
    }
    context.globalAlpha = 1;
    particles.pieces = alive.length > MAX_PIECES ? alive.slice(alive.length - MAX_PIECES) : alive;
    if (particles.pieces.length || particles.emitters.length) {
      particles.frame = requestAnimationFrame(particleFrame);
      return;
    }
    context.clearRect(0, 0, width, height);
    canvas.classList.remove("is-active");
    particles.frame = 0;
    particles.until = 0;
  }

  function formatDurationLabel(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return String(hours) + "h " + String(minutes).padStart(2, "0") + "min";
    return String(minutes) + "min";
  }

  function flashWarning(payload) {
    if (motionAllowed()) {
      document.body.classList.remove("is-warning");
      void document.body.offsetWidth;
      document.body.classList.add("is-warning");
      window.setTimeout(function () { document.body.classList.remove("is-warning"); }, 2400);
    }
    if (!payload) return;
    queueBanner({
      kind: "warning",
      eyebrow: "Reta final · restam",
      title: payload.formatted,
      detail: "Cada apoio ainda adiciona tempo ao cronômetro",
    });
  }

  function announceFinished(payload) {
    pulseTimer();
    if (!payload) return;
    const added = payload.totals && payload.totals.addedSeconds;
    stopParticles();
    queueBanner({
      kind: "finished",
      eyebrow: "00:00:00 · acabou!",
      title: "SUBATHON FINALIZADO!",
      detail: added > 0
        ? "Vocês somaram " + formatDurationLabel(added) + " ao cronômetro. Obrigado, comunidade!"
        : "Obrigado, comunidade!",
      sticker: "OBRIGADO!",
      onShow: function (duration) {
        confettiCannons(2);
        firework();
        runConfetti(duration, [
          every(320, function () { confettiRain(16); }, duration - 1500),
          every(650, firework, duration - 2000),
          every(2100, function () { confettiCannons(0.6); }, duration - 2500),
        ]);
      },
    });
  }

  const eventHandlers = {
    contribution: showToast,
    "goal-completed": celebrateGoal,
    "goal-status": announceGoalStatus,
    "timer-warning": flashWarning,
    "timer-finished": announceFinished,
  };

  /*
   * Short requests, never a held connection: an EventSource per overlay used up
   * the six connections Chromium and OBS allow per host, and the seventh
   * Browser Source never loaded. The next poll is scheduled only after the
   * previous one settles, so a slow answer never piles requests up.
   */
  let cursor = null;
  async function poll() {
    const query = cursor === null ? "" : "?since=" + String(cursor);
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 5000);
    try {
      const response = await fetch("/api/poll" + query, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("HTTP " + String(response.status));
      const body = await response.json();
      render(body.state);
      if (cursor !== null) {
        for (const event of body.events) {
          const handler = eventHandlers[event.name];
          if (handler) handler(event.payload);
        }
      }
      cursor = body.seq;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function schedulePoll() {
    poll().then(
      function () { window.setTimeout(schedulePoll, 1000); },
      function (error) {
        console.error("CatOPanda overlay state error", error);
        document.body.classList.add("is-ready");
        window.setTimeout(schedulePoll, 2000);
      },
    );
  }

  schedulePoll();
})();
