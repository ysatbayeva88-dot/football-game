/** Низкое качество графики: откройте игру с параметром ?low (для слабых ПК). */
export const LOW_QUALITY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('low');
