// index.js
import { embedText, cosineSimilarity, hashText } from './provider.js';
import { getVector, setVector, listVectorKeys, KEY_PREFIX } from './vector-store.js';

const MODULE_NAME = 'tt-embeddings';
const MAX_BATCH = 16; // cap per HTTP request — keep mobile requests small
const TOP_K_CHAT = 5;
const TOP_K_LORE = 4;
const SIM_THRESHOLD = 0.72; // tune per-model; cosine sim cutoff for "relevant enough"

let config = {
    provider: 'openai', // 'openai' | 'cohere' | 'local'
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'text-embedding-3-small',
    chatMemoryEnabled: false,
    lorebookEnabled: false,
};

function getContext() {
    // SillyTavern (and TauriTavern, which keeps this global for compat) exposes
    // this on window for extensions.
    return window.SillyTavern.getContext();
}

function isTauriTavern() {
    return !!window.__TAURITAVERN__;
}

// ---------------------------------------------------------------------------
// Config persistence — small blob, so this uses metadata.* on TauriTavern
// (per ExtensionDEV.md: "适合存储进度、配置项、短摘要等小状态"), and falls
// back to extension_settings on plain SillyTavern.
// ---------------------------------------------------------------------------

async function loadConfig() {
    if (isTauriTavern()) {
        await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
        const meta = await window.__TAURITAVERN__.api.chat.metadata.get();
        const saved = meta?.extensions?.[MODULE_NAME];
        if (saved) config = { ...config, ...saved };
    } else {
        const ctx = getContext();
        const saved = ctx.extensionSettings?.[MODULE_NAME];
        if (saved) config = { ...config, ...saved };
    }
}

async function saveConfig() {
    if (isTauriTavern()) {
        await window.__TAURITAVERN__.api.chat.metadata.setExtension({
            namespace: MODULE_NAME,
            value: config,
        });
    } else {
        const ctx = getContext();
        ctx.extensionSettings[MODULE_NAME] = config;
        ctx.saveSettingsDebounced();
    }
}

// ---------------------------------------------------------------------------
// Chat memory pipeline
// ---------------------------------------------------------------------------

/**
 * Embeds any chat messages that don't yet have a stored (or up-to-date)
 * vector. Safe to call frequently — it's a no-op for unchanged messages.
 */
async function ensureChatEmbeddings(chatId, messages) {
    const toEmbed = [];
    const meta = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg?.mes) continue;
        const hash = hashText(msg.mes);
        const key = `${KEY_PREFIX.chat}${i}`;
        const existing = await getVector(chatId, key).catch(() => null);
        if (existing?.hash === hash) continue; // unchanged, skip
        toEmbed.push(msg.mes);
        meta.push({ index: i, key, hash, text: msg.mes, role: msg.is_user ? 'user' : 'assistant' });
    }

    for (let i = 0; i < toEmbed.length; i += MAX_BATCH) {
        const batchTexts = toEmbed.slice(i, i + MAX_BATCH);
        const batchMeta = meta.slice(i, i + MAX_BATCH);
        const vectors = await embedText(batchTexts, config);
        for (let j = 0; j < vectors.length; j++) {
            const m = batchMeta[j];
            await setVector(chatId, m.key, {
                vector: vectors[j],
                hash: m.hash,
                text: m.text,
                role: m.role,
                model: config.model,
            });
        }
    }
}

