// provider.js
// Thin abstraction over remote embedding APIs. All providers expose:
//   embed(texts: string[], config) -> Promise<number[][]>
// Add new providers by adding a case to embedText() below.

/**
 * Calls an OpenAI-compatible /embeddings endpoint.
 * Works for OpenAI itself, and any local/self-hosted server that mirrors
 * the OpenAI embeddings schema (e.g. Ollama's /v1/embeddings, LM Studio, etc).
 */
async function embedOpenAICompatible(texts, config) {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: config.model,
            input: texts,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    // OpenAI returns data.data, sorted by `index`. Sort defensively.
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
}

/**
 * Calls Cohere's /v2/embed endpoint.
 */
async function embedCohere(texts, config) {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v2/embed`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            texts,
            input_type: 'search_document',
            embedding_types: ['float'],
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.embeddings.float;
}

/**
 * Embeds a batch of texts using whichever provider is configured.
 * Batches should be kept modest in size (see MAX_BATCH in index.js) since
 * mobile connections may be slow/metered.
 */
export async function embedText(texts, config) {
    if (!texts.length) return [];

    switch (config.provider) {
        case 'cohere':
            return embedCohere(texts, config);
        case 'openai':
        case 'local':
        default:
            return embedOpenAICompatible(texts, config);
    }
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Simple, fast, non-cryptographic hash for change detection (FNV-1a). */
export function hashText(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}
