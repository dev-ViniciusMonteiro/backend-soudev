// Uma sala da praça: até 12 pessoas conectadas por WebSocket, cada uma vira um boneco.
// O servidor guarda quem está na sala e repassa poses (em lotes, 10 por segundo), emotes e skins.
// Usa a API de hibernação: sem mensagens, a sala dorme e as conexões continuam abertas.
// Quem chega já vem identificado pelo Worker (perfil do token no D1), nos cabeçalhos X-Jogador-*.

import { DurableObject } from 'cloudflare:workers';
import { Partida } from './jogos';
import { MataMata, type PosMM } from './matamata';
import { Corrida } from './corrida';
import { Truco, VinteUm } from './cartas';
import { Poker, Roleta, girarSlot } from './cassino';
import { darXpPresenca, moverMoedas, registrarPartida, saldoMoedas, skinPermitida } from './perfis';
import { ALCANCE_CARRO, ALCANCE_MESA, ALCANCE_ROLETA, ALCANCE_SLOT, APOSTAS_SLOT, Anim, ROLETA, SLOTS, premioSlot, CARROS, DOMO, MESAS, type TipoMesa, LUGARES_CARRO, EMOTES, ENVIOS_POR_SEGUNDO, type Emote, type EstadoCarro, type IdJogo, type InfoSala, JOGOS, type Jogador, LIMITE_MUNDO, MAX_JOGADORES, type MotivoErro, SKIN_VALIDA, type MsgCliente, type MsgServidor, type Pose, RAIO_PORTAL, dentroDoPredio, posInicialPraca, predioDoJogo, VISAO_BUSCADOR } from './protocolo';
import { Retro } from './retro';

interface Carro {
  x: number;
  z: number;
  rot: number;
  motorista: string | null;
  passageiros: string[];
}

const TICK_MS = 250; // regras dos jogos 4x por segundo
const IDS_JOGOS = Object.keys(JOGOS) as IdJogo[];

const INTERVALO_MIN_POSE = 1000 / 30; // ignora quem manda mais de 30 poses por segundo

interface Config {
  codigo: string;
  publica: boolean;
}

/** O que fica preso a cada conexão (sobrevive à hibernação). */
interface Anexo extends Jogador {
  desde: number; // quando entrou, para o XP de presença
  carro?: number; // carro em que está (dirigindo ou de passageiro)
  passageiro?: boolean;
}

/** O que os outros jogadores veem (sem dados internos). */
const publico = ({ id, nome, nivel, skin, pose }: Anexo): Jogador => ({ id, nome, nivel, skin, pose });

