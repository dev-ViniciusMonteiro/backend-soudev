// Teste dos jogos da praça contra o servidor local (.dev.vars com MODO_TESTE=1 e DURACAO_FATOR=0.05):
// filas pelos portais, sala fechando durante a partida, regras de cada jogo, resultado com XP e moedas.

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');
const PORTAIS = { 'pega-pega': [-13, -6], 'rei-da-colina': [13, -6], 'esconde-esconde': [0, 15] };

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (caminho, { metodo = 'GET', token, dados } = {}) => {
  const h = { Origin: ORIGEM };
  if (token) h.Authorization = `Bearer ${token}`;
  if (dados) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: dados ? JSON.stringify(dados) : undefined });
  return { status: r.status, d: await r.json().catch(() => null) };
};

async function pessoa(nome, codigo) {
  const { token, perfil } = (await api('/perfil', { metodo: 'POST', dados: { apelido: `Teste ${nome}` } })).d;
  const ws = new WebSocket(`${WS}/sala/${codigo}?token=${token}`, { headers: { Origin: ORIGEM } });
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  await esperar(100);
  const p = {
    id: perfil.id,
    token,
    ws,
    msgs,
    tipo: (k) => msgs.filter((m) => m.k === k),
    ultimo: (k) => msgs.filter((m) => m.k === k).at(-1),
    ir: async (x, z, y = 0) => {
      ws.send(JSON.stringify({ k: 'pose', p: [x, y, z, 0, 1] }));
      await esperar(60);
    },
    mandar: (m) => ws.send(JSON.stringify(m)),
    esperarMsg: async (cond, ms = 8000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const m = msgs.find(cond);
        if (m) return m;
        await esperar(40);
      }
      return null;
    },
  };
  return p;
}

const fechar = (...l) => l.forEach((p) => p.ws.close());

/* ---------- Pega-pega ---------- */
{
  const codigo = (await api('/jogar', { metodo: 'POST' })).d.codigo;
  const a = await pessoa('Pega A', codigo);
  const b = await pessoa('Pega B', codigo);
  const c = await pessoa('Pega C', codigo); // fica de fora, assistindo
  const [px, pz] = PORTAIS['pega-pega'];
  await a.ir(px, pz);
  await b.ir(px + 1, pz);
  await esperar(300);
  const filas = a.ultimo('filas');
  ok(filas?.f['pega-pega']?.length === 2 && !filas.f['pega-pega'].includes(c.id), 'Quem pisa no portal entra na fila (quem está fora não)');

  c.mandar({ k: 'iniciar', jogo: 'pega-pega' });
  await esperar(250);
  ok(!a.tipo('partida').length, 'Quem não está na fila não consegue iniciar');
  a.mandar({ k: 'iniciar', jogo: 'pega-pega' });
  const inicio = await a.esperarMsg((m) => m.k === 'partida' && m.p);
  ok(inicio?.p.fase === 'contagem' && inicio.p.participantes.length === 2 && c.tipo('partida').length > 0, 'Iniciar: contagem para os 2 da fila; quem ficou de fora assiste');

  const tentou = await pessoa('Pega D', codigo).catch(() => null);
  if (tentou) await esperar(300);
  ok(tentou?.tipo('erro')[0]?.motivo === 'fechada', 'Partida rolando: gente nova recebe "sala fechada"');
  ok((await api('/jogar', { metodo: 'POST' })).d.codigo !== codigo, 'Partida rolando: o "Jogar" não manda ninguém para esta sala');

  const jogando = await a.esperarMsg((m) => m.k === 'partida' && m.p?.fase === 'jogando');
  ok(Boolean(jogando?.p.pegador), `Começou, com um pegador sorteado`);
  // O pegador encosta no outro.
  const pegador = jogando.p.pegador === a.id ? a : b;
  const outro = pegador === a ? b : a;
  await outro.ir(0, 0);
  await pegador.ir(0.5, 0);
  const pegou = await a.esperarMsg((m) => m.k === 'pegou');
  ok(pegou?.de === pegador.id && pegou.para === outro.id, 'Encostou: o pega passa para o outro');
  // Quem passou fica imune por um tempo: continuar encostado não devolve na hora.
  await esperar(60);
  ok(a.tipo('pegou').length === 1, 'Imunidade: não devolve o pega na mesma hora');
  await pegador.ir(10, 10); // foge

  const res = await a.esperarMsg((m) => m.k === 'resultado', 10000);
  ok(res?.jogo === 'pega-pega' && res.l.length === 2, 'Fim da partida: resultado para todos');
  const venc = res?.l.find((l) => l.posicao === 1);
  ok(venc?.id === pegador.id, 'Vence quem ficou menos tempo pegando (quem passou rápido e fugiu)');
  ok(venc?.xp === 40 && venc.moedas === 60, 'Vencedor ganha 40 XP e 60 moedas');
  ok(res?.conquistas[venc.id]?.includes('primeira-vitoria'), 'Conquista "primeira vitória" no resultado');
  await esperar(300);
  ok(a.ultimo('partida')?.p === null, 'Depois do resultado, volta para a praça');
  ok((await api('/jogar', { metodo: 'POST' })).d.codigo === codigo, 'A sala reabre no "Jogar"');
  const perfil = (await api('/perfil', { token: pegador.token })).d;
  ok(perfil.moedas === 1060 && perfil.xp >= 40, `Perfil do vencedor atualizado (${perfil.moedas} moedas, ${perfil.xp} XP)`);
  const rk = (await api('/ranking?por=pega-pega', { token: pegador.token })).d;
  ok(rk.eu?.valor > 1000, `Ranking do pega-pega: vencedor com rating ${rk.eu?.valor}`);
  fechar(a, b, c);
  if (tentou) fechar(tentou);
}

