// Vinicut: a rede social do site, estilo Orkut. A conta é a mesma dos sistemas (e-mail e senha, sessão em
// sx_sessoes); o perfil, os recados, depoimentos, amigos, fãs, karma, posts, comunidades, fotos (R2) e a
// moderação ficam aqui. Tudo JSON, sessão no cabeçalho Authorization: Bearer <token da conta>.
//
//   GET    /vinicut/eu                      meu perfil (ou null) e os contadores do topo
//   POST   /vinicut/perfil                  criar perfil { usuario, nome, maior18 }
//   PATCH  /vinicut/perfil                  editar
//   DELETE /vinicut/perfil                  apagar o perfil e tudo o que publiquei
//   GET    /vinicut/inicio                  sorte do dia, aniversariantes, sugestões
//   GET    /vinicut/feed?antes=             posts meus e dos amigos
//   GET    /vinicut/u/:usuario              perfil (registra a visita)
//   GET    /vinicut/u/:usuario/{recados,posts,fotos,amigos,depoimentos}
//   POST   /vinicut/u/:usuario/{recados,depoimentos,amizade,fa,karma,bloquear}
//   POST   /vinicut/depoimentos/:id         { aprovar } (quem recebeu)
//   POST   /vinicut/posts · /vinicut/posts/:id/{reacao,comentarios} · GET /vinicut/posts/:id/comentarios
//   DELETE /vinicut/{recados,posts,comentarios,depoimentos,fotos,respostas,topicos}/:id
//   GET/POST /vinicut/comunidades · GET /vinicut/c/:id · POST /vinicut/c/:id/{participar,topicos}
//   GET    /vinicut/t/:id · POST /vinicut/t/:id/respostas
//   POST   /vinicut/fotos (corpo = a imagem)  · GET /vinicut/f/:chave
//   GET    /vinicut/notificacoes · POST /vinicut/notificacoes/lidas · GET /vinicut/pedidos · GET /vinicut/busca?q=
//   POST   /vinicut/denunciar · GET/POST /vinicut/moderacao (só administradores: VINICUT_ADMINS)

import { contaDaSessao, limite } from '../sistemas/contas';
import { ErroSx } from '../sistemas/empresa';

type Linha = Record<string, unknown>;

export class ErroVc extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const USUARIO_RE = /^[a-z0-9._]{3,24}$/;
const ONLINE_MS = 5 * 60000;
const MAX_FOTO = 1_500_000;
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const REACOES = ['curtir', 'amei', 'haha', 'uau', 'triste'];
const RELACIONAMENTOS = ['', 'solteiro(a)', 'namorando', 'casado(a)', 'enrolado(a)', 'prefiro não dizer'];
const TIPOS_DENUNCIA = ['perfil', 'recado', 'depoimento', 'post', 'comentario', 'comunidade', 'topico', 'resposta', 'foto'];

const SORTES = [
  'Hoje é um ótimo dia para mandar um recado para um amigo antigo.',
  'Alguém está pensando em você agora mesmo.',
  'Uma boa notícia chega antes do fim de semana.',
  'Sua criatividade está em alta: comece aquele projeto.',
  'Um velho amigo vai aparecer de surpresa.',
  'Escute mais do que fala hoje e você vai aprender algo valioso.',
  'O que você plantou nos últimos meses começa a dar frutos.',
  'Faça uma pausa: um café com calma muda o seu dia.',
  'Uma conversa sincera resolve o que parecia complicado.',
  'Sua sorte está nas pequenas coisas: preste atenção nelas.',
  'Hoje vale arriscar um pouco mais.',
  'Alguém vai te pedir um conselho; o seu vai ser o melhor.',
  'Arrume a mesa e a cabeça: as ideias vêm junto.',
  'Um elogio sincero hoje volta em dobro.',
  'Você vai rir muito de alguma coisa boba hoje.',
  'A paciência de hoje é o resultado de amanhã.',
  'Uma porta que estava fechada começa a abrir.',
  'Seu bom humor é contagiante: espalhe.',
  'Aprenda uma coisa nova hoje, por menor que seja.',
  'O melhor da semana ainda está por vir.',
];

const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const texto = (v: unknown, max: number, campo: string, obrigatorio = true): string => {
  const t = String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
  if (obrigatorio && !t) throw new ErroVc(400, `Escreva ${campo}.`);
  return t;
};
const num = (v: unknown) => Number(v) || 0;

interface Ctx {
  req: Request;
  env: Env;
  db: D1Database;
  url: URL;
  origem: string;
}

/* ---------- Perfis ---------- */

interface Perfil {
  id: string;
  email: string;
  usuario: string;
  nome: string;
  foto: string | null;
  cidade: string;
  relacionamento: string;
  aniversario: string;
  quem_sou_eu: string;
  interesses: string;
  criado_em: number;
  visto_em: number;
  banido: number;
}

const urlFoto = (c: Ctx, chave: string | null | undefined) => (chave ? `${c.url.origin}/vinicut/f/${chave}` : null);

/** O que os outros veem de uma pessoa nas listas (nome, @, foto, online). */
function resumo(c: Ctx, p: Linha | null | undefined, prefixo = '') {
  if (!p) return null;
  return {
    id: p[`${prefixo}id`] as string,
    usuario: p[`${prefixo}usuario`] as string,
    nome: p[`${prefixo}nome`] as string,
    foto: urlFoto(c, p[`${prefixo}foto`] as string | null),
    online: num(p[`${prefixo}visto_em`]) > Date.now() - ONLINE_MS,
  };
}

async function perfilDoEmail(db: D1Database, email: string): Promise<Perfil | null> {
  return db.prepare('SELECT * FROM vc_perfis WHERE email = ?').bind(email).first<Perfil>();
}

async function perfilDoUsuario(db: D1Database, usuario: string): Promise<Perfil> {
  const p = await db.prepare('SELECT * FROM vc_perfis WHERE usuario = ? AND banido = 0').bind(usuario.toLowerCase()).first<Perfil>();
  if (!p) throw new ErroVc(404, 'Perfil não encontrado.');
  return p;
}

