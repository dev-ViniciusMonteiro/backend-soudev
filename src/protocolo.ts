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

export type IdJogo = 'pega-pega' | 'rei-da-colina' | 'esconde-esconde' | 'sprint-retro' | 'mata-mata' | 'corrida';

export interface InfoJogo {
  nome: string;
  descricao: string;
  min: number; // jogadores para começar
  segundos: number; // duração da partida (no esconde-esconde, depois do tempo para esconder)
  portal: [number, number]; // centro do portal (x, z), dentro do prédio do jogo
}

export const JOGOS: Record<IdJogo, InfoJogo> = {
  'pega-pega': { nome: 'Pega-pega', descricao: 'Quem está pegando passa ao encostar em alguém. Ganha quem ficar menos tempo pegando. Ao começar, todos vão para a praça.', min: 2, segundos: 90, portal: [-28, 52] },
  'rei-da-colina': { nome: 'Rei da colina', descricao: 'Fique no círculo em volta do chafariz. Ganha quem somar mais tempo lá dentro. Ao começar, todos vão para a praça.', min: 2, segundos: 90, portal: [28, 52] },
  'esconde-esconde': { nome: 'Esconde-esconde', descricao: 'Um procura com a lanterna, os outros se escondem pela praça. Encostou, achou. Ao começar, todos vão para a praça.', min: 2, segundos: 100, portal: [52, -28] },
  'mata-mata': { nome: 'Mata-mata (CS)', descricao: 'TR contra CT no domo, por rodadas, com compra de armas. Ganha o time que fizer 4 rodadas primeiro.', min: 2, segundos: 0, portal: [-28, -52] },
  corrida: { nome: 'Corrida', descricao: 'Todos largam juntos de carrinho no circuito do lado oeste da cidade. 3 voltas: quem cruzar primeiro vence.', min: 1, segundos: 0, portal: [-52, -28] },
  'sprint-retro': { nome: 'Sprint Retro', descricao: 'Retrospectiva com a sala inteira: perguntas, placas na mão, votação e relatório. Só começa com todo mundo aqui dentro.', min: 1, segundos: 0, portal: [52, 54] },
};

/**
 * Prédios dos jogos, espalhados pela cidade (entre a rua de dentro e a de fora). Dá para entrar: paredes com
 * uma porta virada para a avenida mais perto. Retângulo alinhado aos eixos: centro (x, z), largura em x, fundo em z.
 */
export interface Predio {
  id: string;
  nome: string;
  icone: string;
  cor: string;
  x: number;
  z: number;
  larg: number;
  prof: number;
  porta: 'oeste' | 'leste' | 'norte' | 'sul'; // oeste = -x, leste = +x, norte = -z, sul = +z
  jogo?: IdJogo;
}

export const PREDIOS: Predio[] = [
  { id: 'cassino', nome: 'Cassino', icone: '🎰', cor: '#dc2626', x: 24, z: -52, larg: 28, prof: 16, porta: 'oeste' },
  { id: 'arena', nome: 'Arena CS', icone: '🔫', cor: '#b91c1c', x: -24, z: -52, larg: 22, prof: 14, porta: 'leste', jogo: 'mata-mata' },
  { id: 'autodromo', nome: 'Autódromo', icone: '🏁', cor: '#16a34a', x: -52, z: -24, larg: 14, prof: 22, porta: 'sul', jogo: 'corrida' },
  { id: 'casa', nome: 'Casa assombrada', icone: '🙈', cor: '#8b5cf6', x: 52, z: -24, larg: 14, prof: 22, porta: 'sul', jogo: 'esconde-esconde' },
  { id: 'ginasio', nome: 'Ginásio', icone: '🏃', cor: '#ef4444', x: -24, z: 52, larg: 22, prof: 14, porta: 'leste', jogo: 'pega-pega' },
  { id: 'castelo', nome: 'Castelo', icone: '👑', cor: '#facc15', x: 24, z: 52, larg: 22, prof: 14, porta: 'oeste', jogo: 'rei-da-colina' },
  // Sala da Sprint Retro: lá no canto, no fim da cidade.
  { id: 'retro', nome: 'Sala Sprint Retro', icone: '🗂️', cor: '#f97316', x: 53, z: 53, larg: 16, prof: 16, porta: 'norte', jogo: 'sprint-retro' },
];

