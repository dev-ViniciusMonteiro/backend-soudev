// Teste das salas contra o servidor rodando (npm run dev em outro terminal, ou BASE=https://... para o publicado).
// Simula vários jogadores: entrar, ver os outros, mover, emote, sair, sala cheia, conexão duplicada e origem barrada.

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (caminho, origem = ORIGEM) => fetch(BASE + caminho, { method: 'POST', headers: origem ? { Origin: origem } : {} });

/** Abre um jogador e guarda tudo o que ele recebe. */
function jogador(codigo, id, nome = id) {
  const ws = new WebSocket(`${WS}/sala/${codigo}?id=${id}&nome=${encodeURIComponent(nome)}&skin=pele:1`, { headers: { Origin: ORIGEM } });
  const recebidas = [];
  ws.onmessage = (e) => recebidas.push(JSON.parse(e.data));
  const aberto = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const fechado = new Promise((res) => (ws.onclose = (e) => res(e.code)));
  return {
    ws,
    recebidas,
    aberto,
    fechado,
    tipo: (k) => recebidas.filter((m) => m.k === k),
    mandar: (m) => ws.send(JSON.stringify(m)),
  };
}

const id = (n) => `teste-${n}-${Math.random().toString(36).slice(2, 8)}`;

// 1. Saúde e origem
ok((await (await fetch(BASE + '/saude')).json()).ok === true, 'GET /saude responde');
ok((await post('/jogar', 'https://site-estranho.com')).status === 403, 'POST /jogar de outro site é barrado');

// 2. Jogar → sala pública
const { codigo } = await (await post('/jogar')).json();
ok(/^[A-HJ-NP-Z2-9]{6}$/.test(codigo), `POST /jogar devolve código (${codigo})`);

// 3. Dois jogadores se veem
const a = jogador(codigo, id('a'), 'Ana');
await a.aberto;
await esperar(150);
const b = jogador(codigo, id('b'), 'Beto <script>');
await b.aberto;
await esperar(300);
const bvA = a.tipo('bemvindo')[0];
const bvB = b.tipo('bemvindo')[0];
ok(bvA?.jogadores.length === 1 && bvA.sala.publica === true, 'A entra sozinho numa sala pública');
ok(bvB?.jogadores.length === 2, 'B entra e já recebe A na lista');
ok(a.tipo('entrou')[0]?.j.nome === 'Beto script', 'A fica sabendo que B entrou (nome limpo de < >)');

// 4. Mesma sala no próximo "Jogar" (a mais cheia com vaga)
ok((await (await post('/jogar')).json()).codigo === codigo, 'Próximo "Jogar" cai na mesma sala (tem vaga)');

// 5. Poses em lote, limitadas ao mundo
b.mandar({ k: 'pose', p: [3, 0, 4, 1.5, 1] });
await esperar(60);
b.mandar({ k: 'pose', p: [999, 0, -999, 0, 2] });
await esperar(400);
const lotes = a.tipo('poses');
const ultima = lotes.flatMap((l) => l.l).filter((p) => p[0] === bvB.eu).pop();
ok(lotes.length >= 1 && lotes.length <= 2, `Poses chegam em lote (${lotes.length} lote(s) para 2 envios)`);
ok(ultima && ultima[1] === 40 && ultima[3] === -40, 'Posição fora da praça é limitada ao mundo (±40)');
b.mandar({ k: 'pose', p: [1, 0, 'x', 0, 0] });
b.mandar({ k: 'pose', p: [1, 0, 1, 0, 9] });
await esperar(300);
ok(a.tipo('poses').length === lotes.length, 'Pose inválida é ignorada');

// 6. Emote e skin
b.mandar({ k: 'emote', e: 'dancar' });
b.mandar({ k: 'emote', e: 'hackear' });
b.mandar({ k: 'skin', s: 'pele:2|chapeu:bone' });
await esperar(300);
ok(a.tipo('emote').length === 1 && a.tipo('emote')[0].e === 'dancar', 'Emote válido chega, inválido não');
ok(a.tipo('skin')[0]?.s === 'pele:2|chapeu:bone', 'Troca de skin chega para os outros');

// 7. Saída
b.ws.close();
await esperar(400);
ok(a.tipo('saiu')[0]?.id === bvB.eu, 'A fica sabendo que B saiu');

// 8. Conexão duplicada: a antiga sai
const idDup = id('dup');
const d1 = jogador(codigo, idDup);
await d1.aberto;
await esperar(150);
const d2 = jogador(codigo, idDup);
await d2.aberto;
await esperar(500);
// O servidor manda o aviso e começa a fechar; o jogo fecha a aba antiga ao receber 'duplicado'.
ok(d1.tipo('erro')[0]?.motivo === 'duplicado' && d1.ws.readyState >= 2, 'Mesmo jogador em outra aba: a conexão antiga recebe "duplicado" e é fechada');
await esperar(200);
ok(a.tipo('entrou').filter((m) => m.j.id === idDup).length === 2 && a.tipo('saiu').some((m) => m.id === idDup), 'Os outros veem a troca (saiu + entrou)');

// 9. Sala cheia (12)
const extras = [];
for (let i = 0; i < 10; i++) {
  const x = jogador(codigo, id(`x${i}`));
  await x.aberto;
  extras.push(x);
}
await esperar(400);
ok(a.tipo('bemvindo').length === 1 && extras[9].tipo('bemvindo')[0]?.jogadores.length === 12, 'Sala chega a 12 pessoas');
const treze = jogador(codigo, id('treze'));
await treze.aberto;
await Promise.race([treze.fechado, esperar(2000)]);
ok(treze.tipo('erro')[0]?.motivo === 'cheia', 'A 13ª pessoa recebe "sala cheia"');
const outra = (await (await post('/jogar')).json()).codigo;
ok(outra !== codigo, `Com a sala cheia, "Jogar" manda para outra sala (${outra})`);

// 10. Online e sala privada
const online = await (await fetch(BASE + '/online')).json();
ok(online.jogadores >= 12, `/online conta as pessoas (${online.jogadores} em ${online.salas} sala(s))`);
const privada = (await (await post('/salas')).json()).codigo;
const p = jogador(privada, id('p'));
await p.aberto;
await esperar(300);
ok(p.tipo('bemvindo')[0]?.sala.publica === false, 'Criar sala → sala privada');
ok((await (await post('/jogar')).json()).codigo !== privada, 'Sala privada não aparece no "Jogar"');

for (const j of [a, d2, p, ...extras]) j.ws.close();
await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram.');
process.exit(falhas ? 1 : 0);