async function emailDaSessao(c: Ctx): Promise<string> {
  const token = (c.req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  try {
    return await contaDaSessao(c.db, token);
  } catch (e) {
    throw new ErroVc(401, e instanceof Error ? e.message : 'Entre de novo.');
  }
}

/** Quem está chamando (com perfil). Marca "visto agora" no máximo uma vez por minuto. */
async function eu(c: Ctx): Promise<Perfil> {
  const p = await perfilDoEmail(c.db, await emailDaSessao(c));
  if (!p) throw new ErroVc(403, 'Crie o seu perfil no Vinicut primeiro.');
  if (p.banido) throw new ErroVc(403, 'Este perfil foi suspenso por violar as regras do Vinicut.');
  if (Date.now() - p.visto_em > 60000) await c.db.prepare('UPDATE vc_perfis SET visto_em = ? WHERE id = ?').bind(Date.now(), p.id).run();
  return p;
}

async function limitar(c: Ctx, p: Perfil, acao: string, max: number, segundos: number) {
  try {
    await limite(c.db, `vc:${acao}:${p.id}`, max, segundos);
  } catch (e) {
    throw new ErroVc(429, e instanceof ErroSx ? e.message : 'Muitas ações seguidas. Aguarde um pouco.');
  }
}

async function bloqueio(db: D1Database, x: string, y: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM vc_bloqueios WHERE (de = ?1 AND bloqueado = ?2) OR (de = ?2 AND bloqueado = ?1)').bind(x, y).first());
}

async function semBloqueio(db: D1Database, x: string, y: string) {
  if (await bloqueio(db, x, y)) throw new ErroVc(403, 'Não é possível interagir com este perfil.');
}

async function amizade(db: D1Database, x: string, y: string): Promise<'amigos' | 'enviado' | 'recebido' | 'nenhum'> {
  const r = await db.prepare('SELECT a, aceita FROM vc_amizades WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(x, y).first<{ a: string; aceita: number }>();
  if (!r) return 'nenhum';
  if (r.aceita) return 'amigos';
  return r.a === x ? 'enviado' : 'recebido';
}

async function notificar(db: D1Database, para: string, de: string, tipo: string, ref: string) {
  if (para === de || (await bloqueio(db, para, de))) return;
  await db.prepare('INSERT INTO vc_notificacoes (id, para, de, tipo, ref, criado_em) VALUES (?, ?, ?, ?, ?, ?)').bind(novoId(), para, de, tipo, ref, Date.now()).run();
}

const AMIGOS_SQL = `SELECT CASE WHEN a = ?1 THEN b ELSE a END FROM vc_amizades WHERE (a = ?1 OR b = ?1) AND aceita = 1`;
const AUTOR = (t: string) => `${t}.id AS a_id, ${t}.usuario AS a_usuario, ${t}.nome AS a_nome, ${t}.foto AS a_foto, ${t}.visto_em AS a_visto_em`;

function validarUsuario(v: unknown): string {
  const u = String(v ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!USUARIO_RE.test(u)) throw new ErroVc(400, 'O @ precisa ter de 3 a 24 letras, números, ponto ou _.');
  return u;
}

function camposPerfil(d: Linha) {
  const out: Record<string, string> = {};
  if ('nome' in d) out.nome = texto(d.nome, 60, 'o seu nome');
  if ('cidade' in d) out.cidade = texto(d.cidade, 60, '', false);
  if ('relacionamento' in d) {
    const r = String(d.relacionamento ?? '');
    if (!RELACIONAMENTOS.includes(r)) throw new ErroVc(400, 'Relacionamento inválido.');
    out.relacionamento = r;
  }
  if ('aniversario' in d) {
    const a = String(d.aniversario ?? '');
    if (a && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(a)) throw new ErroVc(400, 'Aniversário no formato MM-DD.');
    out.aniversario = a;
  }
  if ('quem_sou_eu' in d) out.quem_sou_eu = texto(d.quem_sou_eu, 2000, '', false);
  if ('interesses' in d) out.interesses = texto(d.interesses, 500, '', false);
  return out;
}

/* ---------- Posts ---------- */

function postsSql(onde: string): string {
  return `SELECT p.id, p.texto, p.foto, p.criado_em, ${AUTOR('a')},
    (SELECT COUNT(*) FROM vc_reacoes r WHERE r.post = p.id) AS reacoes,
    (SELECT group_concat(tipo) FROM (SELECT tipo FROM vc_reacoes r WHERE r.post = p.id GROUP BY tipo ORDER BY COUNT(*) DESC LIMIT 3)) AS tipos,
    (SELECT tipo FROM vc_reacoes r WHERE r.post = p.id AND r.de = ?1) AS minha,
    (SELECT COUNT(*) FROM vc_comentarios k WHERE k.post = p.id) AS comentarios
    FROM vc_posts p JOIN vc_perfis a ON a.id = p.autor
    WHERE a.banido = 0 AND p.criado_em < ?2 AND ${onde}
    AND p.autor NOT IN (SELECT bloqueado FROM vc_bloqueios WHERE de = ?1) AND p.autor NOT IN (SELECT de FROM vc_bloqueios WHERE bloqueado = ?1)
    ORDER BY p.criado_em DESC LIMIT 20`;
}

const formatarPost = (c: Ctx, r: Linha) => ({
  id: r.id,
  texto: r.texto,
  foto: urlFoto(c, r.foto as string | null),
  criado_em: r.criado_em,
  autor: resumo(c, r, 'a_'),
  reacoes: num(r.reacoes),
  tipos: r.tipos ? String(r.tipos).split(',') : [],
  minha: r.minha ?? null,
  comentarios: num(r.comentarios),
});

/* ---------- Rotas ---------- */

type Rota = [string, RegExp, (c: Ctx, m: RegExpMatchArray) => Promise<unknown>];

const corpo = async (c: Ctx): Promise<Linha> => {
  try {
    const d = await c.req.json();
    return d && typeof d === 'object' ? (d as Linha) : {};
  } catch {
    return {};
  }
};

const rotas: Rota[] = [
  /* --- Eu --- */
  [
    'GET',
    /^\/vinicut\/eu$/,
    async (c) => {
      const email = await emailDaSessao(c);
      const p = await perfilDoEmail(c.db, email);
      if (!p) return { email, perfil: null };
      if (p.banido) throw new ErroVc(403, 'Este perfil foi suspenso por violar as regras do Vinicut.');
      await c.db.prepare('UPDATE vc_perfis SET visto_em = ? WHERE id = ?').bind(Date.now(), p.id).run();
      const [n, pedidos, dep] = await c.db.batch<{ n: number }>([
        c.db.prepare('SELECT COUNT(*) AS n FROM vc_notificacoes WHERE para = ? AND lida = 0').bind(p.id),
        c.db.prepare('SELECT COUNT(*) AS n FROM vc_amizades WHERE b = ? AND aceita = 0').bind(p.id),
        c.db.prepare('SELECT COUNT(*) AS n FROM vc_depoimentos WHERE para = ? AND aprovado = 0').bind(p.id),
      ]);
      const admins = (c.env.VINICUT_ADMINS ?? '').split(',').map((e) => e.trim().toLowerCase());
      return {
        email,
        perfil: { ...p, email: undefined, foto: urlFoto(c, p.foto) },
        naoLidas: n.results[0]?.n ?? 0,
        pedidos: pedidos.results[0]?.n ?? 0,
        depoimentosPendentes: dep.results[0]?.n ?? 0,
        admin: admins.includes(email),
      };
    },
  ],
  [
    'POST',
    /^\/vinicut\/perfil$/,
    async (c) => {
      const email = await emailDaSessao(c);
      if (await perfilDoEmail(c.db, email)) throw new ErroVc(409, 'Você já tem um perfil.');
      const d = await corpo(c);
      if (d.maior18 !== true) throw new ErroVc(400, 'O Vinicut é para maiores de 18 anos.');
      await limite(c.db, `vc:criar:${email}`, 5, 3600);
      const usuario = validarUsuario(d.usuario);
      if (await c.db.prepare('SELECT 1 FROM vc_perfis WHERE usuario = ?').bind(usuario).first()) throw new ErroVc(409, 'Esse @ já está em uso.');
      const campos = camposPerfil({ nome: d.nome });
      const id = novoId();
      await c.db.prepare('INSERT INTO vc_perfis (id, email, usuario, nome, criado_em, visto_em) VALUES (?, ?, ?, ?, ?, ?)').bind(id, email, usuario, campos.nome, Date.now(), Date.now()).run();
      return { id, usuario };
    },
  ],
  [
    'PATCH',
    /^\/vinicut\/perfil$/,
    async (c) => {
      const p = await eu(c);
      const d = await corpo(c);
      const campos = camposPerfil(d);
      if ('usuario' in d) {
        const u = validarUsuario(d.usuario);
        if (u !== p.usuario && (await c.db.prepare('SELECT 1 FROM vc_perfis WHERE usuario = ?').bind(u).first())) throw new ErroVc(409, 'Esse @ já está em uso.');
        campos.usuario = u;
      }
      if ('foto' in d) {
        const chave = d.foto === null ? null : String(d.foto);
        if (chave && !(await c.db.prepare('SELECT 1 FROM vc_fotos WHERE chave = ? AND autor = ?').bind(chave, p.id).first())) throw new ErroVc(400, 'Foto inválida.');
        await c.db.prepare('UPDATE vc_perfis SET foto = ? WHERE id = ?').bind(chave, p.id).run();
      }
      const chaves = Object.keys(campos);
      if (chaves.length) await c.db.prepare(`UPDATE vc_perfis SET ${chaves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...chaves.map((k) => campos[k]), p.id).run();
      return {};
    },
  ],
  [
    'DELETE',
    /^\/vinicut\/perfil$/,
    async (c) => {
      const p = await eu(c);
      const fotos = await c.db.prepare('SELECT chave FROM vc_fotos WHERE autor = ?').bind(p.id).all<{ chave: string }>();
      for (const f of fotos.results) await c.env.FOTOS.delete(f.chave);
      const id = p.id;
      await c.db.batch([
        c.db.prepare('DELETE FROM vc_recados WHERE para = ?1 OR de = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_depoimentos WHERE para = ?1 OR de = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_amizades WHERE a = ?1 OR b = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_fas WHERE fa = ?1 OR de = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_karma WHERE de = ?1 OR para = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_visitas WHERE perfil = ?1 OR visitante = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_comentarios WHERE de = ?1 OR post IN (SELECT id FROM vc_posts WHERE autor = ?1)').bind(id),
        c.db.prepare('DELETE FROM vc_reacoes WHERE de = ?1 OR post IN (SELECT id FROM vc_posts WHERE autor = ?1)').bind(id),
        c.db.prepare('DELETE FROM vc_posts WHERE autor = ?1').bind(id),
        c.db.prepare('UPDATE vc_comunidades SET membros = membros - 1 WHERE id IN (SELECT comunidade FROM vc_participantes WHERE perfil = ?1)').bind(id),
        c.db.prepare('DELETE FROM vc_participantes WHERE perfil = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_respostas WHERE autor = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_fotos WHERE autor = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_notificacoes WHERE para = ?1 OR de = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_bloqueios WHERE de = ?1 OR bloqueado = ?1').bind(id),
        c.db.prepare('DELETE FROM vc_perfis WHERE id = ?1').bind(id),
      ]);
      return {};
    },
  ],

  /* --- Início --- */
  [
    'GET',
    /^\/vinicut\/inicio$/,
    async (c) => {
      const p = await eu(c);
      const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(5, 10);
      const dia = Math.floor((Date.now() - 3 * 3600000) / 86400000);
      let h = 0;
      for (const ch of `${p.id}${dia}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const [aniv, sugestoes, comunidades] = await c.db.batch<Linha>([
        c.db.prepare(`SELECT * FROM vc_perfis WHERE banido = 0 AND aniversario = ?2 AND id IN (${AMIGOS_SQL})`).bind(p.id, hoje),
        c.db
          .prepare(`SELECT * FROM vc_perfis WHERE banido = 0 AND id != ?1 AND id NOT IN (SELECT a FROM vc_amizades WHERE b = ?1) AND id NOT IN (SELECT b FROM vc_amizades WHERE a = ?1) AND id NOT IN (SELECT bloqueado FROM vc_bloqueios WHERE de = ?1) ORDER BY visto_em DESC LIMIT 6`)
          .bind(p.id),
        c.db.prepare('SELECT c.id, c.nome, c.membros FROM vc_participantes m JOIN vc_comunidades c ON c.id = m.comunidade WHERE m.perfil = ? ORDER BY m.criado_em DESC LIMIT 9').bind(p.id),
      ]);
      return {
        sorte: SORTES[h % SORTES.length],
        aniversariantes: aniv.results.map((r) => resumo(c, r)),
        sugestoes: sugestoes.results.map((r) => resumo(c, r)),
        comunidades: comunidades.results,
      };
    },
  ],
  [
    'GET',
    /^\/vinicut\/feed$/,
    async (c) => {
      const p = await eu(c);
      const antes = num(c.url.searchParams.get('antes')) || Date.now() + 1;
      const r = await c.db.prepare(postsSql(`(p.autor = ?1 OR p.autor IN (${AMIGOS_SQL}))`)).bind(p.id, antes).all<Linha>();
      return { posts: r.results.map((x) => formatarPost(c, x)) };
    },
  ],

  /* --- Perfil de alguém --- */
  [
    'GET',
    /^\/vinicut\/u\/([a-z0-9._]+)$/,
    async (c, m) => {
      const me = await eu(c);
      const p = await perfilDoUsuario(c.db, m[1]);
      if (await bloqueio(c.db, me.id, p.id)) throw new ErroVc(403, 'Este perfil não está disponível.');
      const meu = me.id === p.id;
      if (!meu) await c.db.prepare('INSERT INTO vc_visitas (perfil, visitante, em) VALUES (?, ?, ?) ON CONFLICT (perfil, visitante) DO UPDATE SET em = excluded.em').bind(p.id, me.id, Date.now()).run();
      const [amigos, nAmigos, fas, souFa, karma, meuKarma, comunidades, depoimentos, recados, fotos, visitas, nRecados] = await c.db.batch<Linha>([
        c.db.prepare(`SELECT * FROM vc_perfis WHERE banido = 0 AND id IN (${AMIGOS_SQL}) ORDER BY visto_em DESC LIMIT 9`).bind(p.id),
        c.db.prepare(`SELECT COUNT(*) AS n FROM vc_perfis WHERE banido = 0 AND id IN (${AMIGOS_SQL})`).bind(p.id),
        c.db.prepare('SELECT COUNT(*) AS n FROM vc_fas WHERE de = ?').bind(p.id),
        c.db.prepare('SELECT 1 AS sim FROM vc_fas WHERE fa = ? AND de = ?').bind(me.id, p.id),
        c.db.prepare('SELECT COUNT(*) AS n, AVG(confiavel) AS confiavel, AVG(legal) AS legal, AVG(gente_boa) AS gente_boa FROM vc_karma WHERE para = ?').bind(p.id),
        c.db.prepare('SELECT confiavel, legal, gente_boa FROM vc_karma WHERE de = ? AND para = ?').bind(me.id, p.id),
        c.db.prepare('SELECT c.id, c.nome, c.membros FROM vc_participantes m JOIN vc_comunidades c ON c.id = m.comunidade WHERE m.perfil = ? ORDER BY m.criado_em DESC LIMIT 9').bind(p.id),
        c.db.prepare(`SELECT d.id, d.texto, d.aprovado, d.criado_em, ${AUTOR('a')} FROM vc_depoimentos d JOIN vc_perfis a ON a.id = d.de WHERE d.para = ?1 AND a.banido = 0 AND (d.aprovado = 1 OR ?2 = 1) ORDER BY d.aprovado, d.criado_em DESC LIMIT 30`).bind(p.id, meu ? 1 : 0),
        c.db.prepare(`SELECT r.id, r.texto, r.criado_em, ${AUTOR('a')} FROM vc_recados r JOIN vc_perfis a ON a.id = r.de WHERE r.para = ? AND a.banido = 0 ORDER BY r.criado_em DESC LIMIT 10`).bind(p.id),
        c.db.prepare('SELECT chave, legenda FROM vc_fotos WHERE autor = ? ORDER BY criado_em DESC LIMIT 6').bind(p.id),
        c.db.prepare(`SELECT v.em, ${AUTOR('a')} FROM vc_visitas v JOIN vc_perfis a ON a.id = v.visitante WHERE v.perfil = ?1 AND ?2 = 1 AND a.banido = 0 ORDER BY v.em DESC LIMIT 10`).bind(p.id, meu ? 1 : 0),
        c.db.prepare('SELECT COUNT(*) AS n FROM vc_recados WHERE para = ?').bind(p.id),
      ]);
      const k = karma.results[0] ?? {};
      return {
        perfil: {
          id: p.id,
          usuario: p.usuario,
          nome: p.nome,
          foto: urlFoto(c, p.foto),
          cidade: p.cidade,
          relacionamento: p.relacionamento,
          aniversario: p.aniversario,
          quem_sou_eu: p.quem_sou_eu,
          interesses: p.interesses,
          criado_em: p.criado_em,
          online: p.visto_em > Date.now() - ONLINE_MS,
        },
        meu,
        amizade: meu ? null : await amizade(c.db, me.id, p.id),
        souFa: Boolean(souFa.results.length),
        fas: num(fas.results[0]?.n),
        karma: { votos: num(k.n), confiavel: num(k.confiavel), legal: num(k.legal), gente_boa: num(k.gente_boa) },
        meuKarma: meuKarma.results[0] ?? null,
        amigos: amigos.results.map((r) => resumo(c, r)),
        totalAmigos: num(nAmigos.results[0]?.n),
        comunidades: comunidades.results,
        depoimentos: depoimentos.results.map((r) => ({ id: r.id, texto: r.texto, aprovado: Boolean(r.aprovado), criado_em: r.criado_em, autor: resumo(c, r, 'a_') })),
        recados: recados.results.map((r) => ({ id: r.id, texto: r.texto, criado_em: r.criado_em, autor: resumo(c, r, 'a_') })),
        totalRecados: num(nRecados.results[0]?.n),
        fotos: fotos.results.map((f) => ({ chave: f.chave, url: urlFoto(c, f.chave as string), legenda: f.legenda })),
        visitas: visitas.results.map((r) => ({ em: r.em, ...resumo(c, r, 'a_') })),
      };
    },
  ],
  [
    'GET',
    /^\/vinicut\/u\/([a-z0-9._]+)\/(recados|posts|fotos|amigos)$/,
    async (c, m) => {
      const me = await eu(c);
      const p = await perfilDoUsuario(c.db, m[1]);
      if (await bloqueio(c.db, me.id, p.id)) throw new ErroVc(403, 'Este perfil não está disponível.');
      const antes = num(c.url.searchParams.get('antes')) || Date.now() + 1;
      if (m[2] === 'recados') {
        const r = await c.db.prepare(`SELECT r.id, r.texto, r.criado_em, ${AUTOR('a')} FROM vc_recados r JOIN vc_perfis a ON a.id = r.de WHERE r.para = ? AND a.banido = 0 AND r.criado_em < ? ORDER BY r.criado_em DESC LIMIT 30`).bind(p.id, antes).all<Linha>();
        return { recados: r.results.map((x) => ({ id: x.id, texto: x.texto, criado_em: x.criado_em, autor: resumo(c, x, 'a_') })) };
      }
      if (m[2] === 'posts') {
        const r = await c.db.prepare(postsSql('p.autor = ?3')).bind(me.id, antes, p.id).all<Linha>();
        return { posts: r.results.map((x) => formatarPost(c, x)) };
      }
      if (m[2] === 'fotos') {
        const r = await c.db.prepare('SELECT chave, legenda, criado_em FROM vc_fotos WHERE autor = ? ORDER BY criado_em DESC LIMIT 60').bind(p.id).all<Linha>();
        return { fotos: r.results.map((f) => ({ chave: f.chave, url: urlFoto(c, f.chave as string), legenda: f.legenda, criado_em: f.criado_em })) };
      }
      const r = await c.db.prepare(`SELECT * FROM vc_perfis WHERE banido = 0 AND id IN (${AMIGOS_SQL}) ORDER BY nome LIMIT 500`).bind(p.id).all<Linha>();
      return { amigos: r.results.map((x) => resumo(c, x)) };
    },
  ],
  [
    'POST',
    /^\/vinicut\/u\/([a-z0-9._]+)\/(recados|depoimentos|amizade|fa|karma|bloquear)$/,
    async (c, m) => {
      const me = await eu(c);
      const p = await perfilDoUsuario(c.db, m[1]);
      const d = await corpo(c);
      if (m[2] === 'bloquear') {
        if (p.id === me.id) throw new ErroVc(400, 'Você não pode se bloquear.');
        if (d.sim === false) {
          await c.db.prepare('DELETE FROM vc_bloqueios WHERE de = ? AND bloqueado = ?').bind(me.id, p.id).run();
          return {};
        }
        await c.db.batch([
          c.db.prepare('INSERT OR IGNORE INTO vc_bloqueios (de, bloqueado) VALUES (?, ?)').bind(me.id, p.id),
          c.db.prepare('DELETE FROM vc_amizades WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(me.id, p.id),
          c.db.prepare('DELETE FROM vc_fas WHERE (fa = ?1 AND de = ?2) OR (fa = ?2 AND de = ?1)').bind(me.id, p.id),
        ]);
        return {};
      }
      await semBloqueio(c.db, me.id, p.id);
      switch (m[2]) {
        case 'recados': {
          await limitar(c, me, 'recado', 60, 3600);
          const id = novoId();
          await c.db.prepare('INSERT INTO vc_recados (id, para, de, texto, criado_em) VALUES (?, ?, ?, ?, ?)').bind(id, p.id, me.id, texto(d.texto, 1000, 'o recado'), Date.now()).run();
          await notificar(c.db, p.id, me.id, 'recado', p.usuario);
          return { id };
        }
        case 'depoimentos': {
          if (p.id === me.id) throw new ErroVc(400, 'Depoimento é para os amigos.');
          if ((await amizade(c.db, me.id, p.id)) !== 'amigos') throw new ErroVc(403, 'Só amigos escrevem depoimentos.');
          await limitar(c, me, 'depoimento', 10, 3600);
          const id = novoId();
          await c.db.prepare('INSERT INTO vc_depoimentos (id, para, de, texto, criado_em) VALUES (?, ?, ?, ?, ?)').bind(id, p.id, me.id, texto(d.texto, 2000, 'o depoimento'), Date.now()).run();
          await notificar(c.db, p.id, me.id, 'depoimento', p.usuario);
          return { id };
        }
        case 'amizade': {
          if (p.id === me.id) throw new ErroVc(400, 'Essa é você.');
          const atual = await amizade(c.db, me.id, p.id);
          const acao = String(d.acao);
          if (acao === 'pedir' && atual === 'nenhum') {
            await limitar(c, me, 'amizade', 50, 3600);
            await c.db.prepare('INSERT INTO vc_amizades (a, b, criado_em) VALUES (?, ?, ?)').bind(me.id, p.id, Date.now()).run();
            await notificar(c.db, p.id, me.id, 'amizade', me.usuario);
          } else if (acao === 'aceitar' && atual === 'recebido') {
            await c.db.prepare('UPDATE vc_amizades SET aceita = 1 WHERE a = ? AND b = ?').bind(p.id, me.id).run();
            await notificar(c.db, p.id, me.id, 'aceitou', me.usuario);
          } else if (acao === 'recusar' || acao === 'desfazer') {
            await c.db.prepare('DELETE FROM vc_amizades WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(me.id, p.id).run();
          }
          return { amizade: await amizade(c.db, me.id, p.id) };
        }
        case 'fa': {
          if (p.id === me.id) throw new ErroVc(400, 'Ser fã de si mesma não vale.');
          if (d.sim === false) await c.db.prepare('DELETE FROM vc_fas WHERE fa = ? AND de = ?').bind(me.id, p.id).run();
          else {
            const r = await c.db.prepare('INSERT OR IGNORE INTO vc_fas (fa, de) VALUES (?, ?)').bind(me.id, p.id).run();
            if (r.meta.changes) await notificar(c.db, p.id, me.id, 'fa', me.usuario);
          }
          return {};
        }
        default: {
          // karma: confiável, legal e gente boa, de 0 a 3
          if (p.id === me.id) throw new ErroVc(400, 'O karma vem dos outros.');
          const v = (x: unknown) => Math.max(0, Math.min(3, Math.round(num(x))));
          await c.db
            .prepare('INSERT INTO vc_karma (de, para, confiavel, legal, gente_boa) VALUES (?, ?, ?, ?, ?) ON CONFLICT (de, para) DO UPDATE SET confiavel = excluded.confiavel, legal = excluded.legal, gente_boa = excluded.gente_boa')
            .bind(me.id, p.id, v(d.confiavel), v(d.legal), v(d.gente_boa))
            .run();
          return {};
        }
      }
    },
  ],
  [
    'POST',
    /^\/vinicut\/depoimentos\/([a-z0-9]+)$/,
    async (c, m) => {
      const me = await eu(c);
      const d = await corpo(c);
      const dep = await c.db.prepare('SELECT * FROM vc_depoimentos WHERE id = ? AND para = ?').bind(m[1], me.id).first<Linha>();
      if (!dep) throw new ErroVc(404, 'Depoimento não encontrado.');
      if (d.aprovar === true) await c.db.prepare('UPDATE vc_depoimentos SET aprovado = 1 WHERE id = ?').bind(m[1]).run();
      else await c.db.prepare('DELETE FROM vc_depoimentos WHERE id = ?').bind(m[1]).run();
      return {};
    },
  ],
  [
    'GET',
    /^\/vinicut\/pedidos$/,
    async (c) => {
      const me = await eu(c);
      const r = await c.db.prepare('SELECT p.* FROM vc_amizades f JOIN vc_perfis p ON p.id = f.a WHERE f.b = ? AND f.aceita = 0 AND p.banido = 0 ORDER BY f.criado_em DESC').bind(me.id).all<Linha>();
      return { pedidos: r.results.map((x) => resumo(c, x)) };
    },
  ],

  /* --- Posts --- */
  [
    'POST',
    /^\/vinicut\/posts$/,
    async (c) => {
      const me = await eu(c);
      const d = await corpo(c);
      await limitar(c, me, 'post', 30, 3600);
      const foto = d.foto ? String(d.foto) : null;
      if (foto && !(await c.db.prepare('SELECT 1 FROM vc_fotos WHERE chave = ? AND autor = ?').bind(foto, me.id).first())) throw new ErroVc(400, 'Foto inválida.');
      const t = texto(d.texto, 2000, 'alguma coisa', !foto);
      const id = novoId();
      await c.db.prepare('INSERT INTO vc_posts (id, autor, texto, foto, criado_em) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, t, foto, Date.now()).run();
      return { id };
    },
  ],
  [
    'POST',
    /^\/vinicut\/posts\/([a-z0-9]+)\/(reacao|comentarios)$/,
    async (c, m) => {
      const me = await eu(c);
      const post = await c.db.prepare('SELECT * FROM vc_posts WHERE id = ?').bind(m[1]).first<Linha>();
      if (!post) throw new ErroVc(404, 'Post não encontrado.');
      await semBloqueio(c.db, me.id, post.autor as string);
      const d = await corpo(c);
      if (m[2] === 'reacao') {
        const tipo = d.tipo === null ? null : String(d.tipo);
        if (tipo === null) await c.db.prepare('DELETE FROM vc_reacoes WHERE post = ? AND de = ?').bind(m[1], me.id).run();
        else {
          if (!REACOES.includes(tipo)) throw new ErroVc(400, 'Reação inválida.');
          const antes = await c.db.prepare('SELECT 1 FROM vc_reacoes WHERE post = ? AND de = ?').bind(m[1], me.id).first();
          await c.db.prepare('INSERT INTO vc_reacoes (post, de, tipo) VALUES (?, ?, ?) ON CONFLICT (post, de) DO UPDATE SET tipo = excluded.tipo').bind(m[1], me.id, tipo).run();
          if (!antes) await notificar(c.db, post.autor as string, me.id, 'reacao', m[1]);
        }
        return {};
      }
      await limitar(c, me, 'comentario', 120, 3600);
      const id = novoId();
      await c.db.prepare('INSERT INTO vc_comentarios (id, post, de, texto, criado_em) VALUES (?, ?, ?, ?, ?)').bind(id, m[1], me.id, texto(d.texto, 500, 'o comentário'), Date.now()).run();
      await notificar(c.db, post.autor as string, me.id, 'comentario', m[1]);
      return { id };
    },
  ],
  [
    'GET',
    /^\/vinicut\/posts\/([a-z0-9]+)\/comentarios$/,
    async (c, m) => {
      const me = await eu(c);
      const r = await c.db
        .prepare(`SELECT k.id, k.texto, k.criado_em, ${AUTOR('a')} FROM vc_comentarios k JOIN vc_perfis a ON a.id = k.de WHERE k.post = ?1 AND a.banido = 0 AND k.de NOT IN (SELECT bloqueado FROM vc_bloqueios WHERE de = ?2) ORDER BY k.criado_em LIMIT 200`)
        .bind(m[1], me.id)
        .all<Linha>();
      return { comentarios: r.results.map((x) => ({ id: x.id, texto: x.texto, criado_em: x.criado_em, autor: resumo(c, x, 'a_') })) };
    },
  ],

  /* --- Apagar o que é meu (ou do meu mural) --- */
  [
    'DELETE',
    /^\/vinicut\/(recados|posts|comentarios|depoimentos|fotos|respostas|topicos)\/([A-Za-z0-9/._-]+)$/,
    async (c, m) => {
      const me = await eu(c);
      const id = m[2];
      const regras: Record<string, [string, string[]]> = {
        recados: ['SELECT 1 FROM vc_recados WHERE id = ?1 AND (de = ?2 OR para = ?2)', ['DELETE FROM vc_recados WHERE id = ?1']],
        posts: ['SELECT 1 FROM vc_posts WHERE id = ?1 AND autor = ?2', ['DELETE FROM vc_comentarios WHERE post = ?1', 'DELETE FROM vc_reacoes WHERE post = ?1', 'DELETE FROM vc_posts WHERE id = ?1']],
        comentarios: ['SELECT 1 FROM vc_comentarios k JOIN vc_posts p ON p.id = k.post WHERE k.id = ?1 AND (k.de = ?2 OR p.autor = ?2)', ['DELETE FROM vc_comentarios WHERE id = ?1']],
        depoimentos: ['SELECT 1 FROM vc_depoimentos WHERE id = ?1 AND (de = ?2 OR para = ?2)', ['DELETE FROM vc_depoimentos WHERE id = ?1']],
        fotos: ['SELECT 1 FROM vc_fotos WHERE chave = ?1 AND autor = ?2', ['DELETE FROM vc_fotos WHERE chave = ?1', 'UPDATE vc_perfis SET foto = NULL WHERE foto = ?1', 'UPDATE vc_posts SET foto = NULL WHERE foto = ?1']],
        respostas: ['SELECT 1 FROM vc_respostas WHERE id = ?1 AND autor = ?2', ['UPDATE vc_topicos SET respostas = respostas - 1 WHERE id = (SELECT topico FROM vc_respostas WHERE id = ?1)', 'DELETE FROM vc_respostas WHERE id = ?1']],
        topicos: ['SELECT 1 FROM vc_topicos t JOIN vc_comunidades c ON c.id = t.comunidade WHERE t.id = ?1 AND (t.autor = ?2 OR c.dono = ?2)', ['DELETE FROM vc_respostas WHERE topico = ?1', 'DELETE FROM vc_topicos WHERE id = ?1']],
      };
      const [confere, apagar] = regras[m[1]];
      if (!(await c.db.prepare(confere).bind(id, me.id).first())) throw new ErroVc(404, 'Não encontrado (ou não é seu).');
      await c.db.batch(apagar.map((sql) => c.db.prepare(sql).bind(id)));
      if (m[1] === 'fotos') await c.env.FOTOS.delete(id);
      return {};
    },
  ],

  /* --- Comunidades --- */
  [
    'GET',
    /^\/vinicut\/comunidades$/,
    async (c) => {
      const me = await eu(c);
      const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 60);
      const r = q
        ? await c.db.prepare('SELECT id, nome, descricao, categoria, membros FROM vc_comunidades WHERE nome LIKE ? ORDER BY membros DESC LIMIT 40').bind(`%${q}%`).all<Linha>()
        : await c.db.prepare('SELECT id, nome, descricao, categoria, membros FROM vc_comunidades ORDER BY membros DESC, criado_em DESC LIMIT 40').all<Linha>();
      const minhas = await c.db.prepare('SELECT c.id, c.nome, c.membros FROM vc_participantes m JOIN vc_comunidades c ON c.id = m.comunidade WHERE m.perfil = ? ORDER BY c.nome').bind(me.id).all<Linha>();
      return { comunidades: r.results, minhas: minhas.results };
    },
  ],
  [
    'POST',
    /^\/vinicut\/comunidades$/,
    async (c) => {
      const me = await eu(c);
      const d = await corpo(c);
      await limitar(c, me, 'comunidade', 5, 86400);
      const nome = texto(d.nome, 80, 'o nome da comunidade');
      if (await c.db.prepare('SELECT 1 FROM vc_comunidades WHERE lower(nome) = lower(?)').bind(nome).first()) throw new ErroVc(409, 'Já existe uma comunidade com esse nome.');
      const id = novoId();
      const agora = Date.now();
      await c.db.batch([
        c.db.prepare('INSERT INTO vc_comunidades (id, nome, descricao, categoria, dono, membros, criado_em) VALUES (?, ?, ?, ?, ?, 1, ?)').bind(id, nome, texto(d.descricao, 1000, '', false), texto(d.categoria, 40, '', false), me.id, agora),
        c.db.prepare('INSERT INTO vc_participantes (comunidade, perfil, criado_em) VALUES (?, ?, ?)').bind(id, me.id, agora),
      ]);
      return { id };
    },
  ],
  [
    'GET',
    /^\/vinicut\/c\/([a-z0-9]+)$/,
    async (c, m) => {
      const me = await eu(c);
      const com = await c.db.prepare(`SELECT c.*, ${AUTOR('a')} FROM vc_comunidades c JOIN vc_perfis a ON a.id = c.dono WHERE c.id = ?`).bind(m[1]).first<Linha>();
      if (!com) throw new ErroVc(404, 'Comunidade não encontrada.');
      const [membro, topicos, membros] = await c.db.batch<Linha>([
        c.db.prepare('SELECT 1 AS sim FROM vc_participantes WHERE comunidade = ? AND perfil = ?').bind(m[1], me.id),
        c.db.prepare(`SELECT t.id, t.titulo, t.respostas, t.atualizado_em, ${AUTOR('a')} FROM vc_topicos t JOIN vc_perfis a ON a.id = t.autor WHERE t.comunidade = ? AND a.banido = 0 ORDER BY t.atualizado_em DESC LIMIT 50`).bind(m[1]),
        c.db.prepare('SELECT p.* FROM vc_participantes m JOIN vc_perfis p ON p.id = m.perfil WHERE m.comunidade = ? AND p.banido = 0 ORDER BY m.criado_em DESC LIMIT 9').bind(m[1]),
      ]);
      return {
        comunidade: { id: com.id, nome: com.nome, descricao: com.descricao, categoria: com.categoria, membros: com.membros, criado_em: com.criado_em, dono: resumo(c, com, 'a_') },
        souMembro: Boolean(membro.results.length),
        souDono: com.dono === me.id,
        topicos: topicos.results.map((t) => ({ id: t.id, titulo: t.titulo, respostas: t.respostas, atualizado_em: t.atualizado_em, autor: resumo(c, t, 'a_') })),
        membros: membros.results.map((r) => resumo(c, r)),
      };
    },
  ],
  [
    'POST',
    /^\/vinicut\/c\/([a-z0-9]+)\/(participar|topicos)$/,
    async (c, m) => {
      const me = await eu(c);
      const d = await corpo(c);
      const com = await c.db.prepare('SELECT * FROM vc_comunidades WHERE id = ?').bind(m[1]).first<Linha>();
      if (!com) throw new ErroVc(404, 'Comunidade não encontrada.');
      const membro = await c.db.prepare('SELECT 1 FROM vc_participantes WHERE comunidade = ? AND perfil = ?').bind(m[1], me.id).first();
      if (m[2] === 'participar') {
        if (d.sim === false && membro) {
          if (com.dono === me.id) throw new ErroVc(400, 'O dono não sai da própria comunidade.');
          await c.db.batch([c.db.prepare('DELETE FROM vc_participantes WHERE comunidade = ? AND perfil = ?').bind(m[1], me.id), c.db.prepare('UPDATE vc_comunidades SET membros = membros - 1 WHERE id = ?').bind(m[1])]);
        } else if (d.sim !== false && !membro) {
          await c.db.batch([c.db.prepare('INSERT INTO vc_participantes (comunidade, perfil, criado_em) VALUES (?, ?, ?)').bind(m[1], me.id, Date.now()), c.db.prepare('UPDATE vc_comunidades SET membros = membros + 1 WHERE id = ?').bind(m[1])]);
        }
        return {};
      }
      if (!membro) throw new ErroVc(403, 'Participe da comunidade para criar tópicos.');
      await limitar(c, me, 'topico', 20, 3600);
      const id = novoId();
      const agora = Date.now();
      await c.db.prepare('INSERT INTO vc_topicos (id, comunidade, autor, titulo, texto, atualizado_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, m[1], me.id, texto(d.titulo, 120, 'o título'), texto(d.texto, 5000, 'a mensagem'), agora, agora).run();
      return { id };
    },
  ],
  [
    'GET',
    /^\/vinicut\/t\/([a-z0-9]+)$/,
    async (c, m) => {
      const me = await eu(c);
      const t = await c.db.prepare(`SELECT t.*, c.nome AS comunidade_nome, c.dono AS comunidade_dono, ${AUTOR('a')} FROM vc_topicos t JOIN vc_comunidades c ON c.id = t.comunidade JOIN vc_perfis a ON a.id = t.autor WHERE t.id = ?`).bind(m[1]).first<Linha>();
      if (!t) throw new ErroVc(404, 'Tópico não encontrado.');
      const [r, membro] = await c.db.batch<Linha>([
        c.db.prepare(`SELECT r.id, r.texto, r.criado_em, ${AUTOR('a')} FROM vc_respostas r JOIN vc_perfis a ON a.id = r.autor WHERE r.topico = ?1 AND a.banido = 0 AND r.autor NOT IN (SELECT bloqueado FROM vc_bloqueios WHERE de = ?2) ORDER BY r.criado_em LIMIT 300`).bind(m[1], me.id),
        c.db.prepare('SELECT 1 AS sim FROM vc_participantes WHERE comunidade = ? AND perfil = ?').bind(t.comunidade, me.id),
      ]);
      return {
        topico: { id: t.id, titulo: t.titulo, texto: t.texto, criado_em: t.criado_em, autor: resumo(c, t, 'a_'), comunidade: { id: t.comunidade, nome: t.comunidade_nome } },
        souMembro: Boolean(membro.results.length),
        podeApagar: t.autor === me.id || t.comunidade_dono === me.id,
        respostas: r.results.map((x) => ({ id: x.id, texto: x.texto, criado_em: x.criado_em, autor: resumo(c, x, 'a_') })),
      };
    },
  ],
  [
    'POST',
    /^\/vinicut\/t\/([a-z0-9]+)\/respostas$/,
    async (c, m) => {
      const me = await eu(c);
      const t = await c.db.prepare('SELECT * FROM vc_topicos WHERE id = ?').bind(m[1]).first<Linha>();
      if (!t) throw new ErroVc(404, 'Tópico não encontrado.');
      if (!(await c.db.prepare('SELECT 1 FROM vc_participantes WHERE comunidade = ? AND perfil = ?').bind(t.comunidade, me.id).first())) throw new ErroVc(403, 'Participe da comunidade para responder.');
      await limitar(c, me, 'resposta', 120, 3600);
      const d = await corpo(c);
      const id = novoId();
      const agora = Date.now();
      await c.db.batch([
        c.db.prepare('INSERT INTO vc_respostas (id, topico, autor, texto, criado_em) VALUES (?, ?, ?, ?, ?)').bind(id, m[1], me.id, texto(d.texto, 5000, 'a resposta'), agora),
        c.db.prepare('UPDATE vc_topicos SET respostas = respostas + 1, atualizado_em = ? WHERE id = ?').bind(agora, m[1]),
      ]);
      await notificar(c.db, t.autor as string, me.id, 'resposta', m[1]);
      return { id };
    },
  ],

  /* --- Fotos (R2) --- */
  [
    'POST',
    /^\/vinicut\/fotos$/,
    async (c) => {
      const me = await eu(c);
      await limitar(c, me, 'foto', 40, 3600);
      const tipo = (c.req.headers.get('Content-Type') ?? '').split(';')[0].trim();
      if (!TIPOS_FOTO.includes(tipo)) throw new ErroVc(400, 'Envie uma imagem JPG, PNG ou WebP.');
      const dados = await c.req.arrayBuffer();
      if (!dados.byteLength || dados.byteLength > MAX_FOTO) throw new ErroVc(413, 'A foto precisa ter até 1,5 MB.');
      const chave = `${me.id}/${novoId()}.${tipo.split('/')[1].replace('jpeg', 'jpg')}`;
      await c.env.FOTOS.put(chave, dados, { httpMetadata: { contentType: tipo, cacheControl: 'public, max-age=31536000, immutable' } });
      const legenda = texto(decodeURIComponent(c.req.headers.get('X-Legenda') ?? ''), 200, '', false);
      await c.db.prepare('INSERT INTO vc_fotos (chave, autor, legenda, criado_em) VALUES (?, ?, ?, ?)').bind(chave, me.id, legenda, Date.now()).run();
      return { chave, url: urlFoto(c, chave) };
    },
  ],

  /* --- Notificações e busca --- */
  [
    'GET',
    /^\/vinicut\/notificacoes$/,
    async (c) => {
      const me = await eu(c);
      const r = await c.db.prepare(`SELECT n.id, n.tipo, n.ref, n.lida, n.criado_em, ${AUTOR('a')} FROM vc_notificacoes n JOIN vc_perfis a ON a.id = n.de WHERE n.para = ? AND a.banido = 0 ORDER BY n.criado_em DESC LIMIT 40`).bind(me.id).all<Linha>();
      return { notificacoes: r.results.map((n) => ({ id: n.id, tipo: n.tipo, ref: n.ref, lida: Boolean(n.lida), criado_em: n.criado_em, de: resumo(c, n, 'a_') })) };
    },
  ],
  [
    'POST',
    /^\/vinicut\/notificacoes\/lidas$/,
    async (c) => {
      const me = await eu(c);
      await c.db.prepare('UPDATE vc_notificacoes SET lida = 1 WHERE para = ? AND lida = 0').bind(me.id).run();
      // Guarda só as últimas 200 de cada pessoa.
      await c.db.prepare('DELETE FROM vc_notificacoes WHERE para = ?1 AND id NOT IN (SELECT id FROM vc_notificacoes WHERE para = ?1 ORDER BY criado_em DESC LIMIT 200)').bind(me.id).run();
      return {};
    },
  ],
  [
    'GET',
    /^\/vinicut\/busca$/,
    async (c) => {
      const me = await eu(c);
      const q = (c.url.searchParams.get('q') ?? '').trim().slice(0, 60);
      if (q.length < 2) return { pessoas: [], comunidades: [] };
      const like = `%${q.replace(/^@/, '')}%`;
      const [p, k] = await c.db.batch<Linha>([
        c.db.prepare('SELECT * FROM vc_perfis WHERE banido = 0 AND (nome LIKE ?1 OR usuario LIKE ?1) AND id NOT IN (SELECT de FROM vc_bloqueios WHERE bloqueado = ?2) ORDER BY visto_em DESC LIMIT 20').bind(like, me.id),
        c.db.prepare('SELECT id, nome, descricao, membros FROM vc_comunidades WHERE nome LIKE ? ORDER BY membros DESC LIMIT 20').bind(like),
      ]);
      return { pessoas: p.results.map((x) => resumo(c, x)), comunidades: k.results };
    },
  ],

  /* --- Denúncias e moderação --- */
  [
    'POST',
    /^\/vinicut\/denunciar$/,
    async (c) => {
      const me = await eu(c);
      const d = await corpo(c);
      await limitar(c, me, 'denuncia', 20, 3600);
      const tipo = String(d.tipo);
      if (!TIPOS_DENUNCIA.includes(tipo)) throw new ErroVc(400, 'Tipo de denúncia inválido.');
      await c.db.prepare('INSERT INTO vc_denuncias (id, de, tipo, alvo, motivo, criado_em) VALUES (?, ?, ?, ?, ?, ?)').bind(novoId(), me.id, tipo, String(d.alvo ?? '').slice(0, 120), texto(d.motivo, 500, 'o motivo'), Date.now()).run();
      return {};
    },
  ],
  [
    'GET',
    /^\/vinicut\/moderacao$/,
    async (c) => {
      await admin(c);
      const r = await c.db.prepare(`SELECT d.*, ${AUTOR('a')} FROM vc_denuncias d JOIN vc_perfis a ON a.id = d.de WHERE d.resolvida = 0 ORDER BY d.criado_em LIMIT 100`).all<Linha>();
      const lista = [];
      for (const d of r.results) lista.push({ id: d.id, tipo: d.tipo, alvo: d.alvo, motivo: d.motivo, criado_em: d.criado_em, de: resumo(c, d, 'a_'), conteudo: await conteudoDenunciado(c, d.tipo as string, d.alvo as string) });
      return { denuncias: lista };
    },
  ],
  [
    'POST',
    /^\/vinicut\/moderacao$/,
    async (c) => {
      await admin(c);
      const d = await corpo(c);
      const den = await c.db.prepare('SELECT * FROM vc_denuncias WHERE id = ?').bind(String(d.id)).first<Linha>();
      if (!den) throw new ErroVc(404, 'Denúncia não encontrada.');
      const acao = String(d.acao);
      const alvo = await conteudoDenunciado(c, den.tipo as string, den.alvo as string);
      if (acao === 'remover' || acao === 'banir') {
        await removerConteudo(c, den.tipo as string, den.alvo as string);
        if (acao === 'banir' && alvo?.autorId) await c.db.prepare('UPDATE vc_perfis SET banido = 1 WHERE id = ?').bind(alvo.autorId).run();
      }
      await c.db.prepare('UPDATE vc_denuncias SET resolvida = 1 WHERE tipo = ? AND alvo = ?').bind(den.tipo, den.alvo).run();
      return {};
    },
  ],
];

async function admin(c: Ctx) {
  const email = await emailDaSessao(c);
  const admins = (c.env.VINICUT_ADMINS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(email)) throw new ErroVc(403, 'Só para a moderação.');
}

const TABELA_DENUNCIA: Record<string, [string, string, string]> = {
  // tipo → [tabela, coluna do id, coluna do autor]
  recado: ['vc_recados', 'id', 'de'],
  depoimento: ['vc_depoimentos', 'id', 'de'],
  post: ['vc_posts', 'id', 'autor'],
  comentario: ['vc_comentarios', 'id', 'de'],
  comunidade: ['vc_comunidades', 'id', 'dono'],
  topico: ['vc_topicos', 'id', 'autor'],
  resposta: ['vc_respostas', 'id', 'autor'],
  foto: ['vc_fotos', 'chave', 'autor'],
};

/** O conteúdo denunciado (texto e autor) para a moderação decidir. */
async function conteudoDenunciado(c: Ctx, tipo: string, alvo: string): Promise<{ texto: string; autorId: string; autor: string; foto?: string | null } | null> {
  if (tipo === 'perfil') {
    const p = await c.db.prepare('SELECT * FROM vc_perfis WHERE id = ? OR usuario = ?').bind(alvo, alvo).first<Perfil>();
    return p ? { texto: `${p.nome} (@${p.usuario}): ${p.quem_sou_eu}`, autorId: p.id, autor: p.usuario, foto: urlFoto(c, p.foto) } : null;
  }
  const t = TABELA_DENUNCIA[tipo];
  if (!t) return null;
  const r = await c.db.prepare(`SELECT x.*, p.usuario AS autor_usuario FROM ${t[0]} x JOIN vc_perfis p ON p.id = x.${t[2]} WHERE x.${t[1]} = ?`).bind(alvo).first<Linha>();
  if (!r) return null;
  const txt = [r.titulo, r.nome, r.texto, r.descricao, r.legenda].filter(Boolean).join(' · ');
  return { texto: String(txt), autorId: r[t[2]] as string, autor: r.autor_usuario as string, foto: tipo === 'foto' ? urlFoto(c, alvo) : r.foto ? urlFoto(c, r.foto as string) : null };
}

async function removerConteudo(c: Ctx, tipo: string, alvo: string) {
  if (tipo === 'perfil') return; // perfil: só banindo
  const t = TABELA_DENUNCIA[tipo];
  if (!t) return;
  if (tipo === 'post') await c.db.batch([c.db.prepare('DELETE FROM vc_comentarios WHERE post = ?').bind(alvo), c.db.prepare('DELETE FROM vc_reacoes WHERE post = ?').bind(alvo)]);
  if (tipo === 'topico') await c.db.prepare('DELETE FROM vc_respostas WHERE topico = ?').bind(alvo).run();
  if (tipo === 'comunidade') await c.db.batch([c.db.prepare('DELETE FROM vc_respostas WHERE topico IN (SELECT id FROM vc_topicos WHERE comunidade = ?)').bind(alvo), c.db.prepare('DELETE FROM vc_topicos WHERE comunidade = ?').bind(alvo), c.db.prepare('DELETE FROM vc_participantes WHERE comunidade = ?').bind(alvo)]);
  if (tipo === 'foto') {
    await c.env.FOTOS.delete(alvo);
    await c.db.batch([c.db.prepare('UPDATE vc_perfis SET foto = NULL WHERE foto = ?').bind(alvo), c.db.prepare('UPDATE vc_posts SET foto = NULL WHERE foto = ?').bind(alvo)]);
  }
  await c.db.prepare(`DELETE FROM ${t[0]} WHERE ${t[1]} = ?`).bind(alvo).run();
}

/** Atende /vinicut/... (ou devolve null se não for daqui). */
export async function rotasVinicut(req: Request, env: Env, url: URL, origem: string | null): Promise<Response | null> {
  const caminho = url.pathname.replace(/\/+$/, '');
  if (!caminho.startsWith('/vinicut/')) return null;
  const cabecalhos = (extra: Record<string, string> = {}) => {
    const h = new Headers({ 'Cache-Control': 'no-store', ...extra });
    if (origem) {
      h.set('Access-Control-Allow-Origin', origem);
      h.set('Vary', 'Origin');
    }
    return h;
  };
  // Fotos: públicas (qualquer site pode mostrar), com cache longo.
  const foto = caminho.match(/^\/vinicut\/f\/([A-Za-z0-9]+\/[A-Za-z0-9]+\.(?:jpg|png|webp))$/);
  if (foto && req.method === 'GET') {
    const obj = await env.FOTOS.get(foto[1]);
    if (!obj) return new Response('não encontrada', { status: 404 });
    return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
  }
  if (!origem) return new Response(JSON.stringify({ erro: 'origem não permitida' }), { status: 403, headers: cabecalhos({ 'Content-Type': 'application/json' }) });
  const c: Ctx = { req, env, db: env.DB, url, origem };
  for (const [metodo, re, fn] of rotas) {
    if (metodo !== req.method) continue;
    const m = caminho.match(re);
    if (!m) continue;
    try {
      const r = await fn(c, m);
      return new Response(JSON.stringify(r ?? {}), { headers: cabecalhos({ 'Content-Type': 'application/json' }) });
    } catch (e) {
      const status = e instanceof ErroVc ? e.status : e instanceof ErroSx ? 400 : 500;
      if (status === 500) console.error(e);
      return new Response(JSON.stringify({ erro: status === 500 ? 'Erro no servidor. Tente de novo.' : (e as Error).message }), { status, headers: cabecalhos({ 'Content-Type': 'application/json' }) });
    }
  }
  return new Response(JSON.stringify({ erro: 'não encontrado' }), { status: 404, headers: cabecalhos({ 'Content-Type': 'application/json' }) });
}
