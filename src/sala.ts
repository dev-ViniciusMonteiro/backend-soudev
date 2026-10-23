// Uma sala da praça: até 12 pessoas conectadas por WebSocket, cada uma vira um boneco.
// O servidor guarda quem está na sala e repassa poses (em lotes, 10 por segundo), emotes e skins.
// Usa a API de hibernação: sem mensagens, a sala dorme e as conexões continuam abertas.
// Quem chega já vem identificado pelo Worker (perfil do token no D1), nos cabeçalhos X-Jogador-*.

import { DurableObject } from 'cloudflare:workers';
import { Partida } from './jogos';
import { darXpPresenca, registrarPartida, skinPermitida } from './perfis';
import { EMOTES, ENVIOS_POR_SEGUNDO, type Emote, type IdJogo, type InfoSala, JOGOS, type Jogador, LIMITE_MUNDO, MAX_JOGADORES, type MotivoErro, type MsgCliente, type MsgServidor, type Pose, RAIO_PORTAL, VISAO_BUSCADOR } from './protocolo';

const TICK_MS = 250; // regras dos jogos 4x por segundo
const IDS_JOGOS = Object.keys(JOGOS) as IdJogo[];

const SKIN_VALIDA = /^[\w:#|.,-]{0,200}$/;
const INTERVALO_MIN_POSE = 1000 / 30; // ignora quem manda mais de 30 poses por segundo

interface Config {
  codigo: string;
  publica: boolean;
}

/** O que fica preso a cada conexão (sobrevive à hibernação). */
interface Anexo extends Jogador {
  desde: number; // quando entrou, para o XP de presença
}

/** O que os outros jogadores veem (sem dados internos). */
const publico = ({ id, nome, nivel, skin, pose }: Anexo): Jogador => ({ id, nome, nivel, skin, pose });

const limitar = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Confere e arruma uma pose vinda do jogo; null se não for válida. */
export function poseValida(p: unknown): Pose | null {
  if (!Array.isArray(p) || p.length !== 5 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [x, y, z, r, a] = p as number[];
  const anim = Math.round(a);
  if (anim < 0 || anim > 3) return null;
  const arred = (v: number): number => Math.round(v * 100) / 100;
  return [arred(limitar(x, -LIMITE_MUNDO, LIMITE_MUNDO)), arred(limitar(y, -5, 30)), arred(limitar(z, -LIMITE_MUNDO, LIMITE_MUNDO)), arred(r % (Math.PI * 2)), anim as Pose[4]];
}

export class Sala extends DurableObject<Env> {
  private config: Config | null = null;
  private jogadores = new Map<WebSocket, Anexo>();
  private mexeram = new Set<WebSocket>();
  private ultimaPose = new WeakMap<WebSocket, number>();
  private envio: ReturnType<typeof setTimeout> | null = null;
  private partida: Partida | null = null;
  private relogio: ReturnType<typeof setInterval> | null = null;
  private ultimoEstado = 0;
  private filas = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Depois de hibernar, a memória volta vazia: recupera quem está conectado pelos anexos das conexões.
    for (const ws of ctx.getWebSockets()) {
      const j = ws.deserializeAttachment() as Anexo | null;
      if (j) this.jogadores.set(ws, j);
    }
    ctx.blockConcurrencyWhile(async () => {
      this.config = (await ctx.storage.get<Config>('config')) ?? null;
    });
  }

  /** Chamado pelo Worker ao criar a sala (pública pelo "Jogar", privada pelo "Criar sala"). */
  async configurar(codigo: string, publica: boolean): Promise<void> {
    if (this.config) return;
    this.config = { codigo, publica };
    await this.ctx.storage.put('config', this.config);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const codigo = url.pathname.split('/').pop() ?? '';
    // Sala aberta direto pelo código, sem passar pelo "Criar sala": vira privada.
    if (!this.config) await this.configurar(codigo, false);

    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);
    const recusar = (motivo: MotivoErro): Response => {
      this.ctx.acceptWebSocket(servidor);
      servidor.send(JSON.stringify({ k: 'erro', motivo } satisfies MsgServidor));
      servidor.close(4000, motivo);
      return new Response(null, { status: 101, webSocket: cliente });
    };

    const id = req.headers.get('X-Jogador-Id') ?? '';
    if (!id) return recusar('invalida');
    // Partida rolando: a sala fica fechada para gente nova (quem caiu e é participante pode voltar).
    if (this.partida && !this.partida.participantes.includes(id)) return recusar('fechada');

    // A mesma pessoa abrindo de novo (outra aba, reconexão): a conexão antiga sai.
    for (const [ws, j] of this.jogadores) {
      if (j.id === id) {
        this.remover(ws);
        try {
          ws.send(JSON.stringify({ k: 'erro', motivo: 'duplicado' } satisfies MsgServidor));
          ws.close(4000, 'duplicado');
        } catch {
          /* já fechada */
        }
      }
    }
    if (this.jogadores.size >= MAX_JOGADORES) return recusar('cheia');

    const j: Anexo = {
      id,
      nome: decodeURIComponent(req.headers.get('X-Jogador-Nome') ?? 'Visitante'),
      nivel: Number(req.headers.get('X-Jogador-Nivel')) || 1,
      skin: decodeURIComponent(req.headers.get('X-Jogador-Skin') ?? ''),
      pose: [(Math.random() - 0.5) * 6, 0, 8 + Math.random() * 3, Math.PI, 0],
      desde: Date.now(),
    };
    this.ctx.acceptWebSocket(servidor);
    servidor.serializeAttachment(j);
    this.jogadores.set(servidor, j);

    const sala: InfoSala = { codigo: this.config!.codigo, publica: this.config!.publica, max: MAX_JOGADORES };
    servidor.send(JSON.stringify({ k: 'bemvindo', eu: id, sala, jogadores: [...this.jogadores.values()].map(publico) } satisfies MsgServidor));
    if (this.partida) servidor.send(JSON.stringify({ k: 'partida', p: this.partida.estado(Date.now()) } satisfies MsgServidor));
    this.paraTodos({ k: 'entrou', j: publico(j) }, servidor);
    this.avisarDiretorio();
    return new Response(null, { status: 101, webSocket: cliente });
  }

  async webSocketMessage(ws: WebSocket, dados: string | ArrayBuffer): Promise<void> {
    const j = this.jogadores.get(ws);
    if (!j || typeof dados !== 'string' || dados.length > 1000) return;
    let m: MsgCliente;
    try {
      m = JSON.parse(dados) as MsgCliente;
    } catch {
      return;
    }
    if (m.k === 'pose') {
      const agora = Date.now();
      if (agora - (this.ultimaPose.get(ws) ?? 0) < INTERVALO_MIN_POSE) return;
      const p = poseValida(m.p);
      if (!p) return;
      // Quem procura no esconde-esconde fica parado enquanto os outros escondem.
      if (this.partida && !this.partida.podeMover(j.id)) return;
      this.ultimaPose.set(ws, agora);
      j.pose = p;
      this.mexeram.add(ws);
      this.agendarEnvio();
    } else if (m.k === 'emote' && EMOTES.includes(m.e as Emote)) {
      this.paraTodos({ k: 'emote', id: j.id, e: m.e }, ws);
    } else if (m.k === 'skin' && typeof m.s === 'string' && SKIN_VALIDA.test(m.s)) {
      // Itens bloqueados por nível/conquista não passam (o banco confere e já salva no perfil).
      const s = m.s;
      if (!(await skinPermitida(this.env.DB, j.id, s))) {
        ws.send(JSON.stringify({ k: 'erro', motivo: 'bloqueado' } satisfies MsgServidor));
        return;
      }
      j.skin = s;
      ws.serializeAttachment(j);
      this.paraTodos({ k: 'skin', id: j.id, s }, ws);
    } else if (m.k === 'iniciar') {
      this.iniciar(j.id, m.jogo);
    }
  }

  /* ---------- Jogos ---------- */

  /** Quem está dentro de cada portal (só fora de partida). */
  private calcularFilas(): Partial<Record<IdJogo, string[]>> {
    const f: Partial<Record<IdJogo, string[]>> = {};
    if (this.partida) return f;
    for (const jogo of IDS_JOGOS) {
      const [px, pz] = JOGOS[jogo].portal;
      const ids = [...this.jogadores.values()].filter((j) => Math.hypot(j.pose[0] - px, j.pose[2] - pz) <= RAIO_PORTAL && j.pose[1] < 2).map((j) => j.id);
      if (ids.length) f[jogo] = ids;
    }
    return f;
  }

  /** Manda as filas só quando mudam. */
  private atualizarFilas(): void {
    const f = this.calcularFilas();
    const texto = JSON.stringify(f);
    if (texto === this.filas) return;
    this.filas = texto;
    this.paraTodos({ k: 'filas', f });
  }

  private iniciar(quem: string, jogo: IdJogo): void {
    if (this.partida || !JOGOS[jogo]) return;
    const fila = this.calcularFilas()[jogo] ?? [];
    if (!fila.includes(quem) || fila.length < JOGOS[jogo].min) return;
    const agora = Date.now();
    this.partida = new Partida(jogo, fila, agora, Number(this.env.DURACAO_FATOR || 1));
    this.filas = '';
    this.ultimoEstado = agora;
    this.paraTodos({ k: 'partida', p: this.partida.estado(agora) });
    this.avisarDiretorio(); // fecha a sala no "Jogar"
    this.relogio = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const p = this.partida;
    if (!p) return;
    const agora = Date.now();
    const pos = new Map([...this.jogadores.values()].map((j) => [j.id, { x: j.pose[0], y: j.pose[1], z: j.pose[2] }]));
    const { eventos, acabou, mudouFase } = p.tick(agora, pos);
    for (const e of eventos) this.paraTodos(e);
    if (acabou) {
      void this.terminar();
      return;
    }
    // Estado completo a cada segundo, ou na hora quando algo muda.
    if (eventos.length || mudouFase || agora - this.ultimoEstado >= 1000) {
      this.ultimoEstado = agora;
      this.paraTodos({ k: 'partida', p: p.estado(agora) });
    }
  }

  private async terminar(cancelada = false): Promise<void> {
    const p = this.partida;
    if (!p) return;
    this.partida = null;
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
    this.paraTodos({ k: 'partida', p: null });
    this.avisarDiretorio(); // reabre a sala
    this.atualizarFilas();
    if (cancelada || p.fase !== 'jogando') return;
    const res = p.resultado();
    const nomes = new Map([...this.jogadores.values()].map((j) => [j.id, j.nome]));
    let conquistas: Record<string, string[]> = {};
    try {
      conquistas = await registrarPartida(this.env.DB, { jogo: p.jogo, sala: this.config?.codigo ?? '', inicio: p.inicio, fim: Date.now(), resultados: res });
    } catch (e) {
      console.error('registrar partida', e);
    }
    this.paraTodos({ k: 'resultado', jogo: p.jogo, l: res.map((r) => ({ ...r, nome: nomes.get(r.id) ?? '?' })), conquistas });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.remover(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* já fechada */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.remover(ws);
  }

  private remover(ws: WebSocket): void {
    const j = this.jogadores.get(ws);
    if (!j) return;
    this.jogadores.delete(ws);
    this.mexeram.delete(ws);
    this.paraTodos({ k: 'saiu', id: j.id });
    this.avisarDiretorio();
    // Saiu no meio da partida: sai dela também; sem gente suficiente (ou sem quem procura), acaba.
    if (this.partida?.sair(j.id)) void this.terminar(this.partida.participantes.length < 2);
    else this.atualizarFilas();
    // XP de presença: 1 por minuto na praça (o limite diário fica no banco).
    const minutos = (Date.now() - j.desde) / Number(this.env.PRESENCA_MS || 60000);
    if (minutos >= 1) this.ctx.waitUntil(darXpPresenca(this.env.DB, j.id, minutos).catch((e) => console.error('xp de presença', e)));
  }

  /** Junta as poses e manda um lote só (menos mensagens = mais barato e mais leve). */
  private agendarEnvio(): void {
    if (this.envio) return;
    this.envio = setTimeout(() => {
      this.envio = null;
      if (!this.mexeram.size) return;
      const l: [string, ...Pose][] = [];
      for (const ws of this.mexeram) {
        const j = this.jogadores.get(ws);
        if (!j) continue;
        l.push([j.id, ...j.pose]);
        ws.serializeAttachment(j);
      }
      this.mexeram.clear();
      const p = this.partida;
      if (p?.jogo === 'esconde-esconde' && p.buscador && p.fase !== 'contagem') {
        // Quem procura só recebe a posição de quem ainda está escondido se estiver no alcance da lanterna.
        const b = [...this.jogadores.values()].find((j) => j.id === p.buscador);
        const escondidos = new Set(p.escondidos());
        const longe = (x: [string, ...Pose]): boolean => escondidos.has(x[0]) && (!b || Math.hypot(x[1] - b.pose[0], x[3] - b.pose[2]) > VISAO_BUSCADOR);
        const texto = JSON.stringify({ k: 'poses', l } satisfies MsgServidor);
        const textoBuscador = JSON.stringify({ k: 'poses', l: l.filter((x) => !longe(x)) } satisfies MsgServidor);
        for (const [ws, j] of this.jogadores) {
          try {
            ws.send(j.id === p.buscador ? textoBuscador : texto);
          } catch {
            /* conexão caindo */
          }
        }
      } else this.paraTodos({ k: 'poses', l });
      this.atualizarFilas();
    }, 1000 / ENVIOS_POR_SEGUNDO);
  }

  private paraTodos(m: MsgServidor, exceto?: WebSocket): void {
    const texto = JSON.stringify(m);
    for (const ws of this.jogadores.keys()) {
      if (ws === exceto) continue;
      try {
        ws.send(texto);
      } catch {
        /* conexão caindo: o close remove */
      }
    }
  }

  private avisarDiretorio(): void {
    if (!this.config?.publica) return;
    const { codigo } = this.config;
    const n = this.jogadores.size;
    this.ctx.waitUntil(this.env.DIRETORIO.getByName('global').atualizar(codigo, n, !this.partida));
  }
}
