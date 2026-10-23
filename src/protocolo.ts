// Contrato das mensagens entre o jogo (soudev/games/praca) e o servidor das salas.
// Este arquivo é a fonte: `npm run protocolo` copia para o jogo. Só tipos e constantes, sem dependências.

export const MAX_JOGADORES = 12;

/** Tamanho do mundo: ninguém sai deste quadrado (metros, centro em 0,0). A praça fica no meio, cercada de ruas e quarteirões. */
export const LIMITE_MUNDO = 80;

/** Quantas vezes por segundo o jogo manda a posição (só quando se mexe) e o servidor repassa o lote. */
export const ENVIOS_POR_SEGUNDO = 10;

/** Estado da animação do boneco: o servidor só repassa, quem anima é cada aparelho. */
export const Anim = { Parado: 0, Andando: 1, Correndo: 2, NoAr: 3, Dirigindo: 4 } as const;
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
  | { k: 'skin'; s: Skin }
  | MsgClienteJogo;

/* ---------- Servidor → jogo ---------- */

export type MsgServidor =
  | { k: 'bemvindo'; eu: string; sala: InfoSala; jogadores: Jogador[] }
  | { k: 'entrou'; j: Jogador }
  | { k: 'saiu'; id: string }
  /** Lote de poses de quem se mexeu desde o último envio. */
  | { k: 'poses'; l: [string, ...Pose][] }
  | { k: 'emote'; id: string; e: Emote }
  | { k: 'skin'; id: string; s: Skin }
  | { k: 'erro'; motivo: MotivoErro }
  | MsgServidorJogo;

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

/* ---------- Jogos da praça (portais) ---------- */

export type IdJogo = 'pega-pega' | 'rei-da-colina' | 'esconde-esconde' | 'sprint-retro';

export interface InfoJogo {
  nome: string;
  descricao: string;
  min: number; // jogadores para começar
  segundos: number; // duração da partida (no esconde-esconde, depois do tempo para esconder)
  portal: [number, number]; // centro do portal na praça (x, z)
}

export const JOGOS: Record<IdJogo, InfoJogo> = {
  'pega-pega': { nome: 'Pega-pega', descricao: 'Quem está pegando passa ao encostar em alguém. Ganha quem ficar menos tempo pegando.', min: 2, segundos: 90, portal: [-13, -6] },
  'rei-da-colina': { nome: 'Rei da colina', descricao: 'Fique no círculo em volta do chafariz. Ganha quem somar mais tempo lá dentro.', min: 2, segundos: 90, portal: [13, -6] },
  'esconde-esconde': { nome: 'Esconde-esconde', descricao: 'Um procura com a lanterna, os outros se escondem. Encostou, achou.', min: 2, segundos: 100, portal: [0, 15] },
  'sprint-retro': { nome: 'Sprint Retro', descricao: 'Retrospectiva de Halloween com a sala inteira: perguntas, placas na mão, votação e relatório.', min: 1, segundos: 0, portal: [-13, 6] },
};

/** Ficar dentro deste raio do portal = estar na fila do jogo. */
export const RAIO_PORTAL = 2.2;
/** Pega-pega e esconde-esconde: distância para pegar/achar alguém. */
export const DISTANCIA_PEGAR = 1.5;
/** Rei da colina: anel em volta do chafariz (centro 0,0). */
export const ZONA_REI = { de: 2.8, ate: 7 };
/** Esconde-esconde: segundos para esconder e alcance da lanterna de quem procura. */
export const SEGUNDOS_ESCONDER = 20;
export const VISAO_BUSCADOR = 10;
/** Segundos de contagem antes de começar. */
export const SEGUNDOS_CONTAGEM = 3;

export type FasePartida = 'contagem' | 'esconder' | 'jogando';

/** Estado da partida que todos na sala recebem (quem está jogando e quem só assiste). */
export interface EstadoPartida {
  jogo: IdJogo;
  fase: FasePartida;
  participantes: string[];
  restanteMs: number; // até o fim da fase atual
  pegador?: string; // pega-pega
  buscador?: string; // esconde-esconde
  achados?: string[]; // esconde-esconde
  placar: Record<string, number>; // segundos (pegando, na zona, escondido)
}

export interface LinhaResultado {
  id: string;
  nome: string;
  posicao: number;
  pontos: number;
  xp: number;
  moedas: number;
}

