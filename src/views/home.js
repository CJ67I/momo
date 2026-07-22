import { createPostsForUsers, createStrangerPool, ensureHomepage } from '../npc-factory.js';
import { avatarGradient, escapeHtml, relativeTime, toast } from '../utils.js';

export class HomeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.filter = 'nearby'; // nearby | friends | recommend
    }

    async refreshFeed() {
        toast('正在刷新附近异性动态…', 'info');
        const store = this.app.store;
        const profile = store.getProfile();
        try {
            const strangers = await createStrangerPool(profile, 6);
            store.setStrangers(strangers);
            const friendPosts = createPostsForUsers(store.getFriends(), true);
            const strangerPosts = createPostsForUsers(strangers, false);
            // Replace feed posts (keep friend posts + new stranger posts)
            store.replacePosts([...friendPosts, ...strangerPosts]);
            toast('已刷新附近动态', 'success');
        } catch (e) {
            console.error(e);
            toast('刷新失败', 'error');
        }
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
            : `<div class="mm-empty">还没有动态，点右上角刷新一下吧</div>`;

        const tab = (id, label) =>
            `<button type="button" class="${this.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`;

        return `
            <section class="mm-page mm-home">
                <header class="mm-topbar">
                    <div class="mm-brand">陌陌</div>
                    <button type="button" class="mm-icon-btn" data-action="refresh-feed" title="刷新动态">↻</button>
                </header>
                <div class="mm-subtabs">
                    ${tab('nearby', '附近')}
                    ${tab('friends', '好友')}
                    ${tab('recommend', '推荐')}
                </div>
                <div class="mm-feed">${feedHtml}</div>
            </section>
        `;
    }

    _postCard(post) {
        const isFriend = this.app.store.isFriend(post.authorId) || post.isFriend;
        return `
            <article class="mm-card mm-post" data-author-id="${escapeHtml(post.authorId)}">
                <div class="mm-post-head">
                    <button type="button" class="mm-avatar mm-avatar-btn" style="background:${avatarGradient(post.authorId)}" data-action="open-profile" data-id="${escapeHtml(post.authorId)}">${escapeHtml(post.avatarText || '·')}</button>
                    <div class="mm-post-meta">
                        <div class="mm-name-row">
                            <button type="button" class="mm-name-link" data-action="open-profile" data-id="${escapeHtml(post.authorId)}"><strong>${escapeHtml(post.authorName)}</strong></button>
                            <span class="mm-chip">${post.authorAge || '?'}</span>
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
        root.querySelector('[data-action="refresh-feed"]')?.addEventListener('click', () => this.refreshFeed());

        root.querySelectorAll('[data-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-filter') || 'nearby';
                this.app.render('home');
            });
        });

        root.querySelectorAll('[data-action="add-friend"]').forEach((btn) => {
            btn.addEventListener('click', () => {
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
