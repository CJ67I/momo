import { getContextScope } from './scope.js';
import { getVirtualNow, patchSetVirtualTime } from './time.js';
import { normalizeGender, uid } from './utils.js';

export const MODULE_NAME = 'st-momo';

const DEFAULT_PROFILE = Object.freeze({
    id: 'me',
    nickname: '旅人',
    gender: 'male',
    age: 22,
    city: '上海',
    bio: '刚来陌陌，想认识有趣的人～',
    avatarText: '我',
});

function emptyState() {
    const now = Date.now();
    return {
        profile: { ...DEFAULT_PROFILE },
        friends: [],
        strangers: [],
        posts: [],
        chats: {},
        matchHistory: [],
        settings: {
            autoReply: true,
            useAiReply: true,
            useAiNames: true,
            feedPrompt: '',
            storyInject: false,
            // off | soft | hard — see interop.js (soft = extension prompt, no chat spam)
            interopMode: 'soft',
            worldbookEnabled: true,
            worldbookSelected: [],
            worldbookByScope: {},
            includeEmbeddedBook: true,
            // virtual time
            virtualTimeMs: now,
            virtualAnchorReal: now,
            timeScale: 1,
            // proactive friend DMs (interval in virtual minutes)
            proactiveEnabled: false,
            proactiveIntervalMin: 30,
        },
    };
}

