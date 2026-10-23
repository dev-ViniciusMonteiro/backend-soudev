// Mata-mata estilo CS (TR x CT) no domo: rodadas com compra de armas, dinheiro por rodada e por abate,
// vitória por eliminação ou tempo. O jogo diz "atirei nessa direção e acertei fulano"; aqui o servidor confere
// tudo (vivo, arma na mão, cadência, munição, alcance, mira apontando para o alvo e parede no caminho)
// e só então aplica o dano. Lógica pura: a Sala chama tick() e os métodos e repassa os eventos.

import { ALTURA_OLHO, ARMAS_MM, type Arma, type Bloco, DINHEIRO_INICIAL, DINHEIRO_MAX, type EstadoMM, type FaseMM, type JogadorMM, LIMITE_ARENA, MAPA_ARENA, PRECO_CAPACETE, PRECO_COLETE, RODADAS_PARA_VENCER, SEGUNDOS_COMPRA, SEGUNDOS_FIM_RODADA, SEGUNDOS_RODADA, SPAWNS, type SlotArma, type Time } from './protocolo';
import type { ResultadoJogador } from './perfis';

export interface PosMM {
  x: number;
  y: number;
  z: number; // relativos ao domo
}

export type EventoMM =
  | { k: 'tiro'; de: string; o: [number, number, number]; p: [number, number, number]; arma: string }
  | { k: 'dano'; de: string; para: string; hp: number; cabeca: boolean }
  | { k: 'abate'; de: string; para: string; arma: string; cabeca: boolean };

const GANHA_RODADA = 3250;
const PERDE_RODADA = 1400;
const GANHA_ABATE = 300;
const SEGUNDOS_PARA_COMPRAR = 20; // depois do começo da rodada ainda dá para comprar (como no CS)
const ALTURA_CORPO = 1.45;
const RAIO_CORPO = 0.4;

export const armaPorId = (id: string): Arma | undefined => ARMAS_MM.find((a) => a.id === id);

/** A linha de tiro (de a até b, em 3D) bate em algum bloco do mapa? Caixote baixo só bloqueia se a bala passar abaixo do topo. */
export function bloqueado(a: [number, number, number], b: [number, number, number], mapa: Bloco[] = MAPA_ARENA): boolean {
  for (const [cx, cz, w, d, h] of mapa) {
    const minX = cx - w / 2;
    const maxX = cx + w / 2;
    const minZ = cz - d / 2;
    const maxZ = cz + d / 2;
    // Interseção do segmento com a caixa (método das fatias), incluindo a altura.
    let t0 = 0;
    let t1 = 1;
    const eixos: [number, number, number, number][] = [
      [a[0], b[0] - a[0], minX, maxX],
      [a[1], b[1] - a[1], 0, h],
      [a[2], b[2] - a[2], minZ, maxZ],
    ];
    let fora = false;
    for (const [p, dp, mn, mx] of eixos) {
      if (Math.abs(dp) < 1e-9) {
        if (p < mn || p > mx) {
          fora = true;
          break;
        }
        continue;
      }
      let ta = (mn - p) / dp;
      let tb = (mx - p) / dp;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) {
        fora = true;
        break;
      }
    }
    if (!fora) return true;
  }
  return false;
}

export class MataMata {
  fase: FaseMM = 'compra';
  rodada = 1;
  placar: Record<Time, number> = { TR: 0, CT: 0 };
  readonly jogadores = new Map<string, JogadorMM>();
  private fimFase: number;
  private inicioRodada = 0;
  private ultimoTiro = new Map<string, number>();
  private recarregandoAte = new Map<string, number>();
  private vencedorRodada?: Time;
  vencedor: Time | null = null;
  readonly inicio: number;

  constructor(
    participantes: string[],
    agora: number,
    private fator = 1,
  ) {
    // Times equilibrados (a ordem da fila alterna TR, CT, TR...).
    participantes.forEach((id, i) => {
      const time: Time = i % 2 === 0 ? 'TR' : 'CT';
      this.jogadores.set(id, this.novoJogador(time));
    });
    this.inicio = agora;
    this.fimFase = agora + SEGUNDOS_COMPRA * 1000 * fator;
    this.posicionar();
  }

