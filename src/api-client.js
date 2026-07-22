/**
 * Isolated LLM client for Momo — modeled after dual-track phone extensions:
 * prefer SillyTavern *backend* chat-completions (no main-chat UI / Generate lock),
 * fall back to generateRaw only if backend path fails.
 *
 * Original implementation; does not copy third-party proprietary code.
 */

const SETTINGS_TTL_MS = 20_000;

let activeCount = 0;
let mainChatBusy = false;
let guardBound = false;
let settingsCache = null;
let settingsCacheAt = 0;
let csrfToken = '';

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

export function isApiClientBusy() {
    return activeCount > 0;
}

export function isMainChatGenerating() {
    return mainChatBusy;
}

/** Bind once: pause Momo calls while the main chat Generate pipeline runs. */
export function ensureGenerationGuard() {
    if (guardBound) return;
    const ctx = getCtx();
    const es = ctx?.eventSource;
    const et = ctx?.eventTypes || ctx?.event_types;
    if (!es?.on || !et) return;

    const start = et.GENERATION_STARTED || et.generation_started;
    const end = et.GENERATION_ENDED || et.generation_ended;
    const stopped = et.GENERATION_STOPPED || et.generation_stopped;

    if (start) {
        es.on(start, () => { mainChatBusy = true; });
    }
    if (end) {
        es.on(end, () => { mainChatBusy = false; });
    }
    if (stopped) {
        es.on(stopped, () => { mainChatBusy = false; });
    }
    guardBound = true;
}

async function waitWhileMainBusy(timeoutMs = 180_000) {
    ensureGenerationGuard();
    const t0 = Date.now();
    while (mainChatBusy) {
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

async function completeViaBackend(systemPrompt, prompt, maxTokens) {
    const settings = await loadTavernSettings();
    const oai = settings.oai_settings || settings;
    const messages = buildMessages(systemPrompt, prompt);
    const payload = buildGeneratePayload(oai, messages, maxTokens);

    const post = async (forceRefresh) => fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: await getJsonHeaders({ forceRefresh }),
        credentials: 'include',
        body: JSON.stringify(payload),
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

async function completeViaGenerateRaw(systemPrompt, prompt, maxTokens) {
    const ctx = getCtx();
    const generateRaw = ctx?.generateRaw;
    if (typeof generateRaw !== 'function') {
        throw new Error('generateRaw unavailable');
    }

    try {
        const result = await generateRaw({
            systemPrompt: systemPrompt || undefined,
            prompt,
            responseLength: maxTokens || 600,
        });
        const text = String(result || '').trim();
        if (text) return text;
    } catch {
        /* try string form */
    }

    const result = await generateRaw(
        [systemPrompt, prompt].filter(Boolean).join('\n\n'),
    );
    const text = String(result || '').trim();
    if (!text) throw new Error('generateRaw empty');
    return text;
}

/**
 * Main entry: isolated completion for Momo features.
 * @param {{ systemPrompt?: string, prompt: string, maxTokens?: number, allowDuringMainChat?: boolean }} opts
 * @returns {Promise<string>}
 */
export async function momoComplete(opts) {
    const systemPrompt = String(opts?.systemPrompt || '');
    const prompt = String(opts?.prompt || '');
    const maxTokens = Number(opts?.maxTokens) || 600;

    if (!opts?.allowDuringMainChat) {
        await waitWhileMainBusy();
    }

    activeCount += 1;
    try {
        try {
            return await completeViaBackend(systemPrompt, prompt, maxTokens);
        } catch (e) {
            console.warn('[st-momo] backend generate failed, fallback generateRaw', e);
            if (!opts?.allowDuringMainChat) await waitWhileMainBusy();
            return await completeViaGenerateRaw(systemPrompt, prompt, maxTokens);
        }
    } finally {
        activeCount = Math.max(0, activeCount - 1);
    }
}

/** Convenience for modules that previously called generateRaw directly. */
export async function callMomoGenerate(systemPrompt, userPrompt, responseLength = 600) {
    return momoComplete({
        systemPrompt,
        prompt: userPrompt,
        maxTokens: responseLength,
    });
}
