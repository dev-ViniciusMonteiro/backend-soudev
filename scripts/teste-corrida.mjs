// Teste da corrida contra o servidor local (.dev.vars com MODO_TESTE=1 e DURACAO_FATOR=0.05).
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:5173';
const WS = BASE.replace(/^http/, 'ws');
const CIRCUITO = [-175, 0];

// Mesma conta do protocolo (traçado lido do código-fonte).
const src = readFileSync(new URL('../src/protocolo.ts', import.meta.url), 'utf8');
const TRACADO = JSON.parse('[' + src.split('export const TRACADO: [number, number][] = [')[1].split('];')[0].trim().replace(/,$/, '') + ']');
function pontosPista(passo = 4) {
  const n = TRACADO.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [TRACADO[(i - 1 + n) % n], TRACADO[i], TRACADO[(i + 1) % n], TRACADO[(i + 2) % n]];
    const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / passo));
    for (let j = 0; j < k; j++) {
      const u = j / k;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u + (-a + 3 * b - 3 * cc + d) * u * u * u);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
const p = pontosPista();
const CPS = [];
for (let i = 6; i < p.length; i += 6) CPS.push(p[i]);
CPS.push(p[0]);

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
  return {
    id: perfil.id,
    ws,
    msgs,
    ultimo: (k) => msgs.filter((m) => m.k === k).at(-1),
    /** Pose relativa ao circuito (ou ao mundo). */
    ir: async (x, z, mundo = false, ms = 45) => {
      ws.send(JSON.stringify({ k: 'pose', p: [mundo ? x : CIRCUITO[0] + x, 0, mundo ? z : CIRCUITO[1] + z, 0, 4] }));
      await esperar(ms);
    },
    mandar: async (m, ms = 150) => {
      ws.send(JSON.stringify(m));
      await esperar(ms);
    },
    esperarMsg: async (cond, ms = 10000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const m = msgs.find(cond);
        if (m) return m;
        await esperar(30);
      }
      return null;
    },
  };
}

const codigo = (await api('/salas', { metodo: 'POST' })).d.codigo;
const a = await pessoa('Corre A', codigo);
const b = await pessoa('Corre B', codigo);
await a.ir(-52, -28, true, 100);
await b.ir(-51, -28, true, 100);
await esperar(250);
ok(a.ultimo('filas')?.f.corrida?.length === 2, 'Os dois no portal da corrida entram na fila');
await a.mandar({ k: 'iniciar', jogo: 'corrida' }, 300);
// Com o tempo acelerado (x20) a contagem dura 0,25 s: confere o primeiro estado recebido.
let e = a.msgs.find((m) => m.k === 'corrida')?.e;
ok(e?.fase === 'largada' && Object.keys(e.corredores).length === 2 && e.corredores[a.id].grid[0] < 0, 'Largada: os dois no grid, atrás da linha');
const d = await pessoa('Corre D', codigo).catch(() => null);
await esperar(250);
ok(d?.ultimo('erro')?.motivo === 'fechada', 'Durante a corrida a sala fecha para gente nova');

await a.esperarMsg((m) => m.k === 'corrida' && m.e?.fase === 'correndo');
// B tenta pular direto para a chegada e para o meio do circuito: não conta.
await b.ir(0, -60);
await b.ir(CPS[10][0], CPS[10][1], false, 400);
ok(a.ultimo('corrida').e.corredores[b.id].cp === 0, 'Pular checkpoints não conta (tem que passar em ordem)');
// Teletransporte: de um canto longe (~120 m) até o 1º checkpoint em 40 ms é rápido demais.
await b.ir(-60, 60, false, 300); // fica um tempo no canto (vira a última posição)
await b.ir(-60.5, 60, false, 40);
await b.ir(CPS[0][0], CPS[0][1], false, 300); // 40 ms depois, ~120 m adiante
ok(a.ultimo('corrida').e.corredores[b.id].cp === 0, 'Teletransporte (rápido demais) não conta');

// A faz as 3 voltas passando por todos os checkpoints.
await a.ir(-6, -60, false, 60);
for (let volta = 0; volta < 3; volta++) for (const cp of CPS) await a.ir(cp[0], cp[1]);
await esperar(300);
e = a.ultimo('corrida').e;
ok(e.corredores[a.id].terminou !== null && e.corredores[a.id].volta === 3 && e.corredores[a.id].posicao === 1, `A completou 3 voltas e cruzou a chegada em 1º (${e.corredores[a.id].terminou} ms)`);
// B faz só uma volta: o tempo para terminar acaba e a corrida fecha.
for (const cp of CPS) await b.ir(cp[0], cp[1]);
const res = await a.esperarMsg((m) => m.k === 'resultado' && m.jogo === 'corrida', 15000);
const ra = res?.l.find((x) => x.id === a.id);
const rb = res?.l.find((x) => x.id === b.id);
ok(ra?.posicao === 1 && ra.moedas === 80 && rb?.posicao === 2 && rb.pontos === 1 && rb.moedas === 5, `Fim: A 1º (+${ra?.moedas} moedas), B 2º sem terminar (${rb?.pontos} volta, +${rb?.moedas})`);
ok(a.msgs.some((m) => m.k === 'corrida' && m.e === null), 'Volta para a praça (estado da corrida some)');

for (const x of [a, b, d]) x?.ws.close();
await esperar(300);
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes da corrida passaram.');
process.exit(falhas ? 1 : 0);