  private novoJogador(time: Time): JogadorMM {
    const sec = time === 'TR' ? 'glock' : 'usp';
    const a = armaPorId(sec)!;
    return { time, vivo: true, hp: 100, armadura: 0, capacete: false, dinheiro: DINHEIRO_INICIAL, abates: 0, mortes: 0, primaria: null, secundaria: sec, arma: 'secundaria', municao: { [sec]: [a.pente, a.reserva] }, spawn: [0, 0] };
  }

  /** Cada um no seu lugar de nascer no começo da rodada. */
  private posicionar(): void {
    const n: Record<Time, number> = { TR: 0, CT: 0 };
    for (const j of this.jogadores.values()) {
      const lista = SPAWNS[j.time];
      j.spawn = lista[n[j.time]++ % lista.length];
    }
  }

  private ms = (s: number): number => s * 1000 * this.fator;

  vivos(time: Time): number {
    return [...this.jogadores.values()].filter((j) => j.time === time && j.vivo).length;
  }

  /** Comprar: na fase de compra ou nos primeiros segundos da rodada, vivo e com dinheiro. */
  comprar(id: string, item: string, agora: number): boolean {
    const j = this.jogadores.get(id);
    if (!j?.vivo) return false;
    const pode = this.fase === 'compra' || (this.fase === 'rodada' && agora - this.inicioRodada < this.ms(SEGUNDOS_PARA_COMPRAR));
    if (!pode) return false;
    if (item === 'colete' || item === 'capacete') {
      const preco = item === 'capacete' ? PRECO_CAPACETE : PRECO_COLETE;
      if (j.dinheiro < preco || (j.armadura === 100 && (item === 'colete' || j.capacete))) return false;
      j.dinheiro -= preco;
      j.armadura = 100;
      if (item === 'capacete') j.capacete = true;
      return true;
    }
    const a = armaPorId(item);
    if (!a || a.slot === 'faca' || (a.time && a.time !== j.time) || j.dinheiro < a.preco) return false;
    if ((a.slot === 'primaria' && j.primaria === a.id) || (a.slot === 'secundaria' && j.secundaria === a.id)) return false;
    j.dinheiro -= a.preco;
    if (a.slot === 'primaria') j.primaria = a.id;
    else j.secundaria = a.id;
    j.municao[a.id] = [a.pente, a.reserva];
    j.arma = a.slot;
    return true;
  }

  empunhar(id: string, slot: SlotArma): boolean {
    const j = this.jogadores.get(id);
    if (!j?.vivo || (slot === 'primaria' && !j.primaria)) return false;
    j.arma = slot;
    this.recarregandoAte.delete(id);
    return true;
  }

  armaNaMao(j: JogadorMM): Arma {
    return armaPorId(j.arma === 'faca' ? 'faca' : j.arma === 'primaria' ? j.primaria! : j.secundaria)!;
  }

  recarregar(id: string, agora: number): boolean {
    const j = this.jogadores.get(id);
    if (!j?.vivo) return false;
    const a = this.armaNaMao(j);
    const m = j.municao[a.id];
    if (!m || m[0] >= a.pente || m[1] <= 0) return false;
    this.recarregandoAte.set(id, agora + a.recargaMs);
    return true;
  }

  /** Termina recargas que já deram o tempo. */
  private terminarRecargas(agora: number): void {
    for (const [id, ate] of this.recarregandoAte) {
      if (agora < ate) continue;
      this.recarregandoAte.delete(id);
      const j = this.jogadores.get(id);
      if (!j) continue;
      const a = this.armaNaMao(j);
      const m = j.municao[a.id];
      if (!m) continue;
      const falta = Math.min(a.pente - m[0], m[1]);
      m[0] += falta;
      m[1] -= falta;
    }
  }

