// Regras dos jogos da praça, decididas no servidor a partir das posições que os jogadores já mandam.
// Lógica pura (sem rede nem banco): a Sala chama tick() algumas vezes por segundo e, no fim, resultado().

import { DISTANCIA_PEGAR, type EstadoPartida, type FasePartida, type IdJogo, JOGOS, SEGUNDOS_CONTAGEM, SEGUNDOS_ESCONDER, ZONA_REI } from './protocolo';
import type { ResultadoJogador } from './perfis';

export interface Posicao {
  x: number;
  y: number;
  z: number;
}

export type EventoJogo = { k: 'pegou'; de: string; para: string };

const IMUNIDADE_MS = 2000; // pega-pega: quem acabou de passar não pode ser pego de volta na hora
const XP_PARTICIPAR = 15;
const XP_VENCER = 25;
const MOEDAS_POR_POSICAO = [60, 35, 20];
const MOEDAS_PARTICIPAR = 10;

const distancia = (a: Posicao, b: Posicao): number => Math.hypot(a.x - b.x, a.z - b.z);
const sortear = <T>(l: T[], rnd: () => number): T => l[Math.floor(rnd() * l.length)];

export class Partida {
  fase: FasePartida = 'contagem';
  private fimFase: number;
  private ultimo: number;
  private inicioJogo = 0;
  readonly participantes: string[];
  readonly placar: Record<string, number> = {};
  pegador?: string;
  buscador?: string;
  readonly achados = new Set<string>();
  private imunes = new Map<string, number>();
  readonly inicio: number;

  constructor(
    readonly jogo: IdJogo,
    participantes: string[],
    agora: number,
    private fator = 1, // encurta os tempos no teste
    private rnd: () => number = Math.random,
  ) {
    this.participantes = [...participantes];
    for (const id of participantes) this.placar[id] = 0;
    if (jogo === 'pega-pega') this.pegador = sortear(participantes, rnd);
    if (jogo === 'esconde-esconde') this.buscador = sortear(participantes, rnd);
    this.inicio = agora;
    this.ultimo = agora;
    this.fimFase = agora + SEGUNDOS_CONTAGEM * 1000 * fator;
  }

  private ms = (segundos: number): number => segundos * 1000 * this.fator;

  /** Quem pode se mexer agora (no esconde-esconde, quem procura fica parado enquanto os outros escondem). */
  podeMover(id: string): boolean {
    return !(this.jogo === 'esconde-esconde' && id === this.buscador && (this.fase === 'esconder' || this.fase === 'contagem'));
  }

  /** Avança o relógio e aplica as regras. Devolve os eventos e se a partida acabou. */
  tick(agora: number, pos: Map<string, Posicao>): { eventos: EventoJogo[]; acabou: boolean; mudouFase: boolean } {
    const dt = Math.max(0, (agora - this.ultimo) / 1000 / this.fator); // em segundos "de jogo"
    this.ultimo = agora;
    const eventos: EventoJogo[] = [];
    let mudouFase = false;

    if (agora >= this.fimFase && this.fase !== 'jogando') {
      mudouFase = true;
      if (this.fase === 'contagem' && this.jogo === 'esconde-esconde') {
        this.fase = 'esconder';
        this.fimFase = agora + this.ms(SEGUNDOS_ESCONDER);
      } else {
        this.fase = 'jogando';
        this.inicioJogo = agora;
        this.fimFase = agora + this.ms(JOGOS[this.jogo].segundos);
      }
      return { eventos, acabou: false, mudouFase };
    }
    if (this.fase !== 'jogando') return { eventos, acabou: false, mudouFase };

    if (this.jogo === 'pega-pega' && this.pegador) {
      this.placar[this.pegador] += dt;
      const p = pos.get(this.pegador);
      if (p) {
        const alvo = this.participantes.find((id) => id !== this.pegador && (this.imunes.get(id) ?? 0) <= agora && pos.has(id) && distancia(p, pos.get(id)!) < DISTANCIA_PEGAR);
        if (alvo) {
          eventos.push({ k: 'pegou', de: this.pegador, para: alvo });
          this.imunes.set(this.pegador, agora + IMUNIDADE_MS * this.fator);
          this.pegador = alvo;
        }
      }
    } else if (this.jogo === 'rei-da-colina') {
      for (const id of this.participantes) {
        const p = pos.get(id);
        if (!p || p.y > 1.5) continue;
        const r = Math.hypot(p.x, p.z);
        if (r >= ZONA_REI.de && r <= ZONA_REI.ate) this.placar[id] += dt;
      }
    } else if (this.jogo === 'esconde-esconde' && this.buscador) {
      const b = pos.get(this.buscador);
      const tempo = (agora - this.inicioJogo) / 1000 / this.fator;
      for (const id of this.participantes) {
        if (id === this.buscador || this.achados.has(id)) continue;
        this.placar[id] = tempo; // tempo escondido
        if (b && pos.has(id) && distancia(b, pos.get(id)!) < DISTANCIA_PEGAR) {
          this.achados.add(id);
          eventos.push({ k: 'pegou', de: this.buscador, para: id });
        }
      }
      this.placar[this.buscador] = this.achados.size;
      if (this.escondidos().length === 0) return { eventos, acabou: true, mudouFase };
    }
    return { eventos, acabou: agora >= this.fimFase, mudouFase };
  }

