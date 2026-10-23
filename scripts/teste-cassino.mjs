// Teste do resto do Cassino (poker, roleta e caça-níqueis) contra o servidor local.

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');
const MESA_POKER = [26.5, -47.5];
const ROLETA = [26.5, -56.5];
const SLOT = [37, -52.5];
const VERMELHOS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

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

/* ---------- Caça-níqueis ---------- */
{
  const a = await pessoa('Slot A', codigo);
  await a.mandar({ k: 'slot', v: 10 });
  ok(a.ultimo('mesaErro')?.texto.includes('perto'), 'Caça-níquel: longe da máquina não gira');
  await a.ir(SLOT[0] - 1, SLOT[1]);
  await a.mandar({ k: 'slot', v: 7 });
  ok(a.ultimo('mesaErro')?.texto.includes('inválida'), 'Caça-níquel: aposta fora da lista é recusada');
  await a.mandar({ k: 'slot', v: 25 }, 500);
  const s = a.ultimo('slot');
  const premio = s && (s.rolos[0] === s.rolos[1] && s.rolos[1] === s.rolos[2] ? [8, 12, 25, 50, 100, 250][s.rolos[0]] : s.rolos.filter((r) => r === 0).length === 2 ? 1 : 0);
  ok(s?.rolos.length === 3 && s.ganho === premio * 25 && (await a.moedas()) === 1000 - 25 + s.ganho, `Caça-níquel: girou (${s?.rolos.join(',')}), pagou ${s?.ganho} e o saldo bate`);
  await esperar(1300);
  await a.mandar({ k: 'slot', v: 10 }, 50);
  await a.mandar({ k: 'slot', v: 10 }, 400);
  ok(a.msgs.filter((m) => m.k === 'slot').length === 2, 'Caça-níquel: dois giros colados contam como um (1,2 s entre giros)');
  a.ws.close();
}

/* ---------- Roleta ---------- */
{
  const a = await pessoa('Roleta A', codigo);
  await a.mandar({ k: 'roleta', tipo: 'vermelho', v: 100 });
  ok(a.ultimo('mesaErro')?.texto.includes('perto'), 'Roleta: longe da mesa não aposta');
  await a.ir(ROLETA[0] + 2, ROLETA[1]);
  await a.mandar({ k: 'roleta', tipo: 'numero', alvo: 40, v: 100 });
  ok(a.ultimo('mesaErro')?.texto.includes('0 a 36'), 'Roleta: número fora de 0 a 36 é recusado');
  await a.mandar({ k: 'roleta', tipo: 'vermelho', v: 100 });
  await a.mandar({ k: 'roleta', tipo: 'preto', v: 100 });
  await a.mandar({ k: 'roleta', tipo: 'numero', alvo: 17, v: 10 });
  let e = a.ultimo('roleta')?.e;
  ok(e?.fase === 'apostas' && e.apostas.length === 3 && e.restanteMs > 15000 && (await a.moedas()) === 790, 'Roleta: 3 apostas (210 moedas) e o relógio de 20 s começou');
  const res = await a.esperarMsg((m) => m.k === 'roleta' && m.e?.fase === 'resultado', 30000, a.msgs.length);
  const n = res?.e.numero;
  const esperado = 790 + (n === 0 ? 0 : 200) + (n === 17 ? 360 : 0);
  await esperar(300);
  ok(Number.isInteger(n) && res.e.historico[0] === n && (await a.moedas()) === esperado, `Roleta: caiu ${n} (${n === 0 ? 'zero' : VERMELHOS.includes(n) ? 'vermelho' : 'preto'}), pagou certo (saldo ${esperado})`);
  a.ws.close();
}

