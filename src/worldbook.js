/**
 * World book (lorebook) discovery / load / inject for st-momo.
 * Multi-path loading inspired by virtual-phone extension patterns,
 * implemented independently for SillyTavern's public APIs + /api/worldinfo/get.
 */

const GET_ENDPOINT = '/api/worldinfo/get';

function safe(value) {
    return String(value ?? '').trim();
}

function unique(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const t = safe(item);
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

function getCtx() {
    try {
        return window.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function stripHtml(text) {
    return String(text ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function clip(text, max) {
    const s = String(text ?? '').trim();
    return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function isEnabledEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.disable === true || entry.disabled === true) return false;
    if (Object.hasOwn(entry, 'enabled') && entry.enabled === false) return false;
    return true;
}

function normalizeEntries(raw) {
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object') list = Object.values(raw);
    return list
        .filter(isEnabledEntry)
        .map((e, i) => ({
            uid: safe(e.uid ?? e.id ?? i),
            comment: safe(e.comment || e.name || e.title || ''),
            content: stripHtml(e.content || e.text || e.value || ''),
            keys: [].concat(e.key || [], e.keys || [], e.keysecondary || e.keySecondary || [])
                .map((k) => safe(k).toLowerCase())
                .filter(Boolean),
            constant: Boolean(e.constant),
        }))
        .filter((e) => e.content);
}

function normalizeBookData(data) {
    if (!data) return null;
    if (Array.isArray(data)) return { entries: data };
    if (data.entries) return data;
    if (data.data?.entries) return data.data;
    if (data.worldInfo?.entries) return data.worldInfo;
    if (data.world_info?.entries) return data.world_info;
    if (typeof data === 'object') return { entries: data };
    return null;
}

let csrfCache = { token: '', at: 0 };

async function getCsrfToken(force = false) {
    const now = Date.now();
    if (!force && csrfCache.token && now - csrfCache.at < 60_000) return csrfCache.token;
    try {
        const res = await fetch(`/csrf-token?_=${now}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return '';
        const data = await res.json().catch(() => null);
        csrfCache = { token: safe(data?.token), at: now };
        return csrfCache.token;
    } catch {
        return '';
    }
}

async function buildHeaders(forceCsrf = false) {
    const headers = { 'Content-Type': 'application/json' };
    try {
        const ctx = getCtx();
        const fromCtx = ctx?.getRequestHeaders?.();
        if (fromCtx && typeof fromCtx === 'object') Object.assign(headers, fromCtx);
    } catch {
        /* ignore */
    }
    try {
        if (typeof window.getRequestHeaders === 'function') {
            Object.assign(headers, window.getRequestHeaders() || {});
        }
    } catch {
        /* ignore */
    }
    if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        const token = await getCsrfToken(forceCsrf);
        if (token) headers['X-CSRF-Token'] = token;
    }
    return headers;
}

async function postJson(url, body, forceCsrf = false) {
    const headers = await buildHeaders(forceCsrf);
    const res = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (!forceCsrf && [400, 401, 403].includes(res.status) && /csrf|forbidden|invalid token/i.test(text)) {
            csrfCache = { token: '', at: 0 };
            return postJson(url, body, true);
        }
        throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
}

async function loadWorldInfoModule() {
    try {
        return await import('/scripts/world-info.js');
    } catch {
        try {
            return await import('../../../../scripts/world-info.js');
        } catch {
            return null;
        }
    }
}

/**
 * List all discoverable world book names in the tavern.
 */
export async function listWorldBooks() {
    const names = [];

    const ctx = getCtx();
    if (typeof ctx?.getWorldInfoNames === 'function') {
        names.push(...(ctx.getWorldInfoNames() || []));
    }

    try {
        const mod = await loadWorldInfoModule();
        if (Array.isArray(mod?.world_names)) names.push(...mod.world_names);
        if (typeof mod?.updateWorldInfoList === 'function') {
            await mod.updateWorldInfoList();
            if (Array.isArray(mod?.world_names)) names.push(...mod.world_names);
        }
    } catch (e) {
        console.warn('[st-momo] world-info module list failed', e);
    }

    // DOM fallbacks (editor / global selectors)
    for (const selector of ['#world_info option', '#world_editor_select option']) {
        document.querySelectorAll(selector).forEach((opt) => {
            const name = safe(opt.textContent || opt.innerText);
            const val = safe(opt.value);
            if (!name || /^-+$/.test(val) || /pick to edit|选择以编辑|选择世界书/i.test(name)) return;
            names.push(name);
        });
    }

    // Chat-bound lorebook
    try {
        const chatBook = ctx?.chatMetadata?.world_info;
        if (typeof chatBook === 'string') names.push(chatBook);
        else if (Array.isArray(chatBook)) names.push(...chatBook);
    } catch {
        /* ignore */
    }

    // Character primary world binding
    try {
        const ch = ctx?.characters?.[ctx.characterId];
        const bound = ch?.data?.extensions?.world || ch?.data?.extensions?.world_info;
        if (bound) names.push(bound);
    } catch {
        /* ignore */
    }

    return unique(names).map((name, index) => ({
        id: `wb:${name}`,
        name,
        index,
    }));
}

/**
 * Load one world book by name (multi-path).
 */
export async function loadWorldBook(name) {
    const bookName = safe(name);
    if (!bookName) return null;

    const ctx = getCtx();

    // 1) Official context API
    if (typeof ctx?.loadWorldInfo === 'function') {
        try {
            const data = normalizeBookData(await ctx.loadWorldInfo(bookName));
            if (data && normalizeEntries(data.entries).length) {
                return { name: bookName, entries: normalizeEntries(data.entries), source: 'context.loadWorldInfo' };
            }
        } catch (e) {
            console.warn('[st-momo] context.loadWorldInfo failed', bookName, e);
        }
    }

    // 2) Direct world-info module
    try {
        const mod = await loadWorldInfoModule();
        if (typeof mod?.loadWorldInfo === 'function') {
            const data = normalizeBookData(await mod.loadWorldInfo(bookName));
            if (data && normalizeEntries(data.entries).length) {
                return { name: bookName, entries: normalizeEntries(data.entries), source: 'module.loadWorldInfo' };
            }
        }
    } catch (e) {
        console.warn('[st-momo] module.loadWorldInfo failed', bookName, e);
    }

    // 3) HTTP endpoint with alternate payloads
    for (const body of [{ name: bookName }, { world: bookName }, { file: bookName }, { filename: bookName }]) {
        try {
            const data = normalizeBookData(await postJson(GET_ENDPOINT, body));
            if (data && normalizeEntries(data.entries).length) {
                return { name: bookName, entries: normalizeEntries(data.entries), source: `api:${Object.keys(body)[0]}` };
            }
        } catch (e) {
            console.debug('[st-momo] worldinfo api try failed', body, e);
        }
    }

    return null;
}

/**
 * Character embedded book (V2/V3 character_book).
 */
export function loadCharacterEmbeddedBook() {
    const ctx = getCtx();
    try {
        const ch = ctx?.characters?.[ctx.characterId];
        const book = ch?.data?.character_book || ch?.character_book;
        if (!book) return null;
        let entries = book.entries;
        if (typeof ctx?.convertCharacterBook === 'function') {
            try {
                const converted = ctx.convertCharacterBook(book);
                entries = converted?.entries || entries;
            } catch {
                /* keep raw */
            }
        }
        const normalized = normalizeEntries(entries);
        if (!normalized.length) return null;
        return {
            name: safe(book.name) || `${ch?.name || '角色'}·内嵌世界书`,
            entries: normalized,
            source: 'character_book',
        };
    } catch {
        return null;
    }
}

/**
 * Build injectable text from selected books.
 * @param {string[]} selectedNames
 * @param {string} scanText
 * @param {number} maxChars
 * @param {{includeEmbedded?: boolean, preferConstants?: boolean}} options
 */
export async function buildWorldInjectText(selectedNames = [], scanText = '', maxChars = 3200, options = {}) {
    const { includeEmbedded = true, preferAllSelected = true } = options;
    const hay = String(scanText || '').toLowerCase();
    const chunks = [];
    const loaded = [];

    const names = unique(selectedNames);
    for (const name of names) {
        const book = await loadWorldBook(name);
        if (!book) continue;
        loaded.push({ name: book.name, count: book.entries.length, source: book.source });
        for (const entry of book.entries) {
            const hit = preferAllSelected
                || entry.constant
                || !entry.keys.length
                || entry.keys.some((k) => hay.includes(k));
            if (!hit) continue;
            const title = entry.comment ? `【${book.name}/${entry.comment}】` : `【${book.name}】`;
            chunks.push(`${title}\n${entry.content}`);
            if (chunks.join('\n\n').length >= maxChars) break;
        }
        if (chunks.join('\n\n').length >= maxChars) break;
    }

    if (includeEmbedded) {
        const embedded = loadCharacterEmbeddedBook();
        if (embedded) {
            loaded.push({ name: embedded.name, count: embedded.entries.length, source: embedded.source });
            for (const entry of embedded.entries.slice(0, 20)) {
                chunks.unshift(`【${embedded.name}】\n${entry.content}`);
            }
        }
    }

    return {
        text: clip(chunks.join('\n\n'), maxChars),
        loaded,
        source: chunks.length ? 'selected' : 'none',
    };
}
