/**
 * Friends proactively message the user on a virtual-time interval.
 * May deliver 1–2 short bubbles.
 */

import { canUseTavernApi, deliverBubbles, generateNpcReplies } from './ai.js';
import { isMainChatGenerating } from './api-client.js';
import { getVirtualNow } from './time.js';
import { toast, uid } from './utils.js';

let timer = null;
let busy = false;

async function generateProactiveBubbles(app, peer) {
    const myProfile = app.store.getProfile();
    const history = app.store.getMessages(peer.id);
    const settings = app.store.getSettings();

    if (settings.useAiReply !== false && canUseTavernApi()) {
        const style = peer.speechStyle ? `对话风格：${peer.speechStyle}` : '';
        const persona = peer.persona ? `人物设定：${peer.persona}` : '';
        const bubbles = await generateNpcReplies({
            peer,
            history,
            userText: [
                '（系统提示：这是你主动找玩家聊天，不是回复。',
                '请自然开启新话题或关心近况。可 1 条，也可连发 2 条短消息。）',
                style,
                persona,
            ].filter(Boolean).join('\n'),
            myProfile,
            useAi: true,
        });
        if (bubbles?.length) return bubbles.slice(0, 2);
    }
    return null;
}

async function tick(app) {
    if (busy || !app?.store) return;
    if (isMainChatGenerating()) return;
    const settings = app.store.getSettings();
    if (!settings.proactiveEnabled) return;

    const intervalMin = Math.max(1, Number(settings.proactiveIntervalMin) || 30);
    const intervalMs = intervalMin * 60 * 1000;
    const now = getVirtualNow(settings);

    const friends = app.store.getFriends().filter((f) => f?.id);
    if (!friends.length) return;

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
    if (app.chatView?.sending) return;

    busy = true;
    try {
        const bubbles = await generateProactiveBubbles(app, target);
        if (!bubbles?.length) return;

        await deliverBubbles(bubbles, async (text, index) => {
            app.store.appendMessage(target.id, {
                id: uid('msg'),
                from: 'them',
                text,
                createdAt: getVirtualNow(app.store.getSettings()),
                proactive: true,
            });
            if (index === 0) {
                app.store.updateUser({
                    ...app.store.getFriend(target.id),
                    lastProactiveAt: getVirtualNow(app.store.getSettings()),
                });
            }

            const viewing = app.open && app.tab === 'chat' && app.chatView?.activePeerId === target.id;
            if (viewing) {
                app.store.markRead(target.id);
                app.render('chat');
            } else if (index === bubbles.length - 1) {
                const preview = bubbles.join(' ');
                toast(`${target.nickname}：${preview.slice(0, 28)}${preview.length > 28 ? '…' : ''}`, 'info');
                if (app.open && app.tab === 'chat' && !app.chatView?.activePeerId) {
                    app.render('chat');
                }
            }
        });
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
    setTimeout(() => tick(app), 8000);
}

export function stopProactiveLoop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