/* Mensagens a mais dos jogos (somam com MsgCliente/MsgServidor). */
export type MsgClienteJogo =
  | { k: 'iniciar'; jogo: IdJogo }
  | { k: 'carro'; c: number } // entrar no carro
  | { k: 'sairCarro' }
  | { k: 'placa'; t: string } // sprint retro: levantar (ou trocar) a placa com a resposta
  | { k: 'retro'; a: AcaoRetro }
  | { k: 'voto'; r: string }; // sprint retro: votar (ou tirar o voto) numa resposta
export type MsgServidorJogo =
  | { k: 'filas'; f: Partial<Record<IdJogo, string[]>> }
  | { k: 'partida'; p: EstadoPartida | null }
  | { k: 'pegou'; de: string; para: string } // pega-pega: passou / esconde-esconde: achou
  | { k: 'resultado'; jogo: IdJogo; l: LinhaResultado[]; conquistas: Record<string, string[]> }
  | { k: 'carros'; l: EstadoCarro[] }
  | { k: 'retro'; r: EstadoRetro | null };

/* ---------- Carros ---------- */

/** Os 4 carros que dá para dirigir: modelo e onde ficam estacionados no começo (x, z, rotação). */
export const CARROS: { modelo: string; x: number; z: number; rot: number }[] = [
  { modelo: 'car_taxi', x: -14, z: -30.5, rot: Math.PI / 2 },
  { modelo: 'car_sedan', x: 14, z: 30.5, rot: -Math.PI / 2 },
  { modelo: 'car_hatchback', x: 30.5, z: -14, rot: 0 },
  { modelo: 'car_police', x: -30.5, z: 14, rot: Math.PI },
];
/** Distância máxima até o carro para entrar. */
export const ALCANCE_CARRO = 4.5;
/** Lugares por carro: quem entra primeiro dirige, os outros vão de passageiro. */
export const LUGARES_CARRO = 4;
/** [id do carro, x, z, rotação, id de quem dirige ou '', ids dos passageiros] */
export type EstadoCarro = [number, number, number, number, string, string[]];

/* ---------- Sprint Retro (retrospectiva de Halloween) ---------- */

export const PERGUNTAS_RETRO = [
  { emoji: '🍬', titulo: 'Doçuras', pergunta: 'O que foi bom nesta sprint?' },
  { emoji: '🕸️', titulo: 'Travessuras traiçoeiras', pergunta: 'Que obstáculos atrapalharam?' },
  { emoji: '🪄', titulo: 'Feitiços mágicos', pergunta: 'Que melhorias podemos implementar?' },
  { emoji: '🎭', titulo: 'Festa à fantasia', pergunta: 'O que podemos experimentar na próxima?' },
] as const;
export const VOTOS_RETRO = 3; // votos de cada pessoa na votação
export const TAMANHO_RESPOSTA = 60; // "em poucas palavras"
export const RAIO_CENTRO_RETRO = 8; // para ficar "pronto", tem que estar perto do chafariz

/** "sair" liga/desliga o voto para encerrar a retro (todos os presentes = acaba sem pontos). */
export type AcaoRetro = 'pronto' | 'baixar' | 'passar' | 'avancar' | 'terminarVoto' | 'sair';
export type FaseRetro = 'reuniao' | 'pergunta' | 'votacao' | 'fim';
export type StatusRetro = 'pensando' | 'levantada' | 'baixada';

export interface RespostaRetro {
  id: string;
  pergunta: number;
  autor: string;
  nome: string;
  texto: string;
  votos: string[]; // quem votou
}

export interface EstadoRetro {
  fase: FaseRetro;
  anfitriao: string;
  participantes: string[];
  prontos: string[];
  pergunta: number; // índice em PERGUNTAS_RETRO
  status: Record<string, StatusRetro>;
  placas: Record<string, string>; // placas levantadas agora (id → texto)
  respostas: RespostaRetro[]; // todas na votação e no fim; antes, só as da pergunta atual
  terminaramVoto: string[];
  premiadas: string[]; // no fim: ids das 5 respostas mais votadas, em ordem
  ausentes: string[]; // caíram da conexão: não seguram o andamento e voltam de onde pararam
  querSair: string[]; // votaram para encerrar
  cancelada: boolean; // encerrada por votação (sem pontos)
}
