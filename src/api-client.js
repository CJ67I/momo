/**
 * Isolated LLM client for Momo.
 *
 * Prefer SillyTavern backend `/api/backends/chat-completions/generate` so phone
 * features never touch the main Generate UI / TempResponseLength / generateRaw.
 *
 * generateRaw is intentionally NOT used by default: it temporarily mutates
 * `oai_settings.openai_max_tokens` and races CHAT_COMPLETION_SETTINGS_READY,
 * which is a known cause of empty / truncated main-chat replies.
 */

const SETTINGS_TTL_MS = 20_000;

let activeCount = 0;
let mainChatBusy = false;
let guardBound = false;
let settingsCache = null;
let settingsCacheAt = 0;
let csrfToken = '';

/** @type {AbortController[]} */
let inflightControllers = [];

/** Serialize Momo completions so we never stampede the proxy. */
let chain = Promise.resolve();

function getCtx() {
    try {
        return window.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isStopButtonVisible() {
    try {
        const el = document.getElementById('mes_stop');
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        return style ? style.display !== 'none' : el.style.display !== 'none';
    } catch {
        return false;
    }
}

function isStreamingActive() {
    try {
        const sp = getCtx()?.streamingProcessor;
        return Boolean(sp && sp.isFinished === false);
    } catch {
        return false;
    }
}

export function isApiClientBusy() {
    return activeCount > 0;
}

/** True while SillyTavern main chat is generating / streaming. */
export function isMainChatGenerating() {
    return mainChatBusy || isStreamingActive() || isStopButtonVisible();
}

function abortInflightMomo(reason = 'main_chat_started') {
    const list = inflightControllers.splice(0, inflightControllers.length);
    for (const c of list) {
        try {
            c.abort(reason);
        } catch {
            /* ignore */
        }
    }
}

function trackController(controller) {
    inflightControllers.push(controller);
    const drop = () => {
        const i = inflightControllers.indexOf(controller);
        if (i >= 0) inflightControllers.splice(i, 1);
    };
    controller.signal.addEventListener('abort', drop, { once: true });
    return drop;
}

/** Bind once: pause/abort Momo while the main chat Generate pipeline runs. */
export function ensureGenerationGuard() {
    if (guardBound) return;
    const ctx = getCtx();
    const es = ctx?.eventSource;
    const et = ctx?.eventTypes || ctx?.event_types;
    if (!es?.on || !et) {
        // Retry later — ST may not be ready at first mount
        return;
    }

    const start = et.GENERATION_STARTED || et.generation_started;
    const end = et.GENERATION_ENDED || et.generation_ended;
    const stopped = et.GENERATION_STOPPED || et.generation_stopped;

    if (start) {
        es.on(start, () => {
            mainChatBusy = true;
            abortInflightMomo('main_chat_started');
        });
    }
    if (end) {
        es.on(end, () => { mainChatBusy = false; });
    }
    if (stopped) {
        es.on(stopped, () => { mainChatBusy = false; });
    }

    // Extra safety: some ST paths finish without GENERATION_ENDED
    const received = et.MESSAGE_RECEIVED || et.message_received;
    if (received) {
        es.on(received, () => {
            if (!isStreamingActive() && !isStopButtonVisible()) {
                mainChatBusy = false;
            }
        });
    }

    guardBound = true;
}

async function waitWhileMainBusy(timeoutMs = 180_000) {
    ensureGenerationGuard();
    const t0 = Date.now();
    while (isMainChatGenerating()) {
        if (Date.now() - t0 > timeoutMs) {
            throw new Error('main_chat_busy');
        }
        await sleep(250);
    }
}

async function refreshCsrf() {
    try {
        const res = await fetch('/csrf-token', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            csrfToken = String(data?.token || '');
        }
    } catch {
        /* ignore */
    }
    return csrfToken;
}

async function getJsonHeaders({ forceRefresh = false } = {}) {
    const ctx = getCtx();
    if (typeof ctx?.getRequestHeaders === 'function') {
        try {
            return ctx.getRequestHeaders();
        } catch {
            /* fall through */
        }
    }
    if (forceRefresh || !csrfToken) await refreshCsrf();
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
    };
}

async function loadTavernSettings(force = false) {
    if (!force && settingsCache && Date.now() - settingsCacheAt < SETTINGS_TTL_MS) {
        return settingsCache;
    }

    const headers = await getJsonHeaders();
    let res = await fetch('/api/settings/get', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
    });

    if (res.status === 403) {
        await refreshCsrf();
        res = await fetch('/api/settings/get', {
            method: 'POST',
            headers: await getJsonHeaders({ forceRefresh: true }),
            credentials: 'include',
            body: JSON.stringify({}),
        });
    }

    if (!res.ok) {
        throw new Error(`settings/get ${res.status}`);
    }

    const serverData = await res.json();
    const parsed = typeof serverData?.settings === 'string'
        ? JSON.parse(serverData.settings || '{}')
        : (serverData?.settings || serverData || {});

    settingsCache = parsed;
    settingsCacheAt = Date.now();
    return parsed;
}

