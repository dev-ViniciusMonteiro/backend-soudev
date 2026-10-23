// Sprint Review: retrospectiva com a sala inteira, tema de Halloween.
// Reunião (todos no centro e "pronto") → uma pergunta por vez (cada um levanta a placa com a resposta e baixa
// quando termina; todos baixaram = próxima) → votação (3 votos por pessoa) → relatório com as mais votadas.
// Lógica pura: a Sala chama os métodos e manda estado() para todos depois de cada mudança.

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

export class Retro {
  fase: FaseRetro = 'reuniao';
  anfitriao: string;
  readonly participantes: string[];
  private nomes: Map<string, string>;
  private prontos = new Set<string>();
  pergunta = 0;
  private status = new Map<string, StatusRetro>();
  private placas = new Map<string, string>(); // levantadas agora
  private placaAtual = new Map<string, string>(); // id da resposta que a placa levantada representa
  readonly respostas: RespostaRetro[] = [];
  private terminaramVoto = new Set<string>();
  private premiadas: string[] = [];
  private seq = 0;
  readonly inicio = Date.now();

  constructor(participantes: { id: string; nome: string }[], anfitriao: string) {
    this.participantes = participantes.map((p) => p.id);
    this.nomes = new Map(participantes.map((p) => [p.id, p.nome]));
    this.anfitriao = anfitriao;
  }

  private participa = (id: string): boolean => this.participantes.includes(id);

  /** Todos no centro clicaram "pronto": começa a primeira pergunta. Devolve se mudou algo. */
  pronto(id: string, noCentro: boolean): boolean {
    if (this.fase !== 'reuniao' || !this.participa(id) || !noCentro || this.prontos.has(id)) return false;
    this.prontos.add(id);
    if (this.participantes.every((p) => this.prontos.has(p))) this.irParaPergunta(0);
    return true;
  }

  private irParaPergunta(n: number): void {
    this.fase = 'pergunta';
    this.pergunta = n;
    this.placas.clear();
    this.placaAtual.clear();
    for (const p of this.participantes) this.status.set(p, 'pensando');
  }

  /** Levanta a placa com a resposta (ou troca o texto da placa que já está levantada). */
  levantar(id: string, bruto: unknown): boolean {
    if (this.fase !== 'pergunta' || !this.participa(id)) return false;
    const texto = limparResposta(bruto);
    if (!texto) return false;
    const atual = this.placaAtual.get(id);
    const r = atual && this.respostas.find((x) => x.id === atual);
    if (r) r.texto = texto;
    else {
      const nova: RespostaRetro = { id: `r${++this.seq}`, pergunta: this.pergunta, autor: id, nome: this.nomes.get(id) ?? '?', texto, votos: [] };
      this.respostas.push(nova);
      this.placaAtual.set(id, nova.id);
    }
    this.placas.set(id, texto);
    this.status.set(id, 'levantada');
    return true;
  }

  /** Baixa a placa (a resposta fica guardada). Se todos baixaram, vem a próxima pergunta. */
  baixar(id: string): boolean {
    if (this.fase !== 'pergunta' || this.status.get(id) !== 'levantada') return false;
    this.placas.delete(id);
    this.placaAtual.delete(id);
    this.status.set(id, 'baixada');
    this.talvezAvancar();
    return true;
  }

  /** Sem resposta para esta pergunta: conta como "baixou". */
  passar(id: string): boolean {
    if (this.fase !== 'pergunta' || !this.participa(id) || this.status.get(id) === 'baixada') return false;
    this.placas.delete(id);
    this.placaAtual.delete(id);
    this.status.set(id, 'baixada');
    this.talvezAvancar();
    return true;
  }

  private talvezAvancar(): void {
    if (this.participantes.every((p) => this.status.get(p) === 'baixada')) this.proxima();
  }

  private proxima(): void {
    if (this.pergunta + 1 < PERGUNTAS_RETRO.length) this.irParaPergunta(this.pergunta + 1);
    else {
      this.fase = 'votacao';
      this.placas.clear();
      this.placaAtual.clear();
    }
  }