  /**
   * Tiro: confere e aplica. pos = posições conhecidas pelo servidor (relativas ao domo).
   * Devolve os eventos (o tiro para os outros desenharem, dano e abate).
   */
  atirar(id: string, d: unknown, alvoId: unknown, cabeca: unknown, pos: Map<string, PosMM>, agora: number): EventoMM[] {
    const j = this.jogadores.get(id);
    const p = pos.get(id);
    if (!j?.vivo || !p || this.fase !== 'rodada') return [];
    if (!Array.isArray(d) || d.length !== 3 || !d.every((v) => typeof v === 'number' && Number.isFinite(v))) return [];
    const norma = Math.hypot(d[0], d[1], d[2]);
    if (norma < 1e-6) return [];
    const dir: [number, number, number] = [d[0] / norma, d[1] / norma, d[2] / norma];
    const a = this.armaNaMao(j);
    // Cadência (com folga de 15% para o atraso da rede), munição e recarga.
    if (agora - (this.ultimoTiro.get(id) ?? 0) < a.cadenciaMs * 0.85) return [];
    if ((this.recarregandoAte.get(id) ?? 0) > agora) return [];
    if (a.slot !== 'faca') {
      const m = j.municao[a.id];
      if (!m || m[0] <= 0) return [];
      m[0]--;
    }
    this.ultimoTiro.set(id, agora);

    const olho: [number, number, number] = [p.x, p.y + ALTURA_OLHO, p.z];
    let fim: [number, number, number] = [olho[0] + dir[0] * a.alcance, olho[1] + dir[1] * a.alcance, olho[2] + dir[2] * a.alcance];
    const eventos: EventoMM[] = [];

    const alvo = typeof alvoId === 'string' ? this.jogadores.get(alvoId) : undefined;
    const pa = typeof alvoId === 'string' ? pos.get(alvoId) : undefined;
    if (alvo?.vivo && pa && alvo.time !== j.time) {
      const naCabeca = cabeca === true;
      const ponto: [number, number, number] = [pa.x, pa.y + (naCabeca ? 1.65 : 1.0), pa.z];
      const v = [ponto[0] - olho[0], ponto[1] - olho[1], ponto[2] - olho[2]];
      const dist = Math.hypot(v[0], v[1], v[2]);
      // A mira aponta para o alvo? Tolerância = tamanho do corpo visto daquela distância + folga do atraso.
      const cos = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / Math.max(dist, 1e-6);
      const angulo = Math.acos(Math.min(1, Math.max(-1, cos)));
      const tolerancia = Math.atan2(1.1, dist) + a.dispersao * 2 + 0.05;
      if (dist <= a.alcance + 0.5 && angulo <= tolerancia && !bloqueado(olho, ponto)) {
        fim = ponto;
        // Dano: queda com a distância (menos na AWP e na faca); cabeça x4 (capacete segura parte); colete absorve metade.
        const queda = a.slot === 'faca' || a.mira ? 1 : Math.max(0.6, 1 - dist / (a.alcance * 1.6));
        let dano = a.dano * queda * (naCabeca ? (alvo.capacete ? 2.5 : 4) : 1);
        if (alvo.armadura > 0 && !(naCabeca && !alvo.capacete)) {
          const absorve = Math.min(alvo.armadura, dano * 0.5);
          alvo.armadura = Math.round(alvo.armadura - absorve);
          dano -= absorve;
        }
        alvo.hp = Math.max(0, Math.round(alvo.hp - dano));
        eventos.push({ k: 'dano', de: id, para: alvoId as string, hp: alvo.hp, cabeca: naCabeca });
        if (alvo.hp <= 0) {
          alvo.vivo = false;
          alvo.mortes++;
          // Quem morre perde a arma principal e o colete (como no CS, ficaria no chão).
          alvo.primaria = null;
          alvo.armadura = 0;
          alvo.capacete = false;
          alvo.arma = 'secundaria';
          j.abates++;
          j.dinheiro = Math.min(DINHEIRO_MAX, j.dinheiro + GANHA_ABATE);
          eventos.push({ k: 'abate', de: id, para: alvoId as string, arma: a.id, cabeca: naCabeca });
        }
      }
    }
    if (a.slot !== 'faca') eventos.unshift({ k: 'tiro', de: id, o: olho, p: fim.map((v) => Math.round(v * 100) / 100) as [number, number, number], arma: a.id });
    return eventos;
  }

