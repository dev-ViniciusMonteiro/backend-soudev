// Contrato das mensagens entre o jogo (soudev/games/praca) e o servidor das salas.
// Este arquivo é a fonte: `npm run protocolo` copia para o jogo. Só tipos e constantes, sem dependências.

export const MAX_JOGADORES = 12;

/** Tamanho do mundo: ninguém sai deste quadrado (metros, centro em 0,0). A praça fica no meio, cercada de ruas e quarteirões. */
export const LIMITE_MUNDO = 260;

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

export type CategoriaLoja = 'chapeu' | 'acessorio' | 'roupa' | 'pet' | 'arma';

export interface Item {
  id: string; // a parte da skin que ele libera, ex.: "chapeu:coroa"
  nome: string;
  nivel?: number; // liberado ao chegar neste nível
  conquista?: string; // ou ao ganhar esta conquista
  preco?: number; // ou comprado na loja com moedas do jogo
  categoria?: CategoriaLoja;
  icone?: string;
  descricao?: string;
}

/** Tudo que não está aqui (cores, cabelo curto, careca) é livre desde o começo. */
export const ITENS: Item[] = [
  { id: 'cabelo:arrepiado', nome: 'Cabelo arrepiado', nivel: 2 },
  { id: 'chapeu:bone', nome: 'Boné', nivel: 2 },
  { id: 'cabelo:comprido', nome: 'Cabelo comprido', nivel: 3 },
  { id: 'chapeu:gorro', nome: 'Gorro', nivel: 4 },
  { id: 'oculos:1', nome: 'Óculos escuros', nivel: 5 },
  { id: 'chapeu:cartola', nome: 'Cartola', nivel: 8 },
  { id: 'chapeu:coroa', nome: 'Coroa', conquista: 'rei-da-colina', preco: 2500, categoria: 'chapeu', icone: '👑', descricao: 'A coroa do rei da colina (ou compre direto).' },
  // Loja: só moedas do jogo. Armas são só aparência (mesmo dano para todos no mata-mata).
  { id: 'chapeu:coroa-ouro', nome: 'Coroa de ouro', preco: 1500, categoria: 'chapeu', icone: '👑', descricao: 'Brilha de longe.' },
  { id: 'chapeu:coroa-diamante', nome: 'Coroa de diamante', preco: 5000, categoria: 'chapeu', icone: '💎', descricao: 'A mais rara da praça.' },
  { id: 'chapeu:chifres', nome: 'Chifres', preco: 600, categoria: 'chapeu', icone: '😈', descricao: 'Para os dias de travessura.' },
  { id: 'chapeu:aureola', nome: 'Auréola', preco: 800, categoria: 'chapeu', icone: '😇', descricao: 'Flutua sobre a cabeça.' },
  { id: 'chapeu:tiara', nome: 'Tiara', preco: 400, categoria: 'chapeu', icone: '🎀' },
  { id: 'acessorio:mochila', nome: 'Mochila', preco: 300, categoria: 'acessorio', icone: '🎒' },
  { id: 'acessorio:capa', nome: 'Capa de herói', preco: 700, categoria: 'acessorio', icone: '🦸', descricao: 'Balança quando você corre.' },
  { id: 'acessorio:guitarra', nome: 'Guitarra nas costas', preco: 900, categoria: 'acessorio', icone: '🎸' },
  { id: 'acessorio:asas', nome: 'Asas', preco: 1200, categoria: 'acessorio', icone: '🪽', descricao: 'Batem quando você pula.' },
  { id: 'roupa:jaqueta', nome: 'Jaqueta', preco: 400, categoria: 'roupa', icone: '🧥' },
  { id: 'roupa:moletom', nome: 'Moletom com capuz', preco: 500, categoria: 'roupa', icone: '👕' },
  { id: 'roupa:terno', nome: 'Terno e gravata', preco: 900, categoria: 'roupa', icone: '🤵' },
  { id: 'roupa:esqueleto', nome: 'Fantasia de esqueleto', preco: 1000, categoria: 'roupa', icone: '💀' },
  { id: 'pet:cachorro', nome: 'Cachorro', preco: 2000, categoria: 'pet', icone: '🐶', descricao: 'Segue você pela praça.' },
  { id: 'pet:gato', nome: 'Gato', preco: 2000, categoria: 'pet', icone: '🐱', descricao: 'Segue você (quando quer).' },
  { id: 'arma:camuflada', nome: 'Armas camufladas', preco: 500, categoria: 'arma', icone: '🪖', descricao: 'Visual das suas armas no mata-mata (mesmo dano).' },
  { id: 'arma:neon', nome: 'Armas neon', preco: 1500, categoria: 'arma', icone: '🌈', descricao: 'Visual das suas armas no mata-mata (mesmo dano).' },
  { id: 'arma:ouro', nome: 'Armas de ouro', preco: 3000, categoria: 'arma', icone: '🥇', descricao: 'Visual das suas armas no mata-mata (mesmo dano).' },
  { id: 'arma:dragao', nome: 'Armas Dragão', preco: 6000, categoria: 'arma', icone: '🐉', descricao: 'Visual das suas armas no mata-mata (mesmo dano).' },
];

