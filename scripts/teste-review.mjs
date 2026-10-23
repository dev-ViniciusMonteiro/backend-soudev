// Teste dos carros e do Sprint Review contra o servidor local (.dev.vars com MODO_TESTE=1).

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');

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
  await esperar(120);
  return {
    id: perfil.id,
    token,
    ws,
    msgs,
    ultimo: (k) => msgs.filter((m) => m.k === k).at(-1),
    ir: async (x, z, rot = 0, anim = 1) => {
      ws.send(JSON.stringify({ k: 'pose', p: [x, 0, z, rot, anim] }));
      await esperar(60);
    },
    mandar: async (m) => {
      ws.send(JSON.stringify(m));
      await esperar(150);
    },
    esperarMsg: async (cond, ms = 5000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const m = msgs.find(cond);
        if (m) return m;
        await esperar(40);
      }
      return null;
    },
  };
}

/* ---------- Carros ---------- */
{
  const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;
  const a = await pessoa('Carro A', codigo);
  const b = await pessoa('Carro B', codigo);
  const inicial = a.ultimo('carros');
  ok(inicial?.l.length === 4 && inicial.l.every((c) => c[4] === ''), 'Ao entrar, recebe os 4 carros, todos livres');

  await a.mandar({ k: 'carro', c: 0 });
  ok(a.ultimo('carros').l[0][4] === '', 'Longe do carro não dá para entrar');
  await a.ir(-14, -28); // ao lado do táxi
  await esperar(150);
  await a.mandar({ k: 'carro', c: 0 });
  ok(b.ultimo('carros')?.l[0][4] === a.id, 'Perto do táxi: entra e todos ficam sabendo quem dirige');

  await b.ir(-13, -28);
  await esperar(150);
  await b.mandar({ k: 'carro', c: 0 });
  ok(b.ultimo('carros').l[0][4] === a.id, 'Carro ocupado: outro não entra');

  await a.ir(-5, -30.5, 1.57, 4);
  await esperar(250);
  const pose = b.msgs.filter((m) => m.k === 'poses').flatMap((m) => m.l).filter((p) => p[0] === a.id).at(-1);
  ok(pose?.[5] === 4 && pose[1] === -5, 'Dirigindo: os outros recebem a pose com a animação "dirigindo"');

  await b.ir(-12, -20, 0, 4);
  await esperar(250);
  const poseB = a.msgs.filter((m) => m.k === 'poses').flatMap((m) => m.l).filter((p) => p[0] === b.id).at(-1);
  ok(poseB?.[5] === 0, 'Quem não está em carro não consegue fingir que dirige');

  await a.mandar({ k: 'sairCarro' });
  const saiu = b.ultimo('carros').l[0];
  ok(saiu[4] === '' && saiu[1] === -5 && saiu[2] === -30.5, 'Saiu do carro: ele fica onde parou, livre');

  await a.mandar({ k: 'carro', c: 0 });
  a.ws.close();
  await esperar(400);
  ok(b.ultimo('carros').l[0][4] === '', 'Quem estava dirigindo e caiu libera o carro');
  b.ws.close();
}

