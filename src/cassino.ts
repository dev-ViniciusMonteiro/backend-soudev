// Cassino: poker (Texas Hold'em), roleta e caça-níqueis. Junto com o 21 e o truco (cartas.ts), fica no prédio
// do Cassino. Lógica sem rede, como nas cartas: a Sala passa funções para mexer nas moedas e repassa o estado.

import { type Moedas, baralho52, embaralhar } from './cartas';
import {
  APOSTA_MAX_ROLETA,
  APOSTA_MIN_ROLETA,
  type ApostaRoleta,
  BLINDS_POKER,
  type Carta,
  type EstadoPoker,
  type EstadoRoleta,
  type JogadorPoker,
  LIMITE_POKER,
  LUGARES_MESA,
  MAX_APOSTAS_ROLETA,
  PAGA_ROLETA,
  PESOS_SLOT,
  SEGUNDOS_APOSTAS_ROLETA,
  SEGUNDOS_ENTRE_MAOS,
  SEGUNDOS_GIRO_ROLETA,
  SEGUNDOS_RESULTADO_ROLETA,
  SEGUNDOS_VEZ,
  type TipoApostaRoleta,
  ganhouRoleta,
} from './protocolo';

/** Inteiro aleatório seguro de 0 a n-1. */
function sortear(n: number): number {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return r[0] % n;
}

/* ======================================================================== */
/* Poker: avaliação das mãos                                                 */
/* ======================================================================== */

const VALOR: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const SIMBOLO: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const simb = (v: number): string => SIMBOLO[v] ?? String(v);

/** Pontuação de 5 cartas: [categoria, desempates...] (maior ganha). */
function avaliar5(cs: Carta[]): number[] {
  const vals = cs.map((c) => VALOR[c.slice(0, -1)]).sort((a, b) => b - a);
  const flush = cs.every((c) => c.slice(-1) === cs[0].slice(-1));
  const unicos = [...new Set(vals)];
  let alta = 0;
  if (unicos.length === 5) {
    if (vals[0] - vals[4] === 4) alta = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) alta = 5; // A-2-3-4-5
  }
  const cont = new Map<number, number>();
  for (const v of vals) cont.set(v, (cont.get(v) ?? 0) + 1);
  const grupos = [...cont].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ordem = grupos.map((g) => g[0]);
  if (alta && flush) return [8, alta];
  if (grupos[0][1] === 4) return [7, ...ordem];
  if (grupos[0][1] === 3 && grupos[1][1] === 2) return [6, ...ordem];
  if (flush) return [5, ...vals];
  if (alta) return [4, alta];
  if (grupos[0][1] === 3) return [3, ...ordem];
  if (grupos[0][1] === 2 && grupos[1][1] === 2) return [2, ...ordem];
  if (grupos[0][1] === 2) return [1, ...ordem];
  return [0, ...vals];
}

export function compararPontos(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

export function nomeDaMao(p: number[]): string {
  switch (p[0]) {
    case 8:
      return p[1] === 14 ? 'Royal flush' : `Straight flush até ${simb(p[1])}`;
    case 7:
      return `Quadra de ${simb(p[1])}`;
    case 6:
      return `Full house (${simb(p[1])} e ${simb(p[2])})`;
    case 5:
      return `Flush até ${simb(p[1])}`;
    case 4:
      return `Sequência até ${simb(p[1])}`;
    case 3:
      return `Trinca de ${simb(p[1])}`;
    case 2:
      return `Dois pares (${simb(p[1])} e ${simb(p[2])})`;
    case 1:
      return `Par de ${simb(p[1])}`;
    default:
      return `Carta alta ${simb(p[1])}`;
  }
}

/** Melhor jogo de 5 entre as cartas (2 da mão + até 5 da mesa). */
export function melhorMao(cartas: Carta[]): { pontos: number[]; nome: string } {
  let melhor: number[] | null = null;
  const n = cartas.length;
  const escolher = (ini: number, sel: Carta[]): void => {
    if (sel.length === 5) {
      const p = avaliar5(sel);
      if (!melhor || compararPontos(p, melhor) > 0) melhor = p;
      return;
    }
    for (let i = ini; i <= n - (5 - sel.length); i++) escolher(i + 1, [...sel, cartas[i]]);
  };
  escolher(0, []);
  const p = melhor ?? [0];
  return { pontos: p, nome: nomeDaMao(p) };
}

/* ======================================================================== */
/* Poker: a mesa                                                             */
/* ======================================================================== */

type FaseAposta = 'preflop' | 'flop' | 'turn' | 'river';
const PROXIMA: Record<FaseAposta, EstadoPoker['fase']> = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'fim' };