  /** Quem ainda está escondido (esconde-esconde). */
  escondidos(): string[] {
    return this.participantes.filter((id) => id !== this.buscador && !this.achados.has(id));
  }

  /** Alguém saiu da sala no meio. Devolve true se a partida não tem mais como continuar. */
  sair(id: string): boolean {
    const i = this.participantes.indexOf(id);
    if (i < 0) return false;
    this.participantes.splice(i, 1);
    delete this.placar[id];
    this.achados.delete(id);
    if (this.participantes.length < 2) return true;
    if (id === this.pegador) this.pegador = sortear(this.participantes, this.rnd);
    if (id === this.buscador) return true;
    return this.jogo === 'esconde-esconde' && this.fase === 'jogando' && this.escondidos().length === 0;
  }

  estado(agora: number): EstadoPartida {
    const arred: Record<string, number> = {};
    for (const [id, v] of Object.entries(this.placar)) arred[id] = Math.round(v * 10) / 10;
    return {
      jogo: this.jogo,
      fase: this.fase,
      participantes: [...this.participantes],
      restanteMs: Math.max(0, Math.round((this.fimFase - agora) / this.fator)),
      pegador: this.pegador,
      buscador: this.buscador,
      achados: this.jogo === 'esconde-esconde' ? [...this.achados] : undefined,
      placar: arred,
    };
  }

  /** Classificação final com XP e moedas (posições empatadas dividem o lugar). */
  resultado(): ResultadoJogador[] {
    let ordem: { id: string; chave: number }[];
    if (this.jogo === 'pega-pega') ordem = this.participantes.map((id) => ({ id, chave: this.placar[id] })); // menos tempo pegando é melhor
    else if (this.jogo === 'rei-da-colina') ordem = this.participantes.map((id) => ({ id, chave: -this.placar[id] }));
    else {
      // Esconde-esconde: se achou todo mundo, quem procurou vence; senão, os escondidos vencem juntos e quem procurou fica por último.
      const achouTodos = this.escondidos().length === 0;
      ordem = this.participantes.map((id) => {
        if (id === this.buscador) return { id, chave: achouTodos ? -Infinity : Infinity };
        if (!this.achados.has(id)) return { id, chave: -1e6 };
        return { id, chave: -this.placar[id] };
      });
    }
    ordem.sort((a, b) => a.chave - b.chave);
    const res: ResultadoJogador[] = [];
    ordem.forEach((o, i) => {
      const posicao = i > 0 && Math.abs(o.chave - ordem[i - 1].chave) < 0.05 ? res[i - 1].posicao : i + 1;
      res.push({
        id: o.id,
        posicao,
        pontos: Math.round((this.placar[o.id] ?? 0) * 10) / 10,
        xp: XP_PARTICIPAR + (posicao === 1 ? XP_VENCER : 0),
        moedas: MOEDAS_POR_POSICAO[posicao - 1] ?? MOEDAS_PARTICIPAR,
      });
    });
    return res;
  }
}
