// Teste do backend contra um servidor rodando. Local (com rotas de teste e XP de presença acelerado):
//   .dev.vars com MODO_TESTE=1 e PRESENCA_MS=200, npx wrangler dev e, em outro terminal, npm run teste
// Publicado (pula o que depende do modo de teste): BASE=https://... npm run teste
// Os perfis criados aqui começam com "Teste"; no publicado, apague depois com npm run limpar-teste.

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');
const LOCAL = BASE.includes('localhost');

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (caminho, { metodo = 'GET', token, dados, origem = ORIGEM } = {}) => {
  const h = {};
  if (origem) h.Origin = origem;
  if (token) h.Authorization = `Bearer ${token}`;
  if (dados) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: dados ? JSON.stringify(dados) : undefined });
  return { status: r.status, d: await r.json().catch(() => null) };
};

const novoPerfil = async (apelido, skin = 'pele:1') => (await api('/perfil', { metodo: 'POST', dados: { apelido: `Teste ${apelido}`.slice(0, 16), skin } })).d;

/** Abre um jogador e guarda tudo o que ele recebe. */
function jogador(codigo, token) {
  const ws = new WebSocket(`${WS}/sala/${codigo}?token=${token}`, { headers: { Origin: ORIGEM } });
  const recebidas = [];
  ws.onmessage = (e) => recebidas.push(JSON.parse(e.data));
  const aberto = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  return { ws, recebidas, aberto, tipo: (k) => recebidas.filter((m) => m.k === k), mandar: (m) => ws.send(JSON.stringify(m)) };
}

/* ---------- Perfis ---------- */
ok((await (await fetch(BASE + '/saude')).json()).ok === true, 'GET /saude responde');
ok((await api('/jogar', { metodo: 'POST', origem: 'https://site-estranho.com' })).status === 403, 'POST /jogar de outro site é barrado');

const pa = await novoPerfil('Ana', 'pele:1|chapeu:coroa|camisa:#ef4444');
ok(pa.token?.length === 64 && pa.perfil.moedas === 1000 && pa.perfil.nivel === 1, 'Perfil novo: token secreto, 1000 moedas, nível 1');
ok(!pa.perfil.skin.includes('chapeu:coroa') && pa.perfil.skin.includes('camisa:#ef4444'), 'Item bloqueado é tirado da skin do perfil novo (o resto fica)');
ok((await api('/perfil', { metodo: 'POST', dados: { apelido: '   ' } })).status === 400, 'Perfil sem apelido é recusado');
ok((await api('/perfil', { token: pa.token })).d?.id === pa.perfil.id, 'GET /perfil com o token devolve o perfil');
ok((await api('/perfil', { token: 'f'.repeat(64) })).status === 401, 'Token errado → 401');
ok((await api('/perfil', { metodo: 'PATCH', token: pa.token, dados: { skin: 'pele:2|chapeu:coroa' } })).status === 403, 'Trocar para item bloqueado (coroa) → 403');
ok((await api('/perfil', { metodo: 'PATCH', token: pa.token, dados: { apelido: 'Teste Ana Clara' } })).d?.apelido === 'Teste Ana Clara', 'Trocar apelido');

/* ---------- Loja ---------- */
{
  const comprador = await novoPerfil('Loja');
  const comprar = (item) => api('/loja/comprar', { metodo: 'POST', token: comprador.token, dados: { item } });
  ok((await comprar('chapeu:coroa-diamante')).status === 402, 'Loja: sem moedas suficientes (diamante custa 5000) → recusado');
  const r = await comprar('acessorio:mochila');
  ok(r.status === 200 && r.d.moedas === 700 && r.d.itens.includes('acessorio:mochila'), 'Loja: comprou a mochila por 300 (sobram 700)');
  ok((await comprar('acessorio:mochila')).status === 409, 'Loja: não compra o mesmo item duas vezes');
  ok((await comprar('chapeu:inventado')).status === 400 && (await comprar('cabelo:arrepiado')).status === 400, 'Loja: item inexistente ou que não está à venda → recusado');
  ok((await api('/perfil', { metodo: 'PATCH', token: comprador.token, dados: { skin: 'pele:1|acessorio:mochila' } })).status === 200, 'Item comprado pode ser usado');
  ok((await api('/perfil', { metodo: 'PATCH', token: comprador.token, dados: { skin: 'pele:1|pet:gato' } })).status === 403, 'Item da loja não comprado continua bloqueado');
  const sem = await novoPerfil('Sem token');
  ok((await api('/loja/comprar', { metodo: 'POST', dados: { item: 'acessorio:capa' } })).status === 401 && sem.perfil.moedas === 1000, 'Comprar sem perfil → 401');
}