/* ---------- Sprint Review ---------- */
{
  const codigo = (await api('/jogar', { metodo: 'POST' })).d.codigo;
  const a = await pessoa('Review A', codigo);
  const b = await pessoa('Review B', codigo);
  const c = await pessoa('Review C', codigo);
  await a.ir(-13, 6); // portal do Sprint Review
  await esperar(250);
  await a.mandar({ k: 'iniciar', jogo: 'sprint-review' });
  const r0 = c.ultimo('retro')?.r;
  ok(r0?.fase === 'reuniao' && r0.participantes.length === 3 && r0.anfitriao === a.id, 'Iniciar no portal: a sala inteira entra na retro (reunião), quem iniciou conduz');

  const d = await pessoa('Review D', codigo).catch(() => null);
  await esperar(250);
  ok(d?.ultimo('erro')?.motivo === 'fechada', 'Durante o Sprint Review a sala fecha para gente nova');
  ok((await api('/jogar', { metodo: 'POST' })).d.codigo !== codigo, 'E sai do "Jogar"');

  await a.ir(0, 5);
  await esperar(150);
  await a.mandar({ k: 'retro', a: 'pronto' });
  await b.mandar({ k: 'retro', a: 'pronto' }); // B ainda está longe do centro
  let r = a.ultimo('retro').r;
  ok(r.prontos.length === 1 && r.prontos[0] === a.id, '"Pronto" só vale no centro (perto do chafariz)');
  await b.ir(3, 3);
  await c.ir(-3, 4);
  await esperar(150);
  await b.mandar({ k: 'retro', a: 'pronto' });
  await c.mandar({ k: 'retro', a: 'pronto' });
  r = a.ultimo('retro').r;
  ok(r.fase === 'pergunta' && r.pergunta === 0 && Object.values(r.status).every((s) => s === 'pensando'), 'Todos prontos no centro: começa a 1ª pergunta (Doçuras)');

  await a.mandar({ k: 'placa', t: 'Time <b>unido</b>' });
  r = b.ultimo('retro').r;
  ok(r.placas[a.id] === 'Time bunido/b' && r.status[a.id] === 'levantada', 'Placa levantada aparece para todos (texto limpo de < >)');
  await a.mandar({ k: 'placa', t: 'Time muito unido' });
  r = b.ultimo('retro').r;
  ok(r.respostas.length === 1 && r.respostas[0].texto === 'Time muito unido', 'Trocar o texto com a placa levantada edita a mesma resposta');
  await a.mandar({ k: 'placa', t: 'x'.repeat(200) });
  ok(b.ultimo('retro').r.placas[a.id].length === 60, 'Resposta curta: no máximo 60 letras');
  await a.mandar({ k: 'placa', t: 'Time muito unido' });
  await a.mandar({ k: 'retro', a: 'baixar' });
  await b.mandar({ k: 'retro', a: 'passar' });
  r = c.ultimo('retro').r;
  ok(r.pergunta === 0 && r.status[c.id] === 'pensando', 'Só passa de pergunta quando todos baixaram a placa');
  await c.mandar({ k: 'placa', t: 'Deploy rápido' });
  await c.mandar({ k: 'retro', a: 'baixar' });
  await c.mandar({ k: 'placa', t: 'Mais testes' }); // já é a resposta de C para a 2ª pergunta
  r = a.ultimo('retro').r;
  ok(r.pergunta === 1, 'Todos baixaram: vem a 2ª pergunta (Travessuras traiçoeiras)');

  await b.mandar({ k: 'retro', a: 'avancar' });
  ok(a.ultimo('retro').r.pergunta === 1, 'Só quem conduz pode pular a pergunta');
  await a.mandar({ k: 'retro', a: 'avancar' });
  await a.mandar({ k: 'retro', a: 'avancar' });
  r = a.ultimo('retro').r;
  ok(r.pergunta === 3, 'Quem conduz pula para a 4ª pergunta (Festa à fantasia)');
  await b.mandar({ k: 'placa', t: 'Testar pair programming' });
  await b.mandar({ k: 'retro', a: 'baixar' });
  await a.mandar({ k: 'retro', a: 'passar' });
  await c.mandar({ k: 'retro', a: 'passar' });
  r = a.ultimo('retro').r;
  ok(r.fase === 'votacao' && r.respostas.length === 4, `Depois da última pergunta: votação com todas as respostas (${r.respostas.length})`);

  const rA = r.respostas.find((x) => x.autor === a.id);
  const rC = r.respostas.find((x) => x.autor === c.id && x.pergunta === 0);
  const rB = r.respostas.find((x) => x.autor === b.id);
  await a.mandar({ k: 'voto', r: rA.id });
  ok(a.ultimo('retro').r.respostas.find((x) => x.id === rA.id).votos.length === 0, 'Não dá para votar na própria resposta');
  await b.mandar({ k: 'voto', r: rA.id });
  await c.mandar({ k: 'voto', r: rA.id });
  await a.mandar({ k: 'voto', r: rC.id });
  await a.mandar({ k: 'voto', r: rC.id }); // tira o voto
  await a.mandar({ k: 'voto', r: rB.id });
  r = a.ultimo('retro').r;
  ok(r.respostas.find((x) => x.id === rA.id).votos.length === 2 && r.respostas.find((x) => x.id === rC.id).votos.length === 0, 'Votar de novo na mesma resposta tira o voto');
  // Vota em todas as respostas dos outros que ainda não votou (clicar de novo tiraria o voto).
  for (const x of r.respostas.filter((x) => x.autor !== a.id && !x.votos.includes(a.id))) await a.mandar({ k: 'voto', r: x.id });
  ok(a.ultimo('retro').r.respostas.filter((x) => x.votos.includes(a.id)).length === 3, 'No máximo 3 votos por pessoa');

  await a.mandar({ k: 'retro', a: 'terminarVoto' });
  await b.mandar({ k: 'retro', a: 'terminarVoto' });
  await c.mandar({ k: 'retro', a: 'terminarVoto' });
  const fim = await a.esperarMsg((m) => m.k === 'retro' && m.r?.fase === 'fim');
  ok(fim?.r.premiadas[0] === rA.id, 'Todos terminaram de votar: relatório final com a mais votada em 1º');
  const res = await a.esperarMsg((m) => m.k === 'resultado' && m.jogo === 'sprint-review');
  const linhaA = res?.l.find((l) => l.id === a.id);
  ok(linhaA?.posicao === 1 && linhaA.xp === 70 && linhaA.moedas === 110, `Autor da resposta mais votada: 1º lugar, +${linhaA?.xp} XP e +${linhaA?.moedas} moedas`);
  await esperar(300);
  ok((await api('/jogar', { metodo: 'POST' })).d.codigo === codigo, 'Depois do relatório a sala reabre');
  for (const p of [a, b, c, d]) p?.ws.close();
}

await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes de carros e Sprint Review passaram.');
process.exit(falhas ? 1 : 0);
