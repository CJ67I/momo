/**
 * Bridge to SillyTavern runtime context:
 * persona / character card / chat log / world info / API status.
 */

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

function clip(text, max = 800) {
    const s = String(text ?? '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…`;
}

/**
 * @returns {{
 *  available: boolean,
 *  online: boolean,
 *  onlineStatus: string,
 *  mainApi: string,
 *  hasGenerateRaw: boolean,
 *  hasGenerateQuiet: boolean,
 *  modelHint: string,
 * }}
 */
export function getApiStatus() {
    const ctx = getCtx();
    if (!ctx) {
        return {
            available: false,
            online: false,
            onlineStatus: 'no_st',
            mainApi: '',
            hasGenerateRaw: false,
            hasGenerateQuiet: false,
            modelHint: '',
        };
    }

    const onlineStatus = String(ctx.onlineStatus ?? 'unknown');
    const offlineMarks = ['no_connection', 'none', 'offline', '', 'undefined', 'null'];
    const online = !offlineMarks.includes(onlineStatus.toLowerCase());

    let modelHint = '';
    try {
        modelHint = ctx.getChatCompletionModel?.() || '';
    } catch {
        modelHint = '';
    }

    return {
        available: true,
        online,
        onlineStatus,
        mainApi: String(ctx.mainApi || ''),
        hasGenerateRaw: typeof ctx.generateRaw === 'function',
        hasGenerateQuiet: typeof ctx.generateQuietPrompt === 'function',
        modelHint: String(modelHint || ''),
    };
}

/** User persona (player side) */
export function getPersonaInfo() {
    const ctx = getCtx();
    if (!ctx) return { name: '', description: '', source: 'none' };

    const name = String(ctx.name1 || '').trim();
    const power = ctx.powerUserSettings || {};
    const description = stripHtml(
        power.persona_description
        || power.personaDescription
        || '',
    );

    return {
        name,
        description: clip(description, 1200),
        source: name || description ? 'st' : 'none',
    };
}

/** Active character card fields */
export function getCharacterInfo() {
    const ctx = getCtx();
    if (!ctx) return null;

    try {
        if (typeof ctx.getCharacterCardFields === 'function') {
            const fields = ctx.getCharacterCardFields() || {};
            const name = String(fields.name || ctx.name2 || '').trim();
            if (!name && !fields.description) return null;
            return {
                name,
                description: clip(stripHtml(fields.description), 1600),
                personality: clip(stripHtml(fields.personality), 1000),
                scenario: clip(stripHtml(fields.scenario), 1000),
                mesExample: clip(stripHtml(fields.mes_example || fields.mesExample), 800),
                firstMes: clip(stripHtml(fields.first_mes || fields.firstMes), 600),
                avatar: ctx.characters?.[ctx.characterId]?.avatar || '',
                source: 'card',
            };
        }
    } catch (e) {
        console.warn('[st-momo] getCharacterCardFields failed', e);
    }

    const ch = ctx.characters?.[ctx.characterId];
    if (!ch) return null;
    const data = ch.data || ch;
    return {
        name: String(ch.name || ctx.name2 || '').trim(),
        description: clip(stripHtml(data.description), 1600),
        personality: clip(stripHtml(data.personality), 1000),
        scenario: clip(stripHtml(data.scenario), 1000),
        mesExample: clip(stripHtml(data.mes_example), 800),
        firstMes: clip(stripHtml(data.first_mes), 600),
        avatar: ch.avatar || '',
        source: 'character',
    };
}

/**
 * Recent SillyTavern main chat messages.
 * @param {number} limit
 */
export function getChatHistory(limit = 16) {
    const ctx = getCtx();
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || chat.length === 0) return [];

    return chat
        .slice(-limit)
        .map((m, idx) => ({
            id: m?.swipe_id != null ? `st_${chat.length - limit + idx}_${m.swipe_id}` : `st_${chat.length - limit + idx}`,
            name: String(m?.name || (m?.is_user ? ctx.name1 : ctx.name2) || ''),
            isUser: Boolean(m?.is_user),
            text: clip(stripHtml(m?.mes || m?.message || ''), 500),
        }))
        .filter((m) => m.text);
}

/**
 * Collect world-info / lorebook snippets relevant to current chat + scan text.
 * @param {string} scanText
 * @param {number} maxChars
 */
