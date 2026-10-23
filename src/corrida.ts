// Corrida de carrinhos: largada juntos no grid, 3 voltas no circuito do lado oeste.
// O carrinho anda no jogo (física local); o servidor confere o percurso: cada checkpoint tem que ser
// alcançado em ordem e posições que "pulam" rápido demais (teletransporte) não contam.
// Lógica pura: a Sala manda as poses de quem corre e chama tick().

import { CIRCUITO, type CorredorEstado, type EstadoCorrida, RAIO_CHECKPOINT, SEGUNDOS_CORRIDA, SEGUNDOS_LARGADA, SEGUNDOS_PARA_TERMINAR, VELOCIDADE_MAX_CORRIDA, VOLTAS, checkpoints, gridLargada } from './protocolo';
import type { ResultadoJogador } from './perfis';

interface Corredor extends CorredorEstado {
  ultimo: { x: number; z: number; t: number } | null;
}

const PREMIO_MOEDAS = [80, 50, 30];
const PREMIO_XP = [60, 40, 30];

export class Corrida {
  fase: 'largada' | 'correndo' = 'largada';
  readonly corredores = new Map<string, Corredor>();
  private readonly cps = checkpoints();
  private fimFase: number;
  private largada = 0;
  private primeiroChegou: number | null = null;
  readonly inicio: number;

  constructor(
    participantes: string[],
    agora: number,
    private fator = 1,
  ) {
    const grid = gridLargada(participantes.length);
    participantes.forEach((id, i) => this.corredores.set(id, { volta: 0, cp: 0, terminou: null, posicao: i + 1, grid: grid[i], ultimo: null }));
    this.inicio = agora;
    this.fimFase = agora + SEGUNDOS_LARGADA * 1000 * fator;
  }

  /** Pose de quem corre (mundo). Avança checkpoint se chegou perto do próximo, em ordem. */
  pose(id: string, xMundo: number, zMundo: number, agora: number): boolean {
    const c = this.corredores.get(id);
    if (!c || this.fase !== 'correndo' || c.terminou !== null) return false;
    const x = xMundo - CIRCUITO[0];
    const z = zMundo - CIRCUITO[1];
    // Rápido demais desde a última posição = teletransporte: não conta (e não vira referência).
    if (c.ultimo) {
      const dt = Math.max(1, agora - c.ultimo.t) / 1000;
      const vel = Math.hypot(x - c.ultimo.x, z - c.ultimo.z) / dt;
      if (vel > VELOCIDADE_MAX_CORRIDA / this.fator) return false;
    }
    c.ultimo = { x, z, t: agora };
    const alvo = this.cps[c.cp];
    if (Math.hypot(x - alvo[0], z - alvo[1]) > RAIO_CHECKPOINT) return false;
    c.cp++;
    if (c.cp >= this.cps.length) {
      c.cp = 0;
      c.volta++;
      if (c.volta >= VOLTAS) {
        c.terminou = agora - this.largada;
        if (this.primeiroChegou === null) {
          this.primeiroChegou = agora;
          this.fimFase = Math.min(this.fimFase, agora + SEGUNDOS_PARA_TERMINAR * 1000 * this.fator);
        }
      }
    }
    this.classificar();
    return true;
  }

  /** Quem terminou, pela ordem de chegada; depois, quem andou mais (voltas, checkpoint, distância ao próximo). */
  private classificar(): void {
    const lista = [...this.corredores.entries()].sort(([, a], [, b]) => {
      if (a.terminou !== null || b.terminou !== null) return (a.terminou ?? Infinity) - (b.terminou ?? Infinity);
      if (a.volta !== b.volta) return b.volta - a.volta;
      if (a.cp !== b.cp) return b.cp - a.cp;
      const da = a.ultimo ? Math.hypot(a.ultimo.x - this.cps[a.cp][0], a.ultimo.z - this.cps[a.cp][1]) : Infinity;
      const db = b.ultimo ? Math.hypot(b.ultimo.x - this.cps[b.cp][0], b.ultimo.z - this.cps[b.cp][1]) : Infinity;
      return da - db;
    });
    lista.forEach(([, c], i) => (c.posicao = i + 1));
  }

  tick(agora: number): { mudou: boolean; acabou: boolean } {
    if (this.fase === 'largada' && agora >= this.fimFase) {
      this.fase = 'correndo';
      this.largada = agora;
      this.fimFase = agora + SEGUNDOS_CORRIDA * 1000 * this.fator;
      return { mudou: true, acabou: false };
    }
    if (this.fase === 'correndo') {
      const todos = [...this.corredores.values()].every((c) => c.terminou !== null);
      if (todos || agora >= this.fimFase) return { mudou: true, acabou: true };
    }
    return { mudou: false, acabou: false };
  }

  sair(id: string): boolean {
    this.corredores.delete(id);
    this.classificar();
    return this.corredores.size === 0;
  }

  estado(agora: number): EstadoCorrida {
    return {
      fase: this.fase,
      restanteMs: Math.max(0, Math.round((this.fimFase - agora) / this.fator)),
      decorridoMs: this.fase === 'correndo' ? Math.round((agora - this.largada) / this.fator) : 0,
      corredores: Object.fromEntries([...this.corredores].map(([id, c]) => [id, { volta: c.volta, cp: c.cp, terminou: c.terminou === null ? null : Math.round(c.terminou / this.fator), posicao: c.posicao, grid: c.grid }])),
      totalCheckpoints: this.cps.length,
    };
  }

  /** Pódio com prêmio; quem não terminou ganha só a participação. Pontos = voltas completas. */
  resultado(): ResultadoJogador[] {
    this.classificar();
    return [...this.corredores].map(([id, c]) => {
      const i = c.posicao - 1;
      const terminou = c.terminou !== null;
      return { id, posicao: c.posicao, pontos: c.volta, xp: terminou ? PREMIO_XP[i] ?? 20 : 10, moedas: terminou ? PREMIO_MOEDAS[i] ?? 15 : 5 };
    });
  }
}