/** Está dentro do prédio (com uma folga para dentro das paredes)? */
export function dentroDoPredio(p: Predio, x: number, z: number, folga = 0.3): boolean {
  return Math.abs(x - p.x) <= p.larg / 2 - folga && Math.abs(z - p.z) <= p.prof / 2 - folga;
}
export const predioDoJogo = (jogo: IdJogo): Predio | undefined => PREDIOS.find((p) => p.jogo === jogo);

/** Jogos que acontecem na praça: ao começar, cada participante vai para um lugar em volta do chafariz. */
export const JOGOS_NA_PRACA: IdJogo[] = ['pega-pega', 'rei-da-colina', 'esconde-esconde'];
export function posInicialPraca(i: number): [number, number] {
  const a = (i / 12) * Math.PI * 2 + 0.2;
  return [Math.sin(a) * 12, Math.cos(a) * 12];
}

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
  | MsgClienteMM
  | MsgClienteCartas;
export type MsgServidorJogo =
  | { k: 'filas'; f: Partial<Record<IdJogo, string[]>> }
  | { k: 'partida'; p: EstadoPartida | null }
  | { k: 'pegou'; de: string; para: string } // pega-pega: passou / esconde-esconde: achou
  | { k: 'resultado'; jogo: IdJogo; l: LinhaResultado[]; conquistas: Record<string, string[]> }
  | { k: 'carros'; l: EstadoCarro[] }
  | { k: 'retro'; r: EstadoRetro | null }
  | MsgServidorMM
  | { k: 'corrida'; e: EstadoCorrida | null }
  | MsgServidorCartas;

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
// Para ficar "pronto" na retro, tem que estar dentro da Sala Sprint Retro (PREDIOS, id "retro").

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

/* ---------- Corrida de carrinhos (circuito do lado oeste) ---------- */

/** Centro do circuito no mundo. Os pontos da pista são relativos a ele. */
export const CIRCUITO: [number, number] = [-175, 0];
export const LARGURA_PISTA = 14;
export const VOLTAS = 3;
export const SEGUNDOS_LARGADA = 5;
/** Depois que o primeiro cruza a linha, os outros têm este tempo para terminar. */
export const SEGUNDOS_PARA_TERMINAR = 45;
/** Limite de tempo da corrida inteira. */
export const SEGUNDOS_CORRIDA = 300;
/** Velocidade máxima aceita entre duas posições (acima disso é teletransporte e não conta). */
export const VELOCIDADE_MAX_CORRIDA = 40;
export const RAIO_CHECKPOINT = 16;

/** Pontos de controle do traçado (fechado), relativos ao CIRCUITO. A largada é no primeiro, indo para +x. */
export const TRACADO: [number, number][] = [
  [0, -60],
  [40, -60],
  [62, -52],
  [72, -30],
  [66, -6],
  [50, 10],
  [56, 32],
  [46, 54],
  [22, 62],
  [0, 54],
  [-18, 38],
  [-38, 54],
  [-62, 54],
  [-72, 30],
  [-64, 4],
  [-72, -24],
  [-58, -52],
  [-30, -62],
];

/** Centro da pista amostrado a cada ~passo metros (Catmull-Rom fechado). Mesma conta no jogo e no servidor. */
export function pontosPista(passo = 4): [number, number][] {
  const n = TRACADO.length;
  const saida: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = TRACADO[(i - 1 + n) % n];
    const p1 = TRACADO[i];
    const p2 = TRACADO[(i + 1) % n];
    const p3 = TRACADO[(i + 2) % n];
    const comp = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(2, Math.ceil(comp / passo));
    for (let j = 0; j < k; j++) {
      const u = j / k;
      const u2 = u * u;
      const u3 = u2 * u;
      const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
      saida.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return saida;
}

/** Checkpoints: um a cada ~24 m do traçado (o último é a linha de chegada, no ponto 0). */
export function checkpoints(): [number, number][] {
  const p = pontosPista(4);
  const cps: [number, number][] = [];
  for (let i = 6; i < p.length; i += 6) cps.push(p[i]);
  cps.push(p[0]);
  return cps;
}

/** Lugares no grid de largada (atrás da linha, em duas filas). */
export function gridLargada(n: number): [number, number, number][] {
  const lugares: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const fila = Math.floor(i / 2);
    const lado = i % 2 ? 3.2 : -3.2;
    lugares.push([-6 - fila * 7, -60 + lado, Math.PI / 2]); // olhando para +x
  }
  return lugares;
}

export interface CorredorEstado {
  volta: number; // voltas completas
  cp: number; // próximo checkpoint
  terminou: number | null; // tempo (ms) em que cruzou a chegada
  posicao: number;
  grid: [number, number, number];
}