  /** Avança o relógio: compra → rodada → fim da rodada → próxima (ou fim da partida). */
  tick(agora: number): { mudou: boolean; acabou: boolean } {
    this.terminarRecargas(agora);
    if (this.fase === 'compra' && agora >= this.fimFase) {
      this.fase = 'rodada';
      this.inicioRodada = agora;
      this.fimFase = agora + this.ms(SEGUNDOS_RODADA);
      return { mudou: true, acabou: false };
    }
    if (this.fase === 'rodada') {
      const tr = this.vivos('TR');
      const ct = this.vivos('CT');
      let venceu: Time | null = null;
      if (tr === 0) venceu = 'CT';
      else if (ct === 0) venceu = 'TR';
      else if (agora >= this.fimFase) venceu = tr > ct ? 'TR' : 'CT'; // tempo: quem tem mais vivos; empate, CT
      if (venceu) {
        this.placar[venceu]++;
        this.vencedorRodada = venceu;
        for (const j of this.jogadores.values()) j.dinheiro = Math.min(DINHEIRO_MAX, j.dinheiro + (j.time === venceu ? GANHA_RODADA : PERDE_RODADA));
        this.fase = 'fimRodada';
        this.fimFase = agora + this.ms(SEGUNDOS_FIM_RODADA);
        if (this.placar[venceu] >= RODADAS_PARA_VENCER) this.vencedor = venceu;
        return { mudou: true, acabou: false };
      }
    }
    if (this.fase === 'fimRodada' && agora >= this.fimFase) {
      if (this.vencedor) return { mudou: true, acabou: true };
      this.rodada++;
      this.vencedorRodada = undefined;
      this.fase = 'compra';
      this.fimFase = agora + this.ms(SEGUNDOS_COMPRA);
      this.recarregandoAte.clear();
      // Todo mundo renasce; quem sobreviveu mantém as armas e completa a munição.
      for (const j of this.jogadores.values()) {
        j.vivo = true;
        j.hp = 100;
        j.arma = j.primaria ? 'primaria' : 'secundaria';
        for (const id of [j.primaria, j.secundaria]) {
          const a = id && armaPorId(id);
          if (a) j.municao[a.id] = [a.pente, a.reserva];
        }
      }
      this.posicionar();
      return { mudou: true, acabou: false };
    }
    return { mudou: false, acabou: false };
  }

  /** Saiu da sala: sai do jogo. Se um time ficou vazio, o outro vence a partida. */
  sair(id: string): boolean {
    if (!this.jogadores.delete(id)) return false;
    const tr = [...this.jogadores.values()].some((j) => j.time === 'TR');
    const ct = [...this.jogadores.values()].some((j) => j.time === 'CT');
    if (!tr || !ct) {
      this.vencedor = tr ? 'TR' : ct ? 'CT' : null;
      return true;
    }
    return false;
  }

  /** Dentro da arena e longe das paredes de fora (o jogo já colide; isto é só a trava do servidor). */
  static dentro(x: number, z: number): boolean {
    return Math.abs(x) <= LIMITE_ARENA && Math.abs(z) <= LIMITE_ARENA;
  }

  estado(agora: number): EstadoMM {
    return {
      fase: this.fase,
      rodada: this.rodada,
      placar: { ...this.placar },
      restanteMs: Math.max(0, Math.round((this.fimFase - agora) / this.fator)),
      jogadores: Object.fromEntries([...this.jogadores].map(([id, j]) => [id, { ...j, municao: { ...j.municao } }])),
      vencedorRodada: this.vencedorRodada,
    };
  }

  /** Time vencedor em 1º; dentro do time, mais abates primeiro (para o ranking). */
  resultado(): ResultadoJogador[] {
    return [...this.jogadores].map(([id, j]) => {
      const ganhou = j.time === this.vencedor;
      return { id, posicao: ganhou ? 1 : 2, pontos: j.abates, xp: (ganhou ? 60 : 25) + j.abates * 5, moedas: (ganhou ? 80 : 20) + j.abates * 10 };
    });
  }

  static altura = ALTURA_CORPO;
  static raio = RAIO_CORPO;
}
