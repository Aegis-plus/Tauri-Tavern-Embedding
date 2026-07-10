// vector-store.js
// Persistence layer. Prefers TauriTavern's store.* KV (per-chat, real backend
// storage, no payload bloat). Falls back to extension_settings (SillyTavern's
// own settings object, which is itself just localStorage-backed) when running
// in plain SillyTavern so the extension still works there, just without the
// nicer per-chat isolation TauriTavern gives us.

const NAMESPACE = 'tt-embeddings';

function isTauriTavern() {
    return !!window.__TAURITAVERN__;
}

async function ttStore() {
    await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
    return window.__TAURITAVERN__.api.chat.store;
}

// --- Fallback path for plain SillyTavern (no store.* host API) ---
// Keyed by chat id so different chats don't collide.
function fallbackKey(chatId, key) {
    return `${NAMESPACE}:${chatId}:${key}`;
}

function fallbackGet(chatId, key) {
    const raw = localStorage.getItem(fallbackKey(chatId, key));
    return raw ? JSON.parse(raw) : null;
}

function fallbackSet(chatId, key, value) {
    localStorage.setItem(fallbackKey(chatId, key), JSON.stringify(value));
}

function fallbackDelete(chatId, key) {
    localStorage.removeItem(fallbackKey(chatId, key));
}

function fallbackListKeys(chatId, prefix) {
    const out = [];
    const search = fallbackKey(chatId, prefix);
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(search)) {
            out.push(k.slice(`${NAMESPACE}:${chatId}:`.length));
        }
    }
    return out;
}

// --- Public API ---

export async function getVector(chatId, key) {
    if (isTauriTavern()) {
        const store = await ttStore();
        return store.getJson({ namespace: NAMESPACE, key });
    }
    return fallbackGet(chatId, key);
}

export async function setVector(chatId, key, value) {
    if (isTauriTavern()) {
        const store = await ttStore();
        return store.setJson({ namespace: NAMESPACE, key, value });
    }
    return fallbackSet(chatId, key, value);
}

export async function deleteVector(chatId, key) {
    if (isTauriTavern()) {
        const store = await ttStore();
        return store.deleteJson({ namespace: NAMESPACE, key });
    }
    return fallbackDelete(chatId, key);
}

export async function listVectorKeys(chatId, prefix) {
    if (isTauriTavern()) {
        const store = await ttStore();
        const keys = await store.listKeys({ namespace: NAMESPACE });
        return (keys || []).filter((k) => k.startsWith(prefix));
    }
    return fallbackListKeys(chatId, prefix);
}

export const KEY_PREFIX = {
    chat: 'chat-vec:',
    lore: 'lore-vec:',
};
