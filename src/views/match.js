import { createMatchCandidate } from '../npc-factory.js';
import { avatarGradient, escapeHtml, toast } from '../utils.js';

export class MatchView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.candidate = null;
        this.animating = false;
    }

    ensureCandidate() {
        if (!this.candidate) {
            this.candidate = createMatchCandidate(this.app.store.getProfile());
        }
        return this.candidate;
    }

    nextCandidate() {
        this.candidate = createMatchCandidate(this.app.store.getProfile());
        this.app.render('match');
    }

    render() {
        const c = this.ensureCandidate();
        const tags = (c.tags || []).map((t) => `<span class="mm-tag">${escapeHtml(t)}</span>`).join('');

        return `
            <section class="mm-page mm-match">
                <header class="mm-topbar">
                    <div class="mm-brand">匹配</div>
                    <span class="mm-muted">随机遇见异性</span>
                </header>
                <div class="mm-match-stage">
                    <div class="mm-match-card" id="mm-match-card">
                        <div class="mm-match-cover" style="background:${avatarGradient(c.id)}">
                            <div class="mm-match-avatar">${escapeHtml(c.avatarText)}</div>
                            <div class="mm-match-online ${c.online ? 'is-on' : ''}">${c.online ? '在线' : '刚刚来过'}</div>
                        </div>
                        <div class="mm-match-body">
                            <h2>${escapeHtml(c.nickname)} <small>${c.age}</small></h2>
                            <p class="mm-muted">${escapeHtml(c.city)} · ${escapeHtml(c.distance || '')}</p>
                            <p class="mm-match-bio">${escapeHtml(c.bio)}</p>
                            <div class="mm-tags">${tags}</div>
                            <button type="button" class="mm-link" data-action="view-profile" style="margin-top:10px">查看主页</button>
                        </div>
                    </div>
                </div>
                <div class="mm-match-actions">
                    <button type="button" class="mm-round-btn mm-pass" data-action="pass" title="跳过">✕</button>
                    <button type="button" class="mm-round-btn mm-like" data-action="like" title="喜欢并加好友">♥</button>
                </div>
            </section>
        `;
    }

    bind(root) {
        root.querySelector('[data-action="pass"]')?.addEventListener('click', () => {
            if (this.animating) return;
            this._swipe('left', () => this.nextCandidate());
        });

        root.querySelector('[data-action="like"]')?.addEventListener('click', () => {
            if (this.animating) return;
            const c = this.candidate;
            this._swipe('right', () => {
                if (c) {
                    this.app.store.pushMatch(c);
                    this.app.store.addFriend(c);
                    toast(`匹配成功！已添加 ${c.nickname}`, 'success');
                }
                this.candidate = null;
                this.app.render('match');
            });
        });

        root.querySelector('[data-action="view-profile"]')?.addEventListener('click', () => {
            const c = this.candidate;
            if (!c) return;
            // stash into strangers so profile can resolve
            const list = this.app.store.getStrangers();
            if (!list.some((s) => s.id === c.id)) {
                this.app.store.setStrangers([c, ...list].slice(0, 20));
            }
            this.app.openProfile(c.id, 'match');
        });
    }

    _swipe(dir, done) {
        const card = document.getElementById('mm-match-card');
        if (!card) {
            done();
            return;
        }
        this.animating = true;
        card.classList.add(dir === 'left' ? 'swipe-left' : 'swipe-right');
        setTimeout(() => {
            this.animating = false;
            done();
        }, 280);
    }
}
