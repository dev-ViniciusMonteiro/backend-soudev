// Backend do soudev na Cloudflare: API HTTP e porta de entrada das salas da praça.
//   GET   /saude              → ok
//   GET   /online             → quantas salas públicas e pessoas
//   POST  /perfil             → cria perfil de convidado { apelido, skin } → { token, perfil }
//   GET   /perfil             → seu perfil (Authorization: Bearer <token>)
//   PATCH /perfil             → troca apelido e/ou skin (só itens liberados)
//   GET   /ranking?por=       → nivel | moedas | <jogo> (top 20 + a sua posição)
//   POST  /loja/comprar       → { item } compra com moedas do jogo e libera o item
//   POST  /jogar              → código de uma sala pública com vaga (ou nova)
//   POST  /salas              → código de uma sala privada nova
//   GET   /sala/:codigo       → WebSocket da sala (?token=)

import { Diretorio, novoCodigo } from './diretorio';
import { ErroPerfil, atualizarPerfil, comprarItem, criarPerfil, perfilDoToken, ranking, registrarPartida, tokenDaRequisicao } from './perfis';
import { CODIGO_SALA, type RespostaSala } from './protocolo';
import { Sala } from './sala';

export { Diretorio, Sala };

function origemPermitida(req: Request, env: Env): string | null {
  const origem = req.headers.get('Origin');
  if (!origem) return null;
  return env.ORIGENS.split(',').map((o) => o.trim()).includes(origem) ? origem : null;
}

function json(dados: unknown, origem: string | null, status = 200): Response {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (origem) {
    h.set('Access-Control-Allow-Origin', origem);
    h.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(dados), { status, headers: h });
}

async function corpo(req: Request): Promise<Record<string, unknown>> {
  try {
    const d = await req.json();
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function rotas(req: Request, env: Env, url: URL, origem: string | null): Promise<Response> {
  const caminho = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (caminho === '/saude') return json({ ok: true }, origem);
  if (caminho === '/online' && m === 'GET') return json(await env.DIRETORIO.getByName('global').resumo(), origem);

  if (caminho === '/ranking' && m === 'GET') {
    const eu = await perfilDoToken(env.DB, tokenDaRequisicao(req));
    return json(await ranking(env.DB, url.searchParams.get('por') ?? 'nivel', eu?.id ?? null), origem);
  }

  // Daqui para baixo, só o site e o jogo (evita robôs de outros sites criando perfis e salas).
  if (!origem && m !== 'GET') return json({ erro: 'origem não permitida' }, null, 403);

  if (caminho === '/perfil') {
    if (m === 'POST') {
      const d = await corpo(req);
      return json(await criarPerfil(env.DB, d.apelido, d.skin), origem, 201);
    }
    const eu = await perfilDoToken(env.DB, tokenDaRequisicao(req));
    if (!eu) return json({ erro: 'perfil não encontrado' }, origem, 401);
    if (m === 'GET') return json(eu, origem);
    if (m === 'PATCH') return json(await atualizarPerfil(env.DB, eu, await corpo(req)), origem);
  }

  if (caminho === '/loja/comprar' && m === 'POST') {
    const eu = await perfilDoToken(env.DB, tokenDaRequisicao(req));
    if (!eu) return json({ erro: 'perfil não encontrado' }, origem, 401);
    return json(await comprarItem(env.DB, eu, (await corpo(req)).item), origem);
  }

  if ((caminho === '/jogar' || caminho === '/salas') && m === 'POST') {
    const publica = caminho === '/jogar';
    const codigo = publica ? (await env.DIRETORIO.getByName('global').reservar()).codigo : novoCodigo();
    await env.SALA.getByName(codigo).configurar(codigo, publica);
    return json({ codigo } satisfies RespostaSala, origem);
  }

  const sala = caminho.match(/^\/sala\/([A-Z0-9]+)$/);
  if (sala) {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ erro: 'use WebSocket' }, origem, 426);
    if (!origem) return new Response('origem não permitida', { status: 403 });
    if (!CODIGO_SALA.test(sala[1])) return new Response('código inválido', { status: 400 });
    const eu = await perfilDoToken(env.DB, url.searchParams.get('token'));
    if (!eu) return new Response('perfil não encontrado', { status: 401 });
    // A sala confia nestes cabeçalhos: os que vieram do navegador são trocados pelos do perfil verificado.
    const h = new Headers(req.headers);
    for (const k of [...h.keys()]) if (k.toLowerCase().startsWith('x-jogador-')) h.delete(k);
    h.set('X-Jogador-Id', eu.id);
    h.set('X-Jogador-Nome', encodeURIComponent(eu.apelido));
    h.set('X-Jogador-Nivel', String(eu.nivel));
    h.set('X-Jogador-Skin', encodeURIComponent(eu.skin));
    return env.SALA.getByName(sala[1]).fetch(new Request(req, { headers: h }));
  }

  // Só no servidor local de teste (wrangler dev --var MODO_TESTE:1): grava uma partida de mentira.
  if (env.MODO_TESTE === '1' && caminho === '/teste/partida' && m === 'POST') {
    const d = (await corpo(req)) as unknown as Parameters<typeof registrarPartida>[1];
    return json(await registrarPartida(env.DB, d), origem);
  }

  return json({ erro: 'não encontrado' }, origem, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origem = origemPermitida(req, env);

    if (req.method === 'OPTIONS') {
      if (!origem) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origem,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }

    try {
      return await rotas(req, env, url, origem);
    } catch (e) {
      if (e instanceof ErroPerfil) return json({ erro: e.message }, origem, e.status);
      console.error(e);
      return json({ erro: 'erro interno' }, origem, 500);
    }
  },
} satisfies ExportedHandler<Env>;
