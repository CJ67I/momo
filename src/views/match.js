import { createMatchCandidate } from '../npc-factory.js';
import { avatarGradient, escapeHtml, normalizeGender, oppositeGender, toast } from '../utils.js';

export class MatchView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.candidate = null;
        this.animating = false;
        this.loading = false;
    }

    _expectedGender() {
        return oppositeGender(this.app.store.getProfile()?.gender);
    }

    _isValidCandidate(user) {
        return user && normalizeGender(user.gender) === this._expectedGender();
    }

    ensureCandidate() {
        if (this._isValidCandidate(this.candidate) || this.loading) return this.candidate;
        this.loading = true;
        createMatchCandidate(this.app.store.getProfile())
            .then((c) => {
                this.candidate = c;
            })
            .catch((e) => {
                console.error(e);
                toast('匹配生成失败', 'error');
            })
            .finally(() => {
                this.loading = false;
                if (this.app.tab === 'match' && this.app.stackPage == null) {
                    this.app.render('match');
                }
            });
        return null;
    }

    nextCandidate() {
        this.candidate = null;
        this.ensureCandidate();
        this.app.render('match');
    }

    resetForGenderChange() {
        this.candidate = null;
        this.loading = false;
    }

    render() {
        const c = this.ensureCandidate();
        if (!c) {
            return `
                <section class="mm-page mm-match">
                    <header class="mm-topbar">
                        <div class="mm-brand">匹配</div>
                        <span class="mm-muted">正在寻找异性…</span>
                    </header>
                    <div class="mm-empty">AI 正在取名并生成匹配对象…</div>
                </section>
            `;
        }

        const tags = (c.tags || []).map((t) => `<span class="mm-tag">${escapeHtml(t)}</span>`).join('');
        const genderLabel = normalizeGender(c.gender) === 'female' ? '女' : '男';

        return `
            <section class="mm-page mm-match">
                <header class="mm-topbar">
                    <div class="mm-brand">匹配</div>
                    <span class="mm-muted">异性 · ${genderLabel}</span>
                </header>
                <div class="mm-match-stage">
                    <div class="mm-match-card" id="mm-match-card">
                        <div class="mm-match-cover" style="background:${avatarGradient(c.id)}">
                            <div class="mm-match-avatar">${escapeHtml(c.avatarText)}</div>
                            <div class="mm-match-online ${c.online ? 'is-on' : ''}">${c.online ? '在线' : '刚刚来过'}</div>
                        </div>
                        <div class="mm-match-body">
                            <h2>${escapeHtml(c.nickname)} <small>${c.age}</small></h2>
                            <p class="mm-muted">${escapeHtml(c.city)} · ${escapeHtml(genderLabel)} · ${escapeHtml(c.distance || '')}</p>
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
            if (this.animating || this.loading) return;
            this._swipe('left', () => this.nextCandidate());
        });

        root.querySelector('[data-action="like"]')?.addEventListener('click', () => {
            if (this.animating || this.loading) return;
            const c = this.candidate;
            this._swipe('right', () => {
                if (c) {
                    this.app.store.pushMatch(c);
                    this.app.store.addFriend(c);
                    toast(`匹配成功！已添加 ${c.nickname}`, 'success');
                }
                this.candidate = null;
                this.nextCandidate();
            });
        });

        root.querySelector('[data-action="view-profile"]')?.addEventListener('click', () => {
            const c = this.candidate;
            if (!c) return;
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