export class Poker {
  fase: EstadoPoker['fase'] = 'esperando';
  readonly lugares: (string | null)[] = Array(LUGARES_MESA.poker).fill(null);
  readonly jogadores = new Map<string, JogadorPoker>();
  private maos = new Map<string, Carta[]>();
  private mesa: Carta[] = [];
  private baralho: Carta[] = [];
  private dealer = -1;
  vez: number | null = null;
  private maiorAposta = 0;
  private minimoAumento = BLINDS_POKER[1];
  private agiram = new Set<string>();
  private fimFase = 0;
  private comecando = false;
  /** Moedas a devolver (sobra da mão, prêmios, quem levantou): a Sala credita e esvazia. */
  pagamentos: [string, number, string][] = [];

  get vazia(): boolean {
    return this.lugares.every((l) => !l) && !this.emMao;
  }

  get emMao(): boolean {
    return this.fase !== 'esperando' && this.fase !== 'fim';
  }

  sentar(id: string, agora: number): boolean {
    if (this.lugares.includes(id)) return false;
    const i = this.lugares.indexOf(null);
    if (i < 0) return false;
    this.lugares[i] = id;
    if (this.fase === 'esperando') this.fimFase = Math.max(this.fimFase, agora + 3000);
    return true;
  }

  /** Levantar no meio da mão desiste dela; as fichas que não foram para o pote voltam. */
  levantar(id: string, agora = Date.now()): boolean {
    const i = this.lugares.indexOf(id);
    if (i < 0) return false;
    this.lugares[i] = null;
    const j = this.jogadores.get(id);
    if (j && this.emMao && j.status !== 'fora') {
      if (j.pilha > 0) this.pagamentos.push([id, j.pilha, 'poker:levantou']);
      j.pilha = 0;
      if (j.status === 'ativo' || j.status === 'allin') {
        j.status = 'desistiu';
        j.acao = 'saiu';
      }
      this.agiram.add(id);
      if (this.vez === i) this.avancar(agora);
      else this.conferirFim(agora);
    } else this.jogadores.delete(id);
    return true;
  }

  /** Pronto para dar as cartas de uma mão nova? */
  podeComecar(agora: number): boolean {
    return !this.comecando && (this.fase === 'esperando' || this.fase === 'fim') && agora >= this.fimFase && this.lugares.filter(Boolean).length >= 2;
  }

  /** Começa uma mão: cada um entra com o saldo até o limite (debitado agora). Devolve se começou. */
  async comecarMao(agora: number, saldo: (id: string) => Promise<number>, moedas: Moedas): Promise<boolean> {
    this.comecando = true;
    try {
      const entradas = new Map<string, number>();
      for (const id of this.lugares) {
        if (!id) continue;
        const valor = Math.min(LIMITE_POKER, await saldo(id));
        if (valor >= BLINDS_POKER[1] && (await moedas(id, -valor, 'aposta:poker'))) entradas.set(id, valor);
      }
      // Quem levantou enquanto esperava o banco recebe de volta.
      for (const [id, v] of entradas)
        if (!this.lugares.includes(id)) {
          this.pagamentos.push([id, v, 'poker:levantou']);
          entradas.delete(id);
        }
      if (entradas.size < 2) {
        for (const [id, v] of entradas) this.pagamentos.push([id, v, 'poker:sem-mao']);
        this.fase = 'esperando';
        this.jogadores.clear();
        this.fimFase = agora + 5000;
        return false;
      }
      this.jogadores.clear();
      this.maos.clear();
      for (const id of this.lugares) if (id) this.jogadores.set(id, entradas.has(id) ? { pilha: entradas.get(id)!, aposta: 0, total: 0, status: 'ativo' } : { pilha: 0, aposta: 0, total: 0, status: 'fora', acao: 'sem moedas' });
      this.baralho = embaralhar(baralho52());
      this.mesa = [];
      const naMao = this.lugaresNaMao();
      for (const l of naMao) this.maos.set(this.lugares[l]!, [this.baralho.pop()!, this.baralho.pop()!]);
      // Dealer anda uma cadeira; blinds: no mano a mano o dealer é o small blind.
      this.dealer = this.seguinte(this.dealer, naMao);
      const sb = naMao.length === 2 ? this.dealer : this.seguinte(this.dealer, naMao);
      const bb = this.seguinte(sb, naMao);
      this.por(this.lugares[sb]!, BLINDS_POKER[0], `small blind ${BLINDS_POKER[0]}`);
      this.por(this.lugares[bb]!, BLINDS_POKER[1], `big blind ${BLINDS_POKER[1]}`);
      this.maiorAposta = BLINDS_POKER[1];
      this.minimoAumento = BLINDS_POKER[1];
      this.agiram.clear();
      this.fase = 'preflop';
      this.vez = bb;
      this.avancar(agora);
      return true;
    } finally {
      this.comecando = false;
    }
  }