export interface EstadoCorrida {
  fase: 'largada' | 'correndo';
  restanteMs: number; // largada: até a largada; correndo: até o fim
  decorridoMs: number;
  corredores: Record<string, CorredorEstado>;
  totalCheckpoints: number;
}

/* ---------- Cassino: 21 (contra a casa), truco paulista, poker, roleta e caça-níqueis ---------- */

export type TipoMesa = '21' | 'truco' | 'poker';
/** Onde ficam as mesas, dentro do Cassino (x, z). Chegou perto, pode sentar. */
export const MESAS: Record<TipoMesa, [number, number]> = { '21': [17, -47.5], truco: [17, -56.5], poker: [26.5, -47.5] };
export const LUGARES_MESA: Record<TipoMesa, number> = { '21': 5, truco: 4, poker: 6 };
export const ALCANCE_MESA = 4;

/** Carta em texto: valor + naipe, ex. "A♠", "7♥", "10♦". */
export type Carta = string;

/* 21 */
export const APOSTA_MIN_21 = 10;
export const APOSTA_MAX_21 = 500;
export const SEGUNDOS_APOSTA_21 = 15;
export const SEGUNDOS_VEZ = 25;

export interface MaoBJ {
  cartas: Carta[];
  aposta: number;
  status: 'apostando' | 'jogando' | 'parou' | 'estourou' | 'blackjack' | 'fora';
  ganho?: number; // no fim da rodada: quanto voltou (aposta incluída)
}

export interface EstadoBJ {
  fase: 'apostas' | 'jogando' | 'casa' | 'resultado';
  lugares: (string | null)[];
  maos: Record<string, MaoBJ>;
  casa: Carta[]; // a segunda carta da casa vem como "?" até ela jogar
  vez: string | null;
  restanteMs: number;
}

/* Truco paulista */
export const APOSTAS_TRUCO = [50, 100, 200] as const;
export const PONTOS_TRUCO = 12;

export interface EstadoTruco {
  fase: 'esperando' | 'jogando' | 'fim';
  lugares: (string | null)[];
  aposta: number; // por pessoa, vai para o pote
  placar: [number, number]; // time 0 = lugares 0 e 2; time 1 = lugares 1 e 3
  vira: Carta | null;
  valorMao: number; // 1, 3, 6, 9, 12
  pedido: { de: number; valor: number } | null; // truco pedido pelo time "de", esperando resposta
  mesa: { lugar: number; carta: Carta | null }[]; // cartas da vaz atual (null = encoberta)
  vazas: (number | null)[]; // quem ganhou cada vaz da mão (time; null = empate)
  vez: number | null; // lugar que joga
  cartasNaMao: number[]; // quantas cartas cada lugar ainda tem
  vencedor: number | null; // time
  ultimaVaz: { lugar: number; carta: Carta | null }[] | null; // para mostrar a vaz que acabou
  restanteMs: number;
}

/* Poker (Texas Hold'em). A cada mão, quem está sentado entra com o saldo até o limite (sai da conta na hora);
   no fim da mão volta o que sobrou mais o que ganhou. */
export const BLINDS_POKER: [number, number] = [5, 10];
export const LIMITE_POKER = 1000; // máximo que cada um põe numa mão
export const SEGUNDOS_ENTRE_MAOS = 6;

export interface JogadorPoker {
  pilha: number; // fichas que ainda tem nesta mão
  aposta: number; // quanto já pôs nesta rodada de apostas
  total: number; // quanto já pôs na mão inteira
  status: 'ativo' | 'desistiu' | 'allin' | 'fora'; // fora = sentado esperando a próxima mão
  acao?: string; // última ação, para mostrar ("pagou 20", "aumentou para 60"...)
  cartas?: Carta[]; // só na mostra (fim da mão)
  jogo?: string; // nome da mão na mostra: "Dois pares", "Flush"...
  ganho?: number; // no fim da mão
}

export interface EstadoPoker {
  fase: 'esperando' | 'preflop' | 'flop' | 'turn' | 'river' | 'fim';
  lugares: (string | null)[];
  jogadores: Record<string, JogadorPoker>;
  mesa: Carta[];
  pote: number;
  dealer: number;
  vez: number | null; // lugar que joga
  maiorAposta: number;
  minimoAumento: number;
  restanteMs: number;
}

