// Teste do mata-mata contra o servidor local (.dev.vars com MODO_TESTE=1 e DURACAO_FATOR=0.05).

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');
const DOMO = [190, 0];

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (caminho, { metodo = 'GET', dados } = {}) => {
  const h = { Origin: ORIGEM };
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
  await esperar(120);
  const p = {
    id: perfil.id,
    ws,
    msgs,
    ultimo: (k) => msgs.filter((m) => m.k === k).at(-1),
    mandar: async (m, ms = 120) => {
      ws.send(JSON.stringify(m));
      await esperar(ms);
    },
    /** Pose no mundo; (x, z) relativos ao domo quando arena=true. */
    ir: async (x, z, arena = true) => {
      ws.send(JSON.stringify({ k: 'pose', p: [arena ? DOMO[0] + x : x, 0, arena ? DOMO[1] + z : z, 0, 1] }));
      await esperar(80);
    },
    esperarMsg: async (cond, ms = 8000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const m = msgs.find(cond);
        if (m) return m;
        await esperar(30);
      }
      return null;
    },
  };
  return p;
}

/** Direção do olho de a até o corpo (ou cabeça) de b, posições relativas ao domo. */
const mirar = (a, b, cabeca = false) => {
  const v = [b[0] - a[0], (cabeca ? 1.65 : 1.0) - 1.6, b[1] - a[1]];
  return v;
};

const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;
const a = await pessoa('MM A', codigo);
const b = await pessoa('MM B', codigo);
const c = await pessoa('MM C', codigo); // assiste
await a.ir(0, -14, false);
await b.ir(1, -14, false);
await esperar(250);
ok(a.ultimo('filas')?.f['mata-mata']?.length === 2, 'Os dois no portal do mata-mata entram na fila');
await a.mandar({ k: 'iniciar', jogo: 'mata-mata' }, 300);
let e = a.ultimo('mm')?.e;
ok(e?.fase === 'compra' && e.jogadores[a.id]?.time === 'TR' && e.jogadores[b.id]?.time === 'CT' && !e.jogadores[c.id], 'Começou: A é TR, B é CT; quem não estava no portal assiste');
ok(c.ultimo('mm')?.e?.fase === 'compra', 'Quem assiste também recebe o estado (placar, tempo)');
const d = await pessoa('MM D', codigo).catch(() => null);
await esperar(250);
ok(d?.ultimo('erro')?.motivo === 'fechada', 'Durante o mata-mata a sala fecha para gente nova');

// Compra
await a.mandar({ k: 'comprar', item: 'ak47' });
ok(a.ultimo('mm').e.jogadores[a.id].primaria === null, 'Sem dinheiro (800) não compra AK-47 (2700)');
await b.mandar({ k: 'comprar', item: 'ak47' });
ok(b.ultimo('mm').e.jogadores[b.id].primaria === null, 'CT não compra AK-47 (arma do TR)');
await a.mandar({ k: 'comprar', item: 'colete' });
e = a.ultimo('mm').e;
ok(e.jogadores[a.id].armadura === 100 && e.jogadores[a.id].dinheiro === 150, 'Comprou colete: armadura 100, sobram 150');