/** Aparência em texto: até 300 caracteres (cores + chapéu + acessório + roupa + pet + arma). */
export const SKIN_VALIDA = /^[\w:#|.,-]{0,300}$/;

/** POST /loja/comprar { item } → perfil atualizado (moedas e itens). */
export interface PedidoCompra {
  item: string;
}

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

export type IdJogo = 'pega-pega' | 'rei-da-colina' | 'esconde-esconde' | 'sprint-retro' | 'mata-mata';

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
  'mata-mata': { nome: 'Mata-mata (CS)', descricao: 'TR contra CT no domo, por rodadas, com compra de armas. Ganha o time que fizer 4 rodadas primeiro.', min: 2, segundos: 0, portal: [0, -14] },
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
  | { k: 'voto'; r: string } // sprint retro: votar (ou tirar o voto) numa resposta
  | MsgClienteMM;
export type MsgServidorJogo =
  | { k: 'filas'; f: Partial<Record<IdJogo, string[]>> }
  | { k: 'partida'; p: EstadoPartida | null }
  | { k: 'pegou'; de: string; para: string } // pega-pega: passou / esconde-esconde: achou
  | { k: 'resultado'; jogo: IdJogo; l: LinhaResultado[]; conquistas: Record<string, string[]> }
  | { k: 'carros'; l: EstadoCarro[] }
  | { k: 'retro'; r: EstadoRetro | null }
  | MsgServidorMM;

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

/* ---------- Mata-mata (estilo CS) no domo ---------- */

/** Centro do domo no mundo (do lado da cidade). As coordenadas do mapa abaixo são relativas a ele. */
export const DOMO: [number, number] = [190, 0];
export const RAIO_DOMO = 52;
/** Metade do lado da arena: ninguém sai deste quadrado (relativo ao domo). */
export const LIMITE_ARENA = 35;
export const ALTURA_OLHO = 1.6;

/** Caixa sólida do mapa: centro (x, z), largura, profundidade e altura. Paredes altas param bala; caixotes baixos, só se a bala passar por baixo do topo. */
export type Bloco = [number, number, number, number, number];

/**
 * Mapa inspirado na Dust2, simplificado (vista de cima, norte = -z):
 * TR nasce no sul, CT no norte. Meio com portas no centro; "Long" A pela direita, túnel do B pela esquerda;
 * passarela do meio para o A; bomb A no nordeste e bomb B no noroeste, com caixotes.
 */
export const MAPA_ARENA: Bloco[] = [
  // Bordas
  [0, -35.5, 72, 1, 6],
  [0, 35.5, 72, 1, 6],
  [-35.5, 0, 1, 72, 6],
  [35.5, 0, 1, 72, 6],
  // Quarteirões grandes entre os corredores
  [14, 8, 16, 20, 5], // entre o meio e o Long A
  [-14, 8, 16, 20, 5], // entre o meio e o túnel do B
  [31.5, 7, 7, 22, 5], // parede de fora do Long A (corredor de 6 m)
  [-31.5, 7, 7, 22, 5], // parede de fora do túnel B (corredor de 6 m)
  // Portas do meio (vão de 3 m)
  [-3.75, -8, 4.5, 1, 4],
  [3.75, -8, 4.5, 1, 4],
  // Laterais da base CT (separa o CT dos bombs até z = -18)
  [8.5, -13, 1, 10, 4],
  [-8.5, -13, 1, 10, 4],
  // Caixotes do bomb A
  [20, -22, 3, 3, 1.4],
  [26.5, -27, 2, 2, 1.4],
  [14, -29, 2.5, 2.5, 1.4],
  [28, -14, 2, 4, 1.4],
  // Caixotes do bomb B
  [-20, -22, 3, 3, 1.4],
  [-26.5, -15, 2, 2, 1.4],
  [-14, -28, 2.5, 2.5, 1.4],
  [-28, -28, 3, 2, 1.4],
  // Coberturas no meio, no Long e no túnel
  [0, 6, 2, 2, 1.4],
  [25, 12, 2, 2, 1.4],
  [-25, 12, 2, 2, 1.4],
  [0, 24, 6, 1, 1.4],
];

export const SPAWNS: Record<'TR' | 'CT', [number, number][]> = {
  TR: [
    [0, 30],
    [-4, 30],
    [4, 30],
    [-8, 28],
    [8, 28],
    [0, 26],
  ],
  CT: [
    [0, -30],
    [-4, -30],
    [4, -30],
    [-3, -26],
    [3, -26],
    [0, -24],
  ],
};

export type Time = 'TR' | 'CT';
export type SlotArma = 'primaria' | 'secundaria' | 'faca';

export interface Arma {
  id: string;
  nome: string;
  slot: SlotArma;
  preco: number;
  dano: number;
  cadenciaMs: number;
  pente: number;
  reserva: number;
  recargaMs: number;
  alcance: number;
  dispersao: number; // radianos (parado); andando dobra
  auto: boolean;
  time?: Time; // só um time compra (AK é TR, M4 é CT)
  mira?: boolean; // dá zoom (AWP)
}

export const ARMAS_MM: Arma[] = [
  { id: 'faca', nome: 'Faca', slot: 'faca', preco: 0, dano: 55, cadenciaMs: 500, pente: 0, reserva: 0, recargaMs: 0, alcance: 2.2, dispersao: 0, auto: false },
  { id: 'glock', nome: 'Glock', slot: 'secundaria', preco: 200, dano: 25, cadenciaMs: 150, pente: 20, reserva: 120, recargaMs: 2200, alcance: 60, dispersao: 0.02, auto: false, time: 'TR' },
  { id: 'usp', nome: 'USP', slot: 'secundaria', preco: 200, dano: 32, cadenciaMs: 170, pente: 12, reserva: 36, recargaMs: 2200, alcance: 60, dispersao: 0.015, auto: false, time: 'CT' },
  { id: 'deagle', nome: 'Desert Eagle', slot: 'secundaria', preco: 700, dano: 55, cadenciaMs: 300, pente: 7, reserva: 35, recargaMs: 2200, alcance: 80, dispersao: 0.02, auto: false },
  { id: 'mp5', nome: 'MP5', slot: 'primaria', preco: 1250, dano: 26, cadenciaMs: 80, pente: 30, reserva: 120, recargaMs: 2600, alcance: 60, dispersao: 0.03, auto: true },
  { id: 'ak47', nome: 'AK-47', slot: 'primaria', preco: 2700, dano: 36, cadenciaMs: 100, pente: 30, reserva: 90, recargaMs: 2500, alcance: 100, dispersao: 0.02, auto: true, time: 'TR' },
  { id: 'm4', nome: 'M4A4', slot: 'primaria', preco: 3100, dano: 33, cadenciaMs: 90, pente: 30, reserva: 90, recargaMs: 3000, alcance: 100, dispersao: 0.016, auto: true, time: 'CT' },
  { id: 'awp', nome: 'AWP', slot: 'primaria', preco: 4750, dano: 115, cadenciaMs: 1450, pente: 10, reserva: 30, recargaMs: 3600, alcance: 140, dispersao: 0.002, auto: false, mira: true },
];
/** Colete (100 de armadura) e colete com capacete (protege a cabeça). */
export const PRECO_COLETE = 650;
export const PRECO_CAPACETE = 1000;
export const DINHEIRO_INICIAL = 800;
export const DINHEIRO_MAX = 16000;
export const RODADAS_PARA_VENCER = 4;
export const SEGUNDOS_COMPRA = 8; // congelado escolhendo armas
export const SEGUNDOS_RODADA = 100;
export const SEGUNDOS_FIM_RODADA = 4;

export type FaseMM = 'compra' | 'rodada' | 'fimRodada';

export interface JogadorMM {
  time: Time;
  vivo: boolean;
  hp: number;
  armadura: number;
  capacete: boolean;
  dinheiro: number;
  abates: number;
  mortes: number;
  primaria: string | null;
  secundaria: string;
  arma: SlotArma; // na mão
  municao: Record<string, [number, number]>; // arma → [pente, reserva]
  spawn: [number, number];
}

export interface EstadoMM {
  fase: FaseMM;
  rodada: number;
  placar: Record<Time, number>;
  restanteMs: number;
  jogadores: Record<string, JogadorMM>;
  vencedorRodada?: Time;
}

export type MsgClienteMM =
  | { k: 'comprar'; item: string }
  | { k: 'empunhar'; slot: SlotArma }
  | { k: 'recarregar' }
  /** Tiro: direção da mira; se o jogo achou alguém na mira, diz quem e onde (o servidor confere). */
  | { k: 'tiro'; d: [number, number, number]; alvo?: string; cabeca?: boolean };

export type MsgServidorMM =
  | { k: 'mm'; e: EstadoMM | null }
  | { k: 'tiro'; de: string; o: [number, number, number]; p: [number, number, number]; arma: string }
  | { k: 'dano'; de: string; para: string; hp: number; cabeca: boolean }
  | { k: 'abate'; de: string; para: string; arma: string; cabeca: boolean };