/* ---------- Salas ---------- */
// No publicado pode haver gente de verdade nas salas públicas: lá o teste usa só sala privada.
const { codigo } = (await api(LOCAL ? '/jogar' : '/salas', { metodo: 'POST' })).d;
ok(/^[A-HJ-NP-Z2-9]{6}$/.test(codigo), `${LOCAL ? 'POST /jogar' : 'POST /salas'} devolve código (${codigo})`);

const semToken = new WebSocket(`${WS}/sala/${codigo}?token=${'0'.repeat(64)}`, { headers: { Origin: ORIGEM } });
ok(await new Promise((r) => ((semToken.onopen = () => r(false)), (semToken.onerror = () => r(true)))), 'Sala sem perfil válido não abre');

const pb = await novoPerfil('Beto <b>');
const a = jogador(codigo, pa.token);
await a.aberto;
const entradaA = Date.now();
await esperar(150);
const b = jogador(codigo, pb.token);
await b.aberto;
await esperar(300);
const bvB = b.tipo('bemvindo')[0];
ok(a.tipo('bemvindo')[0]?.jogadores.length === 1, 'A entra sozinho na sala');
ok(bvB?.jogadores.some((j) => j.nome === 'Teste Ana Clara' && j.nivel === 1), 'B recebe A com o nome e o nível do perfil');
ok(a.tipo('entrou')[0]?.j.nome === 'Teste Beto b', 'A fica sabendo que B entrou (nome limpo de < >)');
ok(bvB?.eu === pb.perfil.id, 'O id na sala é o id público do perfil (o token não vaza)');
ok(!JSON.stringify(a.recebidas).includes(pb.token), 'Nenhuma mensagem contém o token de ninguém');
if (LOCAL) ok((await api('/jogar', { metodo: 'POST' })).d.codigo === codigo, 'Próximo "Jogar" cai na mesma sala (tem vaga)');

b.mandar({ k: 'pose', p: [3, 0, 4, 1.5, 1] });
await esperar(60);
b.mandar({ k: 'pose', p: [9999, 0, -9999, 0, 2] });
await esperar(400);
const lotes = a.tipo('poses');
const ultima = lotes.flatMap((l) => l.l).filter((p) => p[0] === bvB.eu).pop();
ok(lotes.length >= 1 && lotes.length <= 2, `Poses chegam em lote (${lotes.length} lote(s) para 2 envios)`);
ok(ultima && ultima[1] === 260 && ultima[3] === -260, 'Posição fora do mundo é limitada (±260, com o domo)');
b.mandar({ k: 'pose', p: [1, 0, 'x', 0, 0] });
await esperar(300);
ok(a.tipo('poses').length === lotes.length, 'Pose inválida é ignorada');

b.mandar({ k: 'emote', e: 'dancar' });
b.mandar({ k: 'emote', e: 'hackear' });
b.mandar({ k: 'skin', s: 'pele:2|camisa:#22c55e' });
b.mandar({ k: 'skin', s: 'pele:2|chapeu:cartola' });
await esperar(600);
ok(a.tipo('emote').length === 1 && a.tipo('emote')[0].e === 'dancar', 'Emote válido chega, inválido não');
ok(a.tipo('skin').length === 1 && a.tipo('skin')[0].s === 'pele:2|camisa:#22c55e', 'Skin liberada chega para os outros; a bloqueada (cartola) não');
ok(b.tipo('erro').some((m) => m.motivo === 'bloqueado'), 'Quem tentou a skin bloqueada recebe "bloqueado"');
ok((await api('/perfil', { token: pb.token })).d.skin === 'pele:2|camisa:#22c55e', 'A skin trocada na sala fica salva no perfil');

// Mesmo perfil em outra aba: a conexão antiga recebe "duplicado".
const b2 = jogador(codigo, pb.token);
await b2.aberto;
await esperar(500);
ok(b.tipo('erro').some((m) => m.motivo === 'duplicado'), 'Mesmo perfil em outra aba: a conexão antiga recebe "duplicado"');
b2.ws.close();
await esperar(400);
ok(a.tipo('saiu').some((m) => m.id === bvB.eu), 'A fica sabendo que B saiu');

