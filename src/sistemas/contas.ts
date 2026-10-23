// Contas dos sistemas de gestão (e-mail e senha), equipes e membros, no D1.
// Senha: PBKDF2-SHA256 com sal. Sessão: token aleatório; no banco só fica o hash dele.
// Uma conta pode estar em várias equipes; cada equipe tem um dono e membros (gerente ou operador).

import { ErroSx } from './empresa';

export const ITERACOES = 100000;
const DIAS_CONTA = 60;
const DIAS_EQUIPE = 60;
const RENOVAR_DIAS = 15;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PAPEIS = ['dono', 'gerente', 'operador'] as const;
export type Papel = (typeof PAPEIS)[number];

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function aleatorio(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64(b);
}

async function sha256(s: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Hash da senha (PBKDF2-SHA256). Pesado de propósito: roda num Durable Object, que tem mais tempo de CPU que o Worker. */
export async function hashSenha(senha: string, sal: string, iteracoes: number): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(sal), iterations: iteracoes }, chave, 256));
}

let derivador: (senha: string, sal: string, iteracoes: number) => Promise<string> = hashSenha;
/** As rotas trocam o cálculo do hash pelo do Durable Object (index.ts não tem CPU sobrando no plano grátis). */
export function usarDerivador(fn: typeof derivador): void {
  derivador = fn;
}
const derivar = (senha: string, sal: string, iteracoes: number) => derivador(senha, sal, iteracoes);

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function limparEmail(v: unknown): string {
  const e = String(v ?? '').trim().toLowerCase().slice(0, 120);
  if (!EMAIL_RE.test(e)) throw new ErroSx('invalido', 'E-mail inválido.');
  return e;
}

function validarSenha(v: unknown): string {
  const s = String(v ?? '');
  if (s.length < 6) throw new ErroSx('invalido', 'A senha precisa ter pelo menos 6 caracteres.');
  if (s.length > 200) throw new ErroSx('invalido', 'Senha comprida demais.');
  return s;
}

