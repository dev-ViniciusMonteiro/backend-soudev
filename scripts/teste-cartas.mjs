// Teste das mesas de cartas do Cassino (21 e truco paulista) contra o servidor local.

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');
const MESA_21 = [17, -47.5];
const MESA_TRUCO = [17, -56.5];

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (caminho, { metodo = 'GET', dados, token } = {}) => {
  const h = { Origin: ORIGEM };
  if (dados) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: dados ? JSON.stringify(dados) : undefined });
  return { status: r.status, d: await r.json().catch(() => null) };
};
async function pessoa(nome, codigo) {
  const { token, perfil } = (await api('/perfil', { metodo: 'POST', dados: { apelido: `Teste ${nome}` } })).d;
  const ws = new WebSocket(`${WS}/sala/${codigo}?token=${token}`, { headers: { Origin: ORIGEM } });
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  await esperar(120);
  return {
    id: perfil.id,
    token,
    ws,
    msgs,
    ultimo: (k) => msgs.filter((m) => m.k === k).at(-1),
    moedas: async () => (await api('/perfil', { token })).d.moedas,
    ir: async (x, z) => {
      ws.send(JSON.stringify({ k: 'pose', p: [x, 0, z, 0, 0] }));
      await esperar(80);
    },
    mandar: async (m, ms = 250) => {
      ws.send(JSON.stringify(m));
      await esperar(ms);
    },
    /** Espera uma mensagem que chegue a partir da posição 'desde' do histórico. */
    esperarMsg: async (cond, ms = 15000, desde = 0) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const m = msgs.slice(desde).reverse().find(cond);
        if (m) return m;
        await esperar(40);
      }
      return null;
    },
  };
}

const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;

/* ---------- 21 ---------- */
{
  const a = await pessoa('BJ A', codigo);
  await a.mandar({ k: 'mesa', mesa: '21', a: 'sentar' });
  ok(a.ultimo('mesaErro')?.texto.includes('perto'), '21: longe da mesa não senta');
  await a.ir(MESA_21[0] + 1, MESA_21[1]);
  await a.mandar({ k: 'mesa', mesa: '21', a: 'sentar' });
  ok(a.ultimo('bj')?.e?.lugares.includes(a.id), '21: perto da mesa, senta');
  await a.mandar({ k: 'bj', a: 'apostar', v: 5 });
  ok(a.ultimo('mesaErro')?.texto.includes('entre'), '21: aposta fora do limite (10 a 500) é recusada');
  await a.mandar({ k: 'bj', a: 'apostar', v: 100 }, 600);
  let e = a.ultimo('bj').e;
  ok((await a.moedas()) === 900 && ['jogando', 'casa', 'resultado'].includes(e.fase), '21: apostou 100 (saldo 900) e as cartas foram dadas');
  ok(e.casa.length === 2 && (e.fase !== 'jogando' || e.casa[1] === '?'), '21: segunda carta da casa escondida enquanto você joga');
  // Joga: pede até 17 ou mais e para.
  for (let i = 0; i < 6; i++) {
    e = a.ultimo('bj').e;
    if (e.fase !== 'jogando' || e.vez !== a.id) break;
    const pts = e.maos[a.id].cartas.reduce((s, c) => s + (c.startsWith('A') ? 11 : 'KQJ'.includes(c[0]) || c.startsWith('10') ? 10 : Number(c.slice(0, -1))), 0);
    await a.mandar({ k: 'bj', a: pts < 17 ? 'pedir' : 'parar' });
  }
  if (a.ultimo('bj').e.vez === a.id) await a.mandar({ k: 'bj', a: 'parar' });
  const res = await a.esperarMsg((m) => m.k === 'bj' && m.e?.fase === 'resultado', 15000, a.msgs.length);
  const ganho = res?.e.maos[a.id].ganho ?? -1;
  await esperar(300);
  ok(res?.e.casa.every((c) => c !== '?') && (await a.moedas()) === 900 + ganho, `21: a casa revela e joga; resultado pago certo (voltou ${ganho}, status ${res?.e.maos[a.id].status})`);
  // Próxima rodada: dobrar.
  const prox = await a.esperarMsg((m) => m.k === 'bj' && m.e?.fase === 'apostas', 9000, a.msgs.length);
  const saldo = await a.moedas();
  await a.mandar({ k: 'bj', a: 'apostar', v: 50 }, 600);
  e = a.ultimo('bj').e;
  if (process.env.DEBUG) console.log('rodada 2:', JSON.stringify({ prox: prox?.e.fase, fase: e.fase, vez: e.vez === a.id, mao: e.maos[a.id], erro: a.ultimo('mesaErro')?.texto }));
  if (e.fase === 'jogando' && e.vez === a.id) {
    await a.mandar({ k: 'bj', a: 'dobrar' }, 500);
    e = a.ultimo('bj').e;
    ok(e.maos[a.id].aposta === 100 && e.maos[a.id].cartas.length === 3 && (await a.moedas()) === saldo - 100, '21: dobrar paga a aposta de novo, recebe 1 carta e para');
  } else ok(Boolean(prox), '21: (rodada com blackjack direto; dobrar não se aplica)');
  await a.mandar({ k: 'mesa', mesa: '21', a: 'levantar' });
  a.ws.close();
}