  /** Lugares de quem está jogando esta mão (não desistiu nem ficou de fora), em ordem. */
  private lugaresNaMao(): number[] {
    return this.lugares.map((id, i) => (id && this.jogadores.get(id) && this.jogadores.get(id)!.status !== 'fora' ? i : -1)).filter((i) => i >= 0);
  }

  private seguinte(de: number, entre: number[]): number {
    for (let k = 1; k <= this.lugares.length; k++) {
      const i = (((de + k) % this.lugares.length) + this.lugares.length) % this.lugares.length;
      if (entre.includes(i)) return i;
    }
    return entre[0];
  }

  private por(id: string, valor: number, acao: string): void {
    const j = this.jogadores.get(id)!;
    const n = Math.min(valor, j.pilha);
    j.pilha -= n;
    j.aposta += n;
    j.total += n;
    j.acao = acao;
    if (j.pilha === 0) {
      j.status = 'allin';
      j.acao = `all-in (${j.total})`;
    }
  }

  acao(id: string, a: 'desistir' | 'passar' | 'pagar' | 'allin' | 'aumentar', v: unknown, agora: number): string | null {
    if (!this.emMao || this.vez === null || this.lugares[this.vez] !== id) return 'Não é a sua vez.';
    const j = this.jogadores.get(id)!;
    const falta = this.maiorAposta - j.aposta;
    if (a === 'desistir') {
      j.status = 'desistiu';
      j.acao = 'desistiu';
    } else if (a === 'passar' || (a === 'pagar' && falta <= 0)) {
      if (falta > 0) return `Tem ${falta} para pagar (ou desista).`;
      j.acao = 'passou';
    } else if (a === 'pagar') this.por(id, falta, `pagou ${Math.min(falta, j.pilha)}`);
    else {
      const tudo = j.aposta + j.pilha;
      let alvo = a === 'allin' ? tudo : Math.floor(Number(v));
      if (!Number.isFinite(alvo)) return 'Valor inválido.';
      if (alvo >= tudo) alvo = tudo;
      else if (alvo < this.maiorAposta + this.minimoAumento) return `O aumento mínimo é para ${this.maiorAposta + this.minimoAumento}.`;
      if (alvo <= this.maiorAposta) this.por(id, alvo - j.aposta, `pagou ${alvo - j.aposta}`);
      else {
        this.minimoAumento = Math.max(this.minimoAumento, alvo - this.maiorAposta);
        this.maiorAposta = alvo;
        this.agiram.clear();
        this.por(id, alvo - j.aposta, `aumentou para ${alvo}`);
      }
    }
    this.agiram.add(id);
    this.avancar(agora);
    return null;
  }

  /** Passa a vez; fecha a rodada de apostas quando todos igualaram; abre o flop, turn e river; mostra. */
  private avancar(agora: number): void {
    if (this.conferirFim(agora)) return;
    const naMao = this.lugaresNaMao();
    const ativos = naMao.filter((l) => this.jogadores.get(this.lugares[l]!)!.status === 'ativo');
    const fechou = ativos.every((l) => {
      const id = this.lugares[l]!;
      return this.agiram.has(id) && this.jogadores.get(id)!.aposta === this.maiorAposta;
    });
    // Só um (ou ninguém) ainda pode apostar e já cobriu: não tem contra quem apostar.
    const sozinho = ativos.length <= 1 && ativos.every((l) => this.jogadores.get(this.lugares[l]!)!.aposta >= this.maiorAposta);
    if (!fechou && !sozinho) {
      // Próximo que ainda precisa falar: não agiu nesta rodada ou não cobriu a maior aposta.
      let l = this.vez ?? this.dealer;
      for (let k = 0; k < ativos.length; k++) {
        l = this.seguinte(l, ativos);
        const id = this.lugares[l]!;
        if (!this.agiram.has(id) || this.jogadores.get(id)!.aposta < this.maiorAposta) break;
      }
      this.vez = l;
      this.fimFase = agora + SEGUNDOS_VEZ * 1000;
      return;
    }
    // Próxima rua.
    for (const id of this.jogadores.keys()) {
      const j = this.jogadores.get(id)!;
      j.aposta = 0;
      if (j.status === 'ativo') delete j.acao;
    }
    this.maiorAposta = 0;
    this.minimoAumento = BLINDS_POKER[1];
    this.agiram.clear();
    const prox = PROXIMA[this.fase as FaseAposta];
    if (prox === 'fim') {
      this.terminar(agora, true);
      return;
    }
    this.fase = prox;
    this.mesa.push(...this.baralho.splice(-(prox === 'flop' ? 3 : 1)));
    if (ativos.length <= 1) {
      // Todo mundo (ou todos menos um) all-in: abre o resto da mesa e mostra.
      while (this.mesa.length < 5) this.mesa.push(this.baralho.pop()!);
      this.terminar(agora, true);
      return;
    }
    this.vez = this.seguinte(this.dealer, ativos);
    this.fimFase = agora + SEGUNDOS_VEZ * 1000;
  }

