import { canUseTavernApi } from '../ai.js';
import { refreshFeedChannel } from '../feed-refresh.js';
import { ensureHomepage } from '../npc-factory.js';
import { bindPullToRefresh, ptrMarkup } from '../pull-refresh.js';
import { injectAddFriend } from '../story-inject.js';
import { avatarGradient, escapeHtml, normalizeGender, relativeTime, toast } from '../utils.js';

const TABS = [
    { id: 'recommend', label: '推荐' },
    { id: 'nearby', label: '附近' },
    { id: 'friends', label: '好友' },
];

const EMPTY_COPY = {
    recommend: '还没有推荐动态<br/>下拉刷新，一次批量生成趣味互动内容',
    nearby: '还没有同城附近动态<br/>下拉刷新，按你选定的城市批量生成同城动态',
    friends: '还没有好友动态<br/>先去匹配或附近加好友，再下拉刷新',
};

export class HomeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.filter = 'recommend';
        this._ptrDispose = null;
        /** @type {string|null} currently refreshing channel */
        this.refreshingChannel = null;
        /** @type {Record<string, boolean>} */
        this._autoTried = {};
    }

    get refreshing() {
        return Boolean(this.refreshingChannel);
    }

    _city() {
        return String(this.app.store.getProfile().city || '').trim() || '同城';
    }

    async refreshFeed(forceChannel = null) {
        const channel = forceChannel || this.filter;
        if (this.refreshingChannel) {
            if (this.refreshingChannel === channel) return;
            toast(`正在刷新「${this._label(this.refreshingChannel)}」，请稍候`, 'info');
            return;
        }

        this.refreshingChannel = channel;
        const store = this.app.store;
        const profile = store.getProfile();
        const city = this._city();

        // Only re-render loading state for the active tab
        if (this.filter === channel) this.app.render('home');

        try {
            if (!canUseTavernApi()) {
                toast('酒馆 API 未在线，无法生成动态（纯 AI，无本地文案库）', 'warning');
                return;
            }

            if (channel === 'friends' && !store.getFriends().length) {
                toast('还没有好友，先去匹配或附近加一个吧', 'info');
                store.replaceChannelPosts('friends', []);
                return;
            }

            toast(`正在生成「${this._label(channel, city)}」…`, 'info');
            const posts = await refreshFeedChannel(store, channel, profile);

            if (!posts.length && channel === 'friends') {
                toast('好友动态为空', 'info');
            } else {
                toast(`已刷新 ${posts.length} 条「${this._label(channel, city)}」`, 'success');
            }
        } catch (e) {
            console.error(e);
            if (e?.message === 'api_offline') {
                toast('酒馆 API 未在线，无法生成动态', 'warning');
            } else if (e?.message === 'gen_empty') {
                toast('API 未返回可用内容，请稍后重试', 'warning');
            } else {
                toast('刷新失败', 'error');
            }
        } finally {
            this.refreshingChannel = null;
            if (this.app.tab === 'home') this.app.render('home');
        }
    }

    _label(channel, city = '') {
        if (channel === 'nearby') return `${city || this._city()} 附近`;
        if (channel === 'friends') return '好友';
        return '推荐';
    }

    render() {
        const city = this._city();
        const posts = this.app.store.getPosts(this.filter);
        const loadingThis = this.refreshingChannel === this.filter;
        const tip = this.filter === 'nearby'
            ? `下拉刷新「${escapeHtml(city)}」同城（一次批量生成）`
            : this.filter === 'friends'
                ? '下拉刷新：随机抽好友批量生成'
                : '下拉刷新：批量生成跨城趣味推荐';

        const feedHtml = posts.length
            ? posts.map((p) => this._postCard(p)).join('')
            : `<div class="mm-empty">${EMPTY_COPY[this.filter] || EMPTY_COPY.recommend}</div>`;

        const tab = (id, label) => {
            const busy = this.refreshingChannel === id ? ' ·…' : '';
            return `<button type="button" class="${this.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}${busy}</button>`;
        };

        return `
            <section class="mm-page mm-home mm-page-enter">
                <header class="mm-topbar">
                    <div class="mm-brand">陌陌</div>
                    <span class="mm-muted">${escapeHtml(city)} · 下拉刷新</span>
                </header>
                <div class="mm-subtabs">
                    ${TABS.map((t) => tab(t.id, t.label)).join('')}
                </div>
                <div class="mm-feed mm-scroll" id="mm-home-scroll">
                    ${ptrMarkup()}
                    ${loadingThis ? '<div class="mm-empty">批量生成中…</div>' : feedHtml}
                    <div class="mm-ptr-tip">${tip}</div>
                </div>
            </section>
        `;
    }

    _postCard(post) {
        const isFriend = this.app.store.isFriend(post.authorId) || post.isFriend;
        const gender = normalizeGender(post.authorGender);
        const ageClass = gender === 'female' ? 'is-female' : 'is-male';
        const channelBadge = post.channel === 'recommend'
            ? '<span class="mm-channel-tag">推荐</span>'
            : post.channel === 'nearby'
                ? `<span class="mm-channel-tag is-nearby">${escapeHtml(post.authorCity || '同城')}</span>`
                : '';

        return `
            <article class="mm-card mm-post" data-author-id="${escapeHtml(post.authorId)}" data-channel="${escapeHtml(post.channel || '')}">
                <div class="mm-post-head">
                    <button type="button" class="mm-avatar mm-avatar-btn" style="background:${avatarGradient(post.authorId)}" data-action="open-profile" data-id="${escapeHtml(post.authorId)}">${escapeHtml(post.avatarText || '·')}</button>
                    <div class="mm-post-meta">
                        <div class="mm-name-row">
                            <button type="button" class="mm-name-link" data-action="open-profile" data-id="${escapeHtml(post.authorId)}"><strong>${escapeHtml(post.authorName)}</strong></button>
                            <span class="mm-chip mm-age ${ageClass}" title="${gender === 'female' ? '女' : '男'}">${post.authorAge || '?'}</span>
                            <span class="mm-muted">${escapeHtml(post.authorCity || '')}</span>
                            ${channelBadge}
                        </div>
                        <div class="mm-muted">${escapeHtml(post.distance || '')} · ${relativeTime(post.createdAt)}</div>
                    </div>
                    ${
                        isFriend
                            ? `<span class="mm-friend-tag">好友</span>`
                            : `<button type="button" class="mm-btn mm-btn-sm" data-action="add-friend" data-id="${escapeHtml(post.authorId)}">加好友</button>`
                    }
                </div>
                <p class="mm-post-text ${post.genFailed ? 'is-failed' : ''}">${escapeHtml(post.text)}</p>
                <div class="mm-post-actions">
                    <span>♡ ${post.likes || 0}</span>
                    <span>💬 ${post.comments || 0}</span>
                    <button type="button" class="mm-link" data-action="open-chat-from-post" data-id="${escapeHtml(post.authorId)}" ${isFriend ? '' : 'disabled'}>私聊</button>
                </div>
            </article>
        `;
    }

    bind(root) {
        this._ptrDispose?.();
        const scroll = root.querySelector('#mm-home-scroll');
        this._ptrDispose = bindPullToRefresh(scroll, {
            onRefresh: () => this.refreshFeed(this.filter),
        });

        // Auto-refresh ONLY the current empty tab, never cascade to others
        const posts = this.app.store.getPosts(this.filter);
        const canAuto = !this._autoTried[this.filter]
            && !this.refreshingChannel
            && posts.length === 0
            && (this.filter !== 'friends' || this.app.store.getFriends().length > 0);

        if (canAuto) {
            this._autoTried[this.filter] = true;
            const ch = this.filter;
            setTimeout(() => {
                if (this.filter === ch && !this.refreshingChannel) this.refreshFeed(ch);
            }, 220);
        }

        root.querySelectorAll('[data-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.getAttribute('data-filter') || 'recommend';
                if (next === this.filter) return;
                this.filter = next;
                this.app.render('home');
            });
        });

        root.querySelectorAll('[data-action="add-friend"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const city = this._city();
                const stranger = this.app.store.getStrangers().find((s) => s.id === id);
                const fromPost = this.app.store.getPosts().find((p) => p.authorId === id);
                const user = ensureHomepage(stranger || (fromPost
                    ? {
                        id: fromPost.authorId,
                        nickname: fromPost.authorName,
                        age: fromPost.authorAge,
                        city: fromPost.authorCity || city,
                        gender: fromPost.authorGender,
                        avatarText: fromPost.avatarText,
                        distance: fromPost.distance,
                        bio: '',
                        tags: [],
                    }
                    : null));
                if (!user) return;
                this.app.addFriendAndEnrich(user);
                await injectAddFriend(user);
                toast(`已添加 ${user.nickname}，可到「好友」下拉刷新看动态`, 'success');
                this.app.render('home');
            });
        });

        root.querySelectorAll('[data-action="open-chat-from-post"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.hasAttribute('disabled')) return;
                const id = btn.getAttribute('data-id');
                this.app.openChat(id);
            });
        });

        root.querySelectorAll('[data-action="open-profile"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (id) this.app.openProfile(id, 'home');
            });
        });
    }
}
