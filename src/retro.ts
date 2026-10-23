// Sprint Retro: retrospectiva com a sala inteira, tema de Halloween.
// Reunião (todos no centro e "pronto") → uma pergunta por vez (cada um levanta a placa com a resposta e baixa
// quando termina; todos baixaram = próxima) → votação (3 votos por pessoa) → relatório com as mais votadas.
// Quem cai da conexão fica "ausente" (não trava ninguém) e volta de onde parou. Se todos os presentes votarem
// para encerrar, a retro acaba sem pontos (saída de emergência).
// Lógica pura e serializável: a Sala guarda o estado no armazenamento a cada mudança (a sala pode hibernar
// enquanto todos digitam parados, e a memória some).

import { type EstadoRetro, type FaseRetro, PERGUNTAS_RETRO, type RespostaRetro, type StatusRetro, TAMANHO_RESPOSTA, VOTOS_RETRO } from './protocolo';
import type { ResultadoJogador } from './perfis';

const XP_PARTICIPAR = 20;
const MOEDAS_PARTICIPAR = 10;
// Prêmio para quem escreveu as 5 respostas mais votadas (1ª, 2ª, ...).
const XP_PREMIO = [50, 40, 30, 20, 10];
const MOEDAS_PREMIO = [100, 70, 50, 30, 20];

export function limparResposta(bruto: unknown): string {
  return String(bruto ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAMANHO_RESPOSTA);
}

/** Tudo o que precisa sobreviver à hibernação. */
interface Dados {
  fase: FaseRetro;
  anfitriao: string;
  participantes: string[];
  nomes: [string, string][];
  prontos: string[];
  pergunta: number;
  status: [string, StatusRetro][];
  placas: [string, string][];
  placaAtual: [string, string][];
  respostas: RespostaRetro[];
  terminaramVoto: string[];
  premiadas: string[];
  ausentes: string[];
  querSair: string[];
  cancelada: boolean;
  seq: number;
  inicio: number;
}

export class Retro {
  private d: Dados;

  constructor(participantes: { id: string; nome: string }[], anfitriao: string, dados?: Dados) {
    this.d = dados ?? {
      fase: 'reuniao',
      anfitriao,
      participantes: participantes.map((p) => p.id),
      nomes: participantes.map((p) => [p.id, p.nome]),
      prontos: [],
      pergunta: 0,
      status: [],
      placas: [],
      placaAtual: [],
      respostas: [],
      terminaramVoto: [],
      premiadas: [],
      ausentes: [],
      querSair: [],
      cancelada: false,
      seq: 0,
      inicio: Date.now(),
    };
  }

  static restaurar(dados: Dados): Retro {
    return new Retro([], '', dados);
  }

  serializar(): Dados {
    return structuredClone(this.d);
  }

  get fase(): FaseRetro {
    return this.d.fase;
  }
  get participantes(): string[] {
    return this.d.participantes;
  }
  get cancelada(): boolean {
    return this.d.cancelada;
  }
  get inicio(): number {
    return this.d.inicio;
  }

  /* ---------- Ajudantes sobre os pares [chave, valor] ---------- */

  private pegar<T>(l: [string, T][], id: string): T | undefined {
    return l.find((x) => x[0] === id)?.[1];
  }
  private por<T>(l: [string, T][], id: string, v: T): void {
    const i = l.findIndex((x) => x[0] === id);
    if (i >= 0) l[i][1] = v;
    else l.push([id, v]);
  }
  private tirar<T>(l: [string, T][], id: string): void {
    const i = l.findIndex((x) => x[0] === id);
    if (i >= 0) l.splice(i, 1);
  }

  private participa = (id: string): boolean => this.d.participantes.includes(id);
  /** Quem está conectado agora: só essas pessoas seguram o andamento. */
  presentes = (): string[] => this.d.participantes.filter((p) => !this.d.ausentes.includes(p));
  private todosPresentes = (cond: (id: string) => boolean): boolean => {
    const p = this.presentes();
    return p.length > 0 && p.every(cond);
  };

  /* ---------- Reunião ---------- */

  /** Todos (presentes) no centro clicaram "pronto": começa a primeira pergunta. */
  pronto(id: string, noCentro: boolean): boolean {
    if (this.d.fase !== 'reuniao' || !this.participa(id) || !noCentro || this.d.prontos.includes(id)) return false;
    this.d.prontos.push(id);
    this.verificar();
    return true;
  }

