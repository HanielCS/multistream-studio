const STORAGE_KEY = "multistream_studio_state_v1";

const DEFAULT_STATE = {
  layout: "spotlight",
  splitRatio: 65,
  globalMuted: false,
  soloScreenId: null,
  screens: [
    { id: 1, url: "", platform: null, sourceId: "", label: "Tela disponível", volume: 80, muted: false, paused: false, scale: 100, chatOpen: true, chatWidth: 310 },
    { id: 2, url: "", platform: null, sourceId: "", label: "Tela disponível", volume: 80, muted: true, paused: false, scale: 100, chatOpen: false, chatWidth: 290 },
    { id: 3, url: "", platform: null, sourceId: "", label: "Tela disponível", volume: 80, muted: true, paused: false, scale: 100, chatOpen: false, chatWidth: 290 },
    { id: 4, url: "", platform: null, sourceId: "", label: "Tela disponível", volume: 80, muted: true, paused: false, scale: 100, chatOpen: false, chatWidth: 290 }
  ]
};

let state = loadState();
const playerInstances = new Map();
let ytApiReady = false;

window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  state.screens.forEach((screen) => {
    if (screen.platform === "youtube" && screen.sourceId) {
      mountPlayer(screen);
    }
  });
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.screens) || parsed.screens.length === 0) {
      return structuredClone(DEFAULT_STATE);
    }
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      screens: parsed.screens.map((s) => ({
        chatOpen: false,
        chatWidth: 300,
        ...s
      }))
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const indicator = document.getElementById("status-indicator");
    if (indicator) {
      indicator.textContent = "Salvo automaticamente";
    }
  } catch (err) {
    console.warn("Falha ao salvar no localStorage:", err);
  }
}

/* Detecção inteligente de URLs e plataformas */
function parseStreamUrl(rawUrl) {
  const clean = (rawUrl || "").trim();
  if (!clean) return null;

  let normalized = clean;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = "https://" + normalized;
  }

  let urlObj;
  try {
    urlObj = new URL(normalized);
  } catch {
    return null;
  }

  const host = urlObj.hostname.replace(/^www\./, "").toLowerCase();
  const pathParts = urlObj.pathname.split("/").filter(Boolean);

  // 1. Kick
  if (host === "kick.com" || host === "player.kick.com") {
    const channel = pathParts[0];
    if (!channel) return null;
    return {
      platform: "kick",
      platformName: "Kick",
      sourceId: channel,
      label: `Kick • ${channel}`,
      url: normalized
    };
  }

  // 2. YouTube
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    let videoId = "";
    if (host === "youtu.be") {
      videoId = pathParts[0] || "";
    } else if (urlObj.searchParams.get("v")) {
      videoId = urlObj.searchParams.get("v");
    } else if (pathParts[0] === "live" || pathParts[0] === "shorts" || pathParts[0] === "embed") {
      videoId = pathParts[1] || "";
    }
    if (!videoId) return null;
    return {
      platform: "youtube",
      platformName: "YouTube",
      sourceId: videoId,
      label: `YouTube • ${videoId}`,
      url: normalized
    };
  }

  // 3. Twitch
  if (host === "twitch.tv" || host === "m.twitch.tv" || host === "player.twitch.tv") {
    if (pathParts[0] === "videos" && pathParts[1]) {
      return {
        platform: "twitch",
        platformName: "Twitch VOD",
        sourceId: `video:${pathParts[1]}`,
        label: `Twitch VOD • ${pathParts[1]}`,
        url: normalized
      };
    }
    const channel = pathParts[0];
    if (!channel) return null;
    return {
      platform: "twitch",
      platformName: "Twitch",
      sourceId: `channel:${channel}`,
      label: `Twitch • ${channel}`,
      url: normalized
    };
  }

  // 4. HLS (.m3u8)
  if (urlObj.pathname.toLowerCase().endsWith(".m3u8")) {
    const fileName = pathParts[pathParts.length - 1] || "Stream HLS";
    return {
      platform: "hls",
      platformName: "HLS (.m3u8)",
      sourceId: normalized,
      label: `HLS • ${fileName}`,
      url: normalized
    };
  }

  // 5. Vídeo direto (.mp4, .webm, .ogg)
  if (/\.(mp4|webm|ogg)$/i.test(urlObj.pathname)) {
    const fileName = pathParts[pathParts.length - 1] || "Vídeo Direto";
    return {
      platform: "video",
      platformName: "Vídeo Direto",
      sourceId: normalized,
      label: `Vídeo • ${fileName}`,
      url: normalized
    };
  }

  return null;
}

