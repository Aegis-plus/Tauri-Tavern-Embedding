// JanitorAI Importer - TauriTavern Extension
// Imports character cards from JanitorAI URLs directly into TauriTavern
(function () {
  "use strict";

  const JANITORAI_API = "https://janitorai.com";
  const JANITORAI_AVATAR_BASE = "https://ella.janitorai.com/bot-avatars";

  // ─── UUID extraction from JanitorAI URL ─────────────────────────
  function extractCharacterId(input) {
    const src = (input || "").trim();
    if (!src) return null;
    // Direct UUID
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const directMatch = src.match(uuidRe);
    if (directMatch && directMatch[0].length === src.length) return directMatch[0];
    // URL
    let path = src;
    try {
      path = decodeURIComponent(new URL(src, JANITORAI_API).pathname);
    } catch {}
    const routeMatch = path.match(
      /\/characters\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[_/?#-]|$)/i
    );
    return routeMatch?.[1] || null;
  }

  // ─── JanitorAI public API call (no auth needed for character data) ─
  async function fetchCharacterData(characterId) {
    const res = await fetch(`${JANITORAI_API}/hampter/characters/${characterId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`JanitorAI API returned ${res.status}`);
    return res.json();
  }

  // ─── Normalize raw JanitorAI data to V2 character card spec ──────
  function stripJanitorAttribution(text) {
    return (text || "").replace(/\n{0,3}\s*created by[^\n]*janitorai\.com\s*$/i, "").trim();
  }

  function normalizeTags(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((t) => (typeof t === "string" ? t : t?.name || "")).filter(Boolean);
  }

  function buildCardData(characterPayload) {
    const c = characterPayload || {};
    const description = stripJanitorAttribution(c.personality || c.description || "");
    const scenario = stripJanitorAttribution(c.scenario || "");
    const firstMes = stripJanitorAttribution(c.first_message || "");
    const mesExample = stripJanitorAttribution(c.example_dialogs || "");
    const altGreetings = Array.isArray(c.first_messages)
      ? c.first_messages.slice(1).map(stripJanitorAttribution)
      : [];

    const cardData = {
      name: c.name || "Unknown",
      description,
      personality: "",
      scenario,
      first_mes: firstMes,
      mes_example: mesExample,
      creator_notes: c.description || "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: altGreetings,
      tags: normalizeTags(c.tags),
      creator: c.creator_name || "unknown",
      character_version: `https://janitorai.com/characters/${c.id}`,
      extensions: {},
    };

    // Character book (lorebook) if present
    if (c.character_book && Object.keys(c.character_book).length > 0) {
      cardData.character_book = c.character_book;
    }

    return {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: cardData,
    };
  }

  // ─── Fetch avatar and build PNG with embedded card data ──────────
  async function fetchAvatarAsBlob(avatarFilename) {
    if (!avatarFilename) return null;
    const url = `${JANITORAI_AVATAR_BASE}/${avatarFilename}?width=1200`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.blob();
  }

  function convertToPngBlob(imageBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
          "image/png"
        );
      };
      img.onerror = () => reject(new Error("Failed to load avatar image"));
      img.src = URL.createObjectURL(imageBlob);
    });
  }

  // Minimal tEXt chunk encoder for PNG (chara keyword)
  function createPngWithCharaChunk(pngArrayBuffer, charaJsonString) {
    const pngBytes = new Uint8Array(pngArrayBuffer);
    const jsonBytes = new TextEncoder().encode(charaJsonString);

    // Build tEXt chunk: length(4) + "tEXt"(4) + keyword("chara\0") + data + CRC(4)
    const keyword = new TextEncoder().encode("chara\0");
    const chunkData = new Uint8Array(keyword.length + jsonBytes.length);
    chunkData.set(keyword, 0);
    chunkData.set(jsonBytes, keyword.length);

    const chunkType = new TextEncoder().encode("tEXt");
    const lengthBytes = new Uint8Array(4);
    const view = new DataView(lengthBytes.buffer);
    view.setUint32(0, chunkData.length, false); // big-endian

    // CRC over type + data
    const crcInput = new Uint8Array(chunkType.length + chunkData.length);
    crcInput.set(chunkType, 0);
    crcInput.set(chunkData, chunkType.length);
    const crcValue = crc32(crcInput);
    const crcBytes = new Uint8Array(4);
    const crcView = new DataView(crcBytes.buffer);
    crcView.setUint32(0, crcValue, false);

    // Insert before IEND chunk (last 12 bytes)
    const iendPos = pngBytes.length - 12;
    const result = new Uint8Array(pngBytes.length + lengthBytes.length + 4 + chunkData.length + 4);
    result.set(pngBytes.slice(0, iendPos), 0);
    let offset = iendPos;
    result.set(lengthBytes, offset); offset += 4;
    result.set(chunkType, offset); offset += 4;
    result.set(chunkData, offset); offset += chunkData.length;
    result.set(crcBytes, offset); offset += 4;
    result.set(pngBytes.slice(iendPos), offset);
    return result;
  }

  // CRC32 implementation
  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  }
  const CRC_TABLE = makeCrcTable();
  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ─── Build the final import file (PNG with embedded chara data) ───
  async function buildImportFile(characterPayload) {
    const cardJson = buildCardData(characterPayload);
    const avatarFilename = characterPayload?.avatar;

    if (avatarFilename) {
      try {
        const avatarBlob = await fetchAvatarAsBlob(avatarFilename);
        if (avatarBlob) {
          const pngBlob = await convertToPngBlob(avatarBlob);
          const pngBuffer = await pngBlob.arrayBuffer();
          const charaJson = JSON.stringify(cardJson);
          const pngWithChara = createPngWithCharaChunk(pngBuffer, charaJson);
          return {
            blob: new Blob([pngWithChara], { type: "image/png" }),
            filename: sanitizeFilename(cardJson.data.name) + ".png",
          };
        }
      } catch (e) {
        console.warn("[JanitorAI Importer] Avatar fetch/convert failed, falling back to JSON:", e);
      }
    }

    // Fallback: JSON file
    return {
      blob: new Blob([JSON.stringify(cardJson, null, 2)], { type: "application/json" }),
      filename: sanitizeFilename(cardJson.data.name) + ".json",
    };
  }

  function sanitizeFilename(name) {
    return (name || "character").replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_").substring(0, 100);
  }

  // ─── Use TauriTavern's built-in character import via drag-drop or file input ─
  async function importCharacterCard(characterPayload) {
    const { blob, filename } = await buildImportFile(characterPayload);

    // Create a File object
    const file = new File([blob], filename, { type: blob.type });

    // Trigger TauriTavern's built-in character import
    if (typeof window.__TAURITAVERN__?.api?.importCharacter === "function") {
      await window.__TAURITAVERN__.api.importCharacter(file);
    } else {
      // Fallback: use SillyTavern's built-in file import handler
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".png,.json";
      // Use DataTransfer to programmatically set files
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      // Dispatch change event to trigger ST's file handler
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // ─── UI Panel ────────────────────────────────────────────────────
  const PANEL_ID = "janitor-importer-panel";

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="janitor-importer-header">
        <span id="janitor-importer-title">JanitorAI Importer</span>
        <button id="janitor-importer-close" title="Close">&times;</button>
      </div>
      <div id="janitor-importer-body">
        <label for="janitor-url-input">Character URL or ID</label>
        <div id="janitor-input-row">
          <input type="text" id="janitor-url-input" placeholder="https://janitorai.com/characters/..." />
          <button id="janitor-import-btn" title="Import">Import</button>
        </div>
        <div id="janitor-status"></div>
        <div id="janitor-preview" style="display:none;">
          <div id="janitor-preview-header">
            <img id="janitor-preview-avatar" />
            <div id="janitor-preview-info">
              <strong id="janitor-preview-name"></strong>
              <span id="janitor-preview-creator"></span>
              <div id="janitor-preview-tags"></div>
            </div>
          </div>
          <button id="janitor-confirm-import">Import to TauriTavern</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    attachPanelEvents(panel);
  }

  let pendingCharacterPayload = null;

  function attachPanelEvents(panel) {
    const urlInput = panel.querySelector("#janitor-url-input");
    const importBtn = panel.querySelector("#janitor-import-btn");
    const closeBtn = panel.querySelector("#janitor-importer-close");
    const statusEl = panel.querySelector("#janitor-status");
    const previewEl = panel.querySelector("#janitor-preview");
    const confirmBtn = panel.querySelector("#janitor-confirm-import");

    closeBtn.addEventListener("click", () => panel.remove());

    importBtn.addEventListener("click", async () => {
      const input = urlInput.value.trim();
      if (!input) {
        setStatus(statusEl, "Please enter a JanitorAI URL or character ID.", "error");
        return;
      }
      const characterId = extractCharacterId(input);
      if (!characterId) {
        setStatus(statusEl, "Invalid URL or character ID.", "error");
        return;
      }
      setStatus(statusEl, "Fetching character data...", "loading");
      importBtn.disabled = true;

      try {
        const data = await fetchCharacterData(characterId);
        pendingCharacterPayload = data;
        showPreview(previewEl, data);
        setStatus(statusEl, "Character found! Review and click Import.", "success");
      } catch (e) {
        setStatus(statusEl, `Error: ${e.message}`, "error");
        pendingCharacterPayload = null;
      } finally {
        importBtn.disabled = false;
      }
    });

    // Enter key triggers import
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") importBtn.click();
    });

    confirmBtn.addEventListener("click", async () => {
      if (!pendingCharacterPayload) return;
      setStatus(statusEl, "Importing character...", "loading");
      confirmBtn.disabled = true;
      try {
        await importCharacterCard(pendingCharacterPayload);
        setStatus(statusEl, "Character imported successfully!", "success");
        pendingCharacterPayload = null;
        previewEl.style.display = "none";
      } catch (e) {
        setStatus(statusEl, `Import failed: ${e.message}`, "error");
      } finally {
        confirmBtn.disabled = false;
      }
    });
  }

  function showPreview(previewEl, data) {
    previewEl.style.display = "block";
    const c = data || {};
    previewEl.querySelector("#janitor-preview-name").textContent = c.name || "Unknown";
    previewEl.querySelector("#janitor-preview-creator").textContent = c.creator_name
      ? `by ${c.creator_name}`
      : "";
    const avatar = previewEl.querySelector("#janitor-preview-avatar");
    if (c.avatar) {
      avatar.src = `${JANITORAI_AVATAR_BASE}/${c.avatar}?width=200`;
      avatar.style.display = "block";
    } else {
      avatar.style.display = "none";
    }
    const tagsEl = previewEl.querySelector("#janitor-preview-tags");
    const tags = Array.isArray(c.tags)
      ? c.tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean)
      : [];
    tagsEl.textContent = tags.slice(0, 8).join(", ") + (tags.length > 8 ? "..." : "");
  }

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = "janitor-status " + (type || "");
  }

  // ─── Extension entry point ───────────────────────────────────────
  jQuery(async () => {
    // Wait for TauriTavern to be ready
    if (window.__TAURITAVERN__?.ready) {
      await window.__TAURITAVERN__.ready;
    } else if (window.__TAURITAVERN_MAIN_READY__) {
      await window.__TAURITAVERN_MAIN_READY__;
    }

    // Add button to the character list panel
    const addImportButton = () => {
      // Target the "Create New Character" button area
      const navMenu = document.querySelector("#left-nav-panel");
      if (!navMenu) return false;

      // Avoid duplicate buttons
      if (document.getElementById("janitor-importer-trigger")) return true;

      const btn = document.createElement("div");
      btn.id = "janitor-importer-trigger";
      btn.className = "list-group-item flex-container flexGap5";
      btn.innerHTML = `
        <i class="fa-solid fa-download"></i>
        <span>JanitorAI Import</span>
      `;
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
          panel.remove();
        } else {
          createPanel();
        }
      });

      // Insert after the "New Character" button
      const newCharBtn = document.querySelector("#create_new_button");
      if (newCharBtn && newCharBtn.parentElement) {
        newCharBtn.parentElement.after(btn);
      } else {
        navMenu.querySelector("#character_list")?.before(btn);
      }
      return true;
    };

    // Retry until the UI is ready
    let attempts = 0;
    const tryAdd = setInterval(() => {
      if (addImportButton() || ++attempts > 60) clearInterval(tryAdd);
    }, 500);
  });
})();