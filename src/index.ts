// Backend do soudev na Cloudflare: API HTTP e porta de entrada das salas da praça.
//   GET  /saude              → ok
//   GET  /online             → quantas salas públicas e pessoas
//   POST /jogar              → código de uma sala pública com vaga (ou nova)
//   POST /salas              → código de uma sala privada nova
//   GET  /sala/:codigo       → WebSocket da sala (?id=&nome=&skin=)

import { Diretorio, novoCodigo } from './diretorio';
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origem = origemPermitida(req, env);
    const caminho = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      if (!origem) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' },
      });
    }

    if (caminho === '/saude') return json({ ok: true }, origem);

    if (caminho === '/online' && req.method === 'GET') return json(await env.DIRETORIO.getByName('global').resumo(), origem);

    // Só o site e o jogo criam salas (evita robôs de outros sites enchendo o diretório).
    if ((caminho === '/jogar' || caminho === '/salas') && req.method === 'POST') {
      if (!origem) return json({ erro: 'origem não permitida' }, null, 403);
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
      return env.SALA.getByName(sala[1]).fetch(req);
    }

    return json({ erro: 'não encontrado' }, origem, 404);
  },
} satisfies ExportedHandler<Env>;