/* Configuração de URL do Chat por plataforma */
function getChatConfig(screen) {
  if (!screen.platform || !screen.sourceId) {
    return { supported: false, reason: "Carregue uma live nesta tela para abrir o chat." };
  }

  const host = window.location.hostname;
  const isLocalFile = window.location.protocol === "file:" || !host;

  if (screen.platform === "kick") {
    const channel = encodeURIComponent(screen.sourceId);
    const chatUrl = `https://kick.com/popout/${channel}/chat`;
    return {
      supported: true,
      embedUrl: chatUrl,
      popoutUrl: chatUrl
    };
  }

  if (screen.platform === "youtube") {
    const vid = encodeURIComponent(screen.sourceId);
    const popoutUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${vid}`;
    if (isLocalFile) {
      return {
        supported: false,
        popoutUrl,
        reason: "O chat do YouTube exige execução via servidor HTTP (ex: localhost:8080) por política de embed_domain."
      };
    }
    return {
      supported: true,
      embedUrl: `https://www.youtube.com/live_chat?v=${vid}&embed_domain=${encodeURIComponent(host)}&dark_theme=1`,
      popoutUrl
    };
  }

  if (screen.platform === "twitch") {
    if (screen.sourceId.startsWith("video:")) {
      return { supported: false, reason: "Chat ao vivo não disponível para VODs da Twitch." };
    }
    const channel = encodeURIComponent(screen.sourceId.replace("channel:", ""));
    const popoutUrl = `https://www.twitch.tv/popout/${channel}/chat?darkpopout`;
    if (isLocalFile) {
      return {
        supported: false,
        popoutUrl,
        reason: "O chat da Twitch exige execução via servidor HTTP (ex: localhost:8080) pelo parâmetro parent."
      };
    }
    return {
      supported: true,
      embedUrl: `https://www.twitch.tv/embed/${channel}/chat?darkpopout&parent=${encodeURIComponent(host)}`,
      popoutUrl
    };
  }

  return {
    supported: false,
    reason: "Esta fonte de vídeo não possui chat integrado."
  };
}

/* Atualização do badge no input em tempo real */
const urlInput = document.getElementById("stream-url");
const platformBadge = document.getElementById("platform-badge");
const targetSelect = document.getElementById("target-screen");

urlInput.addEventListener("input", () => {
  const val = urlInput.value.trim();
  if (!val) {
    platformBadge.className = "platform-badge neutral";
    platformBadge.textContent = "Aguardando link";
    return;
  }
  const parsed = parseStreamUrl(val);
  if (!parsed) {
    platformBadge.className = "platform-badge invalid";
    platformBadge.textContent = "Link não suportado";
    return;
  }
  platformBadge.className = `platform-badge ${parsed.platform}`;
  platformBadge.textContent = parsed.platformName;
});

function populateScreenSelect(selectedId = null) {
  const currentVal = selectedId ?? targetSelect.value;
  targetSelect.innerHTML = "";
  state.screens.forEach((screen, idx) => {
    const opt = document.createElement("option");
    opt.value = String(screen.id);
    const status = screen.platform ? `(${screen.label})` : "(Vazia)";
    opt.textContent = `Tela ${idx + 1} ${status}`;
    targetSelect.appendChild(opt);
  });

  const newOpt = document.createElement("option");
  newOpt.value = "new";
  newOpt.textContent = "+ Nova Tela";
  targetSelect.appendChild(newOpt);

  if (currentVal && [...targetSelect.options].some((o) => o.value === String(currentVal))) {
    targetSelect.value = String(currentVal);
  }
}