// Rodada
await a.esperarMsg((m) => m.k === 'mm' && m.e?.fase === 'rodada');
await a.ir(0, 20);
await b.ir(-25, 5); // atrás da parede do túnel do B
await esperar(150);
await a.mandar({ k: 'tiro', d: mirar([0, 20], [-25, 5]), alvo: b.id }, 200);
ok(a.msgs.some((m) => m.k === 'tiro' && m.de === a.id) && !a.msgs.some((m) => m.k === 'dano'), 'Tiro através da parede não acerta (mas os outros veem o tiro)');
await b.ir(0, 14);
await esperar(150);
await a.mandar({ k: 'tiro', d: [0, 0, 1], alvo: b.id }, 200);
ok(!a.msgs.some((m) => m.k === 'dano'), 'Mira apontando para o outro lado não acerta');
await a.mandar({ k: 'tiro', d: mirar([0, 20], [0, 14]), alvo: b.id }, 20);
await a.mandar({ k: 'tiro', d: mirar([0, 20], [0, 14]), alvo: b.id }, 200);
const danos = a.msgs.filter((m) => m.k === 'dano');
ok(danos.length === 1 && danos[0].hp < 100 && danos[0].hp > 60, `Tiro certo tira vida (B ficou com ${danos[0]?.hp}); o segundo tiro rápido demais foi ignorado (cadência)`);
await a.mandar({ k: 'tiro', d: mirar([0, 20], [0, 14], true), alvo: b.id, cabeca: true }, 250);
const abate = a.msgs.find((m) => m.k === 'abate');
ok(abate?.de === a.id && abate.para === b.id && abate.cabeca, 'Tiro na cabeça mata (abate com headshot)');
e = (await a.esperarMsg((m) => m.k === 'mm' && m.e?.fase === 'fimRodada'))?.e;
ok(e?.placar.TR === 1 && e.vencedorRodada === 'TR', 'CT eliminado: rodada do TR (1 x 0)');
ok(e?.jogadores[a.id].dinheiro === 150 + 300 + 3250, `Dinheiro: +300 pelo abate e +3250 pela rodada (${e?.jogadores[a.id].dinheiro})`);
e = (await a.esperarMsg((m) => m.k === 'mm' && m.e?.rodada === 2 && m.e.fase === 'compra'))?.e;
ok(e?.jogadores[b.id].vivo && e.jogadores[b.id].hp === 100, 'Próxima rodada: todo mundo renasce');

// TR ganha mais 3 rodadas (headshots) e a partida acaba.
for (let r = 2; r <= 4; r++) {
  await a.esperarMsg((m) => m.k === 'mm' && m.e?.rodada === r && m.e.fase === 'rodada');
  await a.ir(0, 20);
  await b.ir(0, 14);
  await esperar(150);
  // Glock na cabeça a 6 m tira ~94 (cai um pouco com a distância): dois tiros.
  await a.mandar({ k: 'tiro', d: mirar([0, 20], [0, 14], true), alvo: b.id, cabeca: true }, 200);
  await a.mandar({ k: 'tiro', d: mirar([0, 20], [0, 14], true), alvo: b.id, cabeca: true }, 250);
}
const res = await a.esperarMsg((m) => m.k === 'resultado' && m.jogo === 'mata-mata', 10000);
if (process.env.DEBUG) console.log('tiros:', JSON.stringify(a.msgs.filter((m) => m.k === 'tiro').map((m) => [m.o, m.p])), 'poses de B vistas por A:', JSON.stringify(a.msgs.filter((m) => m.k === 'poses').flatMap((m) => m.l).filter((p) => p[0] === b.id).slice(-3)));
if (process.env.DEBUG) console.log('placar/fases:', a.msgs.filter((m) => m.k === 'mm' && m.e).map((m) => m.e.rodada + m.e.fase[0] + JSON.stringify(m.e.placar)).filter((v, i, l) => v !== l[i - 1]).join(' '), '| abates:', a.msgs.filter((m) => m.k === 'abate').length);
ok(res?.l.find((l) => l.id === a.id)?.posicao === 1 && res.l.find((l) => l.id === b.id)?.posicao === 2, 'TR fez 4 rodadas: fim da partida, A em 1º (resultado e ranking)');
ok(a.msgs.some((m) => m.k === 'mm' && m.e === null), 'Volta para a praça (estado do mata-mata some)');
ok((await api('/salas', { metodo: 'POST' })).status === 200, 'Sala segue funcionando');

for (const p of [a, b, c, d]) p?.ws.close();
await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes do mata-mata passaram.');
process.exit(falhas ? 1 : 0);
