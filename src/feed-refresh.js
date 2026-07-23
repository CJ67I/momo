/**
 * Per-channel home feed refresh — one batch API call per channel.
 */

import { canUseTavernApi } from './ai.js';
import {
    FEED_PAGE_SIZE,
    generateFriendsBatch,
    generateNearbyBatch,
    generateRecommendBatch,
} from './feed-content.js';
import { createNpc } from './npc-factory.js';
import { getVirtualNow } from './time.js';
import { shuffle, uid } from './utils.js';

function nearbyDistance() {
    const n = (Math.random() * 4.8 + 0.2).toFixed(1);
    return `${n}km`;
}

function farDistance() {
    const n = (Math.random() * 80 + 8).toFixed(0);
    return `${n}km`;
}

function cardToUser(card, { nearby = false } = {}) {
    const user = createNpc(card.gender, card.nickname, { city: card.city });
    if (Number.isFinite(Number(card.age))) user.age = Number(card.age);
    user.bio = card.bio || '';
    user.distance = nearby ? nearbyDistance() : farDistance();
    user.sameCity = Boolean(nearby);
    return user;
}

function cardToPost(card, user, channel, now, asFriend = false) {
    return {
        id: uid('post'),
        channel,
        authorId: user.id,
        authorName: user.nickname,
        authorAge: user.age,
        authorCity: user.city,
        authorGender: user.gender,
        avatarText: user.avatarText,
        distance: user.distance,
        text: card.text,
        genFailed: false,
        likes: Math.floor(Math.random() * 40),
        comments: Math.floor(Math.random() * 12),
        createdAt: now - Math.floor(Math.random() * 1000 * 60 * 60 * 18),
        isFriend: Boolean(asFriend),
    };
}

function mergeStrangers(store, authors) {
    const map = new Map(store.getStrangers().map((s) => [s.id, s]));
    for (const u of authors) map.set(u.id, u);
    store.setStrangers(Array.from(map.values()).slice(0, 48));
}

/**
 * @param {import('./storage.js').MomoStore} store
 * @param {object} profile
 */
export async function refreshRecommend(store, profile) {
    if (!canUseTavernApi()) throw new Error('api_offline');

    const cards = await generateRecommendBatch(profile, FEED_PAGE_SIZE);
    if (!cards.length) throw new Error('gen_empty');

    const settings = store.getSettings();
    const now = getVirtualNow(settings);
    const authors = [];
    const posts = cards.map((card) => {
        const user = cardToUser(card, { nearby: false });
        authors.push(user);
        return cardToPost(card, user, 'recommend', now, false);
    });

    mergeStrangers(store, authors);
    store.replaceChannelPosts('recommend', posts);
    return posts;
}

/**
 * @param {import('./storage.js').MomoStore} store
 * @param {object} profile
 */
export async function refreshNearby(store, profile) {
    if (!canUseTavernApi()) throw new Error('api_offline');

    const city = String(profile.city || '').trim() || '同城';
    const cards = await generateNearbyBatch(profile, FEED_PAGE_SIZE);
    if (!cards.length) throw new Error('gen_empty');

    const settings = store.getSettings();
    const now = getVirtualNow(settings);
    const authors = [];
    const posts = cards.map((card) => {
        const locked = { ...card, city };
        const user = cardToUser(locked, { nearby: true });
        authors.push(user);
        return cardToPost(locked, user, 'nearby', now, false);
    });

    // Prefer same-city authors at front of stranger pool
    store.setStrangers([
        ...authors,
        ...store.getStrangers().filter((s) => String(s.city || '').trim() !== city),
    ].slice(0, 48));

    store.replaceChannelPosts('nearby', posts);
    return posts;
}

/**
 * @param {import('./storage.js').MomoStore} store
 */
export async function refreshFriends(store) {
    if (!canUseTavernApi()) throw new Error('api_offline');

    const friends = store.getFriends();
    if (!friends.length) {
        store.replaceChannelPosts('friends', []);
        return [];
    }

    const sample = shuffle(friends).slice(0, Math.min(FEED_PAGE_SIZE, friends.length));
    const rows = await generateFriendsBatch(sample);
    if (!rows.length) throw new Error('gen_empty');

    const settings = store.getSettings();
    const now = getVirtualNow(settings);
    const byId = new Map(sample.map((f) => [f.id, f]));
    const posts = [];

    for (const row of rows) {
        const user = byId.get(row.id);
        if (!user) continue;
        posts.push({
            id: uid('post'),
            channel: 'friends',
            authorId: user.id,
            authorName: user.nickname,
            authorAge: user.age,
            authorCity: user.city,
            authorGender: user.gender,
            avatarText: user.avatarText,
            distance: user.distance || '',
            text: row.text,
            genFailed: false,
            likes: Math.floor(Math.random() * 40),
            comments: Math.floor(Math.random() * 12),
            createdAt: now - Math.floor(Math.random() * 1000 * 60 * 60 * 18),
            isFriend: true,
        });
    }

    if (!posts.length) throw new Error('gen_empty');
    store.replaceChannelPosts('friends', posts);
    return posts;
}

export async function refreshFeedChannel(store, channel, profile) {
    if (channel === 'recommend') return refreshRecommend(store, profile);
    if (channel === 'friends') return refreshFriends(store);
    return refreshNearby(store, profile);
}