/* Destruição limpa de instâncias de player */
function destroyPlayer(screenId) {
  const entry = playerInstances.get(screenId);
  if (!entry) return;
  try {
    if (entry.type === "youtube" && entry.instance && typeof entry.instance.destroy === "function") {
      entry.instance.destroy();
    }
    if (entry.hls) {
      entry.hls.destroy();
    }
    if (entry.videoEl) {
      entry.videoEl.pause();
      entry.videoEl.removeAttribute("src");
      entry.videoEl.load();
    }
  } catch (e) {
    console.warn("Aviso ao limpar player:", e);
  }
  playerInstances.delete(screenId);
}

/* Criação da estrutura DOM de uma tela */
function createScreenCard(screen, visualIndex) {
  const card = document.createElement("article");
  card.className = "screen-card" + (state.soloScreenId === screen.id ? " is-solo" : "");
  card.dataset.screenId = String(screen.id);
  card.style.width = `${screen.scale || 100}%`;

  const platformClass = screen.platform || "neutral";
  const platformTag = screen.platform ? screen.platform.toUpperCase() : "VAZIA";
  const chatAvailable = ["kick", "youtube", "twitch"].includes(screen.platform) && !screen.sourceId.startsWith("video:");

  card.innerHTML = `
    <div class="screen-header">
      <div class="screen-meta">
        <span class="screen-index">TELA ${visualIndex + 1}</span>
        <span class="platform-badge ${platformClass}" style="position:static;">${platformTag}</span>
        <span class="screen-title" title="${escapeHtml(screen.label)}">${escapeHtml(screen.label)}</span>
      </div>
      <div class="screen-actions">
        ${
          chatAvailable
            ? `<button type="button" class="icon-btn chat-toggle-btn ${screen.chatOpen ? "active" : ""}" data-action="toggle-chat" title="${
                screen.chatOpen ? "Fechar chat para liberar espaço" : "Abrir chat desta live"
              }">💬 ${screen.chatOpen ? "Fechar Chat" : "Chat"}</button>`
            : ""
        }
        <button type="button" class="icon-btn" data-action="focus" title="Colocar esta tela em destaque (Tela 1)">Destacar</button>
        <button type="button" class="icon-btn" data-action="reload" title="Recarregar stream">Recarregar</button>
        <button type="button" class="icon-btn danger" data-action="clear" title="Limpar ou remover tela">✕</button>
      </div>
    </div>

    <div class="screen-body" id="screen-body-${screen.id}">
      <div class="player-viewport" id="viewport-${screen.id}">
        ${
          screen.platform
            ? `<div id="player-mount-${screen.id}"></div>`
            : `<div class="empty-slot">
                 <strong>Tela ${visualIndex + 1} aguardando transmissão</strong>
                 <p>Cole um link da Kick, YouTube, Twitch ou .m3u8 na barra superior e selecione esta tela.</p>
               </div>`
        }
      </div>
    </div>

    <div class="player-controls">
      ${renderControlsHtml(screen)}
    </div>

    <div class="corner-resizer" title="Arraste para redimensionar proporcionalmente (16:9)"></div>
  `;

  if (screen.chatOpen && chatAvailable) {
    attachChatPanel(card, screen);
  }

  bindCardEvents(card, screen);
  return card;
}

/* Monta ou remove o painel de chat SEM recarregar o player de vídeo */
function attachChatPanel(card, screen) {
  const body = card.querySelector(".screen-body");
  if (!body || body.querySelector(".chat-panel")) return;

  const chatInfo = getChatConfig(screen);

  const resizer = document.createElement("div");
  resizer.className = "chat-resizer";
  resizer.title = "Arraste para ajustar a largura do chat";

  const panel = document.createElement("aside");
  panel.className = "chat-panel";
  panel.style.width = `${screen.chatWidth || 300}px`;

  const popoutLink = chatInfo.popoutUrl
    ? `<a href="${escapeHtml(chatInfo.popoutUrl)}" target="_blank" rel="noopener noreferrer" class="chat-btn" title="Abrir chat em janela separada">Popout ↗</a>`
    : "";

  let contentHtml = "";
  if (chatInfo.supported) {
    contentHtml = `<iframe src="${escapeHtml(chatInfo.embedUrl)}" loading="lazy" allow="autoplay"></iframe>`;
  } else {
    contentHtml = `
      <div class="chat-fallback">
        <p>${escapeHtml(chatInfo.reason)}</p>
        ${
          chatInfo.popoutUrl
            ? `<a href="${escapeHtml(chatInfo.popoutUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="font-size:0.75rem;padding:6px 10px;">Abrir Chat em Janela Externa ↗</a>`
            : ""
        }
      </div>
    `;
  }

  panel.innerHTML = `
    <div class="chat-header">
      <span class="chat-header-title">Chat • ${escapeHtml(screen.label)}</span>
      <div class="chat-header-actions">
        ${popoutLink}
        <button type="button" class="chat-btn close-chat" data-chat-close title="Fechar chat e expandir vídeo">✕ Fechar</button>
      </div>
    </div>
    <div class="chat-frame-wrap">
      ${contentHtml}
    </div>
  `;

  panel.querySelector("[data-chat-close]").addEventListener("click", () => {
    setScreenChatState(screen.id, false);
  });

  bindChatResizer(body, panel, resizer, screen);

  body.appendChild(resizer);
  body.appendChild(panel);
}

function detachChatPanel(card) {
  const resizer = card.querySelector(".chat-resizer");
  const panel = card.querySelector(".chat-panel");
  if (resizer) resizer.remove();
  if (panel) panel.remove();
}

function setScreenChatState(screenId, isOpen) {
  const screen = state.screens.find((s) => s.id === screenId);
  if (!screen) return;

  const chatAvailable = ["kick", "youtube", "twitch"].includes(screen.platform) && !screen.sourceId.startsWith("video:");
  screen.chatOpen = Boolean(isOpen && chatAvailable);
  saveState();

  const card = document.querySelector(`.screen-card[data-screen-id="${screenId}"]`);
  if (card) {
    if (screen.chatOpen) {
      attachChatPanel(card, screen);
    } else {
      detachChatPanel(card);
    }

    const headerBtn = card.querySelector('[data-action="toggle-chat"]');
    if (headerBtn) {
      headerBtn.classList.toggle("active", screen.chatOpen);
      headerBtn.textContent = screen.chatOpen ? "💬 Fechar Chat" : "💬 Chat";
      headerBtn.title = screen.chatOpen ? "Fechar chat para liberar espaço" : "Abrir chat desta live";
    }

    const ctrlChatBtn = card.querySelector('[data-ctrl="toggle-chat"]');
    if (ctrlChatBtn) {
      ctrlChatBtn.classList.toggle("active", screen.chatOpen);
      ctrlChatBtn.textContent = screen.chatOpen ? "Fechar Chat" : "💬 Chat";
    }
  }

  updateGlobalChatButton();
}

function updateGlobalChatButton() {
  const btn = document.getElementById("btn-toggle-all-chats");
  if (!btn) return;
  const anyOpen = state.screens.some((s) => s.chatOpen && ["kick", "youtube", "twitch"].includes(s.platform));
  btn.textContent = anyOpen ? "Fechar Chats" : "Abrir Chats";
  btn.classList.toggle("active-info", anyOpen);
}

function bindChatResizer(body, panel, resizer, screen) {
  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizer.classList.add("dragging");
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const maxWidth = body.getBoundingClientRect().width * 0.55;

    function onMouseMove(moveEvent) {
      const deltaX = startX - moveEvent.clientX;
      const nextWidth = Math.min(maxWidth, Math.max(220, Math.round(startWidth + deltaX)));
      screen.chatWidth = nextWidth;
      panel.style.width = `${nextWidth}px`;
    }

    function onMouseUp() {
      resizer.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      saveState();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

function renderControlsHtml(screen) {
  if (!screen.platform) {
    return `
      <div class="controls-left">
        <span style="font-size:0.76rem;color:var(--text-muted);">Nenhuma mídia carregada</span>
      </div>
      <div class="controls-right">
        <button type="button" class="ctrl-btn" data-ctrl="fullscreen">Tela Cheia</button>
      </div>
    `;
  }

  const isSolo = state.soloScreenId === screen.id;
  const chatAvailable = ["kick", "youtube", "twitch"].includes(screen.platform) && !screen.sourceId.startsWith("video:");
  const chatBtnHtml = chatAvailable
    ? `<button type="button" class="ctrl-btn chat-btn-ctrl ${screen.chatOpen ? "active" : ""}" data-ctrl="toggle-chat" title="Abrir ou fechar chat desta live">
         ${screen.chatOpen ? "Fechar Chat" : "💬 Chat"}
       </button>`
    : "";

  if (screen.platform === "kick") {
    return `
      <div class="controls-left">
        <span class="kick-audio-notice">Áudio no player Kick</span>
      </div>
      <div class="controls-right">
        ${chatBtnHtml}
        <button type="button" class="ctrl-btn solo-btn ${isSolo ? "active" : ""}" data-ctrl="solo" title="Mutar todas as outras telas">
          ${isSolo ? "Solo Ativo" : "Solo Áudio"}
        </button>
        <button type="button" class="ctrl-btn" data-ctrl="fullscreen">Tela Cheia</button>
      </div>
    `;
  }

  const effectiveMuted = isEffectivelyMuted(screen);

  return `
    <div class="controls-left">
      <button type="button" class="ctrl-btn" data-ctrl="playpause">
        ${screen.paused ? "▶ Play" : "❚❚ Pause"}
      </button>

      <div class="volume-group">
        <button type="button" class="ctrl-btn" data-ctrl="mute">
          ${effectiveMuted ? "🔇" : "🔊"}
        </button>
        <input
          type="range"
          class="volume-slider"
          data-ctrl="volume"
          min="0"
          max="100"
          value="${effectiveMuted ? 0 : screen.volume}"
          aria-label="Volume da tela"
        />
        <span class="volume-value">${effectiveMuted ? 0 : screen.volume}%</span>
      </div>
    </div>

    <div class="controls-right">
      ${chatBtnHtml}
      <button type="button" class="ctrl-btn solo-btn ${isSolo ? "active" : ""}" data-ctrl="solo" title="Manter áudio apenas nesta tela">
        ${isSolo ? "Solo Ativo" : "Solo Áudio"}
      </button>
      <button type="button" class="ctrl-btn" data-ctrl="fullscreen">Tela Cheia</button>
    </div>
  `;
}

function isEffectivelyMuted(screen) {
  if (state.globalMuted) return true;
  if (state.soloScreenId !== null && state.soloScreenId !== screen.id) return true;
  return Boolean(screen.muted);
}

/* Montagem do player específico para cada plataforma */
function mountPlayer(screen) {
  if (!screen.platform || !screen.sourceId) return;
  const mountEl = document.getElementById(`player-mount-${screen.id}`);
  if (!mountEl) return;

  destroyPlayer(screen.id);
  mountEl.innerHTML = "";

  const muted = isEffectivelyMuted(screen);

  if (screen.platform === "kick") {
    const iframe = document.createElement("iframe");
    iframe.src = `https://player.kick.com/${encodeURIComponent(screen.sourceId)}?autoplay=true`;
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    mountEl.appendChild(iframe);
    playerInstances.set(screen.id, { type: "kick", iframe });
    return;
  }

  if (screen.platform === "youtube") {
    if (!ytApiReady || !window.YT || !window.YT.Player) {
      mountEl.innerHTML = `<div class="empty-slot"><p>Carregando API do YouTube...</p></div>`;
      return;
    }
    const targetDiv = document.createElement("div");
    targetDiv.id = `yt-frame-${screen.id}`;
    mountEl.appendChild(targetDiv);

    const ytPlayer = new window.YT.Player(targetDiv.id, {
      videoId: screen.sourceId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1
      },
      events: {
        onReady: (event) => {
          event.target.setVolume(screen.volume);
          if (muted) event.target.mute();
          else event.target.unMute();
          if (screen.paused) event.target.pauseVideo();
        }
      }
    });

    playerInstances.set(screen.id, { type: "youtube", instance: ytPlayer });
    return;
  }

  if (screen.platform === "twitch") {
    if (!window.Twitch || !window.Twitch.Player) {
      mountEl.innerHTML = `<div class="empty-slot"><p>Carregando API da Twitch...</p></div>`;
      return;
    }
    const targetDiv = document.createElement("div");
    targetDiv.id = `tw-frame-${screen.id}`;
    mountEl.appendChild(targetDiv);

    const parentHost = window.location.hostname || "localhost";
    const options = {
      width: "100%",
      height: "100%",
      controls: false,
      autoplay: true,
      muted: muted,
      parent: [parentHost]
    };

    if (screen.sourceId.startsWith("video:")) {
      options.video = screen.sourceId.replace("video:", "");
    } else {
      options.channel = screen.sourceId.replace("channel:", "");
    }

    const twPlayer = new window.Twitch.Player(targetDiv.id, options);
    twPlayer.addEventListener(window.Twitch.Player.READY, () => {
      twPlayer.setVolume(screen.volume / 100);
      twPlayer.setMuted(muted);
      if (screen.paused) twPlayer.pause();
    });

    playerInstances.set(screen.id, { type: "twitch", instance: twPlayer });
    return;
  }

  if (screen.platform === "hls" || screen.platform === "video") {
    const video = document.createElement("video");
    video.playsInline = true;
    video.autoplay = !screen.paused;
    video.muted = muted;
    video.volume = screen.volume / 100;
    mountEl.appendChild(video);

    let hls = null;
    if (screen.platform === "hls" && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(screen.sourceId);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (!screen.paused) video.play().catch(() => {});
      });
    } else {
      video.src = screen.sourceId;
      if (!screen.paused) video.play().catch(() => {});
    }

    playerInstances.set(screen.id, { type: screen.platform, videoEl: video, hls });
  }
}

