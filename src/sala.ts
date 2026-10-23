// Uma sala da praça: até 12 pessoas conectadas por WebSocket, cada uma vira um boneco.
// O servidor guarda quem está na sala e repassa poses (em lotes, 10 por segundo), emotes e skins.
// Usa a API de hibernação: sem mensagens, a sala dorme e as conexões continuam abertas.
// Quem chega já vem identificado pelo Worker (perfil do token no D1), nos cabeçalhos X-Jogador-*.

import { DurableObject } from 'cloudflare:workers';
import { darXpPresenca, skinPermitida } from './perfis';
import { EMOTES, ENVIOS_POR_SEGUNDO, type Emote, type InfoSala, type Jogador, LIMITE_MUNDO, MAX_JOGADORES, type MotivoErro, type MsgCliente, type MsgServidor, type Pose } from './protocolo';

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
    }
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
      this.paraTodos({ k: 'poses', l });
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
    this.ctx.waitUntil(this.env.DIRETORIO.getByName('global').atualizar(codigo, n, true));
  }
}