  /** Sobrou só um na mão: leva o pote sem mostrar. */
  private conferirFim(agora: number): boolean {
    if (!this.emMao) return true;
    const vivos = [...this.jogadores.values()].filter((j) => j.status === 'ativo' || j.status === 'allin');
    if (vivos.length > 1) return false;
    this.terminar(agora, false);
    return true;
  }

  private terminar(agora: number, mostrar: boolean): void {
    const todos = [...this.jogadores];
    const vivos = todos.filter(([, j]) => j.status === 'ativo' || j.status === 'allin');
    for (const [, j] of todos) j.ganho = 0;
    if (!mostrar || vivos.length === 1) {
      const pote = todos.reduce((s, [, j]) => s + j.total, 0);
      if (vivos[0]) vivos[0][1].ganho = pote;
    } else {
      // Potes paralelos: cada nível de all-in forma um pote que só quem pôs aquilo disputa.
      const pontos = new Map(vivos.map(([id]) => [id, melhorMao([...this.maos.get(id)!, ...this.mesa])]));
      for (const [id, j] of vivos) {
        j.cartas = [...this.maos.get(id)!];
        j.jogo = pontos.get(id)!.nome;
      }
      const niveis = [...new Set(vivos.map(([, j]) => j.total))].sort((a, b) => a - b);
      let antes = 0;
      const ordem = this.lugares.map((_, k) => (this.dealer + 1 + k) % this.lugares.length);
      niveis.forEach((nivel, n) => {
        let pote = todos.reduce((s, [, j]) => s + Math.max(0, Math.min(j.total, nivel) - Math.min(j.total, antes)), 0);
        // O que sobrou acima do último nível (de quem desistiu) vai para o último pote.
        if (n === niveis.length - 1) pote += todos.reduce((s, [, j]) => s + Math.max(0, j.total - nivel), 0);
        antes = nivel;
        const disputam = vivos.filter(([, j]) => j.total >= nivel);
        let melhores: string[] = [];
        for (const [id] of disputam) {
          const c = melhores.length ? compararPontos(pontos.get(id)!.pontos, pontos.get(melhores[0])!.pontos) : 1;
          if (c > 0) melhores = [id];
          else if (c === 0) melhores.push(id);
        }
        melhores.sort((a, b) => ordem.indexOf(this.lugares.indexOf(a)) - ordem.indexOf(this.lugares.indexOf(b)));
        const parte = Math.floor(pote / melhores.length);
        melhores.forEach((id, k) => (this.jogadores.get(id)!.ganho! += parte + (k === 0 ? pote - parte * melhores.length : 0)));
      });
    }
    for (const [id, j] of todos) {
      const volta = j.pilha + (j.ganho ?? 0);
      if (volta > 0) this.pagamentos.push([id, volta, 'premio:poker']);
      j.pilha = 0;
    }
    this.fase = 'fim';
    this.vez = null;
    this.fimFase = agora + SEGUNDOS_ENTRE_MAOS * 1000;
  }

  /** Tempo da vez esgotado: passa se puder, senão desiste. Devolve se mudou. */
  tick(agora: number): boolean {
    if (!this.emMao || this.vez === null || agora < this.fimFase) return false;
    const id = this.lugares[this.vez];
    if (!id) {
      this.avancar(agora);
      return true;
    }
    const j = this.jogadores.get(id)!;
    this.acao(id, j.aposta >= this.maiorAposta ? 'passar' : 'desistir', 0, agora);
    return true;
  }

  maoDe(id: string): Carta[] {
    return [...(this.maos.get(id) ?? [])];
  }

  estado(agora: number): EstadoPoker {
    return {
      fase: this.fase,
      lugares: [...this.lugares],
      jogadores: Object.fromEntries([...this.jogadores].map(([id, j]) => [id, { ...j, cartas: j.cartas ? [...j.cartas] : undefined }])),
      mesa: [...this.mesa],
      pote: [...this.jogadores.values()].reduce((s, j) => s + j.total, 0),
      dealer: this.dealer,
      vez: this.vez,
      maiorAposta: this.maiorAposta,
      minimoAumento: this.minimoAumento,
      restanteMs: Math.max(0, this.fimFase - agora),
    };
  }
}

