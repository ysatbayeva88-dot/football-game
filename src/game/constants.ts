import type { FormationName } from './types';

export const HALF_L = 52.5;
export const HALF_W = 34;
export const GOAL_HW = 3.66;
export const GOAL_H = 2.44;
export const GOAL_D = 2.0;
export const PEN_D = 16.5;
export const PEN_HW = 20.16;
export const GA_D = 5.5;
export const GA_HW = 9.16;
export const PEN_SPOT = 11;
export const CIRCLE_R = 9.15;
export const BALL_R = 0.11;
export const GRAVITY = 9.81;
export const POST_R = 0.06;

export interface Difficulty {
  name: string;
  react: number; // время реакции ИИ с мячом
  pressers: number; // сколько игроков прессингуют
  pressSprint: number; // вероятность спринта при прессинге
  tackleCD: number; // пауза между отборами
  tackleBonus: number;
  shootErr: number;
  passErr: number;
  speedMul: number;
  shootRange: number;
  gkSkill: number;
  runFreq: number;
  dribble: number;
  passLane: number; // минимальная «открытость» линии паса
  passBias: number; // склонность строить атаку пасом, а не дриблингом
  counterPress: number; // доп. игроки в прессинг сразу после потери
}

export const DIFFICULTIES: Difficulty[] = [
  { name: 'Любитель', react: 0.85, pressers: 1, pressSprint: 0.3, tackleCD: 1.6, tackleBonus: -0.16, shootErr: 2.3, passErr: 2.0, speedMul: 0.88, shootRange: 18, gkSkill: -0.18, runFreq: 0.25, dribble: 0.4, passLane: 0.3, passBias: 0.1, counterPress: 0 },
  { name: 'Профи', react: 0.45, pressers: 1, pressSprint: 0.75, tackleCD: 0.9, tackleBonus: 0, shootErr: 1.0, passErr: 1.0, speedMul: 0.98, shootRange: 24, gkSkill: 0, runFreq: 0.7, dribble: 0.75, passLane: 1.3, passBias: 0.25, counterPress: 1 },
  { name: 'Легенда', react: 0.22, pressers: 2, pressSprint: 1, tackleCD: 0.55, tackleBonus: 0.1, shootErr: 0.6, passErr: 0.55, speedMul: 1.04, shootRange: 27, gkSkill: 0.1, runFreq: 1, dribble: 1, passLane: 1.8, passBias: 0.42, counterPress: 2 },
];

/** Параметры ИИ-партнёров игрока (не зависят от сложности бота). */
export const ALLY_AI: Difficulty = { ...DIFFICULTIES[1], pressers: 1, tackleCD: 1.0 };

/** Уровни ассиста управления (только для команды игрока). */
export const ASSISTS = {
  full: { name: 'Полный', passErr: 0.12, shotErr: 0.7, magnet: 1.6, autoReceive: true, tackleBonus: 0.12, cone: 0.8 },
  semi: { name: 'Средний', passErr: 0.55, shotErr: 1.0, magnet: 1.2, autoReceive: true, tackleBonus: 0.04, cone: 0.8 },
  manual: { name: 'Ручной', passErr: 1.0, shotErr: 1.25, magnet: 0.9, autoReceive: false, tackleBonus: -0.04, cone: 0.3 },
} as const;

/**
 * Ассист ИИ для управляемого игрока:
 *  autoReceive — после паса адресат сам бежит в точку встречи с мячом;
 *  magnet      — радиус гарантированного приёма;
 *  autoChase   — сам бежит к свободному мячу, пока джойстик не трогают;
 *  defend      — 'always': сам сближается и сопровождает владельца, 'near': только вблизи (10 м);
 *  secondPress — ближайший партнёр всегда подключается к прессингу;
 *  intercept   — радиус, в котором игрок сам тянется к пасу соперника;
 *  autoPoke    — при плотном сопровождении сам пытается выбить мяч.
 */
export const AI_ASSISTS = {
  full: { name: 'Полный', autoReceive: true, magnet: 2.0, autoChase: true, defend: 'always', secondPress: true, intercept: 1.5, autoPoke: true },
  semi: { name: 'Средний', autoReceive: true, magnet: 1.5, autoChase: true, defend: 'near', secondPress: false, intercept: 1.0, autoPoke: false },
  off: { name: 'Выкл.', autoReceive: false, magnet: 0, autoChase: false, defend: 'none', secondPress: false, intercept: 0, autoPoke: false },
} as const;

export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';
export interface Slot { x: number; z: number; role: Role; label: string }

/** Позиции в нормализованных координатах команды: x от -1 (свои ворота) до 1, z>0 — правый фланг. */
export const FORMATIONS: Record<FormationName, Slot[]> = {
  '4-3-3': [
    { x: -0.96, z: 0, role: 'GK', label: 'ВРТ' },
    { x: -0.62, z: 0.64, role: 'DEF', label: 'ПЗ' },
    { x: -0.7, z: 0.21, role: 'DEF', label: 'ЦЗ' },
    { x: -0.7, z: -0.21, role: 'DEF', label: 'ЦЗ' },
    { x: -0.62, z: -0.64, role: 'DEF', label: 'ЛЗ' },
    { x: -0.32, z: 0.34, role: 'MID', label: 'ЦП' },
    { x: -0.46, z: 0, role: 'MID', label: 'ОП' },
    { x: -0.32, z: -0.34, role: 'MID', label: 'ЦП' },
    { x: -0.04, z: 0.64, role: 'FWD', label: 'ПВ' },
    { x: 0.04, z: 0, role: 'FWD', label: 'ФРВ' },
    { x: -0.04, z: -0.64, role: 'FWD', label: 'ЛВ' },
  ],
  '4-4-2': [
    { x: -0.96, z: 0, role: 'GK', label: 'ВРТ' },
    { x: -0.62, z: 0.64, role: 'DEF', label: 'ПЗ' },
    { x: -0.7, z: 0.21, role: 'DEF', label: 'ЦЗ' },
    { x: -0.7, z: -0.21, role: 'DEF', label: 'ЦЗ' },
    { x: -0.62, z: -0.64, role: 'DEF', label: 'ЛЗ' },
    { x: -0.3, z: 0.66, role: 'MID', label: 'ПП' },
    { x: -0.4, z: 0.19, role: 'MID', label: 'ЦП' },
    { x: -0.4, z: -0.19, role: 'MID', label: 'ЦП' },
    { x: -0.3, z: -0.66, role: 'MID', label: 'ЛП' },
    { x: 0.04, z: 0.15, role: 'FWD', label: 'ФРВ' },
    { x: 0.04, z: -0.15, role: 'FWD', label: 'ФРВ' },
  ],
};

export const KICKOFF_PARTNER: Record<FormationName, number> = { '4-3-3': 6, '4-4-2': 10 };

export const STADIUMS = [
  { id: 'day' as const, name: 'Арена Солнца', desc: 'Дневной матч, ясное небо' },
  { id: 'night' as const, name: 'Стадион Огней', desc: 'Вечер, прожекторы' },
  { id: 'rain' as const, name: 'Северный Парк', desc: 'Ливень, скользкий газон' },
];

export const BRANDS = ['VOLTEX', 'NOVA COLA', 'AEROLINE', 'PIXELBANK', 'TURBO TYRES', 'ZENITH PHONE', 'MOUNTAIN BREW', 'KAIROS', 'BLITZ ENERGY', 'ORBITEL'];

export function rand(a = 0, b = 1) { return a + Math.random() * (b - a); }
export function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5; }
export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function angleLerp(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