  private irParaPergunta(n: number): void {
    this.d.fase = 'pergunta';
    this.d.pergunta = n;
    this.d.placas = [];
    this.d.placaAtual = [];
    this.d.status = this.d.participantes.map((p) => [p, 'pensando']);
  }

  /* ---------- Perguntas ---------- */

  status(id: string): StatusRetro {
    return this.pegar(this.d.status, id) ?? 'pensando';
  }

  /** Levanta a placa com a resposta (ou troca o texto da placa que já está levantada). */
  levantar(id: string, bruto: unknown): boolean {
    if (this.d.fase !== 'pergunta' || !this.participa(id)) return false;
    const texto = limparResposta(bruto);
    if (!texto) return false;
    const atual = this.pegar(this.d.placaAtual, id);
    const r = atual && this.d.respostas.find((x) => x.id === atual);
    if (r) r.texto = texto;
    else {
      const nova: RespostaRetro = { id: `r${++this.d.seq}`, pergunta: this.d.pergunta, autor: id, nome: this.pegar(this.d.nomes, id) ?? '?', texto, votos: [] };
      this.d.respostas.push(nova);
      this.por(this.d.placaAtual, id, nova.id);
    }
    this.por(this.d.placas, id, texto);
    this.por(this.d.status, id, 'levantada');
    return true;
  }

  /** Baixa a placa (a resposta fica guardada). Se todos baixaram, vem a próxima pergunta. */
  baixar(id: string): boolean {
    if (this.d.fase !== 'pergunta' || this.status(id) !== 'levantada') return false;
    this.fecharPlaca(id);
    this.verificar();
    return true;
  }

  /** Sem resposta (ou já terminou): conta como "baixou". Também baixa a placa se estiver levantada. */
  passar(id: string): boolean {
    if (this.d.fase !== 'pergunta' || !this.participa(id) || this.status(id) === 'baixada') return false;
    this.fecharPlaca(id);
    this.verificar();
    return true;
  }

  private fecharPlaca(id: string): void {
    this.tirar(this.d.placas, id);
    this.tirar(this.d.placaAtual, id);
    this.por(this.d.status, id, 'baixada');
  }

  private proxima(): void {
    if (this.d.pergunta + 1 < PERGUNTAS_RETRO.length) this.irParaPergunta(this.d.pergunta + 1);
    else {
      this.d.fase = 'votacao';
      this.d.placas = [];
      this.d.placaAtual = [];
    }
  }

  /** Confere se a fase atual terminou (todos os presentes fizeram a sua parte) e avança. */
  private verificar(): void {
    if (this.d.fase === 'reuniao' && this.todosPresentes((p) => this.d.prontos.includes(p))) this.irParaPergunta(0);
    else if (this.d.fase === 'pergunta' && this.todosPresentes((p) => this.status(p) === 'baixada')) this.proxima();
    else if (this.d.fase === 'votacao' && this.todosPresentes((p) => this.d.terminaramVoto.includes(p))) this.encerrar();
  }

  /** O anfitrião pode puxar o andamento (alguém sumiu do teclado). */
  avancar(id: string): boolean {
    if (id !== this.d.anfitriao) return false;
    if (this.d.fase === 'reuniao') this.irParaPergunta(0);
    else if (this.d.fase === 'pergunta') this.proxima();
    else if (this.d.fase === 'votacao') this.encerrar();
    else return false;
    return true;
  }

  /* ---------- Votação ---------- */

  /** Vota (ou tira o voto) numa resposta: até VOTOS_RETRO por pessoa, não vale votar em si mesmo. */
  votar(id: string, respostaId: string): boolean {
    if (this.d.fase !== 'votacao' || !this.participa(id) || this.d.terminaramVoto.includes(id)) return false;
    const r = this.d.respostas.find((x) => x.id === respostaId);
    if (!r || r.autor === id) return false;
    const i = r.votos.indexOf(id);
    if (i >= 0) r.votos.splice(i, 1);
    else {
      if (this.votosUsados(id) >= VOTOS_RETRO) return false;
      r.votos.push(id);
    }
    return true;
  }

  votosUsados(id: string): number {
    return this.d.respostas.filter((r) => r.votos.includes(id)).length;
  }

  terminarVoto(id: string): boolean {
    if (this.d.fase !== 'votacao' || !this.participa(id) || this.d.terminaramVoto.includes(id)) return false;
    this.d.terminaramVoto.push(id);
    this.verificar();
    return true;
  }