/* ======================================================================== */
/* Roleta                                                                    */
/* ======================================================================== */

const TIPOS_ROLETA: TipoApostaRoleta[] = ['numero', 'vermelho', 'preto', 'par', 'impar', 'baixo', 'alto', 'duzia'];

export class Roleta {
  fase: EstadoRoleta['fase'] = 'apostas';
  private apostas: ApostaRoleta[] = [];
  private numero: number | null = null;
  private historico: number[] = [];
  private fimFase: number | null = null;

  get parada(): boolean {
    return this.fase === 'apostas' && !this.apostas.length;
  }

  async apostar(id: string, tipo: unknown, alvo: unknown, v: unknown, agora: number, debitar: Moedas): Promise<string | null> {
    if (this.fase !== 'apostas') return 'Espere a próxima rodada para apostar.';
    if (!TIPOS_ROLETA.includes(tipo as TipoApostaRoleta)) return 'Aposta inválida.';
    const t = tipo as TipoApostaRoleta;
    const a = Math.floor(Number(alvo));
    if (t === 'numero' && !(a >= 0 && a <= 36)) return 'Escolha um número de 0 a 36.';
    if (t === 'duzia' && !(a >= 1 && a <= 3)) return 'Escolha a 1ª, 2ª ou 3ª dúzia.';
    const valor = Math.floor(Number(v));
    if (!(valor >= APOSTA_MIN_ROLETA && valor <= APOSTA_MAX_ROLETA)) return `Aposta entre ${APOSTA_MIN_ROLETA} e ${APOSTA_MAX_ROLETA} moedas.`;
    if (this.apostas.filter((x) => x.id === id).length >= MAX_APOSTAS_ROLETA) return `No máximo ${MAX_APOSTAS_ROLETA} apostas por rodada.`;
    // Marca antes de esperar o banco (dois cliques não passam do limite).
    const aposta: ApostaRoleta = { id, tipo: t, v: valor, ...(t === 'numero' || t === 'duzia' ? { alvo: a } : {}) };
    this.apostas.push(aposta);
    if (!(await debitar(id, -valor, 'aposta:roleta'))) {
      this.apostas = this.apostas.filter((x) => x !== aposta);
      return 'Moedas insuficientes para essa aposta.';
    }
    this.fimFase ??= agora + SEGUNDOS_APOSTAS_ROLETA * 1000;
    return null;
  }

  /** Relógio: fecha as apostas, gira, paga, recomeça. Devolve se mudou. */
  async tick(agora: number, creditar: Moedas): Promise<boolean> {
    if (this.fimFase === null || agora < this.fimFase) return false;
    if (this.fase === 'apostas') {
      this.fase = 'girando';
      this.fimFase = agora + SEGUNDOS_GIRO_ROLETA * 1000;
      return true;
    }
    if (this.fase === 'girando') {
      const n = sortear(37);
      this.numero = n;
      this.historico = [n, ...this.historico].slice(0, 12);
      for (const ap of this.apostas) {
        ap.ganho = ganhouRoleta(ap.tipo, ap.alvo, n) ? ap.v * PAGA_ROLETA[ap.tipo] : 0;
        if (ap.ganho) await creditar(ap.id, ap.ganho, 'premio:roleta');
      }
      this.fase = 'resultado';
      this.fimFase = agora + SEGUNDOS_RESULTADO_ROLETA * 1000;
      return true;
    }
    this.fase = 'apostas';
    this.apostas = [];
    this.numero = null;
    this.fimFase = null;
    return true;
  }

  estado(agora: number): EstadoRoleta {
    return {
      fase: this.fase,
      apostas: this.apostas.map((a) => ({ ...a })),
      numero: this.numero,
      historico: [...this.historico],
      restanteMs: this.fimFase === null ? null : Math.max(0, this.fimFase - agora),
    };
  }
}

/* ======================================================================== */
/* Caça-níqueis                                                              */
/* ======================================================================== */

/** Três rolos sorteados pelos pesos (índices em SIMBOLOS_SLOT). */
export function girarSlot(): number[] {
  const total = PESOS_SLOT.reduce((a, b) => a + b, 0);
  return [0, 1, 2].map(() => {
    let r = sortear(total);
    for (let i = 0; i < PESOS_SLOT.length; i++) {
      if (r < PESOS_SLOT[i]) return i;
      r -= PESOS_SLOT[i];
    }
    return 0;
  });
}