/* ---------- Poker ---------- */
{
  const a = await pessoa('Poker A', codigo);
  const b = await pessoa('Poker B', codigo);
  await a.mandar({ k: 'mesa', mesa: 'poker', a: 'sentar' });
  ok(a.ultimo('mesaErro')?.texto.includes('perto'), 'Poker: longe da mesa não senta');
  for (const [p, dx] of [[a, 1], [b, -1]]) {
    await p.ir(MESA_POKER[0] + dx, MESA_POKER[1]);
    await p.mandar({ k: 'mesa', mesa: 'poker', a: 'sentar' });
  }
  let m = await a.esperarMsg((x) => x.k === 'poker' && x.e?.fase === 'preflop', 8000);
  let e = m?.e;
  ok(e && e.pote === 15 && (await a.moedas()) === 0 && (await b.moedas()) === 0, 'Poker: mão começou; cada um entrou com o saldo (1000) e os blinds (5/10) estão no pote');
  const cartasA = a.ultimo('pokerMao')?.cartas;
  const cartasB = b.ultimo('pokerMao')?.cartas;
  ok(cartasA?.length === 2 && cartasB?.length === 2 && !a.msgs.some((x) => x.k === 'pokerMao' && JSON.stringify(x.cartas) === JSON.stringify(cartasB)), 'Poker: cada um recebe só as próprias 2 cartas');
  ok(!JSON.stringify(a.ultimo('poker').e).includes(cartasB[0]) || cartasA.includes(cartasB[0]), 'Poker: o estado público não mostra a mão do outro');
  // Mano a mano: o dealer é o small blind e fala primeiro antes do flop.
  const sb = e.lugares[e.vez] === a.id ? a : b;
  const bb = sb === a ? b : a;
  ok(e.jogadores[sb.id].aposta === 5 && e.jogadores[bb.id].aposta === 10 && e.lugares[e.dealer] === sb.id, 'Poker: no mano a mano o dealer põe o small blind e fala primeiro');
  await bb.mandar({ k: 'poker', a: 'passar' });
  ok(bb.ultimo('mesaErro')?.texto.includes('vez'), 'Poker: fora da vez não joga');
  await sb.mandar({ k: 'poker', a: 'aumentar', v: 15 });
  ok(sb.ultimo('mesaErro')?.texto.includes('mínimo'), 'Poker: aumento menor que o mínimo (para 20) é recusado');
  await sb.mandar({ k: 'poker', a: 'desistir' }, 600);
  e = a.ultimo('poker').e;
  await esperar(300);
  ok(e.fase === 'fim' && e.jogadores[bb.id].ganho === 15 && (await bb.moedas()) === 1005 && (await sb.moedas()) === 995, 'Poker: desistiu, o big blind leva o pote (15) e as sobras voltam para a conta');

  // Próxima mão: all-in e pagar; mostra as cartas e as moedas se conservam.
  m = await a.esperarMsg((x) => x.k === 'poker' && x.e?.fase === 'preflop', 12000, a.msgs.length);
  e = m?.e;
  const vez = e.lugares[e.vez] === a.id ? a : b;
  const outro = vez === a ? b : a;
  await vez.mandar({ k: 'poker', a: 'allin' });
  await outro.mandar({ k: 'poker', a: 'pagar' }, 800);
  e = a.ultimo('poker').e;
  const ja = e.jogadores[a.id];
  const jb = e.jogadores[b.id];
  ok(e.fase === 'fim' && e.mesa.length === 5 && ja.cartas?.length === 2 && jb.cartas?.length === 2 && ja.jogo && jb.jogo, `Poker: all-in pago abre a mesa toda e mostra (${ja.jogo} x ${jb.jogo})`);
  await esperar(400);
  const sa = await a.moedas();
  const sbb = await b.moedas();
  ok(sa + sbb === 2000 && ja.ganho + jb.ganho === e.pote, `Poker: o pote (${e.pote}) foi para quem ganhou e nada sumiu (A ${sa}, B ${sbb})`);

  // Levantar no meio da mão: desiste e o que não foi para o pote volta.
  if (sa >= 10 && sbb >= 10) {
    m = await a.esperarMsg((x) => x.k === 'poker' && x.e?.fase === 'preflop', 12000, a.msgs.length);
    await a.mandar({ k: 'mesa', mesa: 'poker', a: 'levantar' }, 600);
    e = b.ultimo('poker').e;
    await esperar(400);
    ok(!e.lugares.includes(a.id) && e.fase === 'fim' && (await a.moedas()) + (await b.moedas()) === 2000, 'Poker: quem levanta no meio desiste; o resto da pilha volta e o outro leva o pote');
  } else ok(true, 'Poker: (alguém ficou sem moedas no all-in; levantar no meio não se aplica)');
  a.ws.close();
  b.ws.close();
}

await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes do cassino passaram.');
process.exit(falhas ? 1 : 0);
