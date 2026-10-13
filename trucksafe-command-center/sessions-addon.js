
(() => {
  const KEY = "ts_chat_sessions_v1";

  const $ = (selector) => document.querySelector(selector);

  function init() {
    const nav = $(".nav");
    const main = $("main");
    const chat = $("#chatMessages");

    if (!nav || !main || !chat || $("#view-sessions")) return;

    let sessions = [];
    let activeId = null;

    try {
      sessions = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(sessions)) sessions = [];
    } catch {
      sessions = [];
    }

    const uid = () =>
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);

    const save = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(sessions));
      } catch {
        alert("Não foi possível salvar as sessões no navegador.");
      }
      renderSessions();
    };

    const current = () =>
      sessions.find((s) => s.id === activeId);

    function snapshot() {
      const session = current();
      if (!session) return;

      session.messagesHTML = chat.innerHTML;
      session.updatedAt = new Date().toISOString();

      if (session.title === "Nova conversa") {
        const text = chat.innerText.trim();
        if (text) {
          session.title = text.split("\n")[0].slice(0, 45);
        }
      }

      save();
    }

    function renderSessions() {
      const list = $("#sessionsList");
      const count = $("#sessionNavCount");

      if (!list) return;

      if (count) count.textContent = sessions.length;

      list.replaceChildren();

      if (!sessions.length) {
        list.textContent = "Nenhuma sessão criada.";
        return;
      }

      [...sessions]
        .sort((a, b) =>
          (b.updatedAt || "").localeCompare(a.updatedAt || "")
        )
        .forEach((session) => {
          const row = document.createElement("div");
          row.className = "session-row";

          const open = document.createElement("button");
          open.className = "session-open";
          open.textContent = session.title;
          open.addEventListener("click", () => openSession(session.id));

          const rename = document.createElement("button");
          rename.textContent = "Renomear";
          rename.addEventListener("click", () => {
            const name = prompt("Nome da sessão:", session.title);
            if (name && name.trim()) {
              session.title = name.trim().slice(0, 80);
              save();
            }
          });

          const remove = document.createElement("button");
          remove.textContent = "Excluir";
          remove.addEventListener("click", () => {
            if (!confirm(`Excluir "${session.title}"?`)) return;

            sessions = sessions.filter((s) => s.id !== session.id);

            if (activeId === session.id) {
              activeId = null;
              chat.replaceChildren();

              if (sessions.length) {
                openSession(sessions[0].id);
              } else {
                createSession();
              }
            } else {
              save();
            }
          });

          row.append(open, rename, remove);
          list.append(row);
        });
    }

    function showView(view) {
      if (typeof window.setView === "function") {
        window.setView(view);
        return;
      }

      document.querySelectorAll(".view").forEach((element) => {
        element.classList.toggle(
          "active",
          element.id === `view-${view}`
        );
      });

      document.querySelectorAll(".nav button[data-view]").forEach((button) => {
        button.classList.toggle("active", button.dataset.view === view);
      });
    }

    function openSession(id) {
      snapshot();

      const session = sessions.find((s) => s.id === id);
      if (!session) return;

      activeId = id;
      chat.innerHTML = session.messagesHTML || "";

      save();
      showView("overview");
    }

    function createSession() {
      snapshot();

      const session = {
        id: uid(),
        title: "Nova conversa",
        messagesHTML: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      sessions.unshift(session);
      activeId = session.id;
      chat.replaceChildren();

      save();
      showView("overview");
      $("#chatInput")?.focus();
    }

    // Adiciona a opção à navegação existente.
    const navButton = document.createElement("button");
    navButton.dataset.view = "sessions";
    navButton.innerHTML =
      '<span class="ico">▤</span> Sessões ' +
      '<span class="count" id="sessionNavCount">0</span>';

    nav.append(navButton);

    // Cria a nova tela.
    const view = document.createElement("section");
    view.id = "view-sessions";
    view.className = "view";

    view.innerHTML = `
      <div class="sessions-head">
        <div>
          <h1>Sessões</h1>
          <p>Converse sobre projetos diferentes separadamente.</p>
        </div>
        <button id="newSessionBtn" type="button">
          + Nova sessão
        </button>
      </div>

      <div class="sessions-panel">
        <div id="sessionsList"></div>
      </div>

      <p class="sessions-note">
        As sessões ficam salvas neste navegador.
      </p>
    `;

    main.append(view);

    // Estilo isolado para não alterar o restante da interface.
    const style = document.createElement("style");

    style.textContent = `
      #view-sessions {
        padding: 28px;
        width: 100%;
        box-sizing: border-box;
      }

      .sessions-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 24px;
      }

      .sessions-head h1 {
        margin-bottom: 8px;
      }

      .sessions-head p,
      .sessions-note {
        color: var(--muted, #8f9cac);
        font-size: 13px;
      }

      #newSessionBtn {
        padding: 11px 15px;
        border: 0;
        border-radius: 9px;
        cursor: pointer;
        font-weight: 700;
      }

      .sessions-panel {
        border: 1px solid var(--line, #29313c);
        border-radius: 14px;
        overflow: hidden;
      }

      #sessionsList {
        display: grid;
      }

      .session-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 14px;
        border-bottom: 1px solid var(--line, #29313c);
      }

      .session-row button {
        padding: 9px 11px;
        border: 1px solid var(--line, #29313c);
        border-radius: 8px;
        cursor: pointer;
      }

      .session-row .session-open {
        flex: 1;
        min-width: 120px;
        text-align: left;
      }

      .sessions-note {
        margin-top: 16px;
        font-size: 11px;
      }
    `;

    document.head.append(style);

    navButton.addEventListener("click", () => {
      snapshot();
      showView("sessions");
      renderSessions();
    });

    $("#newSessionBtn").addEventListener("click", createSession);

    // Salva alterações feitas pelo chat existente.
    const observer = new MutationObserver(() => {
      if (!activeId) return;

      clearTimeout(observer.timer);
      observer.timer = setTimeout(snapshot, 250);
    });

    observer.observe(chat, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Recupera sessões já salvas ou inicia uma nova.
    if (sessions.length) {
      const latest = [...sessions].sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || "")
      )[0];

      activeId = latest.id;
      chat.innerHTML = latest.messagesHTML || "";
    } else {
      sessions.push({
        id: uid(),
        title: "Nova conversa",
        messagesHTML: chat.innerHTML,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      activeId = sessions[0].id;
    }

    save();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