/** Returns the top-K most semantically relevant past messages for a query string. */
async function retrieveRelevantMessages(chatId, queryText, excludeLastN = 1) {
    const [queryVec] = await embedText([queryText], config);
    const keys = await listVectorKeys(chatId, KEY_PREFIX.chat);

    const scored = [];
    for (const key of keys) {
        const entry = await getVector(chatId, key);
        if (!entry?.vector) continue;
        scored.push({ key, score: cosineSimilarity(queryVec, entry.vector), entry });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored
        .filter((s) => s.score >= SIM_THRESHOLD)
        .slice(excludeLastN) // skip the message(s) that triggered this, usually the most recent
        .slice(0, TOP_K_CHAT);
}

// ---------------------------------------------------------------------------
// Lorebook / World Info pipeline
// ---------------------------------------------------------------------------

async function ensureLoreEmbeddings(chatId, entries) {
    const toEmbed = [];
    const meta = [];

    for (const entry of entries) {
        if (!entry?.content) continue;
        const hash = hashText(entry.content);
        const key = `${KEY_PREFIX.lore}${entry.uid}`;
        const existing = await getVector(chatId, key).catch(() => null);
        if (existing?.hash === hash) continue;
        toEmbed.push(entry.content);
        meta.push({ uid: entry.uid, key, hash, text: entry.content, comment: entry.comment });
    }

    for (let i = 0; i < toEmbed.length; i += MAX_BATCH) {
        const batchTexts = toEmbed.slice(i, i + MAX_BATCH);
        const batchMeta = meta.slice(i, i + MAX_BATCH);
        const vectors = await embedText(batchTexts, config);
        for (let j = 0; j < vectors.length; j++) {
            const m = batchMeta[j];
            await setVector(chatId, m.key, {
                vector: vectors[j],
                hash: m.hash,
                text: m.text,
                comment: m.comment,
                model: config.model,
            });
        }
    }
}

async function retrieveRelevantLoreEntries(chatId, contextText) {
    const [queryVec] = await embedText([contextText], config);
    const keys = await listVectorKeys(chatId, KEY_PREFIX.lore);

    const scored = [];
    for (const key of keys) {
        const entry = await getVector(chatId, key);
        if (!entry?.vector) continue;
        scored.push({ key, score: cosineSimilarity(queryVec, entry.vector), entry });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= SIM_THRESHOLD).slice(0, TOP_K_LORE);
}

// ---------------------------------------------------------------------------
// Generation hook — runs before the prompt is built, injects retrieved
// context as an extra system note. Hooked via SillyTavern's eventSource,
// which TauriTavern's frontend preserves for compatibility.
// ---------------------------------------------------------------------------

async function onBeforeGeneration() {
    if (!config.chatMemoryEnabled && !config.lorebookEnabled) return;
    if (!config.apiKey && config.provider !== 'local') return;

    const ctx = getContext();
    const chatId = ctx.chatId ?? ctx.getCurrentChatId?.() ?? 'default';
    const chat = ctx.chat || [];
    if (!chat.length) return;

    const lastMessage = chat[chat.length - 1];
    const queryText = lastMessage?.mes;
    if (!queryText) return;

    const injections = [];

    try {
        if (config.chatMemoryEnabled) {
            await ensureChatEmbeddings(chatId, chat);
            const relevant = await retrieveRelevantMessages(chatId, queryText);
            if (relevant.length) {
                const block = relevant
                    .map((r) => `[${r.entry.role}]: ${r.entry.text}`)
                    .join('\n');
                injections.push(`[Relevant past context]\n${block}`);
            }
        }

        if (config.lorebookEnabled) {
            const worldInfo = ctx.world_info?.entries ? Object.values(ctx.world_info.entries) : [];
            if (worldInfo.length) {
                await ensureLoreEmbeddings(chatId, worldInfo);
                const relevant = await retrieveRelevantLoreEntries(chatId, queryText);
                if (relevant.length) {
                    const block = relevant.map((r) => r.entry.text).join('\n');
                    injections.push(`[Relevant lore]\n${block}`);
                }
            }
        }
    } catch (err) {
        console.error('[tt-embeddings] retrieval failed:', err);
        return; // fail open — don't block generation if the embedding API is down
    }

    if (injections.length) {
        // setExtensionPrompt is SillyTavern's standard mechanism for extensions
        // to inject extra context into the prompt without touching chat history.
        ctx.setExtensionPrompt(
            MODULE_NAME,
            injections.join('\n\n'),
            1, // position: in-chat, near the top
            0, // depth
            false,
        );
    }
}

// ---------------------------------------------------------------------------
// Settings UI wiring
// ---------------------------------------------------------------------------

async function loadSettingsHtml() {
    const resp = await fetch('/scripts/extensions/third-party/tt-embeddings/ui/settings.html');
    return resp.text();
}

function bindSettingsUi(root) {
    const $ = (sel) => root.querySelector(sel);

    $('#tte-provider').value = config.provider;
    $('#tte-base-url').value = config.baseUrl;
    $('#tte-api-key').value = config.apiKey;
    $('#tte-model').value = config.model;
    $('#tte-chat-toggle').checked = config.chatMemoryEnabled;
    $('#tte-lore-toggle').checked = config.lorebookEnabled;

    $('#tte-provider').addEventListener('change', async (e) => {
        config.provider = e.target.value;
        await saveConfig();
    });
    $('#tte-base-url').addEventListener('change', async (e) => {
        config.baseUrl = e.target.value.trim();
        await saveConfig();
    });
    $('#tte-api-key').addEventListener('change', async (e) => {
        config.apiKey = e.target.value.trim();
        await saveConfig();
    });
    $('#tte-model').addEventListener('change', async (e) => {
        config.model = e.target.value.trim();
        await saveConfig();
    });
    $('#tte-chat-toggle').addEventListener('change', async (e) => {
        config.chatMemoryEnabled = e.target.checked;
        await saveConfig();
    });
    $('#tte-lore-toggle').addEventListener('change', async (e) => {
        config.lorebookEnabled = e.target.checked;
        await saveConfig();
    });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async function init() {
    if (isTauriTavern()) {
        await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
    }

    await loadConfig();

    const ctx = getContext();
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (container) {
        const html = await loadSettingsHtml();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        container.appendChild(wrapper);
        bindSettingsUi(wrapper);
    }

    // SillyTavern's standard event hook fired right before a generation
    // request is sent. TauriTavern keeps eventSource for compatibility.
    ctx.eventSource.on(ctx.event_types.GENERATE_BEFORE_COMBINE_PROMPTS, onBeforeGeneration);

    console.log('[tt-embeddings] loaded', { tauriTavern: isTauriTavern() });
})();
