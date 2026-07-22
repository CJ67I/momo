/**
 * Friends proactively message the user on a virtual-time interval.
 */

import { canUseTavernApi, generateNpcReply } from './ai.js';
import { getVirtualNow } from './time.js';
import { toast, uid } from './utils.js';

let timer = null;
let busy = false;

async function generateProactiveText(app, peer) {
    const myProfile = app.store.getProfile();
    const history = app.store.getMessages(peer.id);
    const settings = app.store.getSettings();

    if (settings.useAiReply !== false && canUseTavernApi()) {
        const style = peer.speechStyle ? `对话风格：${peer.speechStyle}` : '';
        const persona = peer.persona ? `人物设定：${peer.persona}` : '';
        const text = await generateNpcReply({
            peer,
            history,
            userText: [
                '（系统提示：这是你主动找玩家聊天，不是回复。',
                '请自然开启一句新话题或关心近况，1-2 句短消息。）',
                style,
                persona,
            ].filter(Boolean).join('\n'),
            myProfile,
            useAi: true,
        });
        if (text) return text;
    }
    return null;
}

async function tick(app) {
    if (busy || !app?.store) return;
    const settings = app.store.getSettings();
    if (!settings.proactiveEnabled) return;

    const intervalMin = Math.max(1, Number(settings.proactiveIntervalMin) || 30);
    const intervalMs = intervalMin * 60 * 1000;
    const now = getVirtualNow(settings);

    const friends = app.store.getFriends().filter((f) => f?.id);
    if (!friends.length) return;

    // pick the friend most overdue
    let target = null;
    let bestOver = -1;
    for (const f of friends) {
        const last = Number(f.lastProactiveAt) || Number(f.addedAt) || 0;
        const over = now - last - intervalMs;
        if (over >= 0 && over > bestOver) {
            bestOver = over;
            target = f;
        }
    }
    if (!target) return;

    // avoid interrupting active reply
    if (app.chatView?.sending) return;

    busy = true;
    try {
        const text = await generateProactiveText(app, target);
        if (!text) return;

        app.store.appendMessage(target.id, {
            id: uid('msg'),
            from: 'them',
            text,
            createdAt: now,
            proactive: true,
        });
        app.store.updateUser({
            ...app.store.getFriend(target.id),
            lastProactiveAt: now,
        });

        const viewing = app.open && app.tab === 'chat' && app.chatView?.activePeerId === target.id;
        if (viewing) {
            app.store.markRead(target.id);
            app.render('chat');
        } else {
            toast(`${target.nickname}：${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`, 'info');
            if (app.open && app.tab === 'chat' && !app.chatView?.activePeerId) {
                app.render('chat');
            }
        }
    } catch (e) {
        console.warn('[st-momo] proactive message failed', e);
    } finally {
        busy = false;
    }
}

/**
 * @param {import('./app.js').MomoApp} app
 */
export function startProactiveLoop(app) {
    stopProactiveLoop();
    timer = setInterval(() => {
        tick(app);
    }, 15000);
    // first check soon after mount
    setTimeout(() => tick(app), 8000);
}

export function stopProactiveLoop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
