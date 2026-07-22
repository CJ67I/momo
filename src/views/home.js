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
    recommend: '还没有推荐动态<br/>下拉刷新，由酒馆 API 生成可能与你互动的趣味内容',
    nearby: '还没有同城附近动态<br/>下拉刷新，按你选定的城市生成同城用户与话题',
    friends: '还没有好友动态<br/>先去匹配或附近加好友，再下拉刷新（随机抽好友生成）',
};

export class HomeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.filter = 'recommend';
        this._ptrDispose = null;
        this.refreshing = false;
        /** @type {Record<string, boolean>} */
        this._autoTried = {};
    }

    _city() {
        return String(this.app.store.getProfile().city || '').trim() || '同城';
    }

    async refreshFeed() {
        if (this.refreshing) return;
        this.refreshing = true;
        const channel = this.filter;
        const store = this.app.store;
        const profile = store.getProfile();
        const city = this._city();

        try {
            if (!canUseTavernApi()) {
                toast('酒馆 API 未在线，无法生成动态（纯 AI，无本地文案库）', 'warning');
                this.refreshing = false;
                this.app.render('home');
                return;
            }

            if (channel === 'friends' && !store.getFriends().length) {
                toast('还没有好友，先去匹配或附近加一个吧', 'info');
                store.replaceChannelPosts('friends', []);
                this.refreshing = false;
                this.app.render('home');
                return;
            }

            const tip = channel === 'nearby'
                ? `正在生成「${city}」同城附近动态…`
                : channel === 'friends'
                    ? '正在随机抽取好友并生成动态…'
                    : '正在生成推荐趣味动态…';
            toast(tip, 'info');

            const posts = await refreshFeedChannel(store, channel, profile);
            const failed = posts.filter((p) => p.genFailed).length;
            if (failed) {
                toast(`已刷新，${failed} 条生成失败`, 'warning');
            } else if (!posts.length && channel === 'friends') {
                toast('好友动态为空', 'info');
            } else {
                const label = channel === 'nearby' ? `${city} 附近` : channel === 'friends' ? '好友' : '推荐';
                toast(`已刷新 ${posts.length} 条「${label}」动态`, 'success');
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
        }

        this.refreshing = false;
        this.app.render('home');
    }

    render() {
        const city = this._city();
        const posts = this.app.store.getPosts(this.filter);
        const tip = this.filter === 'nearby'
            ? `下拉刷新「${escapeHtml(city)}」同城动态（纯 AI）`
            : this.filter === 'friends'
                ? '下拉刷新：随机抽好友，由 API 生成动态'
                : '下拉刷新：API 生成可能与你互动的趣味推荐';

        const feedHtml = posts.length
            ? posts.map((p) => this._postCard(p)).join('')
            : `<div class="mm-empty">${EMPTY_COPY[this.filter] || EMPTY_COPY.recommend}</div>`;

        const tab = (id, label) =>
            `<button type="button" class="${this.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`;

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
                    ${this.refreshing ? '<div class="mm-empty">生成中…</div>' : feedHtml}
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
            onRefresh: () => this.refreshFeed(),
        });

        const posts = this.app.store.getPosts(this.filter);
        const needAuto = !this._autoTried[this.filter]
            && posts.length === 0
            && !this.refreshing
            && (this.filter !== 'friends' || this.app.store.getFriends().length > 0);

        if (needAuto) {
            this._autoTried[this.filter] = true;
            setTimeout(() => this.refreshFeed(), 200);
        }

        root.querySelectorAll('[data-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-filter') || 'recommend';
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