/* Sincronização de áudio/reprodução sem recarregar iframes */
function syncAllAudioStates() {
  state.screens.forEach((screen) => {
    const entry = playerInstances.get(screen.id);
    const muted = isEffectivelyMuted(screen);

    if (entry) {
      try {
        if (entry.type === "youtube" && entry.instance && entry.instance.setVolume) {
          entry.instance.setVolume(screen.volume);
          if (muted) entry.instance.mute();
          else entry.instance.unMute();
        } else if (entry.type === "twitch" && entry.instance && entry.instance.setVolume) {
          entry.instance.setVolume(screen.volume / 100);
          entry.instance.setMuted(muted);
        } else if (entry.videoEl) {
          entry.videoEl.volume = screen.volume / 100;
          entry.videoEl.muted = muted;
        }
      } catch (e) {
        console.warn("Erro ao sincronizar áudio:", e);
      }
    }

    const card = document.querySelector(`.screen-card[data-screen-id="${screen.id}"]`);
    if (card) {
      card.classList.toggle("is-solo", state.soloScreenId === screen.id);
      const controlsBox = card.querySelector(".player-controls");
      if (controlsBox) {
        controlsBox.innerHTML = renderControlsHtml(screen);
        bindControlEvents(card, screen);
      }
    }
  });

  const muteAllBtn = document.getElementById("btn-mute-all");
  if (muteAllBtn) {
    muteAllBtn.textContent = state.globalMuted ? "Reativar Áudio" : "Mutar Tudo";
    muteAllBtn.classList.toggle("active-warning", state.globalMuted);
  }

  updateGlobalChatButton();
}

