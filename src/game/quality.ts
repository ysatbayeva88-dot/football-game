import type { GraphicsLevel } from './types';

const hasWindow = typeof window !== 'undefined';

/** Сенсорный экран (телефон / планшет). */
export const IS_TOUCH = hasWindow && (
  window.matchMedia?.('(pointer: coarse)').matches ||
  'ontouchstart' in window ||
  (navigator.maxTouchPoints ?? 0) > 0
);

/** Телефон или планшет — по сенсорному экрану и размеру / user agent. */
export const IS_MOBILE = hasWindow && IS_TOUCH && (
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  Math.min(window.screen.width, window.screen.height) < 820
);

const params = hasWindow ? new URLSearchParams(location.search) : new URLSearchParams();

/**
 * Низкое качество графики: без теней, меньше болельщиков, ниже разрешение.
 * Включается автоматически на телефонах или параметром ?low; ?high принудительно включает высокое.
 */
export const LOW_QUALITY = !params.has('high') && (params.has('low') || IS_MOBILE);

/** Принудительно показать сенсорное управление на ПК: ?touch */
export const SHOW_TOUCH = IS_TOUCH || params.has('touch');


/** Уровень графики по умолчанию: сохранённый выбор, иначе телефон — низкая, ПК — высокая. */
export function defaultGraphics(): GraphicsLevel {
  if (params.has('low')) return 'low';
  if (params.has('high')) return 'high';
  if (params.has('medium')) return 'medium';
  try {
    const v = localStorage.getItem('uf26-gfx');
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch { /* приватный режим */ }
  return IS_MOBILE ? 'medium' : 'high';
}

export function saveGraphics(g: GraphicsLevel) {
  try { localStorage.setItem('uf26-gfx', g); } catch { /* приватный режим */ }
}