  /** O anfitrião pode puxar o andamento (alguém sumiu do teclado). */
  avancar(id: string): boolean {
    if (id !== this.anfitriao) return false;
    if (this.fase === 'reuniao') this.irParaPergunta(0);
    else if (this.fase === 'pergunta') this.proxima();
    else if (this.fase === 'votacao') this.encerrar();
    else return false;
    return true;
  }

  /** Vota (ou tira o voto) numa resposta: até VOTOS_RETRO por pessoa, não vale votar em si mesmo. */
  votar(id: string, respostaId: string): boolean {
    if (this.fase !== 'votacao' || !this.participa(id) || this.terminaramVoto.has(id)) return false;
    const r = this.respostas.find((x) => x.id === respostaId);
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
    return this.respostas.filter((r) => r.votos.includes(id)).length;
  }

  terminarVoto(id: string): boolean {
    if (this.fase !== 'votacao' || !this.participa(id)) return false;
    this.terminaramVoto.add(id);
    if (this.participantes.every((p) => this.terminaramVoto.has(p))) this.encerrar();
    return true;
  }

  private encerrar(): void {
    this.fase = 'fim';
    this.premiadas = [...this.respostas]
      .filter((r) => r.votos.length > 0)
      .sort((a, b) => b.votos.length - a.votos.length || a.pergunta - b.pergunta || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      .slice(0, XP_PREMIO.length)
      .map((r) => r.id);
  }

  /** Alguém saiu da sala: sai da retro. Devolve true se não sobrou ninguém. */
  sair(id: string): boolean {
    const i = this.participantes.indexOf(id);
    if (i < 0) return false;
    this.participantes.splice(i, 1);
    this.prontos.delete(id);
    this.placas.delete(id);
    this.status.delete(id);
    this.terminaramVoto.delete(id);
    if (!this.participantes.length) return true;
    if (this.anfitriao === id) this.anfitriao = this.participantes[0];
    if (this.fase === 'reuniao' && this.participantes.every((p) => this.prontos.has(p))) this.irParaPergunta(0);
    else if (this.fase === 'pergunta') this.talvezAvancar();
    else if (this.fase === 'votacao' && this.participantes.every((p) => this.terminaramVoto.has(p))) this.encerrar();
    return false;
  }

  estado(): EstadoRetro {
    const todas = this.fase === 'votacao' || this.fase === 'fim';
    return {
      fase: this.fase,
      anfitriao: this.anfitriao,
      participantes: [...this.participantes],
      prontos: [...this.prontos],
      pergunta: this.pergunta,
      status: Object.fromEntries(this.status),
      placas: Object.fromEntries(this.placas),
      respostas: (todas ? this.respostas : this.respostas.filter((r) => r.pergunta === this.pergunta)).map((r) => ({ ...r, votos: [...r.votos] })),
      terminaramVoto: [...this.terminaramVoto],
      premiadas: [...this.premiadas],
    };
  }

  /** Pontos: todos ganham por participar; quem escreveu as 5 mais votadas ganha prêmio. Posição = votos recebidos. */
  resultado(): ResultadoJogador[] {
    const xp = new Map(this.participantes.map((p) => [p, XP_PARTICIPAR]));
    const moedas = new Map(this.participantes.map((p) => [p, MOEDAS_PARTICIPAR]));
    this.premiadas.forEach((rid, i) => {
      const r = this.respostas.find((x) => x.id === rid)!;
      if (!xp.has(r.autor)) return; // autor já saiu da sala
      xp.set(r.autor, xp.get(r.autor)! + XP_PREMIO[i]);
      moedas.set(r.autor, moedas.get(r.autor)! + MOEDAS_PREMIO[i]);
    });
    const votos = new Map(this.participantes.map((p) => [p, this.respostas.filter((r) => r.autor === p).reduce((s, r) => s + r.votos.length, 0)]));
    const ordem = [...this.participantes].sort((a, b) => votos.get(b)! - votos.get(a)!);
    const res: ResultadoJogador[] = [];
    ordem.forEach((id, i) => {
      const posicao = i > 0 && votos.get(id) === votos.get(ordem[i - 1]) ? res[i - 1].posicao : i + 1;
      res.push({ id, posicao, pontos: votos.get(id)!, xp: xp.get(id)!, moedas: moedas.get(id)! });
    });
    return res;
  }
}