function bindCardEvents(card, screen) {
  card.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "toggle-chat") {
        setScreenChatState(screen.id, !screen.chatOpen);
      } else if (action === "focus") {
        const idx = state.screens.findIndex((s) => s.id === screen.id);
        if (idx > 0) {
          const [picked] = state.screens.splice(idx, 1);
          state.screens.unshift(picked);
          saveState();
          renderStage();
        }
      } else if (action === "reload") {
        mountPlayer(screen);
        if (screen.chatOpen) {
          detachChatPanel(card);
          attachChatPanel(card, screen);
        }
      } else if (action === "clear") {
        destroyPlayer(screen.id);
        if (screen.platform) {
          screen.url = "";
          screen.platform = null;
          screen.sourceId = "";
          screen.label = "Tela disponível";
          screen.paused = false;
          screen.chatOpen = false;
        } else if (state.screens.length > 1) {
          state.screens = state.screens.filter((s) => s.id !== screen.id);
          if (state.soloScreenId === screen.id) state.soloScreenId = null;
        }
        saveState();
        renderStage();
      }
    });
  });

  bindControlEvents(card, screen);
  bindCornerResize(card, screen);
}

function bindControlEvents(card, screen) {
  const chatToggleCtrl = card.querySelector('[data-ctrl="toggle-chat"]');
  if (chatToggleCtrl) {
    chatToggleCtrl.addEventListener("click", () => {
      setScreenChatState(screen.id, !screen.chatOpen);
    });
  }

  const playPauseBtn = card.querySelector('[data-ctrl="playpause"]');
  if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => {
      screen.paused = !screen.paused;
      const entry = playerInstances.get(screen.id);
      if (entry) {
        if (entry.type === "youtube" && entry.instance) {
          screen.paused ? entry.instance.pauseVideo() : entry.instance.playVideo();
        } else if (entry.type === "twitch" && entry.instance) {
          screen.paused ? entry.instance.pause() : entry.instance.play();
        } else if (entry.videoEl) {
          screen.paused ? entry.videoEl.pause() : entry.videoEl.play().catch(() => {});
        }
      }
      saveState();
      syncAllAudioStates();
    });
  }

  const muteBtn = card.querySelector('[data-ctrl="mute"]');
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      if (state.globalMuted) state.globalMuted = false;
      screen.muted = !screen.muted;
      saveState();
      syncAllAudioStates();
    });
  }

  const volSlider = card.querySelector('[data-ctrl="volume"]');
  if (volSlider) {
    volSlider.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      screen.volume = val;
      screen.muted = val === 0;
      if (val > 0 && state.globalMuted) state.globalMuted = false;
      saveState();
      syncAllAudioStates();
    });
  }

  const soloBtn = card.querySelector('[data-ctrl="solo"]');
  if (soloBtn) {
    soloBtn.addEventListener("click", () => {
      if (state.soloScreenId === screen.id) {
        state.soloScreenId = null;
      } else {
        state.soloScreenId = screen.id;
        screen.muted = false;
        state.globalMuted = false;
      }
      saveState();
      syncAllAudioStates();
    });
  }

  const fsBtn = card.querySelector('[data-ctrl="fullscreen"]');
  if (fsBtn) {
    fsBtn.addEventListener("click", () => {
      const viewport = card.querySelector(".player-viewport") || card;
      if (viewport.requestFullscreen) {
        viewport.requestFullscreen().catch(() => {});
      }
    });
  }
}