// Sala cheia (12)
const extras = [];
for (let i = 0; i < 11; i++) {
  const p = await novoPerfil(`Extra ${i}`);
  const x = jogador(codigo, p.token);
  await x.aberto;
  extras.push(x);
}
await esperar(400);
ok(extras[10].tipo('bemvindo')[0]?.jogadores.length === 12, 'Sala chega a 12 pessoas');
const treze = jogador(codigo, (await novoPerfil('Treze')).token);
await treze.aberto;
await esperar(500);
ok(treze.tipo('erro')[0]?.motivo === 'cheia', 'A 13ª pessoa recebe "sala cheia"');
if (LOCAL) {
  ok((await api('/jogar', { metodo: 'POST' })).d.codigo !== codigo, 'Com a sala cheia, "Jogar" manda para outra sala');
  const online = (await api('/online')).d;
  ok(online.jogadores >= 12, `/online conta as pessoas (${online.jogadores} em ${online.salas} sala(s))`);
}

const privada = (await api('/salas', { metodo: 'POST' })).d.codigo;
const p = jogador(privada, (await novoPerfil('Priv')).token);
await p.aberto;
await esperar(300);
ok(p.tipo('bemvindo')[0]?.sala.publica === false, 'Criar sala → sala privada');
if (LOCAL) ok((await api('/jogar', { metodo: 'POST' })).d.codigo !== privada, 'Sala privada não aparece no "Jogar"');
for (const j of [p, ...extras]) j.ws.close();

/* ---------- XP de presença, partida, conquistas e ranking (só no servidor local de teste) ---------- */
if (LOCAL) {
  // Com PRESENCA_MS=200, cada 0,2 s na praça vale 1 "minuto" (até 60 por dia).
  a.ws.close();
  const minutosA = Math.floor((Date.now() - entradaA) / 200);
  await esperar(800);
  const xpA = (await api('/perfil', { token: pa.token })).d.xp;
  ok(Math.abs(xpA - Math.min(60, minutosA)) <= 2, `XP de presença ao sair da praça (${xpA} XP por ~${minutosA} "minutos")`);

  const res = await api('/teste/partida', {
    metodo: 'POST',
    dados: {
      jogo: 'rei-da-colina',
      sala: codigo,
      inicio: Date.now() - 60000,
      fim: Date.now(),
      resultados: [
        { id: pa.perfil.id, posicao: 1, pontos: 30, xp: 50, moedas: 100 },
        { id: pb.perfil.id, posicao: 2, pontos: 10, xp: 20, moedas: -5000 },
      ],
    },
  });
  ok(res.d?.[pa.perfil.id]?.includes('rei-da-colina') && res.d[pa.perfil.id].includes('primeira-vitoria'), 'Vencedor ganha as conquistas "primeira vitória" e "rei da colina"');
  ok(res.d?.[pb.perfil.id]?.includes('primeira-partida') && !res.d[pb.perfil.id].includes('primeira-vitoria'), 'Segundo lugar ganha só "primeira partida"');
  const perfA = (await api('/perfil', { token: pa.token })).d;
  const perfB = (await api('/perfil', { token: pb.token })).d;
  ok(perfA.moedas === 1100 && perfA.xp === xpA + 50 && perfA.nivel === 2, `Vencedor: +100 moedas, +50 XP e sobe para o nível ${perfA.nivel}`);
  ok(perfB.moedas === 0, 'Perda de moedas nunca deixa o saldo negativo');
  ok(perfA.itens.includes('chapeu:coroa'), 'A conquista libera a coroa');
  ok((await api('/perfil', { metodo: 'PATCH', token: pa.token, dados: { skin: 'pele:1|chapeu:coroa|cabelo:arrepiado' } })).status === 200, 'Agora pode usar a coroa (conquista) e o cabelo arrepiado (nível 2)');

  const rk = (await api('/ranking?por=rei-da-colina', { token: pb.token })).d;
  // O banco local guarda rodadas anteriores (o vencedor pode nem estar no top 20): usa a posição de cada um.
  const linhaA = (await api('/ranking?por=rei-da-colina', { token: pa.token })).d.eu;
  ok(linhaA?.valor > 1000 && rk.eu?.valor < 1000 && rk.eu.posicao > linhaA.posicao, `Ranking do jogo: vencedor ${linhaA?.valor} (${linhaA?.posicao}º), segundo ${rk.eu?.valor} (${rk.eu?.posicao}º), estilo Elo`);
  const rn = (await api('/ranking?por=nivel', { token: pa.token })).d;
  ok(rn.eu?.valor === 2 && rn.lista.length > 0, `Ranking por nível traz a sua posição (${rn.eu?.posicao}º)`);
  ok((await api('/ranking?por=x;drop')).status === 400, 'Ranking com nome estranho é recusado');
} else {
  a.ws.close();
  console.log('(pulei XP de presença, partida e ranking por jogo: só rodam no servidor local de teste)');
}

await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram.');
process.exit(falhas ? 1 : 0);