/**
 * Prefer live in-memory Chat Completion settings (same object ST uses).
 * Fall back to /api/settings/get snapshot.
 */
async function resolveOaiSettings() {
    const ctx = getCtx();
    const live = ctx?.chatCompletionSettings;
    if (live && typeof live === 'object') {
        return live;
    }
    const settings = await loadTavernSettings();
    return settings.oai_settings || settings;
}

function domVal(id) {
    try {
        return String(document.getElementById(id)?.value || '').trim();
    } catch {
        return '';
    }
}

function resolveChatSource(oai) {
    return String(
        domVal('chat_completion_source')
        || oai.chat_completion_source
        || 'openai',
    );
}

function resolveModel(oai, source) {
    const fromDom = {
        openai: domVal('model_openai_select') || domVal('model_openai'),
        openrouter: domVal('model_openrouter'),
        custom: domVal('custom_model_id') || domVal('custom_model'),
        claude: domVal('model_claude_select') || domVal('model_claude'),
        makersuite: domVal('model_google_select'),
        deepseek: domVal('model_deepseek_select'),
        groq: domVal('model_groq_select'),
        mistralai: domVal('model_mistralai_select'),
        siliconflow: domVal('model_siliconflow_select'),
        moonshot: domVal('model_moonshot_select'),
        xai: domVal('model_xai_select'),
    }[source];

    if (fromDom) return fromDom;

    const fromSettings = {
        openai: oai.openai_model,
        openrouter: oai.openrouter_model,
        custom: oai.custom_model,
        claude: oai.claude_model,
        makersuite: oai.google_model,
        deepseek: oai.deepseek_model,
        groq: oai.groq_model,
        mistralai: oai.mistralai_model,
        siliconflow: oai.siliconflow_model,
        moonshot: oai.moonshot_model,
        xai: oai.xai_model,
        azure_openai: oai.azure_openai_model,
    }[source];

    return String(fromSettings || oai.openai_model || oai.custom_model || 'gpt-4o-mini');
}

function buildMessages(systemPrompt, prompt) {
    const messages = [];
    const sys = String(systemPrompt || '').trim();
    const user = String(prompt || '').trim();
    if (sys) messages.push({ role: 'system', content: sys });
    messages.push({ role: 'user', content: user || ' ' });
    return messages;
}

function extractText(data) {
    if (data == null) return '';
    if (typeof data === 'string') return data.trim();

    const choice = data?.choices?.[0];
    if (choice?.message?.content != null) {
        const c = choice.message.content;
        if (typeof c === 'string') return c.trim();
        if (Array.isArray(c)) {
            return c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('').trim();
        }
    }
    if (typeof choice?.text === 'string') return choice.text.trim();
    if (typeof data?.content === 'string') return data.content.trim();
    if (typeof data?.response === 'string') return data.response.trim();
    // Some providers put text in reasoning-only; still treat as empty for callers
    return '';
}

/**
 * Build a quiet-type payload for ST backend (stream off — never touches chat UI).
 */
function buildGeneratePayload(oai, messages, maxTokens) {
    const source = resolveChatSource(oai);
    const model = resolveModel(oai, source);
    const temp = Number(oai.temp_openai);
    const topP = Number(oai.top_p_openai);
    const freq = Number(oai.freq_pen_openai);
    const pres = Number(oai.pres_pen_openai);
    const tokens = Math.max(16, Math.min(4096, Number(maxTokens) || Number(oai.openai_max_tokens) || 600));

    /** @type {Record<string, unknown>} */
    const payload = {
        type: 'quiet',
        messages,
        model,
        temperature: Number.isFinite(temp) ? temp : 1,
        frequency_penalty: Number.isFinite(freq) ? freq : 0,
        presence_penalty: Number.isFinite(pres) ? pres : 0,
        top_p: Number.isFinite(topP) ? topP : 1,
        max_tokens: tokens,
        stream: false,
        chat_completion_source: source,
        user_name: getCtx()?.name1 || 'User',
        char_name: getCtx()?.name2 || 'Assistant',
        group_names: [],
        include_reasoning: false,
    };

    const reverseProxy = String(oai.reverse_proxy || domVal('openai_reverse_proxy') || '').trim();
    const proxyPassword = String(oai.proxy_password || domVal('openai_proxy_password') || '');
    if (reverseProxy) {
        payload.reverse_proxy = reverseProxy;
        payload.proxy_password = proxyPassword;
    }

    if (source === 'custom') {
        payload.custom_url = String(oai.custom_url || domVal('custom_api_url_text') || '').trim();
        payload.custom_include_body = oai.custom_include_body || '';
        payload.custom_exclude_body = oai.custom_exclude_body || '';
        payload.custom_include_headers = oai.custom_include_headers || '';
    }

    if (source === 'azure_openai') {
        payload.azure_base_url = oai.azure_base_url || '';
        payload.azure_deployment_name = oai.azure_deployment_name || '';
        payload.azure_api_version = oai.azure_api_version || '';
    }

    return payload;
}

