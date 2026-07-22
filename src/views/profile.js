import { ensureHomepage } from '../npc-factory.js';
import { avatarGradient, escapeHtml, relativeTime, toast } from '../utils.js';

export class ProfileView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.userId = null;
        this.returnTab = 'home';
    }

    open(userId, returnTab = 'home') {
        this.userId = userId;
        this.returnTab = returnTab || 'home';
        this.app.stackPage = 'profile';
        this.app.render('profile');
    }

    close() {
        this.userId = null;
        this.app.stackPage = null;
        this.app.render(this.returnTab || 'home');
    }

    _resolveUser() {
        let user = this.app.store.getUser(this.userId);
        if (!user) return null;
        user = ensureHomepage(user);
        // persist back if we filled homepage
        this.app.store.updateUser(user);
        return user;
    }

    render() {
        const user = this._resolveUser();
        if (!user) {
            return `
                <section class="mm-page">
                    <header class="mm-topbar">
                        <button type="button" class="mm-icon-btn" data-action="back">‹</button>
                        <div class="mm-brand">主页</div>
                        <span></span>
                    </header>
                    <div class="mm-empty">找不到该用户</div>
                </section>
            `;
        }

        const isFriend = this.app.store.isFriend(user.id);
        const posts = this.app.store.getPosts().filter((p) => p.authorId === user.id).slice(0, 6);
        const hp = user.homepage || {};
        const moments = hp.moments || [];
        const tags = (user.tags || []).map((t) => `<span class="mm-tag">${escapeHtml(t)}</span>`).join('');
        const avatarStyle = user.avatarUrl
            ? `background-image:url('${escapeHtml(user.avatarUrl)}');background-size:cover;background-position:center;`
            : `background:${avatarGradient(user.id)}`;

        const postHtml = posts.length
            ? posts.map((p) => `
                <article class="mm-card mm-post">
                    <p class="mm-post-text">${escapeHtml(p.text)}</p>
                    <div class="mm-muted">${relativeTime(p.createdAt)} · ♡ ${p.likes || 0}</div>
                </article>
            `).join('')
            : `<div class="mm-empty" style="padding:20px">暂无动态</div>`;

        const momentHtml = moments.length
            ? moments.map((m) => `
                <div class="mm-moment">
                    <div class="mm-moment-dot"></div>
                    <div>
                        <div>${escapeHtml(m.text)}</div>
                        <div class="mm-muted">${relativeTime(m.createdAt)}</div>
                    </div>
                </div>
            `).join('')
            : '';

        return `
            <section class="mm-page mm-profile">
                <header class="mm-topbar">
                    <button type="button" class="mm-icon-btn" data-action="back">‹</button>
                    <div class="mm-brand">主页</div>
                    <span class="mm-muted">${user.online ? '在线' : '离线'}</span>
                </header>
                <div class="mm-profile-scroll">
                    <div class="mm-profile-cover" style="background:${avatarGradient(user.id + '_cover')}"></div>
                    <div class="mm-profile-head">
                        <div class="mm-avatar xl" style="${avatarStyle}">${user.avatarUrl ? '' : escapeHtml(user.avatarText || '·')}</div>
                        <div class="mm-profile-head-text">
                            <h2>${escapeHtml(user.nickname)} <small>${user.age || ''}</small></h2>
                            <p class="mm-muted">${escapeHtml(user.city || '')} · ${user.gender === 'female' ? '女' : '男'} · ${escapeHtml(user.distance || '')}</p>
                            ${user.linkedCharacter ? `<p class="mm-link-tag">酒馆角色：${escapeHtml(user.linkedCharacter.name)}</p>` : ''}
                        </div>
                    </div>
                    <div class="mm-profile-actions">
                        ${
                            isFriend
                                ? `<button type="button" class="mm-btn mm-btn-block" data-action="chat">发消息</button>`
                                : `<button type="button" class="mm-btn mm-btn-block" data-action="add">加好友</button>`
                        }
                    </div>
                    <div class="mm-card mm-profile-about">
                        <h3>关于我</h3>
                        <p>${escapeHtml(hp.about || user.bio || '人设生成中，稍后再看…')}</p>
                        ${user.persona ? `<p class="mm-persona-block">${escapeHtml(user.persona)}</p>` : ''}
                        ${user.speechStyle ? `<p class="mm-muted" style="margin-top:8px">对话风格：${escapeHtml(user.speechStyle)}</p>` : ''}
                        <div class="mm-profile-meta">
                            <span>职业 ${escapeHtml(hp.job || '保密')}</span>
                            <span>情感 ${escapeHtml(hp.relationship || '保密')}</span>
                        </div>
                        <div class="mm-tags" style="margin-top:10px">${tags}</div>
                    </div>
                    ${momentHtml ? `
                        <div class="mm-card">
                            <h3>动态瞬间</h3>
                            <div class="mm-moments">${momentHtml}</div>
                        </div>
                    ` : ''}
                    <div class="mm-profile-section-title">附近动态</div>
                    ${postHtml}
                </div>
            </section>
        `;
    }

    bind(root) {
        root.querySelector('[data-action="back"]')?.addEventListener('click', () => this.close());

        root.querySelector('[data-action="add"]')?.addEventListener('click', () => {
            const user = this._resolveUser();
            if (!user) return;
            this.app.addFriendAndEnrich(user);
            toast(`已添加 ${user.nickname}`, 'success');
            this.app.render('profile');
        });

        root.querySelector('[data-action="chat"]')?.addEventListener('click', () => {
            const user = this._resolveUser();
            if (!user) return;
            if (!this.app.store.isFriend(user.id)) this.app.addFriendAndEnrich(user);
            this.app.stackPage = null;
            this.app.openChat(user.id);
        });
    }
}
