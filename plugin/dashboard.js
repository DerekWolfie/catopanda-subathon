(function () {
  "use strict";

  const TYPE_LABELS = { donate: "Donate", subs: "Subs", bits: "Bits" };
  const STATUS_OPTIONS = [
    { value: "pending", label: "Pendente" },
    { value: "in-progress", label: "Em andamento" },
    { value: "done", label: "Concluída" },
  ];
  const FILTERS = [
    { value: "all", label: "Todas", match: function () { return true; } },
    { value: "reached", label: "Alcançadas pendentes", match: function (goal) { return goal.stage === "reached"; } },
    { value: "in-progress", label: "Em andamento", match: function (goal) { return goal.stage === "in-progress"; } },
    { value: "open", label: "A caminho", match: function (goal) { return goal.stage === "open"; } },
    { value: "done", label: "Concluídas", match: function (goal) { return goal.stage === "done"; } },
  ];
  const URL_LABELS = {
    dashboard: "Este painel",
    goalsActive: "Meta em andamento",
    goalsList: "Lista de metas",
    goalsFooter: "Rodapé de metas",
    goalsTotem: "Totem de metas",
    progressTriple: "Placar triplo",
    progressPill: "Pílula de progresso",
    timerGiant: "Cronômetro gigante",
    brbStage: "Palco CatOPanda",
    alerts: "Alertas",
  };

  const $ = function (selector) { return document.querySelector(selector); };
  const busy = new Set();
  let state = null;
  let filter = "all";
  let search = "";
  let bulkArmedUntil = 0;
  let bulkTimer = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function fold(text) {
    return String(text || "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function toast(message, kind) {
    const region = $("[data-toasts]");
    const item = el("p", "toast toast--" + (kind || "info"), message);
    region.appendChild(item);
    while (region.children.length > 3) region.removeChild(region.firstChild);
    window.setTimeout(function () { item.remove(); }, kind === "error" ? 7000 : 3500);
  }

  async function sendStatus(goalId, status) {
    const response = await fetch("/api/goal-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goalId: goalId, status: status }),
      cache: "no-store",
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok || body.ok === false) throw new Error(body.error || "O servidor respondeu " + String(response.status));
    return body;
  }

  /** One request per goal at a time; the buttons of that goal show it is saving. */
  async function changeStatus(key, goalId, status, successMessage) {
    if (busy.has(key)) return;
    busy.add(key);
    render();
    try {
      const result = await sendStatus(goalId, status);
      const label = STATUS_OPTIONS.find(function (option) { return option.value === status; }).label;
      toast(successMessage || (result.title + ": " + label), "success");
    } catch (error) {
      toast("Não foi possível alterar: " + error.message, "error");
    } finally {
      busy.delete(key);
      await refresh();
    }
  }

  /* ---- Timer ---- */

  let timerArmed = { key: "", until: 0 };
  let timerArmTimer = 0;

  function formatSeconds(total) {
    const safe = Math.max(0, Math.round(total));
    return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
      .map(function (part) { return String(part).padStart(2, "0"); }).join(":");
  }

  function describeAmount(seconds) {
    if (seconds % 3600 === 0) return String(seconds / 3600) + " h";
    if (seconds % 60 === 0) return String(seconds / 60) + " min";
    return formatSeconds(seconds);
  }

  async function sendTimer(operation, seconds) {
    const response = await fetch("/api/timer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: operation, seconds: seconds }),
      cache: "no-store",
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok || body.ok === false) throw new Error(body.error || "O servidor respondeu " + String(response.status));
    return body;
  }

  async function changeTimer(operation, seconds, message) {
    if (busy.has("timer")) return;
    busy.add("timer");
    disarmTimer();
    renderTimer();
    try {
      const result = await sendTimer(operation, seconds);
      toast(message + " Agora: " + result.formatted + ".", "success");
    } catch (error) {
      toast("Não foi possível ajustar o cronômetro: " + error.message, "error");
    } finally {
      busy.delete("timer");
      await refresh();
      renderTimer();
    }
  }

  /** "Definir" and "Restaurar" replace the running countdown, so they take a second click. */
  function armTimer(key) {
    timerArmed = { key: key, until: Date.now() + 4000 };
    window.clearTimeout(timerArmTimer);
    timerArmTimer = window.setTimeout(function () { disarmTimer(); renderTimer(); }, 4000);
    renderTimer();
  }

  function disarmTimer() {
    timerArmed = { key: "", until: 0 };
    window.clearTimeout(timerArmTimer);
  }

  function isArmed(key) {
    return timerArmed.key === key && Date.now() < timerArmed.until;
  }

  function timerFormError(message) {
    const error = $("[data-timer-error]");
    const input = $("[data-timer-amount]");
    error.hidden = !message;
    error.textContent = message || "";
    input.setAttribute("aria-invalid", String(Boolean(message)));
  }

  function renderTimer() {
    if (!state) return;
    const timer = state.timer;
    const isBusy = busy.has("timer");
    const finished = timer.remainingSeconds === 0;
    $("[data-timer-big]").textContent = timer.formatted;
    $("[data-timer-card]").className = "timer-card" + (timer.running ? " is-running" : finished ? " is-finished" : " is-paused");
    $("[data-timer-state]").textContent = timer.running ? "Correndo" : finished ? "Encerrado" : "Pausado";
    const toggle = $("[data-timer-toggle]");
    toggle.textContent = isBusy ? "Salvando…" : timer.running ? "Pausar" : "Retomar";
    toggle.disabled = isBusy || (!timer.running && finished);
    toggle.title = !timer.running && finished ? "Adicione tempo antes de retomar." : "";
    for (const button of document.querySelectorAll("[data-quick], [data-timer-op], [data-timer-reset]")) {
      button.disabled = isBusy;
    }
    const setButton = document.querySelector('[data-timer-op="set"]');
    setButton.textContent = isArmed("set") ? "Confirmar: definir " + formatSeconds(timerArmed.seconds || 0) : "Definir";
    setButton.classList.toggle("is-armed", isArmed("set"));
    const reset = $("[data-timer-reset]");
    reset.textContent = isArmed("reset")
      ? "Confirmar: voltar para " + timer.initialFormatted + " e pausar"
      : "Restaurar valor inicial (" + timer.initialFormatted + ")";
    reset.classList.toggle("is-armed", isArmed("reset"));
  }

  function renderStats() {
    renderTimer();
    const counts = state.goalCounts || {};
    $("[data-timer]").textContent = state.timer.formatted + (state.timer.running ? "" : " (pausado)");
    $("[data-count-reached]").textContent = String(counts.reached || 0) + " de " + String(counts.total || 0);
    $("[data-count-done]").textContent = String(counts.done || 0);
    const errors = $("[data-goal-errors]");
    errors.hidden = !state.goalErrors || state.goalErrors.length === 0;
    errors.textContent = errors.hidden ? "" : state.goalErrors.join(" ");
  }

  function actionButton(label, variant, key, onClick) {
    const button = el("button", "button button--" + variant, busy.has(key) ? "Salvando…" : label);
    button.type = "button";
    button.disabled = busy.has(key);
    button.setAttribute("aria-busy", String(busy.has(key)));
    button.addEventListener("click", onClick);
    return button;
  }

  function renderActive() {
    const goal = state.activeGoal;
    const card = $("[data-active-card]");
    card.className = "active__card" + (goal ? " is-live type--" + goal.type : "");
    const actions = $("[data-active-actions]");
    actions.replaceChildren();
    if (goal) {
      $("[data-active-meta]").textContent = (TYPE_LABELS[goal.type] || goal.type) + " · "
        + (goal.reached ? "Meta de " + goal.targetLabel : goal.amountLabel + " (ainda não alcançada)");
      $("[data-active-title]").textContent = goal.title;
      $("[data-active-hint]").hidden = true;
      actions.append(
        actionButton("Concluir meta", "primary", goal.id, function () { void changeStatus(goal.id, goal.id, "done", goal.title + ": concluída"); }),
        actionButton("Voltar para pendente", "ghost", goal.id, function () { void changeStatus(goal.id, goal.id, "pending"); }),
      );
      return;
    }
    $("[data-active-meta]").textContent = "";
    $("[data-active-title]").textContent = "Nenhuma meta em andamento";
    const next = state.goals.find(function (entry) { return entry.stage === "reached"; });
    const hint = $("[data-active-hint]");
    hint.hidden = false;
    hint.textContent = next
      ? "Próxima alcançada na ordem: " + next.title + "."
      : "Nenhuma meta alcançada está pendente. Você ainda pode iniciar qualquer meta pela lista abaixo.";
    if (next) {
      actions.append(actionButton("Iniciar próxima alcançada", "primary", "@next", function () {
        void changeStatus("@next", "@next", "in-progress", next.title + ": em andamento");
      }));
    }
  }

  function renderFilters() {
    const group = $("[data-filters]");
    group.replaceChildren();
    for (const option of FILTERS) {
      const count = state.goals.filter(option.match).length;
      const button = el("button", "filter", option.label + " ");
      button.type = "button";
      button.setAttribute("aria-pressed", String(filter === option.value));
      button.appendChild(el("span", "filter__count", count));
      button.addEventListener("click", function () {
        filter = option.value;
        render();
      });
      group.appendChild(button);
    }
  }

  function goalRow(goal, index) {
    const row = el("li", "goal-row stage--" + goal.stage + " type--" + goal.type + (busy.has(goal.id) ? " is-busy" : ""));
    row.appendChild(el("span", "goal-row__index", String(index + 1).padStart(2, "0")));
    const main = el("div", "goal-row__main");
    const meta = el("p", "goal-row__meta");
    meta.append(el("span", "type-chip", TYPE_LABELS[goal.type] || goal.type), el("span", "stage-pill", goal.stageLabel));
    if (goal.status === "current") meta.appendChild(el("span", "stage-pill stage-pill--next", "Próxima a alcançar"));
    main.append(meta, el("p", "goal-row__title", goal.title));
    const progress = el("div", "goal-row__progress");
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.setProperty("--fill", String(goal.progress / 100));
    bar.appendChild(fill);
    progress.append(bar, el("span", "goal-row__amount", goal.amountLabel + " · " + String(goal.progress) + "%"));
    main.appendChild(progress);
    row.appendChild(main);

    const control = el("div", "segmented");
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", "Situação de " + goal.title);
    for (const option of STATUS_OPTIONS) {
      const pressed = goal.execution === option.value;
      const button = el("button", "segmented__option segmented__option--" + option.value, option.label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(pressed));
      button.disabled = busy.has(goal.id) || pressed;
      button.addEventListener("click", function () { void changeStatus(goal.id, goal.id, option.value); });
      control.appendChild(button);
    }
    row.appendChild(control);
    return row;
  }

  function renderList() {
    const list = $("[data-goal-list]");
    const selected = FILTERS.find(function (option) { return option.value === filter; });
    const query = fold(search.trim());
    const rows = [];
    state.goals.forEach(function (goal, index) {
      if (!selected.match(goal)) return;
      if (query && fold(goal.title).indexOf(query) === -1) return;
      rows.push(goalRow(goal, index));
    });
    // Keep keyboard focus on the same control across the redraw.
    const focused = document.activeElement;
    const focusKey = focused && focused.closest && focused.closest(".goal-row")
      ? [Array.from(list.children).indexOf(focused.closest(".goal-row")), focused.textContent]
      : null;
    list.replaceChildren.apply(list, rows);
    if (focusKey && list.children[focusKey[0]]) {
      const match = Array.from(list.children[focusKey[0]].querySelectorAll("button"))
        .find(function (button) { return button.textContent === focusKey[1] && !button.disabled; });
      if (match) match.focus();
    }
    const empty = $("[data-empty]");
    empty.hidden = rows.length > 0;
    empty.textContent = state.goals.length === 0
      ? "Nenhuma meta configurada. Cadastre as metas na aba Metas do plugin no OSC Flow Studio."
      : "Nenhuma meta neste filtro.";
  }

  function renderBulk() {
    const button = $("[data-bulk-done]");
    const reached = state.goals.filter(function (goal) { return goal.reached && goal.execution !== "done"; }).length;
    const armed = Date.now() < bulkArmedUntil;
    button.disabled = reached === 0 || busy.has("@reached");
    button.classList.toggle("is-armed", armed);
    button.textContent = busy.has("@reached")
      ? "Salvando…"
      : armed
        ? "Confirmar: concluir " + String(reached) + (reached === 1 ? " meta" : " metas")
        : "Concluir todas as alcançadas";
  }

  let linksSignature = "";
  function renderLinks() {
    const signature = JSON.stringify(state.urls);
    if (signature === linksSignature) return;
    linksSignature = signature;
    const list = $("[data-links]");
    list.replaceChildren();
    for (const key of Object.keys(URL_LABELS)) {
      const url = state.urls[key];
      if (!url) continue;
      const item = el("li", "link-item");
      const copy = el("div", "link-item__copy");
      copy.append(el("span", "link-item__label", URL_LABELS[key]), el("code", "link-item__url", url));
      const button = el("button", "button button--ghost button--small", "Copiar");
      button.type = "button";
      button.setAttribute("aria-label", "Copiar endereço: " + URL_LABELS[key]);
      button.addEventListener("click", async function () {
        try {
          await navigator.clipboard.writeText(url);
          toast("Endereço copiado: " + URL_LABELS[key], "success");
        } catch {
          toast("Não foi possível copiar. Selecione o endereço e copie manualmente.", "error");
        }
      });
      item.append(copy, button);
      list.appendChild(item);
    }
  }

  function render() {
    if (!state) return;
    renderStats();
    renderActive();
    renderFilters();
    renderList();
    renderBulk();
    renderLinks();
  }

  function setConnection(online) {
    const node = $("[data-connection]");
    node.classList.toggle("is-online", online);
    node.classList.toggle("is-offline", !online);
    node.querySelector("span").textContent = online ? "Conectado" : "Sem conexão com o plugin";
  }

  let lastSignature = "";
  async function refresh() {
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 5000);
    try {
      const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("HTTP " + String(response.status));
      const next = await response.json();
      setConnection(true);
      // The timer moves every second; the lists only redraw when a goal changed.
      const signature = JSON.stringify([next.goals, next.activeGoal, next.goalErrors, next.urls]);
      state = next;
      if (signature !== lastSignature) {
        lastSignature = signature;
        render();
      } else {
        renderStats();
      }
    } catch {
      setConnection(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function loop() {
    refresh().finally(function () { window.setTimeout(loop, 1000); });
  }

  $("[data-search]").addEventListener("input", function (event) {
    search = event.target.value;
    if (state) renderList();
  });

  $("[data-bulk-done]").addEventListener("click", function () {
    if (Date.now() < bulkArmedUntil) {
      bulkArmedUntil = 0;
      window.clearTimeout(bulkTimer);
      void changeStatus("@reached", "@reached", "done", "Metas alcançadas marcadas como concluídas");
      return;
    }
    bulkArmedUntil = Date.now() + 4000;
    renderBulk();
    window.clearTimeout(bulkTimer);
    bulkTimer = window.setTimeout(function () { bulkArmedUntil = 0; if (state) renderBulk(); }, 4000);
  });

  for (const button of document.querySelectorAll("[data-test-alert]")) {
    button.addEventListener("click", async function () {
      const label = button.textContent;
      button.disabled = true;
      button.textContent = "Enviando…";
      try {
        const response = await fetch("/api/test-alert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: button.dataset.testAlert }),
          cache: "no-store",
        });
        const body = await response.json().catch(function () { return {}; });
        if (!response.ok || body.ok === false) throw new Error(body.error || "O servidor respondeu " + String(response.status));
        toast("Alerta de teste enviado: " + label + ".", "success");
      } catch (error) {
        toast("Não foi possível enviar o teste: " + error.message, "error");
      } finally {
        button.textContent = label;
        button.disabled = false;
      }
    });
  }

  $("[data-timer-toggle]").addEventListener("click", function () {
    if (!state) return;
    if (state.timer.running) void changeTimer("pause", 0, "Cronômetro pausado.");
    else void changeTimer("resume", 0, "Cronômetro retomado.");
  });

  for (const button of document.querySelectorAll("[data-quick]")) {
    button.addEventListener("click", function () {
      const delta = Number(button.dataset.quick);
      const seconds = Math.abs(delta);
      void changeTimer(delta > 0 ? "add" : "subtract", seconds,
        (delta > 0 ? "+" : "−") + describeAmount(seconds) + (delta > 0 ? " no cronômetro." : " do cronômetro."));
    });
  }

  $("[data-timer-amount]").addEventListener("input", function () { timerFormError(""); });

  $("[data-timer-form]").addEventListener("submit", function (event) {
    event.preventDefault();
    const operation = event.submitter && event.submitter.dataset.timerOp;
    if (!operation) return;
    const raw = $("[data-timer-amount]").value.trim().replace(",", ".");
    const amount = Number(raw);
    if (raw === "" || !Number.isFinite(amount) || amount < 0) {
      timerFormError("Informe uma quantidade válida, por exemplo 15.");
      $("[data-timer-amount]").focus();
      return;
    }
    const seconds = Math.round(amount * Number($("[data-timer-unit]").value));
    if (seconds > 31536000) {
      timerFormError("O cronômetro vai até 365 dias.");
      return;
    }
    if (seconds === 0 && operation !== "set") {
      timerFormError("Informe um tempo maior que zero.");
      return;
    }
    timerFormError("");
    if (operation === "set") {
      if (!isArmed("set") || timerArmed.seconds !== seconds) {
        armTimer("set");
        timerArmed.seconds = seconds;
        renderTimer();
        return;
      }
      void changeTimer("set", seconds, "Cronômetro definido.");
      return;
    }
    void changeTimer(operation, seconds, operation === "add"
      ? "+" + describeAmount(seconds) + " no cronômetro."
      : "−" + describeAmount(seconds) + " do cronômetro.");
  });

  $("[data-timer-reset]").addEventListener("click", function () {
    if (!isArmed("reset")) {
      armTimer("reset");
      return;
    }
    void changeTimer("reset", 0, "Cronômetro restaurado e pausado.");
  });

  loop();
})();
