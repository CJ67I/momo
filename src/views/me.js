import { canUseTavernApi } from '../ai.js';
import { createNpcFromCharacter } from '../npc-factory.js';
import {
    getApiStatus,
    getCharacterAvatarUrl,
    getCharacterInfo,
    getChatHistory,
    getPersonaInfo,
    getWorldInfoSnippets,
} from '../st-bridge.js';
import { avatarGradient, escapeHtml, toast } from '../utils.js';

export class MeView {
    /**
     * @param {import('../app.js').MomoApp} app
     */
    constructor(app) {
        this.app = app;
        this.bridgeInfo = {
            api: getApiStatus(),
            persona: getPersonaInfo(),
            character: getCharacterInfo(),
            chatCount: getChatHistory(50).length,
            worldBooks: [],
            worldPreview: '',
        };
    }

    async refreshBridge() {
        const world = await getWorldInfoSnippets('', 400);
        this.bridgeInfo = {
            api: getApiStatus(),
            persona: getPersonaInfo(),
            character: getCharacterInfo(),
            chatCount: getChatHistory(50).length,
            worldBooks: world.books || [],
            worldPreview: world.text || '',
            worldSource: world.source,
        };
    }

    render() {
        const p = this.app.store.getProfile();
        const settings = this.app.store.getSettings();
        const friends = this.app.store.getFriends().length;
        const api = this.bridgeInfo.api;
        const persona = this.bridgeInfo.persona;
        const character = this.bridgeInfo.character;

        const apiOk = canUseTavernApi();
        const apiLine = !api.available
            ? '未检测到酒馆上下文（本地预览模式）'
            : apiOk
                ? `已接入 · ${api.mainApi || 'api'} · ${api.modelHint || api.onlineStatus}`
                : `未在线 · ${api.mainApi || 'api'} · ${api.onlineStatus}（NPC 将用本地话术回复）`;

        return `
            <section class="mm-page mm-me">
                <header class="mm-topbar">
                    <div class="mm-brand">我</div>
                    <button type="button" class="mm-link" data-action="refresh-bridge">刷新联动</button>
                </header>
                <div class="mm-me-hero">
                    <div class="mm-avatar lg" style="background:${avatarGradient(p.id)}">${escapeHtml(p.avatarText || '我')}</div>
                    <div>
                        <h2>${escapeHtml(p.nickname)} <small>${p.age}</small></h2>
                        <p class="mm-muted">${escapeHtml(p.city)} · ${p.gender === 'female' ? '女' : '男'}</p>
                        <p class="mm-me-bio">${escapeHtml(p.bio)}</p>
                        <p class="mm-muted">好友 ${friends}</p>
                    </div>
                </div>

                <div class="mm-card mm-bridge-card">
                    <h3>酒馆联动状态</h3>
                    <p class="mm-bridge-status ${apiOk ? 'ok' : 'warn'}">${escapeHtml(apiLine)}</p>
                    <ul class="mm-bridge-list">
                        <li>Persona：${escapeHtml(persona.name || '未设置')}${persona.description ? '（已读人设）' : ''}</li>
                        <li>角色卡：${escapeHtml(character?.name || '未选择')}</li>
                        <li>主聊天：${this.bridgeInfo.chatCount} 条可读</li>
                        <li>世界书：${(this.bridgeInfo.worldBooks || []).length} 本${this.bridgeInfo.worldSource && this.bridgeInfo.worldSource !== 'none' ? ` · 已注入(${this.bridgeInfo.worldSource})` : ''}</li>
                        <li>generateRaw：${api.hasGenerateRaw ? '可用' : '不可用'}</li>
                    </ul>
                    <button type="button" class="mm-btn mm-btn-ghost mm-btn-block" data-action="sync-persona">从 Persona 同步昵称</button>
                    <button type="button" class="mm-btn mm-btn-block" data-action="import-character">导入当前角色卡为好友</button>
                </div>

                <form class="mm-form" id="mm-profile-form">
                    <label>昵称<input name="nickname" value="${escapeHtml(p.nickname)}" maxlength="16" required /></label>
                    <label>年龄<input name="age" type="number" min="18" max="60" value="${Number(p.age) || 22}" required /></label>
                    <label>城市<input name="city" value="${escapeHtml(p.city)}" maxlength="20" required /></label>
                    <label>性别
                        <select name="gender">
                            <option value="male" ${p.gender === 'male' ? 'selected' : ''}>男</option>
                            <option value="female" ${p.gender === 'female' ? 'selected' : ''}>女</option>
                        </select>
                    </label>
                    <label>简介<textarea name="bio" rows="3" maxlength="80">${escapeHtml(p.bio)}</textarea></label>
                    <button type="submit" class="mm-btn mm-btn-block">保存资料</button>
                </form>

                <div class="mm-settings">
                    <label class="mm-switch">
                        <span>好友自动回复</span>
                        <input type="checkbox" id="mm-auto-reply" ${settings.autoReply ? 'checked' : ''} />
                    </label>
                    <label class="mm-switch">
                        <span>优先使用酒馆 API 回复</span>
                        <input type="checkbox" id="mm-ai-reply" ${settings.useAiReply ? 'checked' : ''} />
                    </label>
                    <button type="button" class="mm-btn mm-btn-ghost mm-btn-block" data-action="reset">清空本地数据</button>
                </div>
            </section>
        `;
    }