/* Redimensionamento proporcional individual pelo canto inferior direito */
function bindCornerResize(card, screen) {
  const handle = card.querySelector(".corner-resizer");
  if (!handle) return;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const parentWidth = card.parentElement.getBoundingClientRect().width;
    const startX = e.clientX;
    const startScale = screen.scale || 100;

    function onMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaPct = (deltaX / parentWidth) * 100;
      const nextScale = Math.min(100, Math.max(40, Math.round(startScale + deltaPct)));
      screen.scale = nextScale;
      card.style.width = `${nextScale}%`;
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      saveState();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

/* Renderização completa do Stage conforme o layout escolhido */
function renderStage() {
  const stage = document.getElementById("stage");
  stage.className = `stage layout-${state.layout}`;
  stage.innerHTML = "";

  document.querySelectorAll(".layout-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.layout === state.layout);
  });

  populateScreenSelect();

  if (state.layout === "spotlight" || state.layout === "side-by-side") {
    const splitWrapper = document.createElement("div");
    splitWrapper.className = "split-container";

    const primaryCol = document.createElement("div");
    primaryCol.className = "split-primary";
    primaryCol.style.width = `${state.splitRatio}%`;

    const resizer = document.createElement("div");
    resizer.className = "split-resizer";
    resizer.title = "Arraste para redimensionar a proporção entre destaque e laterais";

    const secondaryCol = document.createElement("div");
    secondaryCol.className = "split-secondary";

    state.screens.forEach((screen, idx) => {
      const card = createScreenCard(screen, idx);
      if (idx === 0) {
        primaryCol.appendChild(card);
      } else {
        secondaryCol.appendChild(card);
      }
    });

    splitWrapper.appendChild(primaryCol);
    if (state.screens.length > 1) {
      splitWrapper.appendChild(resizer);
      splitWrapper.appendChild(secondaryCol);
    }

    stage.appendChild(splitWrapper);
    bindSplitResizer(splitWrapper, primaryCol, resizer);
  } else {
    state.screens.forEach((screen, idx) => {
      stage.appendChild(createScreenCard(screen, idx));
    });
  }

  state.screens.forEach((screen) => {
    if (screen.platform && screen.sourceId) {
      mountPlayer(screen);
    }
  });

  syncAllAudioStates();
}

