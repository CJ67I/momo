import { generateNpcReply } from '../ai.js';
import { avatarGradient, escapeHtml, formatTime, toast, uid } from '../utils.js';

export class ChatView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.activePeerId = null;
        this.sending = false;
    }

    open(peerId) {
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
                        <button type="button" class="mm-chat-row" data-action="open-thread" data-id="${escapeHtml(f.id)}">
                            <div class="mm-avatar" style="background:${avatarGradient(f.id)}">${escapeHtml(f.avatarText || '·')}</div>
                            <div class="mm-chat-main">
                                <div class="mm-name-row">
                                    <strong>${escapeHtml(f.nickname)}</strong>
                                    <span class="mm-muted">${formatTime(item.updatedAt)}</span>
                                </div>
                                <div class="mm-chat-preview">${escapeHtml(item.lastMessage)}</div>
                            </div>
                            ${item.unread ? `<span class="mm-badge">${item.unread}</span>` : ''}
                        </button>
                    `;
                })
                .join('')
            : `<div class="mm-empty">还没有好友聊天<br/>去首页加好友，或去匹配遇见新人</div>`;

        return `
            <section class="mm-page mm-chat">
                <header class="mm-topbar">
                    <div class="mm-brand">消息</div>
                </header>
                <div class="mm-chat-list">${rows}</div>
            </section>
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
                    <div class="mm-bubble-row ${mine ? 'is-me' : 'is-them'}">
                        ${mine ? '' : `<div class="mm-avatar sm" style="background:${avatarGradient(peer.id)}">${escapeHtml(peer.avatarText || '·')}</div>`}
                        <div class="mm-bubble">${escapeHtml(m.text)}</div>
                    </div>
                `;
            })
            .join('');

        return `
            <section class="mm-page mm-chat-thread">
                <header class="mm-topbar">
                    <button type="button" class="mm-icon-btn" data-action="back-list">‹</button>
                    <div class="mm-brand">${escapeHtml(peer.nickname)}</div>
                    <span class="mm-muted">${peer.online ? '在线' : '离线'}</span>
                </header>
                <div class="mm-thread" id="mm-thread">${bubbles}</div>
                <form class="mm-composer" id="mm-composer">
                    <input type="text" id="mm-chat-input" placeholder="说点什么…" maxlength="200" autocomplete="off" />
                    <button type="submit" class="mm-btn" ${this.sending ? 'disabled' : ''}>发送</button>
                </form>
            </section>
        `;
    }

    bind(root) {
        root.querySelectorAll('[data-action="open-thread"]').forEach((btn) => {
            btn.addEventListener('click', () => this.open(btn.getAttribute('data-id')));
        });

        root.querySelector('[data-action="back-list"]')?.addEventListener('click', () => this.closeThread());

        const form = root.querySelector('#mm-composer');
        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this._send();
        });

        const thread = root.querySelector('#mm-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
    }

    async _send() {
        if (this.sending || !this.activePeerId) return;
        const input = document.getElementById('mm-chat-input');
        const text = String(input?.value || '').trim();
        if (!text) return;

        const peer = this.app.store.getFriend(this.activePeerId);
        if (!peer) return;

        this.app.store.appendMessage(peer.id, {
            id: uid('msg'),
            from: 'me',
            text,
            createdAt: Date.now(),
        });
        if (input) input.value = '';
        this.app.render('chat');

        const settings = this.app.store.getSettings();
        if (!settings.autoReply) return;

        this.sending = true;
        try {
            const reply = await generateNpcReply({
                peer,
                history: this.app.store.getMessages(peer.id),
                userText: text,
                myProfile: this.app.store.getProfile(),
                useAi: settings.useAiReply,
            });
            this.app.store.appendMessage(peer.id, {
                id: uid('msg'),
                from: 'them',
                text: reply,
                createdAt: Date.now(),
            });
            if (this.activePeerId === peer.id) {
                this.app.store.markRead(peer.id);
                this.app.render('chat');
            }
        } catch (err) {
            console.error(err);
            toast('回复失败', 'error');
        } finally {
            this.sending = false;
        }
    }
}
