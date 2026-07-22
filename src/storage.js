import { uid } from './utils.js';

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
        this.save();
    }

    save() {
        persist(this.state);
    }

    getProfile() {
        return this.state.profile;
    }

    updateProfile(patch) {
        this.state.profile = { ...this.state.profile, ...patch, id: 'me' };
        this.save();
        return this.state.profile;
    }

    getFriends() {
        return this.state.friends;
    }

    getStrangers() {
        return this.state.strangers;
    }

    getPosts() {
        return [...this.state.posts].sort((a, b) => b.createdAt - a.createdAt);
    }

    setStrangers(list) {
        this.state.strangers = list;
        this.save();
    }

    upsertPosts(posts) {
        const map = new Map(this.state.posts.map((p) => [p.id, p]));
        for (const p of posts) map.set(p.id, p);
        this.state.posts = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
        this.save();
    }

    addFriend(user) {
        if (!user?.id) return null;
        if (this.state.friends.some((f) => f.id === user.id)) return user;
        const friend = {
            ...user,
            isFriend: true,
            addedAt: Date.now(),
        };
        this.state.friends.unshift(friend);
        this.state.strangers = this.state.strangers.filter((s) => s.id !== user.id);
        this.state.posts = this.state.posts.map((p) =>
            p.authorId === user.id ? { ...p, isFriend: true } : p,
        );
        if (!this.state.chats[user.id]) {
            this.state.chats[user.id] = {
                peerId: user.id,
                messages: [
                    {
                        id: uid('msg'),
                        from: 'them',
                        text: `嗨～我是${user.nickname}，很高兴认识你！`,
                        createdAt: Date.now(),
                    },
                ],
                updatedAt: Date.now(),
                unread: 1,
            };
        }
        this.save();
        return friend;
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
        if (!this.state.chats[peerId]) {
            this.state.chats[peerId] = { peerId, messages: [], updatedAt: Date.now(), unread: 0 };
        }
        const chat = this.state.chats[peerId];
        chat.messages.push(message);
        chat.updatedAt = message.createdAt || Date.now();
        if (message.from === 'them') chat.unread = (chat.unread || 0) + 1;
        this.save();
        return message;
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