/* ---------- Truco ---------- */
{
  const a = await pessoa('Truco A', codigo);
  const b = await pessoa('Truco B', codigo);
  for (const [p, dx] of [[a, 1], [b, -1]]) {
    await p.ir(MESA_TRUCO[0] + dx, MESA_TRUCO[1]);
    await p.mandar({ k: 'mesa', mesa: 'truco', a: 'sentar' });
  }
  let e = a.ultimo('truco').e;
  ok(e?.lugares[0] === a.id && e.lugares[1] === b.id, 'Truco: A no lugar 0 (time 0), B no lugar 1 (time 1)');
  await a.mandar({ k: 'mesa', mesa: 'truco', a: 'comecar', aposta: 100 }, 800);
  e = a.ultimo('truco').e;
  ok(e?.fase === 'jogando' && e.vira && (await a.moedas()) === 900 && (await b.moedas()) === 900, 'Truco: começou valendo 100 de cada (pote de 200); vira na mesa');
  const maoA = a.ultimo('trucoMao')?.cartas;
  const maoB = b.ultimo('trucoMao')?.cartas;
  ok(maoA?.length === 3 && maoB?.length === 3 && !a.msgs.some((m) => m.k === 'trucoMao' && JSON.stringify(m.cartas) === JSON.stringify(maoB)), 'Truco: cada um recebe só as próprias 3 cartas');
  ok(!JSON.stringify(a.ultimo('truco').e).includes(maoB[0]) || maoA.includes(maoB[0]), 'Truco: o estado público não mostra a mão do outro');
  const vez = e.vez === 0 ? a : b;
  const outro = vez === a ? b : a;
  await outro.mandar({ k: 'truco', a: 'jogar', i: 0 });
  ok(outro.ultimo('mesaErro')?.texto.includes('vez'), 'Truco: fora da vez não joga');

  // Truco, seis, nove, doze e corre: quem pediu o doze leva 9 (o valor antes do pedido).
  await vez.mandar({ k: 'truco', a: 'trucar' });
  ok(a.ultimo('truco').e.pedido?.valor === 3, 'Truco: pediu truco (vale 3)');
  await outro.mandar({ k: 'truco', a: 'trucar' });
  await vez.mandar({ k: 'truco', a: 'trucar' });
  await outro.mandar({ k: 'truco', a: 'trucar' });
  e = a.ultimo('truco').e;
  ok(e.pedido?.valor === 12 && e.valorMao === 9, 'Truco: seis, nove e doze (a mão já vale 9)');
  const timeOutro = outro === a ? 0 : 1;
  await vez.mandar({ k: 'truco', a: 'correr' });
  e = a.ultimo('truco').e;
  ok(e.placar[timeOutro] === 9, `Truco: correu do doze, o outro time leva 9 (${e.placar.join(' x ')})`);

  // Próxima mão: joga as cartas até decidir.
  await esperar(2800);
  for (let k = 0; k < 8; k++) {
    e = a.ultimo('truco').e;
    if (e.fase !== 'jogando' || e.vez === null || e.placar[timeOutro] !== 9 || e.placar[1 - timeOutro] !== 0) break;
    const quem = e.lugares[e.vez] === a.id ? a : b;
    await quem.mandar({ k: 'truco', a: 'jogar', i: 0 }, 1700);
  }
  e = a.ultimo('truco').e;
  ok(e.placar[0] + e.placar[1] >= 9 && e.placar[0] + e.placar[1] <= 10, `Truco: mão jogada até o fim, 1 ponto para quem fez 2 vazes (${e.placar.join(' x ')})`);
  a.ws.close();
  await esperar(500);
  e = b.ultimo('truco').e;
  ok(e?.fase !== 'jogando', 'Truco: quem sai no meio entrega a partida');
  ok((await b.moedas()) === 1100, `Truco: o time que ficou leva o pote (B: ${await b.moedas()})`);
  b.ws.close();
}

await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes das cartas passaram.');
process.exit(falhas ? 1 : 0);
