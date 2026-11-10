import type { Emblem, TeamData } from '../game/types';

const BASE = import.meta.env.BASE_URL || '/';

/** Простая эмблема клуба: щит с буквами в клубных цветах (не копия логотипа). */
export function emblemHTML(e: Emblem, size = 48, crest?: string) {
  const fs = Math.round(size * (e.text.length > 2 ? 0.3 : e.text.length > 1 ? 0.38 : 0.5));
  return `<div class="emblem" style="width:${size}px;height:${Math.round(size * 1.15)}px">
    <svg viewBox="0 0 100 115" width="${size}" height="${Math.round(size * 1.15)}">
      <path d="M50 3 L95 15 L92 62 Q88 95 50 112 Q12 95 8 62 L5 15 Z" fill="${e.bg}" stroke="${e.border}" stroke-width="6"/>
      <path d="M50 14 L84 23 L82 60 Q79 86 50 100 Q21 86 18 60 L16 23 Z" fill="none" stroke="${e.fg}" stroke-opacity="0.35" stroke-width="2"/>
    </svg>
    <span style="color:${e.fg};font-size:${fs}px">${e.text}</span>
    ${crest ? `<img class="crest" alt="" src="${BASE}crests/${encodeURIComponent(crest)}.png" onload="this.parentNode.classList.add('has-crest')" onerror="this.remove()">` : ''}
  </div>`;
}

/**
 * Эмблема клуба: если в public/crests/ лежит файл <crest>.png — показывается он,
 * иначе — сгенерированный щит с буквами.
 */
export function crestHTML(t: Pick<TeamData, 'emblem' | 'crest'>, size = 48) {
  return emblemHTML(t.emblem, size, t.crest);
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function colorDistance(a: string, b: string) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = ((pa >> 16) & 255) - ((pb >> 16) & 255);
  const g = ((pa >> 8) & 255) - ((pb >> 8) & 255);
  const bl = (pa & 255) - (pb & 255);
  return Math.sqrt(r * r * 0.3 + g * g * 0.59 + bl * bl * 0.11);
}
