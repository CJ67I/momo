import { canUseTavernApi, deliverBubbles, generateNpcReplies } from '../ai.js';
import { avatarGradient, escapeHtml, formatTime, toast, uid } from '../utils.js';

/** @typedef {'green'|'yellow'|'red'} SignalLight */

const YELLOW_WAIT_MS = 5000;

const SIGNAL_COPY = {
    green: '空闲 · 可以发送',
    yellow: '等待中 · 可继续连发',
    red: '思考中 · 可继续输入',
};

export class ChatView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.activePeerId = null;
        /** @type {SignalLight} */
        this.light = 'green';
        /** Peer the current yellow/red cycle belongs to */
        this._signalPeerId = null;
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._yellowTimer = null;
        /** Texts collected during yellow (answered when red starts). */
        this._batch = [];
        /** Texts arrived while red — start a new yellow cycle after current think. */
        this._queuedAfterRed = [];
        this._swipeDisposes = [];
    }

    /** True while AI is generating (red). Kept for proactive.js / callers. */
    get sending() {
        return this.light === 'red';
    }

    /** Light shown in the open thread (ignore background cycle for another peer). */
    _displayLight() {
        if (this._signalPeerId && this.activePeerId && this._signalPeerId !== this.activePeerId) {
            return 'green';
        }
        return this.light;
    }

    open(peerId) {
        if (this.activePeerId && this.activePeerId !== peerId && this.light === 'yellow' && this._signalPeerId === this.activePeerId) {
            // Leaving a yellow collect window: keep messages in history, drop unsent timer batch for that peer
            this._clearYellowTimer();
            this._batch = [];
            this._queuedAfterRed = [];
            this.light = 'green';
            this._signalPeerId = null;
        }
        this.activePeerId = peerId;
        this.app.store.markRead(peerId);
        this.app.render('chat');
    }

    closeThread() {
        this.activePeerId = null;
        this.app.render('chat');
    }

    render() {
        if (this.activePeerId) return this._renderThread();
        return this._renderList();
    }

    _renderList() {
        const list = this.app.store.getChatList();
        const rows = list.length
            ? list
                .map((item) => {
                    const f = item.friend;
                    return `
                        <div class="mm-swipe-row mm-row-enter" data-peer-id="${escapeHtml(f.id)}">
                            <div class="mm-swipe-actions">
                                <button type="button" class="mm-swipe-del-btn" data-action="delete-friend" data-id="${escapeHtml(f.id)}">删除</button>
                            </div>
                            <div class="mm-chat-row-wrap mm-swipe-front">
                                <button type="button" class="mm-avatar mm-avatar-btn" style="background:${avatarGradient(f.id)}" data-action="open-profile" data-id="${escapeHtml(f.id)}">${escapeHtml(f.avatarText || '·')}</button>
                                <button type="button" class="mm-chat-row" data-action="open-thread" data-id="${escapeHtml(f.id)}">
                                    <div class="mm-chat-main">
                                        <div class="mm-name-row">
                                            <strong>${escapeHtml(f.nickname)}</strong>
                                            <span class="mm-muted">${formatTime(item.updatedAt)}</span>
                                        </div>
                                        <div class="mm-chat-preview">${escapeHtml(item.lastMessage)}</div>
                                    </div>
                                    ${item.unread ? `<span class="mm-badge">${item.unread}</span>` : ''}
                                </button>
                            </div>
                        </div>
                    `;
                })
                .join('')
            : `<div class="mm-empty">还没有好友聊天<br/>去首页加好友，或去匹配遇见新人</div>`;

        return `
            <section class="mm-page mm-chat mm-page-enter">
                <header class="mm-topbar">
                    <div class="mm-brand">消息</div>
                    <span class="mm-muted">左滑删除好友</span>
                </header>
                <div class="mm-chat-list mm-scroll">${rows}</div>
            </section>
        `;
    }

    _signalMarkup() {
        const on = this._displayLight();
        return `
            <div class="mm-signal" id="mm-signal" data-light="${on}" aria-live="polite">
                <div class="mm-signal-lights" role="status" aria-label="${SIGNAL_COPY[on]}">
                    <span class="mm-light mm-light-red ${on === 'red' ? 'is-on' : ''}" title="思考中"></span>
                    <span class="mm-light mm-light-yellow ${on === 'yellow' ? 'is-on' : ''}" title="等待中"></span>
                    <span class="mm-light mm-light-green ${on === 'green' ? 'is-on' : ''}" title="空闲"></span>
                </div>
                <span class="mm-signal-label" id="mm-signal-label">${SIGNAL_COPY[on]}</span>
            </div>
        `;
    }

    _renderThread() {
        const peer = this.app.store.getFriend(this.activePeerId);
        if (!peer) {
            this.activePeerId = null;
            return this._renderList();
        }
        const messages = this.app.store.getMessages(peer.id);
        const bubbles = messages
            .map((m) => {
                const mine = m.from === 'me';
                return `
                    <div class="mm-bubble-row ${mine ? 'is-me' : 'is-them'} mm-bubble-in">
                        ${mine ? '' : `<div class="mm-avatar sm" style="background:${avatarGradient(peer.id)}">${escapeHtml(peer.avatarText || '·')}</div>`}
                        <div class="mm-bubble">${escapeHtml(m.text)}</div>
                    </div>
                `;
            })
            .join('');

        const shown = this._displayLight();
        const typing = shown === 'red'
            ? '<div class="mm-typing" id="mm-typing">对方正在输入…</div>'
            : shown === 'yellow'
                ? '<div class="mm-typing is-wait" id="mm-typing">等待连发中…</div>'
                : '';

        return `
            <section class="mm-page mm-chat-thread mm-page-enter">
                <header class="mm-topbar">
                    <button type="button" class="mm-icon-btn" data-action="back-list">‹</button>
                    <button type="button" class="mm-brand mm-name-link" data-action="open-profile" data-id="${escapeHtml(peer.id)}">${escapeHtml(peer.nickname)}</button>
                    <button type="button" class="mm-link mm-danger" data-action="delete-friend" data-id="${escapeHtml(peer.id)}">删除</button>
                </header>
                <div class="mm-thread" id="mm-thread">${bubbles}${typing}</div>
                ${this._signalMarkup()}
                <div class="mm-api-hint">${canUseTavernApi() ? '绿灯空闲 · 黄灯可连发 · 红灯思考中仍可输入' : '酒馆 API 未在线，回复将提示生成失败'}</div>
                <form class="mm-composer" id="mm-composer">
                    <input type="text" id="mm-chat-input" placeholder="说点什么…（可连发多条）" maxlength="200" autocomplete="off" />
                    <button type="submit" class="mm-btn">发送</button>
                </form>
            </section>
        `;
    }

    /**
     * Soft refresh thread UI without wiping the composer (keeps focus / draft).
     */
    _refreshThreadSoft() {
        if (this.app.tab !== 'chat' || this.app.stackPage || !this.activePeerId) return;

        const peer = this.app.store.getFriend(this.activePeerId);
        const thread = document.getElementById('mm-thread');
        if (!peer || !thread) {
            this.app.render('chat');
            return;
        }

        const messages = this.app.store.getMessages(peer.id);
        const bubbles = messages
            .map((m) => {
                const mine = m.from === 'me';
                return `
                    <div class="mm-bubble-row ${mine ? 'is-me' : 'is-them'} mm-bubble-in">
                        ${mine ? '' : `<div class="mm-avatar sm" style="background:${avatarGradient(peer.id)}">${escapeHtml(peer.avatarText || '·')}</div>`}
                        <div class="mm-bubble">${escapeHtml(m.text)}</div>
                    </div>
                `;
            })
            .join('');

        const shown = this._displayLight();
        const typingHtml = shown === 'red'
            ? '<div class="mm-typing" id="mm-typing">对方正在输入…</div>'
            : shown === 'yellow'
                ? '<div class="mm-typing is-wait" id="mm-typing">等待连发中…</div>'
                : '';

        thread.innerHTML = `${bubbles}${typingHtml}`;
        thread.scrollTop = thread.scrollHeight;
        this._paintSignal();
    }

    _paintSignal() {
        const root = document.getElementById('mm-signal');
        const label = document.getElementById('mm-signal-label');
        if (!root) return;
        const on = this._displayLight();
        root.setAttribute('data-light', on);
        root.querySelectorAll('.mm-light').forEach((el) => el.classList.remove('is-on'));
        const map = { red: '.mm-light-red', yellow: '.mm-light-yellow', green: '.mm-light-green' };
        root.querySelector(map[on])?.classList.add('is-on');
        if (label) label.textContent = SIGNAL_COPY[on];
    }

    /**
     * @param {SignalLight} next
     */
    _setLight(next) {
        this.light = next;
        if (next === 'green') this._signalPeerId = null;
        if (this.activePeerId && this._signalPeerId && this.activePeerId !== this._signalPeerId) {
            return;
        }
        this._paintSignal();
        const typing = document.getElementById('mm-typing');
        const thread = document.getElementById('mm-thread');
        if (!thread) return;
        if (next === 'red') {
            if (!typing) {
                thread.insertAdjacentHTML('beforeend', '<div class="mm-typing" id="mm-typing">对方正在输入…</div>');
            } else {
                typing.textContent = '对方正在输入…';
                typing.classList.remove('is-wait');
            }
        } else if (next === 'yellow') {
            if (!typing) {
                thread.insertAdjacentHTML('beforeend', '<div class="mm-typing is-wait" id="mm-typing">等待连发中…</div>');
            } else {
                typing.textContent = '等待连发中…';
                typing.classList.add('is-wait');
            }
        } else if (typing) {
            typing.remove();
        }
        thread.scrollTop = thread.scrollHeight;
    }

    _clearYellowTimer() {
        if (this._yellowTimer) {
            clearTimeout(this._yellowTimer);
            this._yellowTimer = null;
        }
    }

    _armYellowTimer() {
        if (this._yellowTimer) return;
        this._yellowTimer = setTimeout(() => {
            this._yellowTimer = null;
            this._beginThinking();
        }, YELLOW_WAIT_MS);
    }

    _deleteFriend(id) {
        const friend = this.app.store.getFriend(id);
        const name = friend?.nickname || '该好友';
        if (!confirm(`删除好友「${name}」？\n聊天记录也会一并清除。`)) return;
        this._clearYellowTimer();
        this._batch = [];
        this._queuedAfterRed = [];
        this.light = 'green';
        this.app.store.removeFriend(id);
        if (this.activePeerId === id) this.activePeerId = null;
        toast(`已删除 ${name}`, 'warning');
        this.app.render('chat');
    }

    _bindRowSwipe(row) {
        const front = row.querySelector('.mm-swipe-front');
        if (!front) return () => {};
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let active = false;
        const openX = -76;

        const setX = (x, animate) => {
            front.style.transition = animate ? 'transform .2s ease' : 'none';
            front.style.transform = `translateX(${x}px)`;
            row.classList.toggle('is-open', x < -40);
        };

        const onDown = (e) => {
            const t = e.touches?.[0] || e;
            startX = t.clientX;
            startY = t.clientY;
            dx = 0;
            active = true;
        };

        const onMove = (e) => {
            if (!active) return;
            const t = e.touches?.[0] || e;
            const mx = t.clientX - startX;
            const my = t.clientY - startY;
            if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) {
                active = false;
                return;
            }
            dx = Math.min(0, Math.max(openX - 20, mx));
            setX(dx, false);
            if (Math.abs(dx) > 8) e.preventDefault?.();
        };

        const onUp = () => {
            if (!active) return;
            active = false;
            setX(dx < openX / 2 ? openX : 0, true);
        };

        front.addEventListener('touchstart', onDown, { passive: true });
        front.addEventListener('touchmove', onMove, { passive: false });
        front.addEventListener('touchend', onUp);
        front.addEventListener('touchcancel', onUp);

        return () => {
            front.removeEventListener('touchstart', onDown);
            front.removeEventListener('touchmove', onMove);
            front.removeEventListener('touchend', onUp);
            front.removeEventListener('touchcancel', onUp);
        };
    }

    bind(root) {
        this._swipeDisposes.forEach((d) => d?.());
        this._swipeDisposes = [];

        root.querySelectorAll('.mm-swipe-row').forEach((row) => {
            this._swipeDisposes.push(this._bindRowSwipe(row));
        });

        root.querySelectorAll('[data-action="open-thread"]').forEach((btn) => {
            btn.addEventListener('click', () => this.open(btn.getAttribute('data-id')));
        });

        root.querySelectorAll('[data-action="open-profile"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                if (id) this.app.openProfile(id, 'chat');
            });
        });

        root.querySelectorAll('[data-action="delete-friend"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._deleteFriend(btn.getAttribute('data-id'));
            });
        });

        root.querySelector('[data-action="back-list"]')?.addEventListener('click', () => this.closeThread());

        const form = root.querySelector('#mm-composer');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            this._send();
        });

        const thread = root.querySelector('#mm-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
        this._paintSignal();
    }

    /**
     * Queue a player message. Yellow collects for 5s, then red thinks.
     * Input stays enabled so the player can send multiple lines.
     */
    _send() {
        if (!this.activePeerId) return;
        const input = document.getElementById('mm-chat-input');
        const text = String(input?.value || '').trim();
        if (!text) return;

        const peer = this.app.store.getFriend(this.activePeerId);
        if (!peer) return;

        this.app.store.appendMessage(peer.id, {
            id: uid('msg'),
            from: 'me',
            text,
            createdAt: this.app.store.now(),
        });
        if (input) input.value = '';

        const settings = this.app.store.getSettings();
        if (!settings.autoReply) {
            this._refreshThreadSoft();
            return;
        }

        if (this.light === 'red') {
            // Only queue onto current red cycle if same peer
            if (this._signalPeerId === peer.id) {
                this._queuedAfterRed.push(text);
            } else {
                // Different peer busy in background — start local yellow for this peer after? keep simple: toast
                toast('上一段回复还在生成，稍后再发', 'info');
            }
            this._refreshThreadSoft();
            return;
        }

        this._signalPeerId = peer.id;
        this._batch.push(text);
        if (this.light !== 'yellow') {
            this._setLight('yellow');
        }
        this._armYellowTimer();
        this._refreshThreadSoft();
    }

    async _beginThinking() {
        const peerId = this._signalPeerId || this.activePeerId;
        if (!peerId) {
            this._setLight('green');
            return;
        }

        const peer = this.app.store.getFriend(peerId);
        if (!peer) {
            this._batch = [];
            this._setLight('green');
            return;
        }

        const batch = this._batch.splice(0, this._batch.length);
        if (!batch.length) {
            this._setLight('green');
            return;
        }

        this._signalPeerId = peerId;
        this._setLight('red');
        if (this.activePeerId === peerId) this._refreshThreadSoft();

        const settings = this.app.store.getSettings();
        const userText = batch.length === 1
            ? batch[0]
            : [
                `（玩家连发了 ${batch.length} 条消息，请一并理解后再以一条或多条短消息回复）`,
                ...batch.map((t, i) => `${i + 1}. ${t}`),
            ].join('\n');

        try {
            const bubbles = await generateNpcReplies({
                peer,
                history: this.app.store.getMessages(peer.id),
                userText,
                myProfile: this.app.store.getProfile(),
                useAi: settings.useAiReply,
            });

            if (!bubbles?.length) {
                toast('回复生成失败：AI 未返回有效内容', 'error');
            } else {
                await deliverBubbles(bubbles, async (bubble) => {
                    this.app.store.appendMessage(peer.id, {
                        id: uid('msg'),
                        from: 'them',
                        text: bubble,
                        createdAt: this.app.store.now(),
                    });
                    if (this.activePeerId === peer.id) {
                        this.app.store.markRead(peer.id);
                        this._refreshThreadSoft();
                    }
                });
            }
        } catch (err) {
            console.error(err);
            const code = err?.code || '';
            const tip = code === 'api_offline'
                ? '回复生成失败：酒馆 API 未在线'
                : code === 'ai_disabled'
                    ? '回复生成失败：已关闭「优先使用酒馆 API 回复」'
                    : code === 'gen_empty'
                        ? '回复生成失败：AI 未返回有效内容'
                        : `回复生成失败${err?.message ? `：${String(err.message).slice(0, 40)}` : ''}`;
            toast(tip, 'error');
        } finally {
            if (this.activePeerId === peer.id) {
                this.app.store.markRead(peer.id);
            }

            if (this._queuedAfterRed.length && this._signalPeerId === peerId) {
                this._batch.push(...this._queuedAfterRed.splice(0, this._queuedAfterRed.length));
                this._setLight('yellow');
                this._armYellowTimer();
                if (this.activePeerId === peerId) this._refreshThreadSoft();
            } else {
                this._queuedAfterRed = [];
                this._setLight('green');
                if (this.activePeerId === peerId) this._refreshThreadSoft();
            }
        }
    }
}
