// Perfis no D1: convidado com token secreto, XP e nível, moedas com extrato, itens, conquistas,
// partidas e ranking por jogo. Moedas e XP só mudam aqui, sempre pelo servidor (o jogo nunca diz "ganhei X").

import { CONQUISTAS, ITENS, type LinhaRanking, MOEDAS_INICIAIS, type Perfil, type RespostaRanking, SKIN_VALIDA, XP_PRESENCA_DIA, itensBloqueados, nivelDoXp } from './protocolo';


export function limparNome(bruto: unknown): string {
  return String(bruto ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

async function hash(texto: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const novoToken = (): string => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hoje = (agora = Date.now()): string => new Date(agora).toISOString().slice(0, 10);
export const temporadaAtual = (agora = Date.now()): string => new Date(agora).toISOString().slice(0, 7);

interface LinhaJogador {
  id: string;
  apelido: string;
  skin: string;
  xp: number;
  moedas: number;
}

async function montarPerfil(db: D1Database, j: LinhaJogador): Promise<Perfil> {
  const [itens, conquistas] = await db.batch<{ v: string }>([
    db.prepare('SELECT item AS v FROM itens WHERE jogador_id = ?').bind(j.id),
    db.prepare('SELECT conquista AS v FROM conquistas WHERE jogador_id = ?').bind(j.id),
  ]);
  return { id: j.id, apelido: j.apelido, skin: j.skin, xp: j.xp, nivel: nivelDoXp(j.xp), moedas: j.moedas, itens: itens.results.map((r) => r.v), conquistas: conquistas.results.map((r) => r.v) };
}

export class ErroPerfil extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function criarPerfil(db: D1Database, apelidoBruto: unknown, skinBruta: unknown): Promise<{ token: string; perfil: Perfil }> {
  const apelido = limparNome(apelidoBruto);
  if (!apelido) throw new ErroPerfil('Escolha um apelido.');
  // Perfil novo está no nível 1: itens bloqueados são tirados da skin.
  let skin = typeof skinBruta === 'string' && SKIN_VALIDA.test(skinBruta) ? skinBruta : '';
  for (const b of itensBloqueados(skin, 1, [])) skin = skin.split('|').filter((p) => p !== b).join('|');
  const id = crypto.randomUUID();
  const token = novoToken();
  const agora = Date.now();
  await db.batch([
    db.prepare('INSERT INTO jogadores (id, token_hash, apelido, skin, moedas, criado_em, visto_em) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, await hash(token), apelido, skin, MOEDAS_INICIAIS, agora, agora),
    db.prepare('INSERT INTO extrato (jogador_id, valor, motivo, data) VALUES (?, ?, ?, ?)').bind(id, MOEDAS_INICIAIS, 'boas-vindas', agora),
  ]);
  return { token, perfil: { id, apelido, skin, xp: 0, nivel: 1, moedas: MOEDAS_INICIAIS, itens: [], conquistas: [] } };
}

/** Perfil dono do token, ou null. Marca o "visto por último". */
export async function perfilDoToken(db: D1Database, token: string | null): Promise<Perfil | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const j = await db.prepare('UPDATE jogadores SET visto_em = ? WHERE token_hash = ? RETURNING id, apelido, skin, xp, moedas').bind(Date.now(), await hash(token)).first<LinhaJogador>();
  return j ? montarPerfil(db, j) : null;
}

export const tokenDaRequisicao = (req: Request): string | null => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;

/** Troca apelido e/ou skin. A skin só pode usar itens liberados. */
export async function atualizarPerfil(db: D1Database, p: Perfil, dados: { apelido?: unknown; skin?: unknown }): Promise<Perfil> {
  const apelido = dados.apelido === undefined ? p.apelido : limparNome(dados.apelido);
  if (!apelido) throw new ErroPerfil('Escolha um apelido.');
  let skin = p.skin;
  if (dados.skin !== undefined) {
    if (typeof dados.skin !== 'string' || !SKIN_VALIDA.test(dados.skin)) throw new ErroPerfil('Aparência inválida.');
    const bloqueados = itensBloqueados(dados.skin, p.nivel, p.itens);
    if (bloqueados.length) throw new ErroPerfil(`Ainda bloqueado: ${bloqueados.map((b) => ITENS.find((i) => i.id === b)?.nome ?? b).join(', ')}.`, 403);
    skin = dados.skin;
  }
  await db.prepare('UPDATE jogadores SET apelido = ?, skin = ? WHERE id = ?').bind(apelido, skin, p.id).run();
  return { ...p, apelido, skin };
}

/** Confere se a skin pode ser usada por este jogador (para troca dentro da sala). */
export async function skinPermitida(db: D1Database, id: string, skin: string): Promise<boolean> {
  if (!SKIN_VALIDA.test(skin)) return false;
  const [j, itens] = await db.batch<{ xp?: number; item?: string }>([db.prepare('SELECT xp FROM jogadores WHERE id = ?').bind(id), db.prepare('SELECT item FROM itens WHERE jogador_id = ?').bind(id)]);
  const xp = j.results[0]?.xp;
  if (xp === undefined) return false;
  if (itensBloqueados(skin, nivelDoXp(xp), itens.results.map((r) => r.item!)).length) return false;
  await db.prepare('UPDATE jogadores SET skin = ? WHERE id = ?').bind(skin, id).run();
  return true;
}

/** XP por tempo na praça: 1 por minuto, até XP_PRESENCA_DIA por dia. Devolve o total de presença de hoje. */
export async function darXpPresenca(db: D1Database, id: string, minutos: number): Promise<number> {
  const dia = hoje();
  const r = await db
    .prepare(
      `UPDATE jogadores SET
         xp_presenca_hoje = CASE WHEN dia_presenca = ?1 THEN xp_presenca_hoje ELSE 0 END + MIN(?2, ?3 - CASE WHEN dia_presenca = ?1 THEN xp_presenca_hoje ELSE 0 END),
         xp = xp + MIN(?2, ?3 - CASE WHEN dia_presenca = ?1 THEN xp_presenca_hoje ELSE 0 END),
         dia_presenca = ?1
       WHERE id = ?4 AND MIN(?2, ?3 - CASE WHEN dia_presenca = ?1 THEN xp_presenca_hoje ELSE 0 END) > 0
       RETURNING xp_presenca_hoje`,
    )
    .bind(dia, Math.floor(minutos), XP_PRESENCA_DIA, id)
    .first<{ xp_presenca_hoje: number }>();
  return r?.xp_presenca_hoje ?? 0;
}

/** Loja: cobra o preço e libera o item numa transação só (sem saldo ou já tendo o item, nada muda). */
export async function comprarItem(db: D1Database, p: Perfil, itemId: unknown): Promise<Perfil> {
  const item = ITENS.find((i) => i.id === itemId && i.preco);
  if (!item?.preco) throw new ErroPerfil('Item não está à venda.');
  if (p.itens.includes(item.id)) throw new ErroPerfil('Você já tem esse item.', 409);
  const agora = Date.now();
  const [r] = await db.batch<{ moedas: number }>([
    db.prepare('UPDATE jogadores SET moedas = moedas - ?1 WHERE id = ?2 AND moedas >= ?1 AND NOT EXISTS (SELECT 1 FROM itens WHERE jogador_id = ?2 AND item = ?3) RETURNING moedas').bind(item.preco, p.id, item.id),
    db.prepare('INSERT INTO itens (jogador_id, item, desbloqueado_em) SELECT ?, ?, ? WHERE changes() > 0').bind(p.id, item.id, agora),
    db.prepare('INSERT INTO extrato (jogador_id, valor, motivo, data) SELECT ?, ?, ?, ? WHERE changes() > 0').bind(p.id, -item.preco, 'loja:' + item.id, agora),
  ]);
  const saldo = r.results[0]?.moedas;
  if (saldo === undefined) throw new ErroPerfil('Moedas insuficientes: ' + item.nome + ' custa ' + item.preco + '.', 402);
  return { ...p, moedas: saldo, itens: [...p.itens, item.id] };
}

/** Cobra ou paga moedas (valor negativo = gasto). Falha sem mexer em nada se o saldo não der. */
export async function moverMoedas(db: D1Database, id: string, valor: number, motivo: string, partidaId: string | null = null): Promise<number> {
  const agora = Date.now();
  const [r] = await db.batch<{ moedas: number }>([
    db.prepare('UPDATE jogadores SET moedas = moedas + ?1 WHERE id = ?2 AND moedas + ?1 >= 0 RETURNING moedas').bind(Math.trunc(valor), id),
    db.prepare('INSERT INTO extrato (jogador_id, valor, motivo, partida_id, data) SELECT ?1, ?2, ?3, ?4, ?5 WHERE changes() > 0').bind(id, Math.trunc(valor), motivo, partidaId, agora),
  ]);
  const saldo = r.results[0]?.moedas;
  if (saldo === undefined) throw new ErroPerfil('Moedas insuficientes.', 402);
  return saldo;
}

export interface ResultadoJogador {
  id: string;
  posicao: number; // 1 = venceu
  pontos: number;
  xp: number;
  moedas: number; // ganho (ou perda) de moedas nesta partida
}

/**
 * Grava uma partida inteira de uma vez: participações, XP, moedas (com extrato), ranking da temporada
 * (rating estilo Elo comparando cada par de jogadores) e conquistas. Devolve as conquistas novas por jogador.
 */
export async function registrarPartida(db: D1Database, p: { jogo: string; sala: string; inicio: number; fim: number; resultados: ResultadoJogador[] }): Promise<Record<string, string[]>> {
  const partidaId = crypto.randomUUID();
  const temporada = temporadaAtual(p.fim);
  const ids = p.resultados.map((r) => r.id);
  const marcadores = ids.map(() => '?').join(',');

  // Ratings atuais para calcular o novo Elo.
  const atuais = await db.prepare(`SELECT jogador_id, rating FROM ranking WHERE jogo = ? AND temporada = ? AND jogador_id IN (${marcadores})`).bind(p.jogo, temporada, ...ids).all<{ jogador_id: string; rating: number }>();
  const rating = new Map(ids.map((id) => [id, 1000]));
  for (const r of atuais.results) rating.set(r.jogador_id, r.rating);
  const K = 32 / Math.max(1, p.resultados.length - 1);
  const delta = new Map(ids.map((id) => [id, 0]));
  for (const a of p.resultados)
    for (const b of p.resultados) {
      if (a.id === b.id) continue;
      const esperado = 1 / (1 + 10 ** ((rating.get(b.id)! - rating.get(a.id)!) / 400));
      const real = a.posicao < b.posicao ? 1 : a.posicao === b.posicao ? 0.5 : 0;
      delta.set(a.id, delta.get(a.id)! + K * (real - esperado));
    }

  const st: D1PreparedStatement[] = [db.prepare('INSERT INTO partidas (id, jogo, sala, inicio, fim) VALUES (?, ?, ?, ?, ?)').bind(partidaId, p.jogo, p.sala, p.inicio, p.fim)];
  for (const r of p.resultados) {
    const venceu = r.posicao === 1 ? 1 : 0;
    st.push(
      db.prepare('INSERT INTO participacoes (partida_id, jogador_id, posicao, pontos, xp, moedas) VALUES (?, ?, ?, ?, ?, ?)').bind(partidaId, r.id, r.posicao, r.pontos, r.xp, r.moedas),
      // Moedas nunca ficam negativas: a perda é limitada ao saldo.
      db.prepare('UPDATE jogadores SET xp = xp + ?1, moedas = MAX(0, moedas + ?2) WHERE id = ?3').bind(r.xp, r.moedas, r.id),
      db.prepare(
        `INSERT INTO ranking (jogo, temporada, jogador_id, rating, vitorias, partidas) VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT (jogo, temporada, jogador_id) DO UPDATE SET rating = ?4, vitorias = vitorias + ?5, partidas = partidas + 1`,
      ).bind(p.jogo, temporada, r.id, Math.round(rating.get(r.id)! + delta.get(r.id)!), venceu),
    );
    if (r.moedas) st.push(db.prepare('INSERT INTO extrato (jogador_id, valor, motivo, partida_id, data) VALUES (?, ?, ?, ?, ?)').bind(r.id, r.moedas, `partida:${p.jogo}`, partidaId, p.fim));
  }
  await db.batch(st);
  return darConquistas(db, p.jogo, p.resultados);
}

/** Confere e grava as conquistas que a partida liberou (e os itens que elas dão). */
async function darConquistas(db: D1Database, jogo: string, resultados: ResultadoJogador[]): Promise<Record<string, string[]>> {
  const ids = resultados.map((r) => r.id);
  const marcadores = ids.map(() => '?').join(',');
  const [vitorias, xps, tem] = await db.batch<{ jogador_id?: string; n?: number; id?: string; xp?: number; conquista?: string }>([
    db.prepare(`SELECT jogador_id, COUNT(*) AS n FROM participacoes WHERE posicao = 1 AND jogador_id IN (${marcadores}) GROUP BY jogador_id`).bind(...ids),
    db.prepare(`SELECT id, xp FROM jogadores WHERE id IN (${marcadores})`).bind(...ids),
    db.prepare(`SELECT jogador_id, conquista FROM conquistas WHERE jogador_id IN (${marcadores})`).bind(...ids),
  ]);
  const nVitorias = new Map(vitorias.results.map((r) => [r.jogador_id!, r.n!]));
  const xp = new Map(xps.results.map((r) => [r.id!, r.xp!]));
  const jaTem = new Set(tem.results.map((r) => `${r.jogador_id}|${r.conquista}`));
  const novas: Record<string, string[]> = {};
  const st: D1PreparedStatement[] = [];
  const agora = Date.now();
  for (const r of resultados) {
    const ganhou = (c: string, cond: boolean): void => {
      if (!cond || jaTem.has(`${r.id}|${c}`) || !CONQUISTAS.some((x) => x.id === c)) return;
      (novas[r.id] ??= []).push(c);
      st.push(db.prepare('INSERT OR IGNORE INTO conquistas (jogador_id, conquista, data) VALUES (?, ?, ?)').bind(r.id, c, agora));
      for (const it of ITENS.filter((i) => i.conquista === c)) st.push(db.prepare('INSERT OR IGNORE INTO itens (jogador_id, item, desbloqueado_em) VALUES (?, ?, ?)').bind(r.id, it.id, agora));
    };
    ganhou('primeira-partida', true);
    ganhou('primeira-vitoria', r.posicao === 1);
    ganhou('dez-vitorias', (nVitorias.get(r.id) ?? 0) >= 10);
    ganhou('rei-da-colina', jogo === 'rei-da-colina' && r.posicao === 1);
    ganhou('nivel-10', nivelDoXp(xp.get(r.id) ?? 0) >= 10);
  }
  if (st.length) await db.batch(st);
  return novas;
}

/** Top 20 por nível, moedas ou rating de um jogo na temporada atual, com a posição de quem pediu. */
export async function ranking(db: D1Database, por: string, meuId: string | null): Promise<RespostaRanking> {
  type Linha = { id: string; apelido: string; xp: number; valor: number };
  let lista: Linha[];
  let minha: (Linha & { posicao: number }) | null = null;
  if (por === 'nivel' || por === 'moedas') {
    const col = por === 'nivel' ? 'xp' : 'moedas';
    lista = (await db.prepare(`SELECT id, apelido, xp, ${col} AS valor FROM jogadores ORDER BY ${col} DESC, criado_em LIMIT 20`).all<Linha>()).results;
    if (meuId)
      minha = await db
        .prepare(`SELECT j.id, j.apelido, j.xp, j.${col} AS valor, (SELECT COUNT(*) FROM jogadores o WHERE o.${col} > j.${col}) + 1 AS posicao FROM jogadores j WHERE j.id = ?`)
        .bind(meuId)
        .first();
  } else {
    if (!/^[a-z0-9-]{2,30}$/.test(por)) throw new ErroPerfil('Ranking inválido.');
    const temporada = temporadaAtual();
    lista = (
      await db
        .prepare('SELECT j.id, j.apelido, j.xp, r.rating AS valor FROM ranking r JOIN jogadores j ON j.id = r.jogador_id WHERE r.jogo = ? AND r.temporada = ? ORDER BY r.rating DESC LIMIT 20')
        .bind(por, temporada)
        .all<Linha>()
    ).results;
    if (meuId)
      minha = await db
        .prepare(
          'SELECT j.id, j.apelido, j.xp, r.rating AS valor, (SELECT COUNT(*) FROM ranking o WHERE o.jogo = r.jogo AND o.temporada = r.temporada AND o.rating > r.rating) + 1 AS posicao FROM ranking r JOIN jogadores j ON j.id = r.jogador_id WHERE r.jogo = ? AND r.temporada = ? AND r.jogador_id = ?',
        )
        .bind(por, temporada, meuId)
        .first();
  }
  const linha = (l: Linha, posicao: number): LinhaRanking => ({ posicao, id: l.id, apelido: l.apelido, nivel: nivelDoXp(l.xp), valor: por === 'nivel' ? nivelDoXp(l.valor) : l.valor });
  return { por, temporada: por === 'nivel' || por === 'moedas' ? undefined : temporadaAtual(), lista: lista.map((l, i) => linha(l, i + 1)), eu: minha ? linha(minha, minha.posicao) : null };
}

/** Saldo de moedas agora (0 se o perfil não existe). */
export async function saldoMoedas(db: D1Database, id: string): Promise<number> {
  const r = await db.prepare('SELECT moedas FROM jogadores WHERE id = ?1').bind(id).first<{ moedas: number }>();
  return r?.moedas ?? 0;
}
