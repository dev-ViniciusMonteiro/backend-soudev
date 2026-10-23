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
  nivel: number;
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

export type MotivoErro = 'cheia' | 'fechada' | 'invalida' | 'duplicado' | 'bloqueado';

/* ---------- HTTP ---------- */

/** POST /jogar → sala pública com vaga (ou nova). POST /salas → sala privada nova. */
export interface RespostaSala {
  codigo: string;
}

/** Conexão: GET /sala/:codigo?token= (WebSocket). O token identifica o perfil; nome, nível e skin vêm do banco. */
export const CODIGO_SALA = /^[A-HJ-NP-Z2-9]{6}$/;

/* ---------- Perfil, progresso e itens ---------- */

/** Moedas com que todo perfil novo começa (o saldo acumula; sem mesada diária). */
export const MOEDAS_INICIAIS = 1000;

/** XP de presença: 1 por minuto na praça, até 60 por dia. */
export const XP_PRESENCA_DIA = 60;

/** Nível a partir do XP: nível 2 com 50, 3 com 200, 5 com 800, 10 com 4050. */
export const nivelDoXp = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
export const xpDoNivel = (nivel: number): number => 50 * (nivel - 1) ** 2;

export interface Item {
  id: string; // a parte da skin que ele libera, ex.: "chapeu:coroa"
  nome: string;
  nivel?: number; // liberado ao chegar neste nível
  conquista?: string; // ou ao ganhar esta conquista
}

/** Tudo que não está aqui (cores, cabelo curto, careca) é livre desde o começo. */
export const ITENS: Item[] = [
  { id: 'cabelo:arrepiado', nome: 'Cabelo arrepiado', nivel: 2 },
  { id: 'chapeu:bone', nome: 'Boné', nivel: 2 },
  { id: 'cabelo:comprido', nome: 'Cabelo comprido', nivel: 3 },
  { id: 'chapeu:gorro', nome: 'Gorro', nivel: 4 },
  { id: 'oculos:1', nome: 'Óculos escuros', nivel: 5 },
  { id: 'chapeu:cartola', nome: 'Cartola', nivel: 8 },
  { id: 'chapeu:coroa', nome: 'Coroa', conquista: 'rei-da-colina' },
];

export interface Conquista {
  id: string;
  nome: string;
  descricao: string;
}

export const CONQUISTAS: Conquista[] = [
  { id: 'primeira-partida', nome: 'Primeira partida', descricao: 'Jogar uma partida na praça' },
  { id: 'primeira-vitoria', nome: 'Primeira vitória', descricao: 'Ganhar uma partida' },
  { id: 'dez-vitorias', nome: 'Veterano', descricao: 'Ganhar 10 partidas' },
  { id: 'rei-da-colina', nome: 'Rei da colina', descricao: 'Ganhar uma partida de rei da colina (libera a coroa)' },
  { id: 'nivel-10', nome: 'Morador da praça', descricao: 'Chegar ao nível 10' },
];

/** Partes da skin que precisam ser liberadas e o jogador não tem. Vazio = pode usar. */
export function itensBloqueados(skin: Skin, nivel: number, liberados: string[]): string[] {
  const partes = skin.split('|');
  return ITENS.filter((it) => partes.includes(it.id) && !(it.nivel !== undefined && nivel >= it.nivel) && !liberados.includes(it.id)).map((it) => it.id);
}

export interface Perfil {
  id: string;
  apelido: string;
  skin: Skin;
  xp: number;
  nivel: number;
  moedas: number;
  itens: string[]; // liberados por conquista
  conquistas: string[];
}

/** POST /perfil { apelido, skin } → perfil novo e o token secreto (guardado só no aparelho). */
export interface RespostaNovoPerfil {
  token: string;
  perfil: Perfil;
}

/** GET /ranking?por=nivel|moedas|<jogo> (com Authorization, traz a sua posição). */
export interface LinhaRanking {
  posicao: number;
  id: string;
  apelido: string;
  nivel: number;
  valor: number;
}

export interface RespostaRanking {
  por: string;
  temporada?: string;
  lista: LinhaRanking[];
  eu: LinhaRanking | null;
}