export async function getWorldInfoSnippets(scanText = '', maxChars = 2800) {
    const ctx = getCtx();
    if (!ctx) return { text: '', source: 'none', books: [] };

    const books = typeof ctx.getWorldInfoNames === 'function'
        ? ctx.getWorldInfoNames()
        : [];

    // Prefer ST's own scanner (respects keys / budgets)
    if (typeof ctx.getWorldInfoPrompt === 'function') {
        try {
            const lines = getChatHistory(12).map((m) => `${m.name}: ${m.text}`);
            if (scanText) lines.push(String(scanText));
            // ST expects newest-first chat string array in many versions
            const chatScan = [...lines].reverse();
            const result = await ctx.getWorldInfoPrompt(
                chatScan,
                Number(ctx.maxContext) || 4096,
                true,
                {},
            );
            const text = clip(
                result?.worldInfoString
                || [ ...(result?.worldInfoBeforeEntries || []), ...(result?.worldInfoAfterEntries || []) ].join('\n'),
                maxChars,
            );
            if (text) {
                return { text, source: 'scanner', books };
            }
        } catch (e) {
            console.warn('[st-momo] getWorldInfoPrompt failed, fallback load', e);
        }
    }

    // Fallback: load books and pick constant / keyword-matched entries
    if (typeof ctx.loadWorldInfo !== 'function' || !books.length) {
        // Character lorebook embedded in card
        const embedded = extractCharacterBookText(ctx, maxChars);
        return { text: embedded, source: embedded ? 'character_book' : 'none', books };
    }

    const hay = `${scanText}\n${getChatHistory(8).map((m) => m.text).join('\n')}`.toLowerCase();
    const chunks = [];

    for (const name of books.slice(0, 6)) {
        try {
            const data = await ctx.loadWorldInfo(name);
            const entries = Object.values(data?.entries || {});
            for (const entry of entries) {
                if (!entry || entry.disable) continue;
                const content = stripHtml(entry.content);
                if (!content) continue;
                const keys = [].concat(entry.key || [], entry.keys || [], entry.keysecondary || []).map((k) => String(k).toLowerCase()).filter(Boolean);
                const hit = entry.constant || !keys.length || keys.some((k) => hay.includes(k));
                if (hit) chunks.push(`【${name}】${content}`);
                if (chunks.join('\n').length > maxChars) break;
            }
        } catch (e) {
            console.warn('[st-momo] loadWorldInfo failed', name, e);
        }
        if (chunks.join('\n').length > maxChars) break;
    }

    const embedded = extractCharacterBookText(ctx, 800);
    if (embedded) chunks.unshift(embedded);

    return {
        text: clip(chunks.join('\n'), maxChars),
        source: chunks.length ? 'books' : 'none',
        books,
    };
}

function extractCharacterBookText(ctx, maxChars) {
    try {
        const ch = ctx?.characters?.[ctx.characterId];
        const book = ch?.data?.character_book || ch?.character_book;
        const entries = book?.entries || [];
        if (!Array.isArray(entries) || !entries.length) return '';
        const parts = entries
            .filter((e) => e && !e.disable && e.content)
            .slice(0, 12)
            .map((e) => stripHtml(e.content));
        return clip(parts.join('\n'), maxChars);
    } catch {
        return '';
    }
}

/**
 * Bundle everything useful for NPC reply prompting.
 * @param {{peer?: object, userText?: string, momoHistory?: Array}} opts
 */
export async function buildInteractionContext(opts = {}) {
    const { peer, userText = '', momoHistory = [] } = opts;
    const api = getApiStatus();
    const persona = getPersonaInfo();
    const character = getCharacterInfo();
    const stChat = getChatHistory(14);
    const world = await getWorldInfoSnippets(
        [userText, peer?.nickname, peer?.bio, ...(peer?.tags || [])].filter(Boolean).join(' '),
        2600,
    );

    return {
        api,
        persona,
        character,
        stChat,
        world,
        momoHistory,
        peer,
        userText,
    };
}

export function formatContextForPrompt(bundle) {
    const lines = [];

    lines.push('## 玩家人设（酒馆 Persona）');
    if (bundle.persona?.name || bundle.persona?.description) {
        lines.push(`名称：${bundle.persona.name || '玩家'}`);
        if (bundle.persona.description) lines.push(bundle.persona.description);
    } else {
        lines.push('（未读取到 Persona，使用陌陌资料）');
    }

    lines.push('\n## 当前角色卡');
    if (bundle.character?.name) {
        lines.push(`角色名：${bundle.character.name}`);
        if (bundle.character.description) lines.push(`描述：${bundle.character.description}`);
        if (bundle.character.personality) lines.push(`性格：${bundle.character.personality}`);
        if (bundle.character.scenario) lines.push(`场景：${bundle.character.scenario}`);
    } else {
        lines.push('（当前未选中角色卡）');
    }

    lines.push('\n## 世界书/设定摘要');
    lines.push(bundle.world?.text || '（无激活世界书条目）');

    lines.push('\n## 酒馆主聊天最近记录');
    if (bundle.stChat?.length) {
        for (const m of bundle.stChat.slice(-10)) {
            lines.push(`${m.isUser ? '玩家' : m.name || '角色'}: ${m.text}`);
        }
    } else {
        lines.push('（暂无主聊天记录）');
    }

    return lines.join('\n');
}

/** Thumbnail URL helper for character avatars */
export function getCharacterAvatarUrl(avatarFile) {
    const ctx = getCtx();
    if (!avatarFile || typeof ctx?.getThumbnailUrl !== 'function') return '';
    try {
        return ctx.getThumbnailUrl('avatar', avatarFile);
    } catch {
        return '';
    }
}
