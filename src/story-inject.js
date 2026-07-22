/**
 * Offline / story injection: push Momo events into SillyTavern main chat.
 */

function getCtx() {
    try {
        return window.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function isEnabled() {
    try {
        return getCtx()?.extensionSettings?.['st-momo']?.settings?.storyInject === true;
    } catch {
        return false;
    }
}

/**
 * @param {string} text
 * @param {{force?: boolean}} opts
 */
export async function injectStoryLine(text, opts = {}) {
    if (!opts.force && !isEnabled()) return false;
    const line = String(text || '').trim();
    if (!line) return false;

    const ctx = getCtx();
    if (!ctx) return false;

    const mes = `【陌陌】${line}`;

    try {
        if (typeof ctx.sendSystemMessage === 'function') {
            // ST: sendSystemMessage(type, text)
            try {
                ctx.sendSystemMessage('generic', mes);
            } catch {
                ctx.sendSystemMessage(mes);
            }
            ctx.saveChat?.();
            return true;
        }
    } catch (e) {
        console.warn('[st-momo] sendSystemMessage failed', e);
    }

    try {
        const msg = {
            name: '陌陌',
            is_user: false,
            is_system: true,
            is_name: true,
            send_date: Date.now(),
            mes,
            extra: { type: 'st-momo-inject' },
        };
        if (Array.isArray(ctx.chat)) {
            ctx.chat.push(msg);
            if (typeof ctx.addOneMessage === 'function') {
                ctx.addOneMessage(msg);
            }
            await ctx.saveChat?.();
            return true;
        }
    } catch (e) {
        console.warn('[st-momo] chat push inject failed', e);
    }

    return false;
}

export function injectMatchSuccess(user) {
    if (!user) return Promise.resolve(false);
    return injectStoryLine(`在陌陌匹配到了 ${user.nickname}（${user.age || '?'}岁 · ${user.city || ''}），并加为好友。`);
}

export function injectAddFriend(user) {
    if (!user) return Promise.resolve(false);
    return injectStoryLine(`在陌陌添加了好友 ${user.nickname}。`);
}

export function injectFeedRefresh(count) {
    return injectStoryLine(`刷了附近动态，看到 ${count} 条新内容。`);
}
