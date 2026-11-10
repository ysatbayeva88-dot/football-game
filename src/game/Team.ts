import * as THREE from 'three';
import { FORMATIONS, hashStr } from './constants';
import type { Difficulty, Slot } from './constants';
import { KitMaterials, PlayerModel } from './PlayerModel';
import { Player } from './Player';
import type { FormationName, Kit, PlayerData, TeamData, TeamStats } from './types';

export function emptyStats(): TeamStats {
  return { shots: 0, onTarget: 0, possession: 0, passes: 0, passesDone: 0, fouls: 0, corners: 0, offsides: 0, saves: 0 };
}

export class Team {
  players: Player[] = [];
  bench: PlayerData[];
  slots: Slot[];
  kit: Kit;
  kitMats: KitMaterials;
  gkMats: KitMaterials;
  score = 0;
  stats = emptyStats();
  subsUsed = 0;
  opp!: Team;

  constructor(
    public idx: number,
    public data: TeamData,
    kitName: 'home' | 'away',
    public formation: FormationName,
    public dir: number,
    public isHuman: boolean,
    public ai: Difficulty,
  ) {
    this.kit = data[kitName];
    this.kitMats = new KitMaterials(this.kit, data.emblem);
    this.gkMats = new KitMaterials(data.gk);
    this.slots = FORMATIONS[formation];
    this.bench = data.subs.map(p => ({ ...p }));
    data.starters.forEach((pd, i) => {
      const mats = i === 0 ? this.gkMats : this.kitMats;
      const model = new PlayerModel(mats, pd.number, hashStr(pd.name), pd.name, i === 0);
      const p = new Player({ ...pd }, this, i, model);
      p.speedMul = isHuman ? 1 : ai.speedMul;
      this.players.push(p);
    });
  }

  /** Метры в системе координат команды (x вперёд к чужим воротам, z вправо) -> мир. */
  toWorld(x: number, z: number, out = new THREE.Vector3()) {
    return out.set(x * this.dir, 0, z * this.dir);
  }

  substitute(slotIndex: number, benchIndex: number) {
    const p = this.players[slotIndex];
    const incoming = this.bench[benchIndex];
    if (!p || !incoming) return null;
    const outgoing = p.data;
    p.data = { ...incoming };
    this.bench.splice(benchIndex, 1);
    this.subsUsed++;
    p.model.setKit(slotIndex === 0 ? this.gkMats : this.kitMats, incoming.number, incoming.name);
    p.speedMul = this.isHuman ? 1 : this.ai.speedMul;
    return { outgoing, incoming };
  }

  ovr() {
    return Math.round(this.players.reduce((s, p) => s + p.data.ovr, 0) / this.players.length);
  }

  dispose() {
    this.kitMats.dispose();
    this.gkMats.dispose();
    for (const p of this.players) p.model.dispose();
  }
}

export function teamOvr(t: TeamData) {
  const avg = (arr: PlayerData[]) => (arr.length ? Math.round(arr.reduce((s, p) => s + p.ovr, 0) / arr.length) : 0);
  const atk = t.starters.filter(p => ['ST', 'CF', 'LW', 'RW'].includes(p.pos));
  const mid = t.starters.filter(p => ['CM', 'CDM', 'CAM', 'LM', 'RM'].includes(p.pos));
  const def = t.starters.filter(p => ['GK', 'CB', 'LB', 'RB'].includes(p.pos));
  return { ovr: avg(t.starters), atk: avg(atk), mid: avg(mid), def: avg(def) };
}