async function completeViaBackend(systemPrompt, prompt, maxTokens, signal) {
    const oai = await resolveOaiSettings();
    const messages = buildMessages(systemPrompt, prompt);
    const payload = buildGeneratePayload(oai, messages, maxTokens);

    const post = async (forceRefresh) => fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: await getJsonHeaders({ forceRefresh }),
        credentials: 'include',
        body: JSON.stringify(payload),
        signal,
    });

    let res = await post(false);
    if (res.status === 403) {
        await refreshCsrf();
        res = await post(true);
    }

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`backend generate ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = extractText(data);
    if (!text) throw new Error('backend generate empty');
    return text;
}

/**
 * Last-resort path. Mutates ST TempResponseLength — only use when explicitly allowed
 * and main chat is idle.
 */
async function completeViaGenerateRaw(systemPrompt, prompt, maxTokens) {
    const ctx = getCtx();
    const generateRaw = ctx?.generateRaw;
    if (typeof generateRaw !== 'function') {
        throw new Error('generateRaw unavailable');
    }
    if (isMainChatGenerating()) {
        throw new Error('generateRaw blocked: main chat busy');
    }

    // Object form (modern ST). Do NOT pass responseLength — that triggers
    // TempResponseLength and can permanently corrupt openai_max_tokens.
    try {
        const result = await generateRaw({
            systemPrompt: systemPrompt || undefined,
            prompt,
        });
        const text = String(result || '').trim();
        if (text) return text;
    } catch {
        /* try string form */
    }

    if (isMainChatGenerating()) {
        throw new Error('generateRaw blocked: main chat busy');
    }

    const result = await generateRaw(
        [systemPrompt, prompt].filter(Boolean).join('\n\n'),
    );
    const text = String(result || '').trim();
    if (!text) throw new Error('generateRaw empty');
    return text;
}

async function runComplete(opts) {
    const systemPrompt = String(opts?.systemPrompt || '');
    const prompt = String(opts?.prompt || '');
    const maxTokens = Number(opts?.maxTokens) || 600;
    const allowGenerateRaw = opts?.allowGenerateRaw === true;

    if (!opts?.allowDuringMainChat) {
        await waitWhileMainBusy();
    }

    // Re-check right before network I/O
    if (!opts?.allowDuringMainChat && isMainChatGenerating()) {
        throw new Error('main_chat_busy');
    }

    const controller = new AbortController();
    const untrack = trackController(controller);

    activeCount += 1;
    try {
        try {
            return await completeViaBackend(systemPrompt, prompt, maxTokens, controller.signal);
        } catch (e) {
            if (controller.signal.aborted || e?.name === 'AbortError') {
                throw new Error('aborted_for_main_chat');
            }
            if (!allowGenerateRaw) {
                console.warn('[st-momo] backend generate failed (no generateRaw fallback)', e);
                throw e;
            }
            console.warn('[st-momo] backend generate failed, fallback generateRaw', e);
            if (!opts?.allowDuringMainChat) await waitWhileMainBusy();
            return await completeViaGenerateRaw(systemPrompt, prompt, maxTokens);
        }
    } finally {
        untrack();
        activeCount = Math.max(0, activeCount - 1);
    }
}

/**
 * Main entry: isolated completion for Momo features.
 * Requests are serialized; in-flight calls abort when main chat starts.
 *
 * @param {{
 *  systemPrompt?: string,
 *  prompt: string,
 *  maxTokens?: number,
 *  allowDuringMainChat?: boolean,
 *  allowGenerateRaw?: boolean,
 * }} opts
 * @returns {Promise<string>}
 */
export async function momoComplete(opts) {
    ensureGenerationGuard();
    const job = chain.then(() => runComplete(opts), () => runComplete(opts));
    // Keep the chain alive even if a job fails
    chain = job.catch(() => {});
    return job;
}

/** Convenience for modules that previously called generateRaw directly. */
export async function callMomoGenerate(systemPrompt, userPrompt, responseLength = 600) {
    return momoComplete({
        systemPrompt,
        prompt: userPrompt,
        maxTokens: responseLength,
        // Never fall back to generateRaw — callers already have local fallbacks.
        allowGenerateRaw: false,
    });
}
