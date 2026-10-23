// Mesas de cartas da praça. O servidor embaralha e distribui; cada um só recebe as próprias cartas.
// Moedas: apostar/dobrar debitam do saldo na hora (se não tiver, não joga); prêmios creditam no fim.
// Lógica sem rede: a Sala passa funções para mexer nas moedas e repassa o estado.

import { APOSTA_MAX_21, APOSTA_MIN_21, APOSTAS_TRUCO, type Carta, type EstadoBJ, type EstadoTruco, LUGARES_MESA, type MaoBJ, PONTOS_TRUCO, SEGUNDOS_APOSTA_21, SEGUNDOS_VEZ } from './protocolo';

export type Moedas = (id: string, valor: number, motivo: string) => Promise<boolean>;

const NAIPES = ['♣', '♥', '♠', '♦'];

/** Embaralha com números aleatórios seguros (Fisher-Yates). */
function embaralhar<T>(l: T[]): T[] {
  const r = new Uint32Array(l.length);
  crypto.getRandomValues(r);
  for (let i = l.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

const valorDe = (c: Carta): string => c.slice(0, -1);
const naipeDe = (c: Carta): string => c.slice(-1);

/* ======================================================================== */
/* 21 contra a casa                                                          */
/* ======================================================================== */

/** Pontos de uma mão de 21 (Ás vale 11 ou 1). */
export function pontos21(cartas: Carta[]): number {
  let total = 0;
  let ases = 0;
  for (const c of cartas) {
    const v = valorDe(c);
    if (v === 'A') {
      total += 11;
      ases++;
    } else if (v === 'K' || v === 'Q' || v === 'J') total += 10;
    else total += Number(v);
  }
  while (total > 21 && ases > 0) {
    total -= 10;
    ases--;
  }
  return total;
}

export class VinteUm {
  fase: EstadoBJ['fase'] = 'apostas';
  readonly lugares: (string | null)[] = Array(LUGARES_MESA['21']).fill(null);
  readonly maos = new Map<string, MaoBJ>();
  private casa: Carta[] = [];
  private baralho: Carta[] = [];
  vez: string | null = null;
  private fimFase: number;

  constructor(agora: number) {
    this.fimFase = agora + SEGUNDOS_APOSTA_21 * 1000;
  }

  get vazia(): boolean {
    return this.lugares.every((l) => !l);
  }

  sentar(id: string): boolean {
    if (this.lugares.includes(id)) return false;
    const i = this.lugares.indexOf(null);
    if (i < 0) return false;
    this.lugares[i] = id;
    return true;
  }

  /** Levantar no meio da rodada perde a aposta (como abandonar a mão). */
  levantar(id: string): boolean {
    const i = this.lugares.indexOf(id);
    if (i < 0) return false;
    this.lugares[i] = null;
    this.maos.delete(id);
    if (this.vez === id) this.proximaVez();
    return true;
  }

  async apostar(id: string, v: unknown, debitar: Moedas): Promise<string | null> {
    if (this.fase !== 'apostas' || !this.lugares.includes(id)) return 'Espere a próxima rodada para apostar.';
    if (this.maos.has(id)) return 'Você já apostou nesta rodada.';
    const valor = Math.floor(Number(v));
    if (!(valor >= APOSTA_MIN_21 && valor <= APOSTA_MAX_21)) return `Aposta entre ${APOSTA_MIN_21} e ${APOSTA_MAX_21} moedas.`;
    // Marca antes de esperar o banco (dois cliques não debitam duas vezes).
    this.maos.set(id, { cartas: [], aposta: valor, status: 'apostando' });
    if (!(await debitar(id, -valor, 'aposta:21'))) {
      this.maos.delete(id);
      return 'Moedas insuficientes para essa aposta.';
    }
    return null;
  }

  private comprar(): Carta {
    return this.baralho.pop()!;
  }

  private distribuir(agora: number): void {
    // Baralho novo de 52 cartas a cada rodada.
    this.baralho = embaralhar(NAIPES.flatMap((n) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((v) => v + n)));
    this.casa = [this.comprar(), this.comprar()];
    for (const id of this.lugares) {
      const m = id && this.maos.get(id);
      if (!m) continue;
      m.cartas = [this.comprar(), this.comprar()];
      m.status = pontos21(m.cartas) === 21 ? 'blackjack' : 'jogando';
    }
    this.fase = 'jogando';
    this.vez = null;
    this.proximaVez(agora);
  }

  private proximaVez(agora = Date.now()): void {
    const ordem = this.lugares.filter((l): l is string => Boolean(l));
    const atual = this.vez ? ordem.indexOf(this.vez) : -1;
    this.vez = ordem.slice(atual + 1).find((id) => this.maos.get(id)?.status === 'jogando') ?? null;
    this.fimFase = agora + SEGUNDOS_VEZ * 1000;
    if (!this.vez && this.fase === 'jogando') {
      this.fase = 'casa';
      this.fimFase = agora + 1200;
    }
  }

  async acao(id: string, a: 'pedir' | 'parar' | 'dobrar', debitar: Moedas): Promise<string | null> {
    const m = this.maos.get(id);
    if (this.fase !== 'jogando' || this.vez !== id || !m) return 'Não é a sua vez.';
    if (a === 'dobrar') {
      if (m.cartas.length !== 2) return 'Só dá para dobrar com as duas primeiras cartas.';
      if (!(await debitar(id, -m.aposta, 'aposta:21:dobrar'))) return 'Moedas insuficientes para dobrar.';
      m.aposta *= 2;
      m.cartas.push(this.comprar());
      m.status = pontos21(m.cartas) > 21 ? 'estourou' : 'parou';
      this.proximaVez();
      return null;
    }
    if (a === 'pedir') {
      m.cartas.push(this.comprar());
      const p = pontos21(m.cartas);
      if (p > 21) m.status = 'estourou';
      else if (p === 21) m.status = 'parou';
      else {
        this.fimFase = Date.now() + SEGUNDOS_VEZ * 1000;
        return null;
      }
    } else m.status = 'parou';
    this.proximaVez();
    return null;
  }

  /** Relógio: fecha apostas, tempo da vez, a casa joga e paga, nova rodada. Devolve se mudou. */
  async tick(agora: number, creditar: Moedas): Promise<boolean> {
    if (this.fase === 'apostas') {
      const sentados = this.lugares.filter(Boolean) as string[];
      const apostaram = sentados.filter((id) => this.maos.get(id)?.status === 'apostando');
      const todos = sentados.length > 0 && apostaram.length === sentados.length;
      if (apostaram.length && (todos || agora >= this.fimFase)) {
        this.distribuir(agora);
        return true;
      }
      if (agora >= this.fimFase) this.fimFase = agora + SEGUNDOS_APOSTA_21 * 1000;
      return false;
    }
    if (this.fase === 'jogando' && agora >= this.fimFase && this.vez) {
      // Tempo esgotado: para.
      const m = this.maos.get(this.vez);
      if (m) m.status = 'parou';
      this.proximaVez(agora);
      return true;
    }
    if (this.fase === 'casa' && agora >= this.fimFase) {
      // Casa compra até 17 (se ainda tem alguém na disputa).
      const disputando = [...this.maos.values()].some((m) => m.status === 'parou');
      while (disputando && pontos21(this.casa) < 17) this.casa.push(this.comprar());
      const casa = pontos21(this.casa);
      const casaBJ = casa === 21 && this.casa.length === 2;
      for (const [id, m] of this.maos) {
        const p = pontos21(m.cartas);
        let ganho = 0;
        if (m.status === 'blackjack') ganho = casaBJ ? m.aposta : Math.floor(m.aposta * 2.5);
        else if (m.status === 'estourou') ganho = 0;
        else if (casa > 21 || p > casa) ganho = m.aposta * 2;
        else if (p === casa && !casaBJ) ganho = m.aposta;
        m.ganho = ganho;
        if (ganho > 0) await creditar(id, ganho, 'premio:21');
      }
      this.fase = 'resultado';
      this.fimFase = agora + 5000;
      return true;
    }
    if (this.fase === 'resultado' && agora >= this.fimFase) {
      this.maos.clear();
      this.casa = [];
      this.vez = null;
      this.fase = 'apostas';
      this.fimFase = agora + SEGUNDOS_APOSTA_21 * 1000;
      return true;
    }
    return false;
  }

  estado(agora: number): EstadoBJ {
    const revelada = this.fase === 'casa' || this.fase === 'resultado';
    return {
      fase: this.fase,
      lugares: [...this.lugares],
      maos: Object.fromEntries([...this.maos].map(([id, m]) => [id, { ...m, cartas: [...m.cartas] }])),
      casa: revelada ? [...this.casa] : this.casa.length ? [this.casa[0], '?'] : [],
      vez: this.vez,
      restanteMs: Math.max(0, this.fimFase - agora),
    };
  }
}

/* ======================================================================== */
/* Truco paulista                                                            */
/* ======================================================================== */

/** Ordem das cartas comuns (da mais fraca para a mais forte). 8, 9 e 10 não entram. */
const ORDEM_TRUCO = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
/** Naipes das manilhas: paus (zap) > copas > espadas > ouros. */
const FORCA_NAIPE: Record<string, number> = { '♣': 4, '♥': 3, '♠': 2, '♦': 1 };
const AUMENTOS = [1, 3, 6, 9, 12];

/** A manilha é o valor seguinte ao da vira (depois do 3 volta para o 4). */
export const manilhaDa = (vira: Carta): string => ORDEM_TRUCO[(ORDEM_TRUCO.indexOf(valorDe(vira)) + 1) % ORDEM_TRUCO.length];

/** Força de uma carta com essa vira (encoberta vale 0). */
export function forcaTruco(c: Carta | null, vira: Carta): number {
  if (!c) return 0;
  if (valorDe(c) === manilhaDa(vira)) return 100 + FORCA_NAIPE[naipeDe(c)];
  return 1 + ORDEM_TRUCO.indexOf(valorDe(c));
}

/**
 * Quem ganha a mão pelas vazes jogadas (time 0/1), -1 se empatou tudo, ou null se ainda não dá para saber.
 * Regras: quem faz 2 vazes ganha; empate na 1ª → quem ganhar a 2ª; ganhou a 1ª e empatou a 2ª → quem ganhou a 1ª;
 * 1ª e 2ª divididas → a 3ª decide; empate na 3ª → quem ganhou a 1ª.
 */
export function decidirMao(v: (number | null)[]): number | null {
  if (v.length < 2) return null;
  const [a, b, c] = v;
  if (v.length === 2) {
    if (a !== null && a === b) return a;
    if (a === null && b !== null) return b;
    if (a !== null && b === null) return a;
    return null;
  }
  if (c !== null && c !== undefined) return c;
  if (a !== null) return a;
  if (b !== null) return b;
  return -1;
}

export class Truco {
  fase: EstadoTruco['fase'] = 'esperando';
  readonly lugares: (string | null)[] = Array(LUGARES_MESA.truco).fill(null);
  aposta: number = APOSTAS_TRUCO[1];
  private maos: Carta[][] = [[], [], [], []];
  placar: [number, number] = [0, 0];
  private vira: Carta | null = null;
  private valorMao = 1;
  private pedido: { de: number; valor: number } | null = null;
  private ultimoQueAumentou: number | null = null;
  private mesa: { lugar: number; carta: Carta | null }[] = [];
  private ultimaVaz: { lugar: number; carta: Carta | null }[] | null = null;
  private vazas: (number | null)[] = [];
  vez: number | null = null;
  private comecaMao = 0;
  private comecaVaz = 0;
  vencedor: number | null = null;
  private fimVez = 0;
  private pausaAte = 0; // depois de cada vaz/mão, uma pausa para todos verem
  private jogadores: number[] = []; // lugares que jogam, na ordem da mesa

  timeDe = (lugar: number): number => lugar % 2;

  get vazia(): boolean {
    return this.lugares.every((l) => !l);
  }

  sentar(id: string): boolean {
    if (this.fase === 'jogando' || this.lugares.includes(id)) return false;
    const i = this.lugares.indexOf(null);
    if (i < 0) return false;
    this.lugares[i] = id;
    if (this.fase === 'fim') this.fase = 'esperando';
    return true;
  }

  /** Levantar no meio da partida entrega a vitória para o outro time. */
  levantar(id: string): 'saiu' | 'abandonou' | false {
    const i = this.lugares.indexOf(id);
    if (i < 0) return false;
    this.lugares[i] = null;
    if (this.fase === 'jogando' && this.jogadores.includes(i)) {
      this.vencedor = 1 - this.timeDe(i);
      this.fase = 'fim';
      return 'abandonou';
    }
    return 'saiu';
  }

  /** Começa: 2 (um de cada time) ou 4 sentados; todos pagam a aposta para o pote. */
  async comecar(id: string, aposta: unknown, debitar: Moedas): Promise<string | null> {
    if (this.fase === 'jogando') return 'A partida já começou.';
    if (!this.lugares.includes(id)) return 'Sente na mesa para começar.';
    const ocupados = this.lugares.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
    const times = new Set(ocupados.map(this.timeDe));
    if (!(ocupados.length === 4 || (ocupados.length === 2 && times.size === 2))) return 'Truco é 1 contra 1 (um em cada lado da mesa) ou 2 contra 2.';
    const v = Number(aposta);
    this.aposta = (APOSTAS_TRUCO as readonly number[]).includes(v) ? v : APOSTAS_TRUCO[1];
    const pagos: string[] = [];
    for (const i of ocupados) {
      const j = this.lugares[i]!;
      if (!(await debitar(j, -this.aposta, 'aposta:truco'))) {
        for (const p of pagos) await debitar(p, this.aposta, 'devolucao:truco');
        return 'Alguém na mesa não tem moedas para essa aposta.';
      }
      pagos.push(j);
    }
    this.jogadores = ocupados;
    this.placar = [0, 0];
    this.vencedor = null;
    this.comecaMao = ocupados[0];
    this.fase = 'jogando';
    this.novaMao(Date.now());
    return null;
  }

  private novaMao(agora: number): void {
    const baralho = embaralhar(NAIPES.flatMap((n) => ORDEM_TRUCO.map((v) => v + n)));
    this.maos = [[], [], [], []];
    for (const l of this.jogadores) this.maos[l] = [baralho.pop()!, baralho.pop()!, baralho.pop()!];
    this.vira = baralho.pop()!;
    // Mão de onze: quem tem 11 joga valendo 3 e não tem truco.
    this.valorMao = this.placar.includes(PONTOS_TRUCO - 1) ? 3 : 1;
    this.pedido = null;
    this.ultimoQueAumentou = null;
    this.mesa = [];
    this.vazas = [];
    this.comecaVaz = this.comecaMao;
    this.vez = this.comecaMao;
    this.fimVez = agora + SEGUNDOS_VEZ * 1000;
  }

  private proximo(lugar: number): number {
    const i = this.jogadores.indexOf(lugar);
    return this.jogadores[(i + 1) % this.jogadores.length];
  }

  maoDe(id: string): Carta[] {
    const i = this.lugares.indexOf(id);
    return i >= 0 ? [...this.maos[i]] : [];
  }

  jogar(id: string, idx: unknown, encoberta: unknown, agora: number): string | null {
    const lugar = this.lugares.indexOf(id);
    if (this.fase !== 'jogando' || lugar !== this.vez || agora < this.pausaAte) return 'Não é a sua vez.';
    if (this.pedido) return 'Responda o truco antes.';
    const i = Number(idx);
    const mao = this.maos[lugar];
    if (!Number.isInteger(i) || i < 0 || i >= mao.length) return 'Carta inválida.';
    // Encoberta (carta virada) só a partir da 2ª vaz.
    const virada = encoberta === true && this.vazas.length > 0;
    const [carta] = mao.splice(i, 1);
    this.mesa.push({ lugar, carta: virada ? null : carta });
    if (this.mesa.length < this.jogadores.length) {
      this.vez = this.proximo(lugar);
      this.fimVez = agora + SEGUNDOS_VEZ * 1000;
      return null;
    }
    this.fecharVaz(agora);
    return null;
  }

  private fecharVaz(agora: number): void {
    const vira = this.vira!;
    const maior = Math.max(...this.mesa.map((m) => forcaTruco(m.carta, vira)));
    const venc = this.mesa.filter((m) => forcaTruco(m.carta, vira) === maior);
    const times = new Set(venc.map((m) => this.timeDe(m.lugar)));
    const time = times.size === 1 ? [...times][0] : null; // dois times empatados = vaz empatada ("cangou")
    this.vazas.push(time);
    this.ultimaVaz = this.mesa;
    this.mesa = [];
    // Quem ganhou começa a próxima; empate, começa quem começou esta.
    this.comecaVaz = time === null ? this.comecaVaz : venc.find((m) => this.timeDe(m.lugar) === time)!.lugar;
    this.vez = this.comecaVaz;
    this.pausaAte = agora + 1500;
    this.fimVez = this.pausaAte + SEGUNDOS_VEZ * 1000;
    const mao = decidirMao(this.vazas);
    if (mao !== null) this.fecharMao(mao, agora);
  }

  private fecharMao(time: number, agora: number): void {
    if (time >= 0) this.placar[time] += this.valorMao;
    if (this.placar[0] >= PONTOS_TRUCO || this.placar[1] >= PONTOS_TRUCO) {
      this.vencedor = this.placar[0] >= PONTOS_TRUCO ? 0 : 1;
      this.fase = 'fim';
      this.vez = null;
      return;
    }
    this.comecaMao = this.proximo(this.comecaMao);
    this.pausaAte = agora + 2500;
    this.vez = null; // a próxima mão é distribuída no tick, depois da pausa
  }

  /** Pede truco (ou aumenta para seis/nove/doze quando está respondendo). */
  trucar(id: string, agora: number): string | null {
    const lugar = this.lugares.indexOf(id);
    if (this.fase !== 'jogando' || lugar < 0 || !this.jogadores.includes(lugar) || this.vez === null) return 'Agora não dá para pedir truco.';
    const time = this.timeDe(lugar);
    if (this.placar.includes(PONTOS_TRUCO - 1)) return 'Na mão de onze não tem truco.';
    if (this.pedido) {
      // Respondendo com aumento: aceita o pedido e pede mais.
      if (this.pedido.de === time) return 'Esperando o outro time responder.';
      if (this.pedido.valor >= 12) return 'Doze é o máximo.';
      this.valorMao = this.pedido.valor;
      this.pedido = { de: time, valor: AUMENTOS[AUMENTOS.indexOf(this.pedido.valor) + 1] };
    } else {
      if (lugar !== this.vez) return 'Peça truco na sua vez.';
      if (this.ultimoQueAumentou === time) return 'Seu time já aumentou; agora é o outro time.';
      if (this.valorMao >= 12) return 'Doze é o máximo.';
      this.pedido = { de: time, valor: AUMENTOS[AUMENTOS.indexOf(this.valorMao) + 1] };
    }
    this.fimVez = agora + SEGUNDOS_VEZ * 1000;
    return null;
  }

  responder(id: string, aceitar: boolean, agora: number): string | null {
    const lugar = this.lugares.indexOf(id);
    if (!this.pedido || lugar < 0 || this.timeDe(lugar) === this.pedido.de) return 'Não há truco para você responder.';
    if (aceitar) {
      this.valorMao = this.pedido.valor;
      this.ultimoQueAumentou = this.pedido.de;
      this.pedido = null;
      this.fimVez = agora + SEGUNDOS_VEZ * 1000;
    } else {
      // Correu: quem pediu leva o valor de antes do pedido.
      const quem = this.pedido.de;
      this.pedido = null;
      this.mesa = [];
      this.fecharMao(quem, agora);
    }
    return null;
  }

  /** Relógio: próxima mão depois da pausa; tempo da vez esgotado joga a carta mais fraca (ou aceita o truco). */
  tick(agora: number): boolean {
    if (this.fase !== 'jogando' || agora < this.pausaAte) return false;
    if (this.vez === null) {
      this.novaMao(agora);
      return true;
    }
    if (agora < this.fimVez) return false;
    if (this.pedido) {
      const resp = this.jogadores.find((l) => this.timeDe(l) !== this.pedido!.de)!;
      this.responder(this.lugares[resp]!, true, agora);
      return true;
    }
    const mao = this.maos[this.vez];
    const vira = this.vira!;
    const fraca = mao.reduce((m, c, i) => (forcaTruco(c, vira) < forcaTruco(mao[m], vira) ? i : m), 0);
    this.jogar(this.lugares[this.vez]!, fraca, false, agora);
    return true;
  }

  /** Fim: o time vencedor divide o pote. */
  async pagar(creditar: Moedas): Promise<void> {
    if (this.vencedor === null) return;
    const ganhadores = this.jogadores.filter((l) => this.timeDe(l) === this.vencedor && this.lugares[l]).map((l) => this.lugares[l]!);
    const pote = this.aposta * this.jogadores.length;
    for (const id of ganhadores) await creditar(id, Math.floor(pote / Math.max(1, ganhadores.length)), 'premio:truco');
  }

  estado(agora: number): EstadoTruco {
    return {
      fase: this.fase,
      lugares: [...this.lugares],
      aposta: this.aposta,
      placar: [...this.placar] as [number, number],
      vira: this.vira,
      valorMao: this.valorMao,
      pedido: this.pedido,
      mesa: this.mesa.map((m) => ({ ...m })),
      vazas: [...this.vazas],
      vez: this.vez,
      cartasNaMao: this.maos.map((m) => m.length),
      vencedor: this.vencedor,
      ultimaVaz: this.ultimaVaz,
      restanteMs: Math.max(0, (this.vez === null ? this.pausaAte : this.fimVez) - agora),
    };
  }
}
