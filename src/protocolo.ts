// Contrato das mensagens entre o jogo (soudev/games/praca) e o servidor das salas.
// Este arquivo é a fonte: `npm run protocolo` copia para o jogo. Só tipos e constantes, sem dependências.

export const MAX_JOGADORES = 12;

/** Tamanho da praça: ninguém sai deste quadrado (metros, centro em 0,0). */
export const LIMITE_MUNDO = 40;

/** Quantas vezes por segundo o jogo manda a posição (só quando se mexe) e o servidor repassa o lote. */
export const ENVIOS_POR_SEGUNDO = 10;

/** Estado da animação do boneco: o servidor só repassa, quem anima é cada aparelho. */
export const Anim = { Parado: 0, Andando: 1, Correndo: 2, NoAr: 3 } as const;
export type Anim = (typeof Anim)[keyof typeof Anim];

export const EMOTES = ['acenar', 'dancar', 'comemorar', 'joinha'] as const;
export type Emote = (typeof EMOTES)[number];

/** Aparência em texto curto, ex.: "pele:3|cabelo:2|camisa:#e33|calca:#223|chapeu:bone". O jogo interpreta. */
export type Skin = string;

/** [x, y, z, rotação em radianos, Anim] */
export type Pose = [number, number, number, number, Anim];

export interface Jogador {
  id: string;
  nome: string;
  skin: Skin;
  pose: Pose;
}

export interface InfoSala {
  codigo: string;
  publica: boolean;
  max: number;
}

/* ---------- Jogo → servidor ---------- */

export type MsgCliente =
  | { k: 'pose'; p: Pose }
  | { k: 'emote'; e: Emote }
  | { k: 'skin'; s: Skin };

/* ---------- Servidor → jogo ---------- */

export type MsgServidor =
  | { k: 'bemvindo'; eu: string; sala: InfoSala; jogadores: Jogador[] }
  | { k: 'entrou'; j: Jogador }
  | { k: 'saiu'; id: string }
  /** Lote de poses de quem se mexeu desde o último envio. */
  | { k: 'poses'; l: [string, ...Pose][] }
  | { k: 'emote'; id: string; e: Emote }
  | { k: 'skin'; id: string; s: Skin }
  | { k: 'erro'; motivo: MotivoErro };

export type MotivoErro = 'cheia' | 'fechada' | 'invalida' | 'duplicado';

/* ---------- HTTP ---------- */

/** POST /jogar → sala pública com vaga (ou nova). POST /salas → sala privada nova. */
export interface RespostaSala {
  codigo: string;
}

/** Conexão: GET /sala/:codigo?id=&nome=&skin= (WebSocket). */
export const CODIGO_SALA = /^[A-HJ-NP-Z2-9]{6}$/;