const limitar = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Confere e arruma uma pose vinda do jogo; null se não for válida. */
export function poseValida(p: unknown): Pose | null {
  if (!Array.isArray(p) || p.length !== 5 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [x, y, z, r, a] = p as number[];
  const anim = Math.round(a);
  if (anim < 0 || anim > Anim.Dirigindo) return null;
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
  private retro: Retro | null = null;
  private mm: MataMata | null = null;
  private relogioMM: ReturnType<typeof setInterval> | null = null;
  private ultimoEstadoMM = 0;
  private corrida: Corrida | null = null;
  private relogioCorrida: ReturnType<typeof setInterval> | null = null;
  private ultimoEstadoCorrida = 0;
  private bj: VinteUm | null = null;
  private truco: Truco | null = null;
  private trucoPago = false;
  private poker: Poker | null = null;
  private roleta: Roleta | null = null;
  private ultimoSlot = new Map<string, number>();
  private relogioMesas: ReturnType<typeof setTimeout> | null = null;
  private carros: Carro[] = CARROS.map((c) => ({ x: c.x, z: c.z, rot: c.rot, motorista: null, passageiros: [] }));

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Depois de hibernar, a memória volta vazia: recupera quem está conectado pelos anexos das conexões.
    for (const ws of ctx.getWebSockets()) {
      const j = ws.deserializeAttachment() as Anexo | null;
      if (!j) continue;
      this.jogadores.set(ws, j);
      const c = j.carro !== undefined ? this.carros[j.carro] : undefined;
      if (c && j.passageiro) c.passageiros.push(j.id);
      else if (c) Object.assign(c, { x: j.pose[0], z: j.pose[2], rot: j.pose[3], motorista: j.id });
    }
    ctx.blockConcurrencyWhile(async () => {
      this.config = (await ctx.storage.get<Config>('config')) ?? null;
      // A retro fica guardada: a sala hiberna se todos ficam parados digitando, e a memória some.
      const retro = await ctx.storage.get<Parameters<typeof Retro.restaurar>[0]>('retro');
      if (retro) this.retro = Retro.restaurar(retro);
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
    // Partida ou Sprint Retro rolando: a sala fica fechada para gente nova (quem caiu e participa pode voltar).
    if (this.partida && !this.partida.participantes.includes(id)) return recusar('fechada');
    if (this.retro && !this.retro.participantes.includes(id)) return recusar('fechada');
    if (this.mm && !this.mm.jogadores.has(id)) return recusar('fechada');
    if (this.corrida && !this.corrida.corredores.has(id)) return recusar('fechada');

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
    // Voltou para a retro (reconectou ou abriu de novo): continua de onde estava.
    if (this.retro?.voltou(id)) this.retroMudou();
    else if (this.retro) servidor.send(JSON.stringify({ k: 'retro', r: this.retro.estado() } satisfies MsgServidor));
    servidor.send(JSON.stringify({ k: 'carros', l: this.estadoCarros() } satisfies MsgServidor));
    if (this.mm) servidor.send(JSON.stringify({ k: 'mm', e: this.mm.estado(Date.now()) } satisfies MsgServidor));
    if (this.corrida) servidor.send(JSON.stringify({ k: 'corrida', e: this.corrida.estado(Date.now()) } satisfies MsgServidor));
    if (this.bj) servidor.send(JSON.stringify({ k: 'bj', e: this.bj.estado(Date.now()) } satisfies MsgServidor));
    if (this.poker) servidor.send(JSON.stringify({ k: 'poker', e: this.poker.estado(Date.now()) } satisfies MsgServidor));
    if (this.roleta) servidor.send(JSON.stringify({ k: 'roleta', e: this.roleta.estado(Date.now()) } satisfies MsgServidor));
    if (this.truco) {
      servidor.send(JSON.stringify({ k: 'truco', e: this.truco.estado(Date.now()) } satisfies MsgServidor));
      const mao = this.truco.maoDe(id);
      if (mao.length) servidor.send(JSON.stringify({ k: 'trucoMao', cartas: mao } satisfies MsgServidor));
    }
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
      // "Dirigindo" só vale para quem está mesmo num carro; o carro anda junto com a pose de quem dirige.
      const c = j.carro !== undefined ? this.carros[j.carro] : undefined;
      if (p[4] === Anim.Dirigindo && !c) p[4] = Anim.Parado;
      // Passageiro não move o carro: vai junto com ele.
      if (c && j.passageiro) return;
      if (c) {
        Object.assign(c, { x: p[0], z: p[2], rot: p[3] });
        for (const [, o] of this.jogadores) if (c.passageiros.includes(o.id)) o.pose = [p[0], p[1], p[2], p[3], Anim.Dirigindo];
      }
      this.ultimaPose.set(ws, agora);
      j.pose = p;
      if (this.corrida?.pose(j.id, p[0], p[2], agora)) this.enviarCorrida(agora);
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
    } else if (this.mm?.jogadores.has(j.id) && (m.k === 'comprar' || m.k === 'empunhar' || m.k === 'recarregar' || m.k === 'tiro')) {
      this.acaoMM(j, m);
    } else if (m.k === 'mesa' || m.k === 'bj' || m.k === 'truco' || m.k === 'poker' || m.k === 'roleta' || m.k === 'slot') {
      await this.acaoMesa(ws, j, m);
    } else if (m.k === 'iniciar') {
      this.iniciar(j.id, m.jogo);
    } else if (m.k === 'carro') {
      this.entrarNoCarro(ws, j, m.c);
    } else if (m.k === 'sairCarro') {
      this.sairDoCarro(j);
      ws.serializeAttachment(j);
    } else if (this.retro && (m.k === 'placa' || m.k === 'retro' || m.k === 'voto')) {
      const r = this.retro;
      let mudou = false;
      if (m.k === 'placa') mudou = r.levantar(j.id, m.t);
      else if (m.k === 'voto') mudou = typeof m.r === 'string' && r.votar(j.id, m.r);
      else if (m.a === 'pronto') mudou = r.pronto(j.id, dentroDoPredio(predioDoJogo('sprint-retro')!, j.pose[0], j.pose[2]));
      else if (m.a === 'baixar') mudou = r.baixar(j.id);
      else if (m.a === 'passar') mudou = r.passar(j.id);
      else if (m.a === 'avancar') mudou = r.avancar(j.id);
      else if (m.a === 'terminarVoto') mudou = r.terminarVoto(j.id);
      else if (m.a === 'sair') mudou = r.votarSair(j.id);
      if (mudou) this.retroMudou();
    }
  }

  /* ---------- Mesas de cartas ---------- */

  /** Mexe nas moedas do perfil; false se não tem saldo (ou o banco falhou). */
  private moedas = async (id: string, valor: number, motivo: string): Promise<boolean> => {
    try {
      await moverMoedas(this.env.DB, id, valor, motivo);
      return true;
    } catch {
      return false;
    }
  };

  private erroMesa(ws: WebSocket, mesa: TipoMesa | 'roleta' | 'slot', texto: string | null | false): void {
    if (texto) ws.send(JSON.stringify({ k: 'mesaErro', mesa, texto } satisfies MsgServidor));
  }

  private async acaoMesa(ws: WebSocket, j: Anexo, m: MsgCliente): Promise<void> {
    const agora = Date.now();
    if (m.k === 'mesa') {
      const tipo: TipoMesa = m.mesa === 'truco' || m.mesa === 'poker' ? m.mesa : '21';
      if (m.a === 'sentar') {
        const [mx, mz] = MESAS[tipo];
        if (Math.hypot(j.pose[0] - mx, j.pose[2] - mz) > ALCANCE_MESA) return this.erroMesa(ws, tipo, 'Chegue perto da mesa para sentar.');
        if (tipo === 'poker') {
          this.poker ??= new Poker();
          if (!this.poker.sentar(j.id, agora)) return this.erroMesa(ws, tipo, 'A mesa de poker está cheia.');
        } else if (tipo === '21') {
          this.bj ??= new VinteUm(agora);
          if (!this.bj.sentar(j.id)) return this.erroMesa(ws, tipo, 'A mesa está cheia.');
        } else {
          this.truco ??= new Truco();
          if (!this.truco.sentar(j.id)) return this.erroMesa(ws, tipo, 'A mesa está cheia ou a partida já começou.');
          this.trucoPago = false;
        }
      } else if (m.a === 'levantar') this.levantarDasMesas(j.id, tipo);
      else if (m.a === 'comecar' && tipo === 'truco' && this.truco) {
        const erro = await this.truco.comecar(j.id, m.aposta, this.moedas);
        this.trucoPago = false;
        this.erroMesa(ws, tipo, erro);
      }
    } else if (m.k === 'bj' && this.bj) {
      const erro = m.a === 'apostar' ? await this.bj.apostar(j.id, m.v, this.moedas) : await this.bj.acao(j.id, m.a, this.moedas);
      this.erroMesa(ws, '21', erro);
    } else if (m.k === 'truco' && this.truco) {
      let erro: string | null = null;
      if (m.a === 'jogar') erro = this.truco.jogar(j.id, m.i, m.encoberta, agora);
      else if (m.a === 'trucar') erro = this.truco.trucar(j.id, agora);
      else erro = this.truco.responder(j.id, m.a === 'aceitar', agora);
      this.erroMesa(ws, 'truco', erro);
    } else if (m.k === 'poker' && this.poker) {
      this.erroMesa(ws, 'poker', this.poker.acao(j.id, m.a, 'v' in m ? m.v : 0, agora));
      await this.pagarPoker();
    } else if (m.k === 'roleta') {
      if (Math.hypot(j.pose[0] - ROLETA[0], j.pose[2] - ROLETA[1]) > ALCANCE_ROLETA) return this.erroMesa(ws, 'roleta', 'Chegue perto da roleta para apostar.');
      this.roleta ??= new Roleta();
      this.erroMesa(ws, 'roleta', await this.roleta.apostar(j.id, m.tipo, m.alvo, m.v, agora, this.moedas));
    } else if (m.k === 'slot') {
      await this.girarSlot(ws, j, m.v, agora);
      return;
    }
    this.enviarMesas();
    this.armarRelogioMesas();
  }

  /** Caça-níquel: só para quem girou (perto de uma máquina, no máximo um giro a cada 1,2 s). */
  private async girarSlot(ws: WebSocket, j: Anexo, v: unknown, agora: number): Promise<void> {
    if (!SLOTS.some(([x, z]) => Math.hypot(j.pose[0] - x, j.pose[2] - z) <= ALCANCE_SLOT)) return this.erroMesa(ws, 'slot', 'Chegue perto de uma máquina.');
    const aposta = Number(v);
    if (!(APOSTAS_SLOT as readonly number[]).includes(aposta)) return this.erroMesa(ws, 'slot', 'Aposta inválida.');
    if (agora - (this.ultimoSlot.get(j.id) ?? 0) < 1200) return;
    this.ultimoSlot.set(j.id, agora);
    if (!(await this.moedas(j.id, -aposta, 'aposta:slot'))) return this.erroMesa(ws, 'slot', 'Moedas insuficientes.');
    const rolos = girarSlot();
    const ganho = premioSlot(rolos) * aposta;
    if (ganho > 0) await this.moedas(j.id, ganho, 'premio:slot');
    ws.send(JSON.stringify({ k: 'slot', rolos, aposta, ganho } satisfies MsgServidor));
  }

  /** Credita o que o poker tem para devolver (sobras, prêmios, quem levantou). */
  private async pagarPoker(): Promise<void> {
    if (!this.poker) return;
    const l = this.poker.pagamentos.splice(0);
    for (const [id, v, motivo] of l) await this.moedas(id, v, motivo);
  }

  private levantarDasMesas(id: string, so?: TipoMesa): void {
    if ((!so || so === 'poker') && this.poker?.levantar(id)) void this.pagarPoker();
    if ((!so || so === '21') && this.bj) this.bj.levantar(id);
    if ((!so || so === 'truco') && this.truco && this.truco.levantar(id) === 'abandonou') void this.pagarTruco();
    this.enviarMesas();
  }

  private async pagarTruco(): Promise<void> {
    if (!this.truco || this.trucoPago) return;
    this.trucoPago = true;
    await this.truco.pagar(this.moedas);
  }

  /** Estado das mesas para todos; as cartas do truco, só para o dono de cada mão. */
  private enviarMesas(): void {
    const agora = Date.now();
    if (this.bj?.vazia) this.bj = null;
    if (this.truco?.vazia) this.truco = null;
    if (this.poker?.vazia && !this.poker.pagamentos.length) this.poker = null;
    if (this.roleta?.parada) this.roleta = null;
    this.paraTodos({ k: 'bj', e: this.bj?.estado(agora) ?? null });
    this.paraTodos({ k: 'truco', e: this.truco?.estado(agora) ?? null });
    this.paraTodos({ k: 'poker', e: this.poker?.estado(agora) ?? null });
    this.paraTodos({ k: 'roleta', e: this.roleta?.estado(agora) ?? null });
    if (this.poker)
      for (const [ws, j] of this.jogadores) {
        if (!this.poker.lugares.includes(j.id)) continue;
        try {
          ws.send(JSON.stringify({ k: 'pokerMao', cartas: this.poker.maoDe(j.id) } satisfies MsgServidor));
        } catch {
          /* caindo */
        }
      }
    if (this.truco)
      for (const [ws, j] of this.jogadores) {
        if (!this.truco.lugares.includes(j.id)) continue;
        try {
          ws.send(JSON.stringify({ k: 'trucoMao', cartas: this.truco.maoDe(j.id) } satisfies MsgServidor));
        } catch {
          /* caindo */
        }
      }
  }

  /** Relógio das mesas: um setTimeout novo a cada volta (cada um segura a sala em memória por até 15 min). */
  private armarRelogioMesas(): void {
    if (this.relogioMesas || (!this.bj && !this.truco && !this.poker && !this.roleta)) return;
    this.relogioMesas = setTimeout(async () => {
      this.relogioMesas = null;
      const agora = Date.now();
      let mudou = false;
      if (this.bj) mudou = (await this.bj.tick(agora, this.moedas)) || mudou;
      if (this.roleta) mudou = (await this.roleta.tick(agora, this.moedas)) || mudou;
      if (this.poker) {
        if (this.poker.podeComecar(agora)) {
          await this.poker.comecarMao(agora, (id) => saldoMoedas(this.env.DB, id).catch(() => 0), this.moedas);
          mudou = true;
        } else mudou = this.poker.tick(agora) || mudou;
        await this.pagarPoker();
      }
      if (this.truco) {
        mudou = this.truco.tick(agora) || mudou;
        if (this.truco.fase === 'fim' && !this.trucoPago) {
          await this.pagarTruco();
          mudou = true;
        }
      }
      // Relógio da vez e da aposta: manda o estado de tempos em tempos mesmo sem mudança.
      if (mudou || Math.floor(agora / 1000) % 2 === 0) this.enviarMesas();
      this.armarRelogioMesas();
    }, 500);
  }

  /* ---------- Corrida ---------- */

  private enviarCorrida(agora: number): void {
    if (!this.corrida) return;
    this.ultimoEstadoCorrida = agora;
    this.paraTodos({ k: 'corrida', e: this.corrida.estado(agora) });
  }

  private tickCorrida(): void {
    const c = this.corrida;
    if (!c) return;
    const agora = Date.now();
    const { mudou, acabou } = c.tick(agora);
    if (acabou) {
      void this.terminarCorrida(true);
      return;
    }
    if (mudou || agora - this.ultimoEstadoCorrida >= 1000) this.enviarCorrida(agora);
  }

  private async terminarCorrida(comResultado: boolean): Promise<void> {
    const c = this.corrida;
    if (!c) return;
    this.corrida = null;
    if (this.relogioCorrida) clearInterval(this.relogioCorrida);
    this.relogioCorrida = null;
    this.paraTodos({ k: 'corrida', e: null });
    this.avisarDiretorio();
    this.atualizarFilas();
    if (!comResultado || c.fase !== 'correndo') return;
    const res = c.resultado();
    const nomes = new Map([...this.jogadores.values()].map((j) => [j.id, j.nome]));
    let conquistas: Record<string, string[]> = {};
    try {
      conquistas = await registrarPartida(this.env.DB, { jogo: 'corrida', sala: this.config?.codigo ?? '', inicio: c.inicio, fim: Date.now(), resultados: res });
    } catch (e) {
      console.error('registrar corrida', e);
    }
    this.paraTodos({ k: 'resultado', jogo: 'corrida', l: res.map((x) => ({ ...x, nome: nomes.get(x.id) ?? '?' })), conquistas });
  }

  /* ---------- Mata-mata ---------- */

  /** Posições dos jogadores relativas ao centro do domo. */
  private posicoesMM(): Map<string, PosMM> {
    return new Map([...this.jogadores.values()].map((j) => [j.id, { x: j.pose[0] - DOMO[0], y: j.pose[1], z: j.pose[2] - DOMO[1] }]));
  }

  private acaoMM(j: Anexo, m: MsgCliente): void {
    const mm = this.mm!;
    const agora = Date.now();
    let mudou = false;
    if (m.k === 'comprar') mudou = mm.comprar(j.id, String(m.item), agora);
    else if (m.k === 'empunhar') mudou = mm.empunhar(j.id, m.slot);
    else if (m.k === 'recarregar') mudou = mm.recarregar(j.id, agora);
    else if (m.k === 'tiro') {
      const eventos = mm.atirar(j.id, m.d, m.alvo, m.cabeca, this.posicoesMM(), agora);
      for (const e of eventos) this.paraTodos(e);
      mudou = eventos.some((e) => e.k !== 'tiro');
    }
    if (mudou) this.enviarMM(agora);
  }

  private enviarMM(agora: number): void {
    if (!this.mm) return;
    this.ultimoEstadoMM = agora;
    this.paraTodos({ k: 'mm', e: this.mm.estado(agora) });
  }

  private tickMM(): void {
    const mm = this.mm;
    if (!mm) return;
    const agora = Date.now();
    const { mudou, acabou } = mm.tick(agora);
    if (acabou) {
      void this.terminarMM(true);
      return;
    }
    // Estado completo a cada segundo (relógio e munição) ou na hora quando muda de fase.
    if (mudou || agora - this.ultimoEstadoMM >= 1000) this.enviarMM(agora);
  }

  private async terminarMM(comResultado: boolean): Promise<void> {
    const mm = this.mm;
    if (!mm) return;
    this.mm = null;
    if (this.relogioMM) clearInterval(this.relogioMM);
    this.relogioMM = null;
    this.paraTodos({ k: 'mm', e: null });
    this.avisarDiretorio();
    this.atualizarFilas();
    if (!comResultado || !mm.vencedor) return;
    const res = mm.resultado();
    const nomes = new Map([...this.jogadores.values()].map((j) => [j.id, j.nome]));
    let conquistas: Record<string, string[]> = {};
    try {
      conquistas = await registrarPartida(this.env.DB, { jogo: 'mata-mata', sala: this.config?.codigo ?? '', inicio: mm.inicio, fim: Date.now(), resultados: res });
    } catch (e) {
      console.error('registrar mata-mata', e);
    }
    this.paraTodos({ k: 'resultado', jogo: 'mata-mata', l: res.map((x) => ({ ...x, nome: nomes.get(x.id) ?? '?' })), conquistas });
  }

  /* ---------- Carros ---------- */

  private estadoCarros(): EstadoCarro[] {
    return this.carros.map((c, i) => [i, Math.round(c.x * 100) / 100, Math.round(c.z * 100) / 100, Math.round(c.rot * 100) / 100, c.motorista ?? '', [...c.passageiros]]);
  }

  private entrarNoCarro(ws: WebSocket, j: Anexo, n: unknown): void {
    const c = typeof n === 'number' ? this.carros[n] : undefined;
    if (!c || j.carro !== undefined) return;
    // Durante uma partida, quem está jogando não pega carro (no pega-pega seria trapaça).
    if (this.partida?.participantes.includes(j.id)) return;
    if (Math.hypot(j.pose[0] - c.x, j.pose[2] - c.z) > ALCANCE_CARRO) return;
    // Volante livre: dirige. Senão, vai de passageiro se tiver lugar.
    if (!c.motorista) {
      c.motorista = j.id;
      j.passageiro = false;
    } else if (c.passageiros.length < LUGARES_CARRO - 1) {
      c.passageiros.push(j.id);
      j.passageiro = true;
    } else return;
    j.carro = n as number;
    j.pose = [c.x, 0, c.z, c.rot, Anim.Dirigindo];
    ws.serializeAttachment(j);
    this.paraTodos({ k: 'carros', l: this.estadoCarros() });
  }

  private sairDoCarro(j: Anexo): void {
    const c = j.carro !== undefined ? this.carros[j.carro] : undefined;
    if (!c) return;
    if (j.passageiro) c.passageiros = c.passageiros.filter((p) => p !== j.id);
    else c.motorista = null;
    j.carro = undefined;
    j.passageiro = false;
    if (j.pose[4] === Anim.Dirigindo) j.pose[4] = Anim.Parado;
    this.paraTodos({ k: 'carros', l: this.estadoCarros() });
  }

  /* ---------- Sprint Retro ---------- */

  private retroMudou(): void {
    const r = this.retro;
    if (!r) return;
    // Guarda antes de avisar (se a sala hibernar, volta igual).
    this.ctx.waitUntil(r.fase === 'fim' ? this.ctx.storage.delete('retro') : this.ctx.storage.put('retro', r.serializar()));
    this.paraTodos({ k: 'retro', r: r.estado() });
    if (r.fase === 'fim') void this.terminarRetro();
  }

  /** Alarme: retro sem ninguém conectado há 1 minuto é cancelada (senão a sala ficaria fechada para sempre). */
  async alarm(): Promise<void> {
    if (this.retro && this.retro.presentes().length === 0) this.cancelarRetro();
  }

  private cancelarRetro(): void {
    this.retro = null;
    this.ctx.waitUntil(this.ctx.storage.delete('retro'));
    this.paraTodos({ k: 'retro', r: null });
    this.avisarDiretorio();
  }

  private async terminarRetro(): Promise<void> {
    const r = this.retro;
    if (!r) return;
    this.retro = null;
    this.avisarDiretorio(); // reabre a sala
    this.atualizarFilas();
    // O relatório final (fase "fim") já foi enviado; aqui só ficam os pontos (encerrada por votação: sem pontos).
    if (r.cancelada) return;
    const res = r.resultado();
    const nomes = new Map([...this.jogadores.values()].map((j) => [j.id, j.nome]));
    let conquistas: Record<string, string[]> = {};
    try {
      conquistas = await registrarPartida(this.env.DB, { jogo: 'sprint-retro', sala: this.config?.codigo ?? '', inicio: r.inicio, fim: Date.now(), resultados: res });
    } catch (e) {
      console.error('registrar sprint review', e);
    }
    this.paraTodos({ k: 'resultado', jogo: 'sprint-retro', l: res.map((x) => ({ ...x, nome: nomes.get(x.id) ?? '?' })), conquistas });
  }

  /* ---------- Jogos ---------- */

  /** Quem está dentro de cada portal (só fora de partida). */
  private calcularFilas(): Partial<Record<IdJogo, string[]>> {
    const f: Partial<Record<IdJogo, string[]>> = {};
    if (this.partida || this.retro || this.mm || this.corrida) return f;
    for (const jogo of IDS_JOGOS) {
      const [px, pz] = JOGOS[jogo].portal;
      // Sprint Retro: a "fila" é quem está dentro da sala (para começar, tem que estar todo mundo).
      const sala = jogo === 'sprint-retro' ? predioDoJogo(jogo) : undefined;
      const ids = [...this.jogadores.values()].filter((j) => (sala ? dentroDoPredio(sala, j.pose[0], j.pose[2]) : Math.hypot(j.pose[0] - px, j.pose[2] - pz) <= RAIO_PORTAL && j.pose[1] < 2)).map((j) => j.id);
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
    if (this.partida || this.retro || this.mm || this.corrida || !JOGOS[jogo]) return;
    const fila = this.calcularFilas()[jogo] ?? [];
    if (!fila.includes(quem) || fila.length < JOGOS[jogo].min) return;
    // Corrida: quem estava no portal vai para o grid de largada (desce dos carros da cidade), o resto assiste.
    if (jogo === 'corrida') {
      for (const [ws, j] of this.jogadores)
        if (fila.includes(j.id) && j.carro !== undefined) {
          this.sairDoCarro(j);
          ws.serializeAttachment(j);
        }
      const agora = Date.now();
      this.corrida = new Corrida(fila.slice(0, 8), agora, Number(this.env.DURACAO_FATOR || 1));
      this.filas = '';
      this.enviarCorrida(agora);
      this.avisarDiretorio();
      this.relogioCorrida = setInterval(() => this.tickCorrida(), 250);
      return;
    }
    // Mata-mata: quem estava no portal vai para o domo (times alternados), o resto assiste.
    if (jogo === 'mata-mata') {
      for (const [ws, j] of this.jogadores)
        if (fila.includes(j.id) && j.carro !== undefined) {
          this.sairDoCarro(j);
          ws.serializeAttachment(j);
        }
      const agora = Date.now();
      this.mm = new MataMata(fila, agora, Number(this.env.DURACAO_FATOR || 1));
      this.filas = '';
      this.ultimoEstadoMM = agora;
      this.paraTodos({ k: 'mm', e: this.mm.estado(agora) });
      this.avisarDiretorio();
      this.relogioMM = setInterval(() => this.tickMM(), 250);
      return;
    }
    // Sprint Retro: participa a sala inteira, e só começa com todo mundo dentro da Sala Sprint Retro.
    if (jogo === 'sprint-retro') {
      if (fila.length < this.jogadores.size) return;
      this.retro = new Retro(
        [...this.jogadores.values()].map((j) => ({ id: j.id, nome: j.nome })),
        quem,
      );
      this.filas = '';
      this.avisarDiretorio(); // fecha a sala
      this.retroMudou();
      return;
    }
    const agora = Date.now();
    // Quem vai jogar desce do carro.
    for (const [ws, j] of this.jogadores)
      if (fila.includes(j.id) && j.carro !== undefined) {
        this.sairDoCarro(j);
        ws.serializeAttachment(j);
      }
    this.partida = new Partida(jogo, fila, agora, Number(this.env.DURACAO_FATOR || 1));
    this.filas = '';
    // A partida é na praça: cada um vai para um lugar em volta do chafariz (o jogo faz o mesmo no aparelho).
    const lugares = this.partida.participantes;
    for (const [ws, j] of this.jogadores) {
      const i = lugares.indexOf(j.id);
      if (i < 0) continue;
      const [x, z] = posInicialPraca(i);
      j.pose = [x, 0, z, Math.atan2(-x, -z), Anim.Parado];
      ws.serializeAttachment(j);
    }
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
    // Saiu da sala: levanta das mesas de cartas.
    if (this.bj || this.truco || this.poker) this.levantarDasMesas(j.id);
    // Saiu no meio da corrida: sai da classificação; se não sobrou ninguém, acaba sem resultado.
    if (this.corrida?.sair(j.id)) void this.terminarCorrida(false);
    // Saiu no meio do mata-mata: se um time ficou vazio, o outro vence.
    if (this.mm?.sair(j.id)) void this.terminarMM(this.mm.jogadores.size > 0);
    // Estava dirigindo: o carro fica parado onde parou.
    if (j.carro !== undefined) this.sairDoCarro(j);
    // Saiu no meio da partida: sai dela também; sem gente suficiente (ou sem quem procura), acaba.
    if (this.partida?.sair(j.id)) void this.terminar(this.partida.participantes.length < 2);
    else this.atualizarFilas();
    // Caiu da retro: fica ausente (não trava os outros). Se não sobrou ninguém conectado, espera 1 minuto
    // (pode ser só alguém recarregando a página) e, se ninguém voltar, a retro acaba e a sala reabre.
    if (this.retro) {
      if (this.retro.ausente(j.id)) this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 60_000));
      this.retroMudou();
    }
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
    this.ctx.waitUntil(this.env.DIRETORIO.getByName('global').atualizar(codigo, n, !this.partida && !this.retro && !this.mm && !this.corrida));
  }
}
