/**
 * Character / chat scoped keys for worldbook bindings.
 */

export function getContextScope() {
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (!ctx) {
            return { key: 'local', label: '本地预览', characterId: null, chatId: '', characterName: '' };
        }
        const characterId = ctx.characterId;
        const characterName = String(
            ctx.characters?.[characterId]?.name
            || ctx.name2
            || '',
        ).trim();
        let chatId = '';
        try {
            chatId = String(ctx.getCurrentChatId?.() || ctx.chatId || '').trim();
        } catch {
            chatId = String(ctx.chatId || '').trim();
        }
        const key = [
            characterId != null ? `c${characterId}` : 'c_',
            chatId ? `h${chatId}` : 'h_',
            characterName || 'anon',
        ].join('__').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 140);

        const label = characterName
            ? `${characterName}${chatId ? ` · 会话` : ''}`
            : (chatId ? `会话 ${chatId}` : '未选角色');

        return { key, label, characterId, chatId, characterName };
    } catch {
        return { key: 'local', label: '本地预览', characterId: null, chatId: '', characterName: '' };
    }
}
