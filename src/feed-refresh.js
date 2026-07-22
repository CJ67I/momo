/**
 * Per-channel home feed refresh (recommend / nearby / friends).
 * All post bodies come from the tavern API — no local content libraries.
 */

import { canUseTavernApi } from './ai.js';
import {
    FEED_PAGE_SIZE,
    resolvePostTexts,
    resolveRecommendCard,
} from './feed-content.js';
import {
    createNpc,
    createPostsForUsers,
    createStrangerPool,
} from './npc-factory.js';
import { injectFeedRefresh } from './story-inject.js';
import { getVirtualNow } from './time.js';
import { shuffle, uid } from './utils.js';

function nearbyDistance() {
    const n = (Math.random() * 4.8 + 0.2).toFixed(1);
    return `${n}km`;
}

/**
 * @param {import('./storage.js').MomoStore} store
 * @param {object} profile
 */
export async function refreshRecommend(store, profile) {
    if (!canUseTavernApi()) {
        throw new Error('api_offline');
    }

    const posts = [];
    const authors = [];
    const avoid = [];
    const settings = store.getSettings();
    const now = getVirtualNow(settings);

    for (let i = 0; i < FEED_PAGE_SIZE; i++) {
        // eslint-disable-next-line no-await-in-loop
        const card = await resolveRecommendCard(profile, { avoid, index: i });
        if (!card) continue;

        const user = createNpc(card.gender, card.nickname, { city: card.city });
        user.bio = card.bio;
        user.distance = nearbyDistance();
        user.sameCity = false;
        authors.push(user);
        avoid.push(card.text);

        posts.push({
            id: uid('post'),
            channel: 'recommend',
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
            isFriend: false,
        });
    }

    if (!posts.length) throw new Error('gen_empty');

    // Merge recommend authors into stranger pool for profile / add-friend
    const strangerMap = new Map(store.getStrangers().map((s) => [s.id, s]));
    for (const u of authors) strangerMap.set(u.id, u);
    store.setStrangers(Array.from(strangerMap.values()).slice(0, 40));
    store.replaceChannelPosts('recommend', posts);
    await injectFeedRefresh(posts.length, 'recommend');
    return posts;
}

/**
 * @param {import('./storage.js').MomoStore} store
 * @param {object} profile
 */
export async function refreshNearby(store, profile) {
    if (!canUseTavernApi()) {
        throw new Error('api_offline');
    }

    const city = String(profile.city || '').trim() || '同城';
    const strangers = await createStrangerPool(profile, FEED_PAGE_SIZE, {
        parallel: true,
        preferFast: false,
        city,
    });
    // Force same city on every author
    const local = strangers.map((u) => ({
        ...u,
        city,
        sameCity: true,
        distance: nearbyDistance(),
    }));
    store.setStrangers([
        ...local,
        ...store.getStrangers().filter((s) => String(s.city || '').trim() !== city),
    ].slice(0, 40));

    const posts = await createPostsForUsers(local, {
        asFriend: false,
        channel: 'nearby',
    });
    store.replaceChannelPosts('nearby', posts);
    await injectFeedRefresh(posts.length, 'nearby');
    return posts;
}

/**
 * Randomly sample friends and generate their posts via API.
 * @param {import('./storage.js').MomoStore} store
 */
export async function refreshFriends(store) {
    if (!canUseTavernApi()) {
        throw new Error('api_offline');
    }

    const friends = store.getFriends();
    if (!friends.length) {
        store.replaceChannelPosts('friends', []);
        return [];
    }

    const sample = shuffle(friends).slice(0, Math.min(FEED_PAGE_SIZE, friends.length));
    const posts = await createPostsForUsers(sample, {
        asFriend: true,
        channel: 'friends',
    });
    store.replaceChannelPosts('friends', posts);
    await injectFeedRefresh(posts.length, 'friends');
    return posts;
}

/**
 * @param {import('./storage.js').MomoStore} store
 * @param {'recommend'|'nearby'|'friends'} channel
 * @param {object} profile
 */
export async function refreshFeedChannel(store, channel, profile) {
    if (channel === 'recommend') return refreshRecommend(store, profile);
    if (channel === 'friends') return refreshFriends(store);
    return refreshNearby(store, profile);
}

/** @deprecated kept for any leftover imports */
export async function resolveChannelTexts(users, channel, settings) {
    return resolvePostTexts(users, settings, { channel });
}
