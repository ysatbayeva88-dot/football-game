export type Position = 'GK' | 'RB' | 'CB' | 'LB' | 'CDM' | 'CM' | 'CAM' | 'RM' | 'LM' | 'RW' | 'LW' | 'ST' | 'CF';

export interface PlayerData {
  name: string;
  number: number;
  pos: Position;
  ovr: number;
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
}

export interface Kit {
  shirt: string;
  sleeves: string;
  shorts: string;
  socks: string;
  pattern: 'plain' | 'stripes' | 'band' | 'hoops';
  stripe: string;
  number: string;
}

export interface Emblem {
  text: string;
  bg: string;
  fg: string;
  border: string;
}

export type FormationName = '4-3-3' | '4-4-2';

export interface TeamData {
  id: string;
  name: string;
  short: string;
  city: string;
  formation: FormationName;
  emblem: Emblem;
  /** Имя файла эмблемы в public/crests/ (без .png). */
  crest?: string;
  home: Kit;
  away: Kit;
  gk: Kit;
  starters: PlayerData[];
  subs: PlayerData[];
}

export type StadiumId = 'day' | 'night' | 'rain';
export type AssistLevel = 'full' | 'semi' | 'manual';
export type GraphicsLevel = 'low' | 'medium' | 'high';

export interface MatchConfig {
  home: TeamData; // команда игрока
  away: TeamData; // команда бота
  homeKit: 'home' | 'away';
  awayKit: 'home' | 'away';
  stadium: StadiumId;
  difficulty: 0 | 1 | 2;
  halfMinutes: 2 | 4 | 6;
  formation: FormationName;
  assist: AssistLevel;
  graphics: GraphicsLevel;
}

export interface TeamStats {
  shots: number;
  onTarget: number;
  possession: number; // секунды
  passes: number;
  passesDone: number;
  fouls: number;
  corners: number;
  offsides: number;
  saves: number;
}

export interface GoalRecord {
  team: number;
  name: string;
  minute: number;
  own: boolean;
  penalty: boolean;
}

export interface MatchResult {
  cfg: MatchConfig;
  score: [number, number];
  stats: [TeamStats, TeamStats];
  goals: GoalRecord[];
}