/** Limite de tentativas por chave (login, cadastro), guardado no D1. */
export async function limite(db: D1Database, chave: string, max: number, segundos: number): Promise<void> {
  const agora = Date.now();
  const r = await db
    .prepare('INSERT INTO sx_limites (chave, n, ate) VALUES (?1, 1, ?2) ON CONFLICT (chave) DO UPDATE SET n = CASE WHEN ate < ?3 THEN 1 ELSE n + 1 END, ate = CASE WHEN ate < ?3 THEN ?2 ELSE ate END RETURNING n')
    .bind(chave, agora + segundos * 1000, agora)
    .first<{ n: number }>();
  if ((r?.n ?? 0) > max) throw new ErroSx('limite', 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.');
}

/* ---------- Sessões ---------- */

async function novaSessao(db: D1Database, email: string, equipe: string | null, dias: number): Promise<string> {
  const token = aleatorio(32);
  await db.prepare('INSERT INTO sx_sessoes (token_hash, email, equipe_id, expira) VALUES (?, ?, ?, ?)').bind(await sha256(token), email, equipe, Date.now() + dias * 86400000).run();
  return token;
}

export function tokenDoCorpo(corpo: Record<string, unknown>): string {
  return String(corpo.authorization ?? corpo.token ?? '').replace(/^Bearer\s+/i, '').trim();
}

/** Sessão da conta (sem equipe). */
export async function contaDaSessao(db: D1Database, token: string): Promise<string> {
  if (!token) throw new ErroSx('sessao', 'Entre de novo com seu e-mail e senha.');
  const r = await db.prepare('SELECT email FROM sx_sessoes WHERE token_hash = ? AND equipe_id IS NULL AND expira > ?').bind(await sha256(token), Date.now()).first<{ email: string }>();
  if (!r) throw new ErroSx('sessao', 'Sessão expirada. Entre de novo com seu e-mail e senha.');
  return r.email;
}

/** Sessão do sistema de uma equipe: confere se ainda é membro e devolve o papel (e um token novo perto de vencer). */
export async function sessaoDaEquipe(db: D1Database, token: string, equipe: string): Promise<{ email: string; papel: Papel; novoToken?: string }> {
  if (!token) throw new ErroSx('sessao', 'Entre de novo com seu e-mail e senha.');
  const hash = await sha256(token);
  const r = await db
    .prepare('SELECT s.email, s.expira, m.papel FROM sx_sessoes s LEFT JOIN sx_membros m ON m.equipe_id = s.equipe_id AND m.email = s.email WHERE s.token_hash = ? AND s.equipe_id = ?')
    .bind(hash, equipe)
    .first<{ email: string; expira: number; papel: Papel | null }>();
  if (!r || r.expira < Date.now()) throw new ErroSx('sessao', 'Sessão expirada. Entre de novo.');
  if (!r.papel) throw new ErroSx('sessao', 'Seu acesso a esta equipe foi removido.');
  let novoToken: string | undefined;
  if (r.expira - Date.now() < RENOVAR_DIAS * 86400000) {
    novoToken = await novaSessao(db, r.email, equipe, DIAS_EQUIPE);
    await db.prepare('DELETE FROM sx_sessoes WHERE token_hash = ?').bind(hash).run();
  }
  return { email: r.email, papel: r.papel, novoToken };
}

/* ---------- Contas ---------- */

export interface EquipeDaConta {
  id: string;
  nome: string;
  nicho: string;
  papel: Papel;
}

export async function equipesDe(db: D1Database, email: string): Promise<EquipeDaConta[]> {
  const r = await db.prepare('SELECT e.id, e.nome, e.nicho, m.papel FROM sx_membros m JOIN sx_equipes e ON e.id = m.equipe_id WHERE m.email = ? ORDER BY e.criado_em').bind(email).all<EquipeDaConta>();
  return r.results;
}

export async function cadastrar(db: D1Database, emailBruto: unknown, senhaBruta: unknown, ip: string) {
  const email = limparEmail(emailBruto);
  const senha = validarSenha(senhaBruta);
  await limite(db, `cad:${ip}`, 20, 3600);
  const existe = await db.prepare('SELECT 1 FROM sx_contas WHERE email = ?').bind(email).first();
  if (existe) throw new ErroSx('existe', 'Já existe uma conta com este e-mail. Use "Entrar".');
  const sal = aleatorio(16);
  await db.prepare('INSERT INTO sx_contas (email, hash, sal, iteracoes, criado_em) VALUES (?, ?, ?, ?, ?)').bind(email, await derivar(senha, sal, ITERACOES), sal, ITERACOES, Date.now()).run();
  return { email, token: await novaSessao(db, email, null, DIAS_CONTA), equipes: await equipesDe(db, email), trocarSenha: false };
}

export async function entrar(db: D1Database, emailBruto: unknown, senhaBruta: unknown) {
  const email = limparEmail(emailBruto);
  const senha = String(senhaBruta ?? '');
  await limite(db, `login:${email}`, 10, 900);
  const c = await db.prepare('SELECT hash, sal, iteracoes, temporaria FROM sx_contas WHERE email = ?').bind(email).first<{ hash: string; sal: string; iteracoes: number; temporaria: number }>();
  if (!c || !iguais(await derivar(senha, c.sal, c.iteracoes), c.hash)) throw new ErroSx('login', 'E-mail ou senha incorretos.');
  return { email, token: await novaSessao(db, email, null, DIAS_CONTA), equipes: await equipesDe(db, email), trocarSenha: c.temporaria === 1 };
}

export async function trocarSenha(db: D1Database, email: string, atual: unknown, nova: unknown): Promise<void> {
  const c = await db.prepare('SELECT hash, sal, iteracoes FROM sx_contas WHERE email = ?').bind(email).first<{ hash: string; sal: string; iteracoes: number }>();
  if (!c || !iguais(await derivar(String(atual ?? ''), c.sal, c.iteracoes), c.hash)) throw new ErroSx('login', 'A senha atual está incorreta.');
  const senha = validarSenha(nova);
  const sal = aleatorio(16);
  await db.prepare('UPDATE sx_contas SET hash = ?, sal = ?, iteracoes = ?, temporaria = 0 WHERE email = ?').bind(await derivar(senha, sal, ITERACOES), sal, ITERACOES, email).run();
}

export async function sair(db: D1Database, token: string, todas: boolean): Promise<void> {
  const hash = await sha256(token);
  if (!todas) {
    await db.prepare('DELETE FROM sx_sessoes WHERE token_hash = ?').bind(hash).run();
    return;
  }
  const r = await db.prepare('SELECT email FROM sx_sessoes WHERE token_hash = ?').bind(hash).first<{ email: string }>();
  if (r) await db.prepare('DELETE FROM sx_sessoes WHERE email = ?').bind(r.email).run();
}

/* ---------- Equipes ---------- */

export async function papelNaEquipe(db: D1Database, email: string, equipe: string): Promise<Papel | null> {
  const r = await db.prepare('SELECT papel FROM sx_membros WHERE equipe_id = ? AND email = ?').bind(equipe, email).first<{ papel: Papel }>();
  return r?.papel ?? null;
}

export async function criarEquipe(db: D1Database, email: string, nomeBruto: unknown, nichoBruto: unknown): Promise<EquipeDaConta> {
  const nome = String(nomeBruto ?? '').trim().slice(0, 80);
  if (!nome) throw new ErroSx('invalido', 'Dê um nome para a equipe (o nome do seu negócio).');
  const nicho = String(nichoBruto ?? '').replace(/[^a-z-]/g, '').slice(0, 40) || 'geral';
  const total = await db.prepare("SELECT COUNT(*) AS n FROM sx_membros WHERE email = ? AND papel = 'dono'").bind(email).first<{ n: number }>();
  if ((total?.n ?? 0) >= 10) throw new ErroSx('limite', 'Cada conta pode criar até 10 equipes.');
  const id = aleatorio(12).replace(/[-_]/g, 'x');
  const agora = Date.now();
  await db.batch([db.prepare('INSERT INTO sx_equipes (id, nome, nicho, dono, criado_em) VALUES (?, ?, ?, ?, ?)').bind(id, nome, nicho, email, agora), db.prepare("INSERT INTO sx_membros (equipe_id, email, papel, criado_em) VALUES (?, ?, 'dono', ?)").bind(id, email, agora)]);
  return { id, nome, nicho, papel: 'dono' };
}

export async function abrirEquipe(db: D1Database, email: string, equipe: string) {
  const papel = await papelNaEquipe(db, email, equipe);
  if (!papel) throw new ErroSx('acesso', 'Você não faz parte desta equipe.');
  const e = await db.prepare('SELECT nome, nicho FROM sx_equipes WHERE id = ?').bind(equipe).first<{ nome: string; nicho: string }>();
  return { papel, empresa: e?.nome ?? '', nicho: e?.nicho ?? '', token: await novaSessao(db, email, equipe, DIAS_EQUIPE) };
}

export async function renomearEquipe(db: D1Database, email: string, equipe: string, nomeBruto: unknown): Promise<void> {
  if ((await papelNaEquipe(db, email, equipe)) !== 'dono') throw new ErroSx('acesso', 'Só o dono pode renomear a equipe.');
  const nome = String(nomeBruto ?? '').trim().slice(0, 80);
  if (!nome) throw new ErroSx('invalido', 'Informe o nome.');
  await db.prepare('UPDATE sx_equipes SET nome = ? WHERE id = ?').bind(nome, equipe).run();
}

/* ---------- Membros ---------- */

async function gestor(db: D1Database, email: string, equipe: string): Promise<Papel> {
  const papel = await papelNaEquipe(db, email, equipe);
  if (papel !== 'dono' && papel !== 'gerente') throw new ErroSx('acesso', 'Só o dono e os gerentes cuidam da equipe.');
  return papel;
}

export async function membros(db: D1Database, email: string, equipe: string) {
  await gestor(db, email, equipe);
  const r = await db
    .prepare('SELECT m.email, m.papel, m.criado_em, c.email IS NOT NULL AS tem_conta FROM sx_membros m LEFT JOIN sx_contas c ON c.email = m.email WHERE m.equipe_id = ? ORDER BY CASE m.papel WHEN \'dono\' THEN 0 WHEN \'gerente\' THEN 1 ELSE 2 END, m.criado_em')
    .bind(equipe)
    .all<{ email: string; papel: Papel; criado_em: number; tem_conta: number }>();
  return r.results.map((m) => ({ email: m.email, papel: m.papel, temConta: Boolean(m.tem_conta) }));
}

export async function salvarMembro(db: D1Database, email: string, equipe: string, alvoBruto: unknown, papelBruto: unknown): Promise<void> {
  const meu = await gestor(db, email, equipe);
  const alvo = limparEmail(alvoBruto);
  const papel = String(papelBruto) as Papel;
  if (papel !== 'gerente' && papel !== 'operador') throw new ErroSx('invalido', 'Papel inválido: gerente ou operador.');
  if (meu === 'gerente' && papel === 'gerente') throw new ErroSx('acesso', 'Só o dono pode adicionar gerentes.');
  const atual = await papelNaEquipe(db, alvo, equipe);
  if (atual === 'dono') throw new ErroSx('acesso', 'O papel do dono não muda.');
  if (meu === 'gerente' && atual === 'gerente') throw new ErroSx('acesso', 'Só o dono muda outro gerente.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM sx_membros WHERE equipe_id = ?').bind(equipe).first<{ n: number }>();
  if (!atual && (n?.n ?? 0) >= 50) throw new ErroSx('limite', 'A equipe chegou a 50 pessoas.');
  await db.prepare('INSERT INTO sx_membros (equipe_id, email, papel, criado_em) VALUES (?, ?, ?, ?) ON CONFLICT (equipe_id, email) DO UPDATE SET papel = excluded.papel').bind(equipe, alvo, papel, Date.now()).run();
}

export async function removerMembro(db: D1Database, email: string, equipe: string, alvoBruto: unknown): Promise<void> {
  const meu = await gestor(db, email, equipe);
  const alvo = limparEmail(alvoBruto);
  const atual = await papelNaEquipe(db, alvo, equipe);
  if (!atual) return;
  if (atual === 'dono') throw new ErroSx('acesso', 'O dono não sai da equipe.');
  if (meu === 'gerente' && atual === 'gerente') throw new ErroSx('acesso', 'Só o dono remove um gerente.');
  await db.batch([db.prepare('DELETE FROM sx_membros WHERE equipe_id = ? AND email = ?').bind(equipe, alvo), db.prepare('DELETE FROM sx_sessoes WHERE equipe_id = ? AND email = ?').bind(equipe, alvo)]);
}

/**
 * "Esqueci a senha": o dono gera uma senha provisória para alguém da equipe (a pessoa troca ao entrar).
 * Só vale para quem não participa de equipes de outros donos (senão um dono tomaria a conta de alguém de fora).
 */
export async function senhaProvisoria(db: D1Database, email: string, equipe: string, alvoBruto: unknown): Promise<string> {
  if ((await papelNaEquipe(db, email, equipe)) !== 'dono') throw new ErroSx('acesso', 'Só o dono gera senha provisória.');
  const alvo = limparEmail(alvoBruto);
  if (alvo === email) throw new ErroSx('invalido', 'Para a sua senha, use "Trocar senha".');
  if (!(await papelNaEquipe(db, alvo, equipe))) throw new ErroSx('acesso', 'Essa pessoa não está na equipe.');
  const outras = await db.prepare('SELECT COUNT(*) AS n FROM sx_membros m JOIN sx_equipes e ON e.id = m.equipe_id WHERE m.email = ? AND e.dono != ?').bind(alvo, email).first<{ n: number }>();
  if ((outras?.n ?? 0) > 0) throw new ErroSx('acesso', 'Essa pessoa também participa de equipes de outros donos: ela mesma precisa lembrar a senha.');
  const nova = aleatorio(6).replace(/[-_]/g, 'k');
  const sal = aleatorio(16);
  const hash = await derivar(nova, sal, ITERACOES);
  await db.batch([
    db.prepare('INSERT INTO sx_contas (email, hash, sal, iteracoes, temporaria, criado_em) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (email) DO UPDATE SET hash = excluded.hash, sal = excluded.sal, iteracoes = excluded.iteracoes, temporaria = 1').bind(alvo, hash, sal, ITERACOES, Date.now()),
    db.prepare('DELETE FROM sx_sessoes WHERE email = ?').bind(alvo),
  ]);
  return nova;
}
