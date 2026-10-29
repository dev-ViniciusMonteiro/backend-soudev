// Super-admin dos sistemas de gestão: painel completo servido pelo próprio backend-soudev,
// em /admin-sx. Lista e (nos próximos incrementos) gerencia todas as empresas e contas.
//
// Segurança: login por usuário + senha (hash PBKDF2 no secret ADMIN_SX_PASS_HASH, nunca no código),
// sessão por cookie httpOnly assinado com HMAC (secret ADMIN_SX_SECRET). Usuário no var ADMIN_SX_USER.
// Tudo no mesmo worker onde estão os dados — sem token entre workers, sem proxy.

type AdminEnv = {
  DB: D1Database
  ADMIN_SX_USER?: string
  ADMIN_SX_PASS_HASH?: string
  ADMIN_SX_SECRET?: string
  ADMIN_SX_HORAS?: string
}

const enc = new TextEncoder()

function deB64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

// Hash guardado: pbkdf2$<iteracoes>$<saltB64>$<hashB64> (gerado pelo hash-senha.mjs do soudev).
async function verificarSenha(senha: string, armazenado?: string): Promise<boolean> {
  const p = String(armazenado || '').split('$')
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false
  const iteracoes = parseInt(p[1], 10)
  const salt = deB64(p[2])
  const esperado = deB64(p[3])
  if (!iteracoes || !esperado.length) return false
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes }, chave, esperado.length * 8)
  return iguais(new Uint8Array(bits), esperado)
}

async function hmac(secret: string, dados: string): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', chave, enc.encode(dados)))
}
async function criarSessao(env: AdminEnv): Promise<string> {
  const horas = parseInt(env.ADMIN_SX_HORAS || '12', 10) || 12
  const payload = JSON.stringify({ u: env.ADMIN_SX_USER, exp: Date.now() + horas * 3600 * 1000 })
  const p64 = b64url(enc.encode(payload))
  const sig = b64url(await hmac(env.ADMIN_SX_SECRET || '', p64))
  return `${p64}.${sig}`
}
async function validarSessao(env: AdminEnv, token: string | null): Promise<boolean> {
  if (!token || token.indexOf('.') < 0) return false
  const [p64, sig] = token.split('.')
  const esperada = b64url(await hmac(env.ADMIN_SX_SECRET || '', p64))
  if (!iguais(enc.encode(sig), enc.encode(esperada))) return false
  try {
    const d = JSON.parse(new TextDecoder().decode(deB64(p64)))
    return d.exp > Date.now()
  } catch {
    return false
  }
}
function lerCookie(req: Request, nome: string): string | null {
  const raw = req.headers.get('Cookie') || ''
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=')
    if (k === nome) return v.join('=')
  }
  return null
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
const htmlResp = (corpo: string, status = 200, cookie?: string): Response => {
  const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  if (cookie) h.set('Set-Cookie', cookie)
  return new Response(corpo, { status, headers: h })
}