    bind(root) {
        // refresh bridge info when page shows
        this.refreshBridge().then(() => {
            // only re-render if still on me
            if (this.app.tab === 'me' && this.app.stackPage == null && this.app.open) {
                const host = this.app.root?.querySelector('#mm-screen');
                if (host && host.querySelector('.mm-me')) {
                    // update status texts in place to avoid loop
                    const status = host.querySelector('.mm-bridge-status');
                    const api = this.bridgeInfo.api;
                    const apiOk = canUseTavernApi();
                    if (status) {
                        status.className = `mm-bridge-status ${apiOk ? 'ok' : 'warn'}`;
                        status.textContent = !api.available
                            ? '未检测到酒馆上下文（本地预览模式）'
                            : apiOk
                                ? `已接入 · ${api.mainApi || 'api'} · ${api.modelHint || api.onlineStatus}`
                                : `未在线 · ${api.mainApi || 'api'} · ${api.onlineStatus}（NPC 将用本地话术回复）`;
                    }
                    const list = host.querySelector('.mm-bridge-list');
                    if (list) {
                        const persona = this.bridgeInfo.persona;
                        const character = this.bridgeInfo.character;
                        list.innerHTML = `
                            <li>Persona：${escapeHtml(persona.name || '未设置')}${persona.description ? '（已读人设）' : ''}</li>
                            <li>角色卡：${escapeHtml(character?.name || '未选择')}</li>
                            <li>主聊天：${this.bridgeInfo.chatCount} 条可读</li>
                            <li>世界书：${(this.bridgeInfo.worldBooks || []).length} 本${this.bridgeInfo.worldSource && this.bridgeInfo.worldSource !== 'none' ? ` · 已注入(${this.bridgeInfo.worldSource})` : ''}</li>
                            <li>generateRaw：${api.hasGenerateRaw ? '可用' : '不可用'}</li>
                        `;
                    }
                }
            }
        });

        root.querySelector('#mm-profile-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const nickname = String(fd.get('nickname') || '').trim();
            const age = Number(fd.get('age')) || 22;
            const city = String(fd.get('city') || '').trim();
            const gender = String(fd.get('gender') || 'male');
            const bio = String(fd.get('bio') || '').trim();
            this.app.store.updateProfile({
                nickname,
                age,
                city,
                gender,
                bio,
                avatarText: nickname.slice(0, 1) || '我',
            });
            toast('资料已保存', 'success');
            this.app.render('me');
        });

        root.querySelector('#mm-auto-reply')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ autoReply: e.target.checked });
        });
        root.querySelector('#mm-ai-reply')?.addEventListener('change', (e) => {
            this.app.store.updateSettings({ useAiReply: e.target.checked });
        });

        root.querySelector('[data-action="refresh-bridge"]')?.addEventListener('click', async () => {
            await this.refreshBridge();
            toast('已刷新酒馆联动信息', 'success');
            this.app.render('me');
        });

        root.querySelector('[data-action="sync-persona"]')?.addEventListener('click', () => {
            const persona = getPersonaInfo();
            if (!persona.name) {
                toast('未读取到 Persona 名称', 'warning');
                return;
            }
            this.app.store.updateProfile({
                nickname: persona.name.slice(0, 16),
                avatarText: persona.name.slice(0, 1),
                bio: persona.description ? persona.description.slice(0, 80) : this.app.store.getProfile().bio,
            });
            toast(`已同步：${persona.name}`, 'success');
            this.app.render('me');
        });

        root.querySelector('[data-action="import-character"]')?.addEventListener('click', () => {
            const character = getCharacterInfo();
            if (!character?.name) {
                toast('请先在酒馆选择一个角色卡', 'warning');
                return;
            }
            const profile = this.app.store.getProfile();
            const npc = createNpcFromCharacter(character, {
                gender: profile.gender === 'male' ? 'female' : 'male',
                city: profile.city,
                avatarUrl: getCharacterAvatarUrl(character.avatar),
            });
            if (!npc) return;
            if (this.app.store.isFriend(npc.id)) {
                this.app.store.updateUser(npc);
                toast('已更新该角色好友资料', 'info');
            } else {
                this.app.store.addFriend(npc);
                toast(`已添加好友：${npc.nickname}`, 'success');
            }
            this.app.openProfile(npc.id, 'me');
        });

        root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
            if (!confirm('确定清空陌陌扩展的全部本地数据？')) return;
            this.app.store.resetAll();
            this.app.chatView.activePeerId = null;
            this.app.matchView.candidate = null;
            this.app.stackPage = null;
            toast('已清空', 'warning');
            this.app.render('me');
        });
    }
}
