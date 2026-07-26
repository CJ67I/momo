import { canUseTavernApi, deliverBubbles, generateNpcReplies } from '../ai.js';
import {
    appendImagePromptMessage,
    fulfillImagePromptMessage,
    getPeerReferenceImage,
    getUserReferenceImage,
    isGallerySeedreamRef,
    isManualSeedreamRef,
    isSeedreamConfigured,
    prepareReferenceImage,
    tryHandlePersonalImageBubble,
    userAskedForPhoto,
} from '../image-gen.js';
import { generateFriendPersona } from '../npc-persona.js';
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
        this._lpDisposes = [];
        /** Skip next open-thread click after long-press menu. */
        this._suppressClick = false;
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
                    <span class="mm-muted">长按编辑 · 左滑删除</span>
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

    /**
     * @param {object} m
     * @param {object} peer
     */
    _renderBubble(m, peer) {
        const mine = m.from === 'me';
        const avatar = mine
            ? ''
            : `<div class="mm-avatar sm" style="background:${avatarGradient(peer.id)}">${escapeHtml(peer.avatarText || '·')}</div>`;
        const status = String(m.imageGenStatus || '').trim();
        const imageUrl = String(m.imageUrl || '').trim();
        const prompt = String(m.imagePrompt || '').trim();
        const isImageCard = m.type === 'image' || m.type === 'image_prompt' || Boolean(imageUrl) || status === 'loading' || status === 'failed';

        if (isImageCard) {
            let body = '';
            if (imageUrl && status !== 'failed') {
                body = `
                    <div class="mm-bubble mm-bubble-image">
                        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(prompt || '图片')}" loading="lazy" />
                        ${prompt ? `<div class="mm-image-caption">${escapeHtml(prompt)}</div>` : ''}
                        <button type="button" class="mm-image-retry" data-action="regen-image" data-msg-id="${escapeHtml(m.id)}">重绘</button>
                    </div>`;
            } else if (status === 'loading') {
                body = `
                    <div class="mm-bubble mm-bubble-image is-loading">
                        <div class="mm-image-status">正在生成形象图…</div>
                        ${prompt ? `<div class="mm-image-caption">${escapeHtml(prompt)}</div>` : ''}
                    </div>`;
            } else if (status === 'failed') {
                body = `
                    <div class="mm-bubble mm-bubble-image is-failed">
                        <div class="mm-image-status">生图失败：${escapeHtml(m.imageGenError || '未知错误')}</div>
                        ${prompt ? `<div class="mm-image-caption">${escapeHtml(prompt)}</div>` : ''}
                        <button type="button" class="mm-image-retry" data-action="regen-image" data-msg-id="${escapeHtml(m.id)}">重试</button>
                    </div>`;
            } else {
                body = `
                    <div class="mm-bubble mm-bubble-image">
                        <div class="mm-image-status">待生成形象图</div>
                        ${prompt ? `<div class="mm-image-caption">${escapeHtml(prompt)}</div>` : ''}
                        <button type="button" class="mm-image-retry" data-action="regen-image" data-msg-id="${escapeHtml(m.id)}">生成</button>
                    </div>`;
            }
            return `<div class="mm-bubble-row ${mine ? 'is-me' : 'is-them'} mm-bubble-in">${avatar}${body}</div>`;
        }

        return `
            <div class="mm-bubble-row ${mine ? 'is-me' : 'is-them'} mm-bubble-in">
                ${avatar}
                <div class="mm-bubble">${escapeHtml(m.text)}</div>
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
        const bubbles = messages.map((m) => this._renderBubble(m, peer)).join('');
        const settings = this.app.store.getSettings();
        const profile = this.app.store.getProfile();
        const seedreamOk = isSeedreamConfigured(settings);
        const hasPeerRef = Boolean(getPeerReferenceImage(peer));
        const hasUserRef = Boolean(getUserReferenceImage(profile));
        const peerImgBtn = seedreamOk
            ? `<button type="button" class="mm-icon-btn mm-gen-image-btn" data-action="request-image" title="生成对方形象图（输入框可写提示词）" aria-label="对方形象图" ${hasPeerRef ? '' : 'disabled'}>图</button>`
            : '';
        const myImgBtn = seedreamOk
            ? `<button type="button" class="mm-icon-btn mm-gen-image-btn is-me-img" data-action="request-my-image" title="发送我的形象图（输入框写提示词）" aria-label="我的形象图" ${hasUserRef ? '' : 'disabled'}>我</button>`
            : '';

        const shown = this._displayLight();
        const typing = shown === 'red'
            ? '<div class="mm-typing" id="mm-typing">对方正在输入…</div>'
            : shown === 'yellow'
                ? '<div class="mm-typing is-wait" id="mm-typing">等待连发中…</div>'
                : '';

        let hint = '绿灯空闲 · 黄灯可连发 · 红灯思考中仍可输入';
        if (!canUseTavernApi()) {
            hint = '酒馆 API 未在线，回复将提示生成失败';
        } else if (seedreamOk) {
            const bits = [];
            bits.push(hasPeerRef ? '「图」=对方' : '对方未上传参考图');
            bits.push(hasUserRef ? '「我」=自己形象' : '请到「我」页上传自己参考图');
            hint = bits.join(' · ');
        }

        return `
            <section class="mm-page mm-chat-thread mm-page-enter">
                <header class="mm-topbar">
                    <button type="button" class="mm-icon-btn" data-action="back-list">‹</button>
                    <button type="button" class="mm-brand mm-name-link" data-action="open-profile" data-id="${escapeHtml(peer.id)}">${escapeHtml(peer.nickname)}</button>
                    <button type="button" class="mm-icon-btn" data-action="friend-menu" data-id="${escapeHtml(peer.id)}" title="更多" aria-label="更多">···</button>
                </header>
                <div class="mm-thread" id="mm-thread">${bubbles}${typing}</div>
                ${this._signalMarkup()}
                <div class="mm-api-hint">${escapeHtml(hint)}</div>
                <form class="mm-composer" id="mm-composer">
                    ${peerImgBtn}
                    ${myImgBtn}
                    <input type="text" id="mm-chat-input" placeholder="说点什么… 或写提示词后点「图/我」" maxlength="200" autocomplete="off" />
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
        const bubbles = messages.map((m) => this._renderBubble(m, peer)).join('');

        const shown = this._displayLight();
        const typingHtml = shown === 'red'
            ? '<div class="mm-typing" id="mm-typing">对方正在输入…</div>'
            : shown === 'yellow'
                ? '<div class="mm-typing is-wait" id="mm-typing">等待连发中…</div>'
                : '';

        thread.innerHTML = `${bubbles}${typingHtml}`;
        thread.scrollTop = thread.scrollHeight;
        this._paintSignal();
        this._bindImageActions(thread);
    }

    /**
     * @param {HTMLElement|null} root
     */
    _bindImageActions(root) {
        if (!root) return;
        root.querySelectorAll('[data-action="regen-image"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const msgId = btn.getAttribute('data-msg-id');
                if (!msgId || !this.activePeerId) return;
                fulfillImagePromptMessage(this.app.store, this.activePeerId, msgId, {
                    onUpdate: () => {
                        if (this.activePeerId) this._refreshThreadSoft();
                    },
                }).catch((err) => {
                    toast(err?.message || '生图失败', 'error');
                });
            });
        });
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

    _closeOverlay() {
        document.getElementById('mm-friend-overlay')?.remove();
    }

    _syncInterop() {
        import('../interop.js')
            .then((m) => m.syncInteropDigest(this.app.store))
            .catch(() => {});
    }

    _overlayHost() {
        return this.app.root?.querySelector('.mm-phone') || this.app.root || document.body;
    }

    /**
     * Action sheet: edit persona, clear history, delete friend.
     * @param {string} peerId
     */
    _openFriendActions(peerId) {
        const id = String(peerId || '');
        const friend = this.app.store.getFriend(id);
        if (!friend) return;
        this._suppressClick = true;
        this._closeOverlay();

        const host = this._overlayHost();
        const wrap = document.createElement('div');
        wrap.id = 'mm-friend-overlay';
        wrap.className = 'mm-action-overlay';
        wrap.innerHTML = `
            <div class="mm-action-backdrop" data-sheet="cancel"></div>
            <div class="mm-action-sheet" role="dialog" aria-label="好友操作">
                <div class="mm-action-title">${escapeHtml(friend.nickname)}</div>
                <button type="button" data-sheet="edit">编辑资料</button>
                <button type="button" data-sheet="clear">删除聊天记录</button>
                <button type="button" class="is-danger" data-sheet="delete">删除好友</button>
                <button type="button" class="is-cancel" data-sheet="cancel">取消</button>
            </div>
        `;
        host.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('is-open'));

        wrap.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-sheet]');
            if (!btn) return;
            const act = btn.getAttribute('data-sheet');
            if (act === 'cancel') {
                this._closeOverlay();
                return;
            }
            this._closeOverlay();
            if (act === 'edit') this._openEditFriend(id);
            else if (act === 'clear') this._clearChatHistory(id);
            else if (act === 'delete') this._deleteFriend(id);
        });
    }

    /**
     * Edit friend nickname / bio / persona / speech style / tags.
     * Persona + speechStyle: AI-generate first when empty; always allow regenerate then hand-edit.
     * @param {string} peerId
     */
    _openEditFriend(peerId) {
        const id = String(peerId || '');
        const friend = this.app.store.getFriend(id);
        if (!friend) return;
        this._closeOverlay();

        const hasPersona = Boolean(String(friend.persona || '').trim() && String(friend.speechStyle || '').trim());
        const tags = Array.isArray(friend.tags) ? friend.tags.join('、') : '';
        const galleryHidden = isGallerySeedreamRef(friend);
        const manualRef = isManualSeedreamRef(friend);
        const refUrl = manualRef ? String(friend.seedreamRefUrl || '').trim() : '';
        const refDataUrl = manualRef ? String(friend.seedreamRefDataUrl || '').trim() : '';
        const previewUrl = manualRef
            ? (/^data:image\//i.test(refDataUrl) ? refDataUrl : refUrl)
            : '';
        const refEnabled = Boolean(getPeerReferenceImage(friend))
            && friend.seedreamRefEnabled !== false
            && friend.seedreamRefEnabled !== 'false';
        const promptTags = String(friend.seedreamPromptTags || friend.imageTags || '').trim();
        /** Keep large data URIs out of HTML attributes (truncation risk). */
        let pendingRefUrl = refUrl;
        let pendingRefDataUrl = refDataUrl;
        let refDirty = false;
        const host = this._overlayHost();
        const wrap = document.createElement('div');
        wrap.id = 'mm-friend-overlay';
        wrap.className = 'mm-action-overlay';
        wrap.innerHTML = `
            <div class="mm-action-backdrop" data-edit="cancel"></div>
            <div class="mm-edit-sheet" role="dialog" aria-label="编辑好友资料">
                <div class="mm-action-title">编辑 · ${escapeHtml(friend.nickname)}</div>
                <form id="mm-edit-friend-form" class="mm-edit-form">
                    <label>昵称<input name="nickname" maxlength="16" required value="${escapeHtml(friend.nickname || '')}" /></label>
                    <label>简介<input name="bio" maxlength="40" value="${escapeHtml(friend.bio || '')}" /></label>
                    <label>标签（顿号分隔）<input name="tags" maxlength="60" value="${escapeHtml(tags)}" placeholder="徒步、咖啡" /></label>
                    <div class="mm-ref-block">
                        <div class="mm-edit-persona-head">
                            <span>个人形象参考图（Seedream）</span>
                        </div>
                        <p class="mm-muted" style="margin:0;font-size:11px;line-height:1.45">
                            手动上传会覆盖图库自动匹配，并按 <b>编辑图1</b> 生图。图库匹配的参考图<strong>不会在此展示</strong>。
                        </p>
                        <p class="mm-muted" id="mm-ref-gallery-hint" style="margin:0;font-size:11px;${galleryHidden && !manualRef ? '' : 'display:none'}">
                            当前：图库自动匹配（已隐藏，可点「图」生图）
                        </p>
                        <div class="mm-ref-row">
                            <div class="mm-ref-preview" id="mm-ref-preview">${previewUrl ? '' : '无'}</div>
                            <div class="mm-ref-actions">
                                <input type="file" id="mm-ref-file" accept="image/png,image/jpeg,image/webp,image/gif,image/*" hidden />
                                <button type="button" class="mm-btn mm-btn-ghost" id="mm-ref-upload">${previewUrl ? '替换参考图' : '上传参考图'}</button>
                                <button type="button" class="mm-btn mm-btn-ghost" id="mm-ref-clear" ${previewUrl || galleryHidden ? '' : 'disabled'}>清除/重配</button>
                                <label class="mm-switch" style="margin-top:6px">
                                    <span>启用参考图</span>
                                    <input type="checkbox" name="seedreamRefEnabled" ${refEnabled ? 'checked' : ''} ${previewUrl || galleryHidden ? '' : 'disabled'} />
                                </label>
                            </div>
                        </div>
                        <label>外貌提示词（可选）
                            <input name="seedreamPromptTags" maxlength="200" value="${escapeHtml(promptTags)}" placeholder="黑长直、双眼皮…" />
                        </label>
                    </div>
                    <div class="mm-edit-persona-head">
                        <span>人设 / 说话风格</span>
                        <button type="button" class="mm-link" data-edit="regen" id="mm-persona-regen">重新生成</button>
                    </div>
                    <p class="mm-muted mm-edit-status" id="mm-persona-status"></p>
                    <label>人设<textarea name="persona" rows="3" maxlength="300" placeholder="性格、经历、说话立场…">${escapeHtml(friend.persona || '')}</textarea></label>
                    <label>说话风格<textarea name="speechStyle" rows="2" maxlength="160" placeholder="口癖、语气、常用词…">${escapeHtml(friend.speechStyle || '')}</textarea></label>
                    <div class="mm-edit-actions">
                        <button type="button" class="mm-btn mm-btn-ghost" data-edit="cancel">取消</button>
                        <button type="submit" class="mm-btn">保存</button>
                    </div>
                </form>
            </div>
        `;
        host.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('is-open'));

        const form = wrap.querySelector('#mm-edit-friend-form');
        const personaEl = form?.querySelector('[name="persona"]');
        const styleEl = form?.querySelector('[name="speechStyle"]');
        const bioEl = form?.querySelector('[name="bio"]');
        const tagsEl = form?.querySelector('[name="tags"]');
        const statusEl = wrap.querySelector('#mm-persona-status');
        const regenBtn = wrap.querySelector('#mm-persona-regen');
        const refEnabledEl = form?.querySelector('[name="seedreamRefEnabled"]');
        const refPreview = wrap.querySelector('#mm-ref-preview');
        const refFile = wrap.querySelector('#mm-ref-file');
        const refUploadBtn = wrap.querySelector('#mm-ref-upload');
        const refClearBtn = wrap.querySelector('#mm-ref-clear');
        const galleryHint = wrap.querySelector('#mm-ref-gallery-hint');

        const paintRefPreview = (url, dataUrl = '', { dirty = true } = {}) => {
            const preview = String(dataUrl || url || '').trim();
            pendingRefUrl = String(url || '').trim();
            pendingRefDataUrl = String(dataUrl || '').trim();
            if (dirty) refDirty = true;
            if (refPreview) {
                if (preview) {
                    refPreview.style.backgroundImage = `url("${preview.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
                    refPreview.textContent = '';
                } else {
                    refPreview.style.backgroundImage = '';
                    refPreview.textContent = '无';
                }
            }
            if (galleryHint) {
                galleryHint.style.display = (!preview && galleryHidden && !refDirty) ? '' : 'none';
            }
            if (refClearBtn) refClearBtn.disabled = !(preview || (galleryHidden && !refDirty));
            if (refEnabledEl) {
                const canEnable = Boolean(preview || (galleryHidden && !refDirty));
                refEnabledEl.disabled = !canEnable;
                if (!canEnable) refEnabledEl.checked = false;
                else if (!refEnabledEl.checked) refEnabledEl.checked = true;
            }
            if (refUploadBtn) refUploadBtn.textContent = preview ? '替换参考图' : '上传参考图';
        };

        // Only show manual uploads; gallery matches stay hidden
        paintRefPreview(pendingRefUrl, pendingRefDataUrl, { dirty: false });

        refUploadBtn?.addEventListener('click', () => refFile?.click());
        refClearBtn?.addEventListener('click', () => paintRefPreview('', '', { dirty: true }));
        refFile?.addEventListener('change', async () => {
            const file = refFile.files?.[0];
            refFile.value = '';
            if (!file) return;
            try {
                toast('正在处理参考图…', 'info');
                const prepared = await prepareReferenceImage(file, this.app.store.getSettings());
                paintRefPreview(prepared.url, prepared.dataUrl || '', { dirty: true });
                if (prepared.storedAs === 'data' && prepared.uploadError) {
                    toast('已用本地图（云端上传失败，仍可生图）', 'warning');
                } else {
                    toast('已覆盖为手动参考图', 'success');
                }
            } catch (err) {
                console.warn('[st-momo] ref upload failed', err);
                toast(err?.message || '参考图处理失败', 'error');
            }
        });

        const setPersonaLocked = (locked, statusText) => {
            if (personaEl) personaEl.readOnly = locked;
            if (styleEl) styleEl.readOnly = locked;
            if (regenBtn) regenBtn.disabled = locked;
            if (statusEl) statusEl.textContent = statusText || '';
        };

        const fillFromPatch = (patch) => {
            if (!patch) return;
            if (personaEl && patch.persona) personaEl.value = patch.persona;
            if (styleEl && patch.speechStyle) styleEl.value = patch.speechStyle;
            if (bioEl && patch.bio) bioEl.value = patch.bio;
            if (tagsEl && Array.isArray(patch.tags) && patch.tags.length) {
                tagsEl.value = patch.tags.join('、');
            }
        };

        const runGenerate = async ({ force = false } = {}) => {
            const latest = this.app.store.getFriend(id) || friend;
            setPersonaLocked(true, '正在生成人设与说话风格…');
            try {
                const patch = await generateFriendPersona(latest, { force });
                if (!patch?.persona && !patch?.speechStyle) {
                    toast('人设生成失败，可手填或点重新生成', 'warning');
                    setPersonaLocked(false, '生成失败，可手动填写');
                    return;
                }
                fillFromPatch(patch);
                setPersonaLocked(false, '已生成，可自由修改后保存');
            } catch (e) {
                console.warn('[st-momo] edit persona gen failed', e);
                toast('人设生成失败，可手填或点重新生成', 'warning');
                setPersonaLocked(false, '生成失败，可手动填写');
            }
        };

        wrap.addEventListener('click', (e) => {
            if (e.target.closest('[data-edit="cancel"]')) this._closeOverlay();
        });

        regenBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            runGenerate({ force: true });
        });

        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const nickname = String(fd.get('nickname') || '').trim().slice(0, 16);
            if (!nickname) {
                toast('昵称不能为空', 'warning');
                return;
            }
            const bio = String(fd.get('bio') || '').trim().slice(0, 40);
            const persona = String(fd.get('persona') || '').trim().slice(0, 300);
            const speechStyle = String(fd.get('speechStyle') || '').trim().slice(0, 160);
            const tagList = String(fd.get('tags') || '')
                .split(/[/|,，、\s]+/)
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 6);
            const seedreamPromptTags = String(fd.get('seedreamPromptTags') || '').trim().slice(0, 200);
            const patch = {
                id,
                nickname,
                bio,
                persona,
                speechStyle,
                tags: tagList,
                avatarText: nickname.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 1) || friend.avatarText || '·',
                personaReady: true,
                seedreamPromptTags,
            };

            if (refDirty) {
                const seedreamRefUrl = String(pendingRefUrl || '').trim();
                const seedreamRefDataUrl = String(pendingRefDataUrl || '').trim();
                if (seedreamRefUrl || seedreamRefDataUrl) {
                    Object.assign(patch, {
                        seedreamRefSource: 'manual',
                        seedreamGalleryId: '',
                        seedreamRefUrl,
                        seedreamRefDataUrl,
                        seedreamRefEnabled: Boolean(form.querySelector('[name="seedreamRefEnabled"]')?.checked),
                    });
                } else {
                    // Cleared: re-roll from gallery if possible, else wipe
                    const auto = this.app.store.buildRandomGalleryRefPatch();
                    if (auto) {
                        Object.assign(patch, auto);
                        toast('已重新从图库匹配参考图（隐藏）', 'info');
                    } else {
                        Object.assign(patch, {
                            seedreamRefSource: '',
                            seedreamGalleryId: '',
                            seedreamRefUrl: '',
                            seedreamRefDataUrl: '',
                            seedreamRefEnabled: false,
                        });
                    }
                }
            } else if (galleryHidden) {
                // Keep hidden gallery match; only sync enabled checkbox
                patch.seedreamRefEnabled = Boolean(form.querySelector('[name="seedreamRefEnabled"]')?.checked);
            }

            this.app.store.updateUser(patch);
            this._syncInterop();
            this._closeOverlay();
            toast('好友资料已更新', 'success');
            this.app.render('chat');
        });

        if (!hasPersona) {
            runGenerate({ force: true });
        } else {
            setPersonaLocked(false, '可直接修改，或点「重新生成」');
        }
    }

    _clearChatHistory(id) {
        const friend = this.app.store.getFriend(id);
        const name = friend?.nickname || '该好友';
        if (!confirm(`清空与「${name}」的聊天记录？\n好友关系会保留。`)) return;
        if (this._signalPeerId === id) {
            this._clearYellowTimer();
            this._batch = [];
            this._queuedAfterRed = [];
            this.light = 'green';
            this._signalPeerId = null;
        }
        this.app.store.clearChat(id);
        this._syncInterop();
        toast('聊天记录已删除', 'warning');
        this.app.render('chat');
    }

    _deleteFriend(id) {
        const friend = this.app.store.getFriend(id);
        const name = friend?.nickname || '该好友';
        if (!confirm(`删除好友「${name}」？\n聊天记录也会一并清除。`)) return;
        this._closeOverlay();
        this._clearYellowTimer();
        this._batch = [];
        this._queuedAfterRed = [];
        this.light = 'green';
        this.app.store.removeFriend(id);
        if (this.activePeerId === id) this.activePeerId = null;
        this._syncInterop();
        toast(`已删除 ${name}`, 'warning');
        this.app.render('chat');
    }

    /**
     * Long-press a chat row to open friend actions (touch + mouse).
     * @param {HTMLElement} row
     */
    _bindLongPress(row) {
        const peerId = row.getAttribute('data-peer-id');
        const front = row.querySelector('.mm-swipe-front');
        if (!peerId || !front) return () => {};

        let timer = null;
        let startX = 0;
        let startY = 0;
        let fired = false;

        const clear = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const onDown = (e) => {
            if (e.button != null && e.button !== 0) return;
            const t = e.touches?.[0] || e;
            startX = t.clientX;
            startY = t.clientY;
            fired = false;
            clear();
            timer = setTimeout(() => {
                timer = null;
                fired = true;
                this._openFriendActions(peerId);
            }, 520);
        };

        const onMove = (e) => {
            if (!timer) return;
            const t = e.touches?.[0] || e;
            if (Math.hypot(t.clientX - startX, t.clientY - startY) > 12) clear();
        };

        const onUp = (e) => {
            clear();
            if (fired) {
                e.preventDefault?.();
                e.stopPropagation?.();
                setTimeout(() => {
                    this._suppressClick = false;
                }, 280);
            }
        };

        front.addEventListener('touchstart', onDown, { passive: true });
        front.addEventListener('touchmove', onMove, { passive: true });
        front.addEventListener('touchend', onUp);
        front.addEventListener('touchcancel', onUp);
        front.addEventListener('mousedown', onDown);
        front.addEventListener('mousemove', onMove);
        front.addEventListener('mouseup', onUp);
        front.addEventListener('mouseleave', clear);
        front.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            clear();
            this._openFriendActions(peerId);
        });

        return () => {
            clear();
            front.removeEventListener('touchstart', onDown);
            front.removeEventListener('touchmove', onMove);
            front.removeEventListener('touchend', onUp);
            front.removeEventListener('touchcancel', onUp);
            front.removeEventListener('mousedown', onDown);
            front.removeEventListener('mousemove', onMove);
            front.removeEventListener('mouseup', onUp);
            front.removeEventListener('mouseleave', clear);
        };
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
        this._closeOverlay();
        this._swipeDisposes.forEach((d) => d?.());
        this._swipeDisposes = [];
        this._lpDisposes.forEach((d) => d?.());
        this._lpDisposes = [];

        root.querySelectorAll('.mm-swipe-row').forEach((row) => {
            this._swipeDisposes.push(this._bindRowSwipe(row));
            this._lpDisposes.push(this._bindLongPress(row));
        });

        root.querySelectorAll('[data-action="open-thread"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                if (this._suppressClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._suppressClick = false;
                    return;
                }
                this.open(btn.getAttribute('data-id'));
            });
        });

        root.querySelectorAll('[data-action="open-profile"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                if (this._suppressClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._suppressClick = false;
                    return;
                }
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

        root.querySelector('[data-action="friend-menu"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.currentTarget.getAttribute('data-id');
            if (id) this._openFriendActions(id);
        });

        root.querySelector('[data-action="back-list"]')?.addEventListener('click', () => this.closeThread());

        root.querySelector('[data-action="request-image"]')?.addEventListener('click', () => {
            this._requestPersonalImage({ useUserReference: false });
        });
        root.querySelector('[data-action="request-my-image"]')?.addEventListener('click', () => {
            this._requestPersonalImage({ useUserReference: true });
        });

        const form = root.querySelector('#mm-composer');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            this._send();
        });

        const thread = root.querySelector('#mm-thread');
        if (thread) {
            thread.scrollTop = thread.scrollHeight;
            this._bindImageActions(thread);
        }
        this._paintSignal();
    }

    /**
     * Manual Seedream generate.
     * @param {{ useUserReference?: boolean }} [opts]
     */
    _requestPersonalImage(opts = {}) {
        const peerId = this.activePeerId;
        const peer = peerId ? this.app.store.getFriend(peerId) : null;
        if (!peer) return;
        const settings = this.app.store.getSettings();
        const useUser = opts.useUserReference === true;
        if (!isSeedreamConfigured(settings)) {
            toast('请先在「我」页启用 Seedream 并填写 API Key', 'warning');
            return;
        }
        if (useUser) {
            if (!getUserReferenceImage(this.app.store.getProfile())) {
                toast('请先在「我」页上传自己的形象参考图', 'warning');
                return;
            }
        } else if (!getPeerReferenceImage(peer)) {
            toast('请先在编辑资料里上传对方形象参考图', 'warning');
            return;
        }
        const input = document.getElementById('mm-chat-input');
        const scene = String(input?.value || '').trim() || 'casual selfie, natural lighting, looking at camera';
        if (input) input.value = '';
        const msg = appendImagePromptMessage(this.app.store, peer.id, {
            prompt: scene.slice(0, 200),
            from: useUser ? 'me' : 'them',
            useUserReference: useUser,
        });
        this._refreshThreadSoft();
        fulfillImagePromptMessage(this.app.store, peer.id, msg.id, {
            onUpdate: () => {
                if (this.activePeerId === peer.id) this._refreshThreadSoft();
            },
        }).catch((err) => {
            toast(err?.message || '生图失败', 'error');
        });
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
        this._syncInterop();

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
            const allowPersonalImage = Boolean(
                settings.seedreamAutoFromAi !== false
                && isSeedreamConfigured(settings)
                && getPeerReferenceImage(peer),
            );
            const bubbles = await generateNpcReplies({
                peer,
                history: this.app.store.getMessages(peer.id),
                userText,
                myProfile: this.app.store.getProfile(),
                useAi: settings.useAiReply,
                allowPersonalImage,
            });

            if (!bubbles?.length) {
                toast('回复生成失败：AI 未返回有效内容', 'error');
            } else {
                let imageHandled = false;
                const onImgUpdate = () => {
                    if (this.activePeerId === peer.id) {
                        this.app.store.markRead(peer.id);
                        this._refreshThreadSoft();
                    }
                };
                await deliverBubbles(bubbles, async (bubble) => {
                    if (allowPersonalImage) {
                        const handled = await tryHandlePersonalImageBubble(
                            this.app.store,
                            peer.id,
                            bubble,
                            { onUpdate: onImgUpdate },
                        );
                        if (handled) {
                            imageHandled = true;
                            return;
                        }
                    }
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

                // Fallback: user asked for a photo but model only wrote text / 【图片】占位未识别
                if (allowPersonalImage && !imageHandled && userAskedForPhoto(userText)) {
                    const msg = appendImagePromptMessage(this.app.store, peer.id, {
                        prompt: 'casual selfie matching the chat vibe, natural lighting',
                        from: 'them',
                    });
                    onImgUpdate();
                    fulfillImagePromptMessage(this.app.store, peer.id, msg.id, {
                        onUpdate: onImgUpdate,
                    }).catch((e) => console.warn('[st-momo] photo fallback failed', e));
                }
                this._syncInterop();
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