function bindSplitResizer(container, primaryCol, resizer) {
  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizer.classList.add("dragging");
    const rect = container.getBoundingClientRect();

    function onMouseMove(moveEvent) {
      const relX = moveEvent.clientX - rect.left;
      const pct = Math.min(80, Math.max(25, Math.round((relX / rect.width) * 100)));
      state.splitRatio = pct;
      primaryCol.style.width = `${pct}%`;
    }

    function onMouseUp() {
      resizer.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      saveState();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

/* Eventos globais da barra superior e de layout */
document.getElementById("stream-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const parsed = parseStreamUrl(urlInput.value);
  if (!parsed) {
    urlInput.focus();
    return;
  }

  const targetVal = targetSelect.value;
  let targetScreen;

  if (targetVal === "new") {
    const nextId = state.screens.reduce((max, s) => Math.max(max, s.id), 0) + 1;
    targetScreen = {
      id: nextId,
      url: parsed.url,
      platform: parsed.platform,
      sourceId: parsed.sourceId,
      label: parsed.label,
      volume: 80,
      muted: state.screens.some((s) => s.platform !== null),
      paused: false,
      scale: 100,
      chatOpen: false,
      chatWidth: 300
    };
    state.screens.push(targetScreen);
  } else {
    const idNum = Number(targetVal);
    targetScreen = state.screens.find((s) => s.id === idNum) || state.screens[0];
    targetScreen.url = parsed.url;
    targetScreen.platform = parsed.platform;
    targetScreen.sourceId = parsed.sourceId;
    targetScreen.label = parsed.label;
    targetScreen.paused = false;
  }

  urlInput.value = "";
  platformBadge.className = "platform-badge neutral";
  platformBadge.textContent = "Aguardando link";

  saveState();
  renderStage();
  populateScreenSelect(targetScreen.id);
});

document.querySelectorAll(".layout-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.layout = btn.dataset.layout;
    saveState();
    renderStage();
  });
});