  private encerrar(): void {
    this.d.fase = 'fim';
    this.d.placas = [];
    this.d.premiadas = [...this.d.respostas]
      .filter((r) => r.votos.length > 0)
      .sort((a, b) => b.votos.length - a.votos.length || a.pergunta - b.pergunta || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      .slice(0, XP_PREMIO.length)
      .map((r) => r.id);
  }

  /* ---------- Saída de emergência ---------- */

  /** Liga/desliga o voto para encerrar. Todos os presentes votaram: acaba sem pontos, com o relatório do que deu. */
  votarSair(id: string): boolean {
    if (this.d.fase === 'fim' || !this.participa(id)) return false;
    const i = this.d.querSair.indexOf(id);
    if (i >= 0) this.d.querSair.splice(i, 1);
    else this.d.querSair.push(id);
    if (this.todosPresentes((p) => this.d.querSair.includes(p))) {
      this.d.cancelada = true;
      this.encerrar();
    }
    return true;
  }

  /* ---------- Conexão ---------- */

  /** Caiu a conexão (ou saiu da sala): vira ausente e não segura mais ninguém. Devolve true se não sobrou ninguém. */
  ausente(id: string): boolean {
    if (!this.participa(id) || this.d.ausentes.includes(id)) return this.presentes().length === 0;
    this.d.ausentes.push(id);
    this.tirar(this.d.placas, id);
    this.tirar(this.d.placaAtual, id);
    const q = this.d.querSair.indexOf(id);
    if (q >= 0) this.d.querSair.splice(q, 1);
    const presentes = this.presentes();
    if (!presentes.length) return true;
    if (this.d.anfitriao === id) this.d.anfitriao = presentes[0];
    this.verificar();
    return false;
  }

  /** Voltou (reconectou ou abriu de novo): continua de onde estava. */
  voltou(id: string): boolean {
    const i = this.d.ausentes.indexOf(id);
    if (i < 0) return false;
    this.d.ausentes.splice(i, 1);
    // Na pergunta atual, quem volta recomeça "pensando" (a placa caiu junto com a conexão).
    if (this.d.fase === 'pergunta' && this.status(id) === 'levantada') this.por(this.d.status, id, 'pensando');
    return true;
  }

  /* ---------- Estado e resultado ---------- */

  estado(): EstadoRetro {
    const d = this.d;
    const todas = d.fase === 'votacao' || d.fase === 'fim';
    return {
      fase: d.fase,
      anfitriao: d.anfitriao,
      participantes: [...d.participantes],
      prontos: [...d.prontos],
      pergunta: d.pergunta,
      status: Object.fromEntries(d.participantes.map((p) => [p, this.status(p)])),
      placas: Object.fromEntries(d.placas),
      respostas: (todas ? d.respostas : d.respostas.filter((r) => r.pergunta === d.pergunta)).map((r) => ({ ...r, votos: [...r.votos] })),
      terminaramVoto: [...d.terminaramVoto],
      premiadas: [...d.premiadas],
      ausentes: [...d.ausentes],
      querSair: [...d.querSair],
      cancelada: d.cancelada,
    };
  }

  /** Pontos: todos ganham por participar; quem escreveu as 5 mais votadas ganha prêmio. Posição = votos recebidos. */
  resultado(): ResultadoJogador[] {
    const d = this.d;
    const xp = new Map(d.participantes.map((p) => [p, XP_PARTICIPAR]));
    const moedas = new Map(d.participantes.map((p) => [p, MOEDAS_PARTICIPAR]));
    d.premiadas.forEach((rid, i) => {
      const r = d.respostas.find((x) => x.id === rid)!;
      if (!xp.has(r.autor)) return;
      xp.set(r.autor, xp.get(r.autor)! + XP_PREMIO[i]);
      moedas.set(r.autor, moedas.get(r.autor)! + MOEDAS_PREMIO[i]);
    });
    const votos = new Map(d.participantes.map((p) => [p, d.respostas.filter((r) => r.autor === p).reduce((s, r) => s + r.votos.length, 0)]));
    const ordem = [...d.participantes].sort((a, b) => votos.get(b)! - votos.get(a)!);
    const res: ResultadoJogador[] = [];
    ordem.forEach((id, i) => {
      const posicao = i > 0 && votos.get(id) === votos.get(ordem[i - 1]) ? res[i - 1].posicao : i + 1;
      res.push({ id, posicao, pontos: votos.get(id)!, xp: xp.get(id)!, moedas: moedas.get(id)! });
    });
    return res;
  }
}
