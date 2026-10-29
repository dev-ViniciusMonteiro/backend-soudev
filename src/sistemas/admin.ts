// Super-admin dos sistemas de gestão: listar e gerenciar TODAS as empresas e contas.
// Protegido por token fixo (secret ADMIN_SUPER_TOKEN). É chamado server-to-server pelo
// painel /admin (worker soudev-ideias) — nunca direto pelo navegador, então não usa CORS/origem.

function autorizado(req: Request, env: Env): boolean {
  const token = (env as unknown as { ADMIN_SUPER_TOKEN?: string }).ADMIN_SUPER_TOKEN;
  if (!token) return false;
  const h = req.headers.get('Authorization') ?? '';
  const dado = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (dado.length !== token.length) return false;
  let d = 0;
  for (let i = 0; i < dado.length; i++) d |= dado.charCodeAt(i) ^ token.charCodeAt(i);
  return d === 0;
}

const j = (dados: unknown, status = 200): Response =>
  new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Atende /admin-sx/... (ou devolve null se não for daqui). */
export async function rotasAdminSx(req: Request, env: Env, caminho: string): Promise<Response | null> {
  if (!caminho.startsWith('/admin-sx/')) return null;
  if (!autorizado(req, env)) return j({ erro: 'não autorizado' }, 401);

  // Resumo geral + lista de empresas (equipes) com dono e nº de membros.
  if (caminho === '/admin-sx/empresas' && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.nome, e.nicho, e.dono, e.criado_em,
              (SELECT COUNT(*) FROM sx_membros m WHERE m.equipe_id = e.id) AS membros
         FROM sx_equipes e
        ORDER BY e.criado_em DESC
        LIMIT 1000`,
    ).all();
    const contas = await env.DB.prepare('SELECT COUNT(*) AS n FROM sx_contas').all();
    return j({ empresas: results ?? [], total_contas: contas.results?.[0]?.n ?? 0 });
  }

  // Lista de contas (e-mails cadastrados).
  if (caminho === '/admin-sx/contas' && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT email, criado_em, temporaria FROM sx_contas ORDER BY criado_em DESC LIMIT 2000',
    ).all();
    return j({ contas: results ?? [] });
  }

  return j({ erro: 'rota admin não encontrada' }, 404);
}
