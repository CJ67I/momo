import { createPostsForUsers, createStrangerPool, ensureHomepage } from '../npc-factory.js';
import { bindPullToRefresh, ptrMarkup } from '../pull-refresh.js';
import { injectAddFriend, injectFeedRefresh } from '../story-inject.js';
import { avatarGradient, escapeHtml, normalizeGender, relativeTime, toast } from '../utils.js';

export class HomeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.filter = 'nearby';
        this._ptrDispose = null;
        this.refreshing = false;
    }

    async refreshFeed() {
        if (this.refreshing) return;
        this.refreshing = true;
        const store = this.app.store;
        const profile = store.getProfile();
        try {
            const strangers = await createStrangerPool(profile, 6, {
                parallel: true,
                preferFast: true,
            });
            store.setStrangers(strangers);
            const friendPosts = await createPostsForUsers(store.getFriends(), true);
            const strangerPosts = await createPostsForUsers(strangers, false);
            store.replacePosts([...friendPosts, ...strangerPosts]);
            await injectFeedRefresh(strangerPosts.length);
            toast('已刷新附近动态', 'success');
        } catch (e) {
            console.error(e);
            toast('刷新失败', 'error');
        }
        this.refreshing = false;
        this.app.render('home');
    }

    render() {
        let posts = this.app.store.getPosts();
        if (this.filter === 'friends') {
            posts = posts.filter((p) => this.app.store.isFriend(p.authorId) || p.isFriend);
        } else if (this.filter === 'recommend') {
            posts = posts.filter((p) => !(this.app.store.isFriend(p.authorId) || p.isFriend));
        }

        const feedHtml = posts.length
            ? posts.map((p) => this._postCard(p)).join('')
            : `<div class="mm-empty">还没有动态<br/>下拉页面即可刷新</div>`;

        const tab = (id, label) =>
            `<button type="button" class="${this.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`;

        return `
            <section class="mm-page mm-home mm-page-enter">
                <header class="mm-topbar">
                    <div class="mm-brand">陌陌</div>
                    <span class="mm-muted">下拉刷新</span>
                </header>
                <div class="mm-subtabs">
                    ${tab('nearby', '附近')}
                    ${tab('friends', '好友')}
                    ${tab('recommend', '推荐')}
                </div>
                <div class="mm-feed mm-scroll" id="mm-home-scroll">
                    ${ptrMarkup()}
                    ${feedHtml}
                    <div class="mm-ptr-tip">下拉刷新附近动态</div>
                </div>
            </section>
        `;
    }

    _postCard(post) {
        const isFriend = this.app.store.isFriend(post.authorId) || post.isFriend;
        const gender = normalizeGender(post.authorGender);
        const ageClass = gender === 'female' ? 'is-female' : 'is-male';
        return `
            <article class="mm-card mm-post" data-author-id="${escapeHtml(post.authorId)}">
                <div class="mm-post-head">
                    <button type="button" class="mm-avatar mm-avatar-btn" style="background:${avatarGradient(post.authorId)}" data-action="open-profile" data-id="${escapeHtml(post.authorId)}">${escapeHtml(post.avatarText || '·')}</button>
                    <div class="mm-post-meta">
                        <div class="mm-name-row">
                            <button type="button" class="mm-name-link" data-action="open-profile" data-id="${escapeHtml(post.authorId)}"><strong>${escapeHtml(post.authorName)}</strong></button>
                            <span class="mm-chip mm-age ${ageClass}" title="${gender === 'female' ? '女' : '男'}">${post.authorAge || '?'}</span>
                            <span class="mm-muted">${escapeHtml(post.authorCity || '')}</span>
                        </div>
                        <div class="mm-muted">${escapeHtml(post.distance || '')} · ${relativeTime(post.createdAt)}</div>
                    </div>
                    ${
                        isFriend
                            ? `<span class="mm-friend-tag">好友</span>`
                            : `<button type="button" class="mm-btn mm-btn-sm" data-action="add-friend" data-id="${escapeHtml(post.authorId)}">加好友</button>`
                    }
                </div>
                <p class="mm-post-text">${escapeHtml(post.text)}</p>
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

        root.querySelectorAll('[data-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-filter') || 'nearby';
                this.app.render('home');
            });
        });

        root.querySelectorAll('[data-action="add-friend"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const stranger = this.app.store.getStrangers().find((s) => s.id === id);
                const fromPost = this.app.store.getPosts().find((p) => p.authorId === id);
                const user = ensureHomepage(stranger || (fromPost
                    ? {
                        id: fromPost.authorId,
                        nickname: fromPost.authorName,
                        age: fromPost.authorAge,
                        city: fromPost.authorCity,
                        gender: fromPost.authorGender,
                        avatarText: fromPost.avatarText,
                        distance: fromPost.distance,
                        bio: '来自附近动态',
                        tags: ['附近'],
                    }
                    : null));
                if (!user) return;
                this.app.store.addFriend(user);
                await injectAddFriend(user);
                toast(`已添加 ${user.nickname}`, 'success');
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