document.getElementById("btn-add-slot").addEventListener("click", () => {
  const nextId = state.screens.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  state.screens.push({
    id: nextId,
    url: "",
    platform: null,
    sourceId: "",
    label: "Tela disponível",
    volume: 80,
    muted: true,
    paused: false,
    scale: 100,
    chatOpen: false,
    chatWidth: 300
  });
  saveState();
  renderStage();
});

document.getElementById("btn-toggle-all-chats").addEventListener("click", () => {
  const eligible = state.screens.filter((s) => ["kick", "youtube", "twitch"].includes(s.platform) && !s.sourceId.startsWith("video:"));
  const anyOpen = eligible.some((s) => s.chatOpen);
  eligible.forEach((s) => {
    setScreenChatState(s.id, !anyOpen);
  });
});

document.getElementById("btn-mute-all").addEventListener("click", () => {
  state.globalMuted = !state.globalMuted;
  saveState();
  syncAllAudioStates();
});

document.getElementById("btn-reset-sizes").addEventListener("click", () => {
  state.splitRatio = 65;
  state.screens.forEach((s) => {
    s.scale = 100;
    s.chatWidth = 300;
  });
  saveState();
  renderStage();
});

document.getElementById("btn-clear-all").addEventListener("click", () => {
  state.screens.forEach((s) => destroyPlayer(s.id));
  state = structuredClone(DEFAULT_STATE);
  saveState();
  renderStage();
});

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// Inicialização
renderStage();