/* Roleta europeia (0 a 36). */
export const ROLETA: [number, number] = [26.5, -56.5];
export const ALCANCE_ROLETA = 4;
export const APOSTA_MIN_ROLETA = 10;
export const APOSTA_MAX_ROLETA = 500;
export const MAX_APOSTAS_ROLETA = 10; // por pessoa, por rodada
export const SEGUNDOS_APOSTAS_ROLETA = 20; // contados a partir da primeira aposta
export const SEGUNDOS_GIRO_ROLETA = 5;
export const SEGUNDOS_RESULTADO_ROLETA = 6;
export const VERMELHOS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export type TipoApostaRoleta = 'numero' | 'vermelho' | 'preto' | 'par' | 'impar' | 'baixo' | 'alto' | 'duzia';
/** Quanto volta (aposta incluída) quando acerta. */
export const PAGA_ROLETA: Record<TipoApostaRoleta, number> = { numero: 36, vermelho: 2, preto: 2, par: 2, impar: 2, baixo: 2, alto: 2, duzia: 3 };

export function ganhouRoleta(tipo: TipoApostaRoleta, alvo: number | undefined, n: number): boolean {
  if (tipo === 'numero') return alvo === n;
  if (n === 0) return false;
  if (tipo === 'vermelho') return VERMELHOS.includes(n);
  if (tipo === 'preto') return !VERMELHOS.includes(n);
  if (tipo === 'par') return n % 2 === 0;
  if (tipo === 'impar') return n % 2 === 1;
  if (tipo === 'baixo') return n <= 18;
  if (tipo === 'alto') return n >= 19;
  return Math.ceil(n / 12) === alvo; // dúzia 1, 2 ou 3
}

export interface ApostaRoleta {
  id: string;
  tipo: TipoApostaRoleta;
  alvo?: number;
  v: number;
  ganho?: number; // no resultado
}

export interface EstadoRoleta {
  fase: 'apostas' | 'girando' | 'resultado';
  apostas: ApostaRoleta[];
  numero: number | null; // só no resultado
  historico: number[]; // últimos números (mais novo primeiro)
  restanteMs: number | null; // null = esperando a primeira aposta
}

/* Caça-níqueis: 3 rolos. */
export const SLOTS: [number, number][] = [
  [37, -57.5],
  [37, -55],
  [37, -52.5],
  [37, -50],
  [37, -47.5],
];
export const ALCANCE_SLOT = 2.2;
export const APOSTAS_SLOT = [10, 25, 50, 100] as const;
export const SIMBOLOS_SLOT = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'] as const;
/** Chance de cada símbolo em cada rolo (soma 100). */
export const PESOS_SLOT = [30, 25, 18, 13, 9, 5];
/** Três iguais: quanto volta (vezes a aposta). Dois 🍒 devolvem a aposta. Retorno médio ~95%. */
export const PREMIOS_SLOT = [8, 12, 25, 50, 100, 250];

export function premioSlot(rolos: number[]): number {
  if (rolos[0] === rolos[1] && rolos[1] === rolos[2]) return PREMIOS_SLOT[rolos[0]];
  return rolos.filter((r) => r === 0).length === 2 ? 1 : 0;
}

export type MsgClienteCartas =
  | { k: 'mesa'; mesa: TipoMesa; a: 'sentar' | 'levantar' | 'comecar'; aposta?: number }
  | { k: 'poker'; a: 'desistir' | 'passar' | 'pagar' | 'allin' }
  | { k: 'poker'; a: 'aumentar'; v: number }
  | { k: 'roleta'; tipo: TipoApostaRoleta; alvo?: number; v: number }
  | { k: 'slot'; v: number }
  | { k: 'bj'; a: 'apostar'; v: number }
  | { k: 'bj'; a: 'pedir' | 'parar' | 'dobrar' }
  | { k: 'truco'; a: 'jogar'; i: number; encoberta?: boolean }
  | { k: 'truco'; a: 'trucar' | 'aceitar' | 'correr' };

export type MsgServidorCartas =
  | { k: 'bj'; e: EstadoBJ | null }
  | { k: 'truco'; e: EstadoTruco | null }
  /** Só para você: as suas cartas do truco. */
  | { k: 'trucoMao'; cartas: Carta[] }
  | { k: 'poker'; e: EstadoPoker | null }
  /** Só para você: as suas duas cartas do poker. */
  | { k: 'pokerMao'; cartas: Carta[] }
  | { k: 'roleta'; e: EstadoRoleta | null }
  /** Só para quem girou: resultado do caça-níquel (índices em SIMBOLOS_SLOT). */
  | { k: 'slot'; rolos: number[]; aposta: number; ganho: number }
  | { k: 'mesaErro'; mesa: TipoMesa | 'roleta' | 'slot'; texto: string };