const CSS = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e7e9ee}a{color:#8ab4ff}.wrap{max-width:900px;margin:0 auto;padding:24px 16px}.card{background:#171a21;border:1px solid #242934;border-radius:14px;padding:18px;margin-top:12px}h1{font-size:20px;margin:0}.muted{color:#9aa3b2}input{width:100%;padding:11px 12px;border-radius:9px;border:1px solid #2b313d;background:#0f1115;color:#e7e9ee;margin-top:6px}button{cursor:pointer;border:0;border-radius:9px;padding:9px 14px;background:#3a63ff;color:#fff;font-weight:600}button.ghost{background:#242934;color:#cdd3de}label{display:block;margin-top:14px;font-weight:600}`

function paginaLogin(erro = ''): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · Empresas</title><meta name="robots" content="noindex"><style>${CSS}.wrap{max-width:380px;margin-top:10vh}</style></head><body><div class="wrap"><div class="card"><h1>Super-admin · Empresas</h1><p class="muted">Acesso restrito.</p>${erro ? `<p style="color:#ffb4bf">${esc(erro)}</p>` : ''}<form method="post" action="/admin-sx/login" autocomplete="off"><label>Usuário<input name="user" required autofocus></label><label>Senha<input name="senha" type="password" required></label><button style="margin-top:18px;width:100%">Entrar</button></form></div></div></body></html>`
}

function paginaPainel(empresas: any[], totalContas: number): string {
  const fmt = (ms: number) => { try { return new Date(ms).toLocaleString('pt-BR') } catch { return '' } }
  const linhas = empresas.map((e) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><strong>${esc(e.nome || '—')}</strong><span class="muted">${esc(e.nicho || '')} · ${e.membros} membro(s)</span></div><div class="muted" style="margin-top:6px">Dono: ${esc(e.dono || '—')} · criada em ${esc(fmt(e.criado_em))}</div><div class="muted" style="font-size:12px;margin-top:4px">id: ${esc(e.id)}</div></div>`).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Empresas · Admin</title><meta name="robots" content="noindex"><style>${CSS}</style></head><body><div class="wrap"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>Empresas <span style="background:#3a63ff;color:#fff;border-radius:999px;padding:2px 10px;font-size:14px">${empresas.length}</span></h1><form method="post" action="/admin-sx/logout"><button class="ghost">Sair</button></form></div><p class="muted">${empresas.length} empresa(s) · ${totalContas} conta(s) cadastrada(s).</p>${empresas.length ? linhas : '<div class="card"><p class="muted">Nenhuma empresa cadastrada ainda.</p></div>'}</div></body></html>`
}

/** Atende /admin-sx e /admin-sx/... (ou devolve null se não for daqui). */
export async function rotasAdminSx(req: Request, env: AdminEnv, caminho: string): Promise<Response | null> {
  if (caminho !== '/admin-sx' && !caminho.startsWith('/admin-sx/')) return null
  const horas = parseInt(env.ADMIN_SX_HORAS || '12', 10) || 12
  const cookieDe = (valor: string, apagar = false) => `sid_sx=${apagar ? '' : valor}; HttpOnly; Secure; SameSite=Strict; Path=/admin-sx; Max-Age=${apagar ? 0 : horas * 3600}`

  // Login
  if (caminho === '/admin-sx/login' && req.method === 'POST') {
    const form = await req.formData()
    const user = String(form.get('user') || '')
    const senha = String(form.get('senha') || '')
    const userOk = iguais(enc.encode(user), enc.encode(env.ADMIN_SX_USER || ''))
    const senhaOk = await verificarSenha(senha, env.ADMIN_SX_PASS_HASH)
    if (!userOk || !senhaOk) return htmlResp(paginaLogin('Usuário ou senha incorretos.'), 401)
    return new Response(null, { status: 303, headers: { Location: '/admin-sx', 'Set-Cookie': cookieDe(await criarSessao(env)) } })
  }
  if (caminho === '/admin-sx/logout' && req.method === 'POST') {
    return new Response(null, { status: 303, headers: { Location: '/admin-sx', 'Set-Cookie': cookieDe('', true) } })
  }

  // Tudo abaixo exige sessão.
  const logado = await validarSessao(env, lerCookie(req, 'sid_sx'))
  if (!logado) return htmlResp(paginaLogin())

  // Painel (lista de empresas + contas)
  if (caminho === '/admin-sx' || caminho === '/admin-sx/') {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.nome, e.nicho, e.dono, e.criado_em,
              (SELECT COUNT(*) FROM sx_membros m WHERE m.equipe_id = e.id) AS membros
         FROM sx_equipes e ORDER BY e.criado_em DESC LIMIT 1000`,
    ).all()
    const contas = await env.DB.prepare('SELECT COUNT(*) AS n FROM sx_contas').all()
    return htmlResp(paginaPainel((results as any[]) ?? [], (contas.results?.[0] as any)?.n ?? 0))
  }

  return htmlResp(paginaLogin(), 404)
}