/* ---------- Rei da colina ---------- */
{
  const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;
  const a = await pessoa('Rei A', codigo);
  const b = await pessoa('Rei B', codigo);
  const [px, pz] = PORTAIS['rei-da-colina'];
  await a.ir(px, pz);
  await b.ir(px, pz + 1);
  await esperar(250);
  b.mandar({ k: 'iniciar', jogo: 'rei-da-colina' });
  await a.esperarMsg((m) => m.k === 'partida' && m.p?.fase === 'jogando');
  await a.ir(5, 0); // dentro do anel
  await b.ir(15, 15); // longe
  const res = await a.esperarMsg((m) => m.k === 'resultado', 10000);
  ok(res?.l[0].id === a.id && res.l[0].pontos > res.l[1].pontos, `Rei da colina: vence quem ficou na zona (${res?.l[0].pontos}s contra ${res?.l[1].pontos}s)`);
  ok(res?.conquistas[a.id]?.includes('rei-da-colina'), 'Vencer o rei da colina dá a conquista (e a coroa)');
  ok((await api('/perfil', { token: a.token })).d.itens.includes('chapeu:coroa'), 'Coroa liberada no perfil');
  fechar(a, b);
}

/* ---------- Esconde-esconde ---------- */
{
  const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;
  const a = await pessoa('Esc A', codigo);
  const b = await pessoa('Esc B', codigo);
  const [px, pz] = PORTAIS['esconde-esconde'];
  await a.ir(px, pz);
  await b.ir(px + 1, pz);
  await esperar(250);
  a.mandar({ k: 'iniciar', jogo: 'esconde-esconde' });
  const esc = await a.esperarMsg((m) => m.k === 'partida' && m.p?.fase === 'esconder');
  ok(Boolean(esc?.p.buscador), 'Esconde-esconde: fase de esconder com quem procura sorteado');
  const busc = esc.p.buscador === a.id ? a : b;
  const hider = busc === a ? b : a;
  // Quem procura está congelado: a pose dele é ignorada.
  const antes = hider.msgs.length;
  await busc.ir(-20, -20);
  await esperar(200);
  ok(!hider.msgs.slice(antes).some((m) => m.k === 'poses' && m.l.some((x) => x[0] === busc.id)), 'Quem procura não se mexe enquanto os outros escondem');
  // Quem se esconde vai longe: quem procura não recebe a posição (fora da lanterna).
  const antesB = busc.msgs.length;
  await hider.ir(-25, -25);
  await esperar(250);
  ok(!busc.msgs.slice(antesB).some((m) => m.k === 'poses' && m.l.some((x) => x[0] === hider.id)), 'Quem procura não recebe a posição de quem está longe (fora da lanterna)');
  ok(a === busc || a.msgs.slice(antesB).some((m) => m.k === 'poses'), 'Os outros continuam recebendo normalmente');
  await busc.esperarMsg((m) => m.k === 'partida' && m.p?.fase === 'jogando');
  // Quem procura chega perto e acha.
  await busc.ir(-20, -20);
  await busc.ir(-24, -24.5);
  const achou = await busc.esperarMsg((m) => m.k === 'pegou');
  ok(achou?.para === hider.id, 'Chegou perto: achou');
  const res = await busc.esperarMsg((m) => m.k === 'resultado', 10000);
  ok(res?.l.find((l) => l.posicao === 1)?.id === busc.id, 'Achou todo mundo: quem procurou vence (e a partida acaba antes do tempo)');
  fechar(a, b);
}

/* ---------- Saiu no meio ---------- */
{
  const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;
  const a = await pessoa('Sai A', codigo);
  const b = await pessoa('Sai B', codigo);
  const [px, pz] = PORTAIS['pega-pega'];
  await a.ir(px, pz);
  await b.ir(px, pz);
  await esperar(250);
  a.mandar({ k: 'iniciar', jogo: 'pega-pega' });
  await a.esperarMsg((m) => m.k === 'partida' && m.p?.fase === 'jogando');
  b.ws.close();
  const fim = await a.esperarMsg((m) => m.k === 'partida' && m.p === null);
  ok(Boolean(fim) && !a.tipo('resultado').length, 'Se sobra 1 só, a partida é cancelada (sem resultado nem ranking)');
  fechar(a);
}

await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes dos jogos passaram.');
process.exit(falhas ? 1 : 0);