function getExtensionBucket() {
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (ctx?.extensionSettings) {
            if (!ctx.extensionSettings[MODULE_NAME]) {
                ctx.extensionSettings[MODULE_NAME] = emptyState();
            }
            return ctx.extensionSettings[MODULE_NAME];
        }
    } catch (e) {
        console.warn('[st-momo] extensionSettings unavailable', e);
    }

    const key = `st_momo_fallback_${MODULE_NAME}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
        const state = emptyState();
        localStorage.setItem(key, JSON.stringify(state));
        return state;
    }
    try {
        return JSON.parse(raw);
    } catch {
        const state = emptyState();
        localStorage.setItem(key, JSON.stringify(state));
        return state;
    }
}

function persist(state) {
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (ctx?.extensionSettings) {
            ctx.extensionSettings[MODULE_NAME] = state;
            ctx.saveSettingsDebounced?.();
            return;
        }
    } catch (e) {
        console.warn('[st-momo] saveSettingsDebounced failed', e);
    }
    localStorage.setItem(`st_momo_fallback_${MODULE_NAME}`, JSON.stringify(state));
}

export class MomoStore {
    constructor() {
        this.state = getExtensionBucket();
        this._ensureShape();
    }

    _ensureShape() {
        const base = emptyState();
        for (const key of Object.keys(base)) {
            if (this.state[key] == null) {
                this.state[key] = structuredClone
                    ? structuredClone(base[key])
                    : JSON.parse(JSON.stringify(base[key]));
            }
        }
        if (!this.state.profile?.nickname) this.state.profile = { ...DEFAULT_PROFILE };
        if (!this.state.settings.worldbookByScope || typeof this.state.settings.worldbookByScope !== 'object') {
            this.state.settings.worldbookByScope = {};
        }
        // migrate away from local feed templates / useAiFeed toggle
        if ('feedTemplates' in this.state.settings) delete this.state.settings.feedTemplates;
        if ('useAiFeed' in this.state.settings) delete this.state.settings.useAiFeed;
        // migrate legacy storyInject → interopMode
        if (!this.state.settings.interopMode) {
            this.state.settings.interopMode = this.state.settings.storyInject === true ? 'hard' : 'soft';
        }
        if (!['off', 'soft', 'hard'].includes(this.state.settings.interopMode)) {
            this.state.settings.interopMode = 'soft';
        }
        // migrate legacy posts → channel-tagged feeds
        if (Array.isArray(this.state.posts)) {
            this.state.posts = this.state.posts.map((p) => ({
                ...p,
                channel: p.channel || (p.isFriend ? 'friends' : 'nearby'),
            }));
        }
        if (!Number.isFinite(Number(this.state.settings.virtualTimeMs))) {
            Object.assign(this.state.settings, patchSetVirtualTime(Date.now()));
        }
        if (!Number.isFinite(Number(this.state.settings.virtualAnchorReal))) {
            this.state.settings.virtualAnchorReal = Date.now();
        }
        if (!Number.isFinite(Number(this.state.settings.timeScale)) || Number(this.state.settings.timeScale) <= 0) {
            this.state.settings.timeScale = 1;
        }
        if (!Number.isFinite(Number(this.state.settings.proactiveIntervalMin))) {
            this.state.settings.proactiveIntervalMin = 30;
        }
        this.save();
    }

    save() {
        persist(this.state);
    }

    getProfile() {
        return this.state.profile;
    }

    updateProfile(patch) {
        const next = { ...this.state.profile, ...patch, id: 'me' };
        if (patch.gender != null) next.gender = normalizeGender(patch.gender);
        this.state.profile = next;
        this.save();
        return this.state.profile;
    }

    getWorldbookSettings() {
        const s = this.getSettings();
        const scope = getContextScope();
        const map = s.worldbookByScope || {};
        const hasScoped = Object.prototype.hasOwnProperty.call(map, scope.key);
        const selected = hasScoped
            ? [...(Array.isArray(map[scope.key]) ? map[scope.key] : [])]
            : (Array.isArray(s.worldbookSelected) ? [...s.worldbookSelected] : []);
        return {
            enabled: s.worldbookEnabled !== false,
            selected,
            includeEmbedded: s.includeEmbeddedBook !== false,
            scopeKey: scope.key,
            scopeLabel: scope.label,
        };
    }

    setWorldbookSelection(names = []) {
        const selected = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))];
        const scope = getContextScope();
        const map = { ...(this.getSettings().worldbookByScope || {}) };
        map[scope.key] = selected;
        return this.updateSettings({
            worldbookByScope: map,
            worldbookSelected: selected,
            worldbookEnabled: true,
        });
    }

    getFriends() {
        return this.state.friends;
    }

    getStrangers() {
        return this.state.strangers;
    }

    /**
     * @param {'recommend'|'nearby'|'friends'|null} [channel]
     */
    getPosts(channel = null) {
        let list = this.state.posts || [];
        if (channel) list = list.filter((p) => p.channel === channel);
        return [...list].sort((a, b) => b.createdAt - a.createdAt);
    }

    setStrangers(list) {
        this.state.strangers = list;
        this.save();
    }

    upsertPosts(posts) {
        const map = new Map(this.state.posts.map((p) => [p.id, p]));
        for (const p of posts) map.set(p.id, { ...p, channel: p.channel || 'nearby' });
        this.state.posts = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 120);
        this.save();
    }

    replacePosts(posts) {
        this.state.posts = Array.isArray(posts) ? [...posts] : [];
        this.save();
    }

    /**
     * Replace only one home-feed channel; leave other channels intact.
     * @param {'recommend'|'nearby'|'friends'} channel
     * @param {object[]} posts
     */
    replaceChannelPosts(channel, posts) {
        const others = (this.state.posts || []).filter((p) => p.channel !== channel);
        const tagged = (posts || []).map((p) => ({ ...p, channel }));
        this.state.posts = [...others, ...tagged]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 120);
        this.save();
    }

    addFriend(user) {
        if (!user?.id) return null;
        if (this.state.friends.some((f) => f.id === user.id)) return user;
        const now = getVirtualNow(this.getSettings());
        const friend = {
            ...user,
            isFriend: true,
            addedAt: now,
            lastProactiveAt: now,
            personaReady: Boolean(user.personaReady),
        };
        this.state.friends.unshift(friend);
        this.state.strangers = this.state.strangers.filter((s) => s.id !== user.id);
        // Leave recommend / nearby immediately; friends tab waits for next refresh
        this.state.posts = this.state.posts
            .filter((p) => !(p.authorId === user.id && (p.channel === 'recommend' || p.channel === 'nearby')))
            .map((p) => (p.authorId === user.id ? { ...p, isFriend: true } : p));
        if (!this.state.chats[user.id]) {
            this.state.chats[user.id] = {
                peerId: user.id,
                messages: [
                    {
                        id: uid('msg'),
                        from: 'them',
                        text: `嗨～我是${user.nickname}，很高兴认识你！`,
                        createdAt: now,
                    },
                ],
                updatedAt: now,
                unread: 1,
            };
        }
        this.save();
        return friend;
    }

    removeFriend(userId) {
        const id = String(userId || '');
        if (!id) return false;
        const before = this.state.friends.length;
        this.state.friends = this.state.friends.filter((f) => f.id !== id);
        delete this.state.chats[id];
        this.state.posts = this.state.posts
            .filter((p) => !(p.authorId === id && p.channel === 'friends'))
            .map((p) => (p.authorId === id ? { ...p, isFriend: false } : p));
        this.save();
        return this.state.friends.length < before;
    }

    isFriend(userId) {
        return this.state.friends.some((f) => f.id === userId);
    }

    getFriend(userId) {
        return this.state.friends.find((f) => f.id === userId) || null;
    }

    getUser(userId) {
        return (
            this.state.friends.find((f) => f.id === userId)
            || this.state.strangers.find((s) => s.id === userId)
            || this.state.matchHistory.find((m) => m.id === userId)
            || null
        );
    }

    updateUser(user) {
        if (!user?.id) return;
        const patchList = (list) => {
            const idx = list.findIndex((x) => x.id === user.id);
            if (idx >= 0) list[idx] = { ...list[idx], ...user };
        };
        patchList(this.state.friends);
        patchList(this.state.strangers);
        patchList(this.state.matchHistory);
        this.save();
    }

    getChatList() {
        return this.state.friends
            .map((f) => {
                const chat = this.state.chats[f.id] || { messages: [], updatedAt: f.addedAt || 0, unread: 0 };
                const last = chat.messages[chat.messages.length - 1];
                return {
                    friend: f,
                    lastMessage: last?.text || '打个招呼吧',
                    updatedAt: chat.updatedAt || 0,
                    unread: chat.unread || 0,
                };
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getMessages(peerId) {
        return this.state.chats[peerId]?.messages || [];
    }

    appendMessage(peerId, message) {
        const now = getVirtualNow(this.getSettings());
        if (!this.state.chats[peerId]) {
            this.state.chats[peerId] = { peerId, messages: [], updatedAt: now, unread: 0 };
        }
        const chat = this.state.chats[peerId];
        const msg = { ...message, createdAt: message.createdAt || now };
        chat.messages.push(msg);
        chat.updatedAt = msg.createdAt;
        if (msg.from === 'them') chat.unread = (chat.unread || 0) + 1;
        this.save();
        return msg;
    }

    /** Current virtual time (ms). */
    now() {
        return getVirtualNow(this.getSettings());
    }

    setVirtualClock(when) {
        return this.updateSettings(patchSetVirtualTime(when));
    }

    markRead(peerId) {
        if (this.state.chats[peerId]) {
            this.state.chats[peerId].unread = 0;
            this.save();
        }
    }

    pushMatch(user) {
        this.state.matchHistory.unshift({ ...user, matchedAt: Date.now() });
        this.state.matchHistory = this.state.matchHistory.slice(0, 30);
        this.save();
    }

    getSettings() {
        return this.state.settings;
    }

    updateSettings(patch) {
        this.state.settings = { ...this.state.settings, ...patch };
        this.save();
        return this.state.settings;
    }

    resetAll() {
        this.state = emptyState();
        this.save();
    }
}
