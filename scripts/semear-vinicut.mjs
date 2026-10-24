// Popula o Vinicut do servidor LOCAL com pessoas e conteúdo de exemplo (para ver as telas e tirar prints).
// Uso: node scripts/semear-vinicut.mjs   (cria vini.demo@exemplo.com / senha123 e três amigos)

const BASE = process.env.BASE ?? 'http://localhost:8787';
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error('Só para o servidor local.');
const ORIGEM = 'http://localhost:3000';

async function chamar(token, metodo, caminho, dados) {
  const h = { Origin: ORIGEM };
  if (token) h.Authorization = `Bearer ${token}`;
  if (dados !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: dados !== undefined ? JSON.stringify(dados) : undefined });
  return r.json().catch(() => ({}));
}

async function pessoa(email, usuario, nome, extra) {
  let r = await chamar(null, 'POST', '/sistemas/conta', { acao: 'cadastrar', email, senha: 'senha123' });
  if (!r.ok) r = await chamar(null, 'POST', '/sistemas/conta', { acao: 'entrar', email, senha: 'senha123' });
  const token = r.token;
  await chamar(token, 'POST', '/vinicut/perfil', { usuario, nome, maior18: true });
  await chamar(token, 'PATCH', '/vinicut/perfil', extra);
  return { usuario, nome, api: (m, c, d) => chamar(token, m, c, d) };
}

const vini = await pessoa('vini.demo@exemplo.com', 'vinicius', 'Vinicius Monteiro', { cidade: 'Mogi Guaçu, SP', relacionamento: 'namorando', aniversario: '10-24', quem_sou_eu: 'Tech Lead, apaixonado por jogos, café e por fazer coisas que funcionam.\nCriei o Vinicut para matar a saudade do Orkut.', interesses: 'programação, jogos, IA, música' });
const ana = await pessoa('ana.demo@exemplo.com', 'ana.clara', 'Ana Clara', { cidade: 'Campinas, SP', relacionamento: 'solteiro(a)', aniversario: '10-24', quem_sou_eu: 'Designer. Adoro fotografia.' });
const beto = await pessoa('beto.demo@exemplo.com', 'beto_silva', 'Beto Silva', { cidade: 'São Paulo, SP', relacionamento: 'casado(a)' });
const carla = await pessoa('carla.demo@exemplo.com', 'carlinha', 'Carla Souza', { cidade: 'Mogi Mirim, SP' });

for (const p of [ana, beto, carla]) {
  await p.api('POST', `/vinicut/u/${vini.usuario}/amizade`, { acao: 'pedir' });
  if (p !== carla) await vini.api('POST', `/vinicut/u/${p.usuario}/amizade`, { acao: 'aceitar' });
}
await ana.api('POST', `/vinicut/u/${beto.usuario}/amizade`, { acao: 'pedir' });
await beto.api('POST', `/vinicut/u/${ana.usuario}/amizade`, { acao: 'aceitar' });

await ana.api('POST', `/vinicut/u/${vini.usuario}/recados`, { texto: 'Viniii! Que saudade do Orkut, que ideia boa isso aqui 😂' });
await beto.api('POST', `/vinicut/u/${vini.usuario}/recados`, { texto: 'Fala, mestre! Bora marcar aquele café essa semana?' });
await vini.api('POST', `/vinicut/u/${ana.usuario}/recados`, { texto: 'Valeu, Ana! Chama todo mundo pra cá 😄' });

const d1 = await beto.api('POST', `/vinicut/u/${vini.usuario}/depoimentos`, { texto: 'O Vinicius é aquele amigo que resolve qualquer problema de computador às 2 da manhã sem reclamar. Gente boa demais!' });
await vini.api('POST', `/vinicut/depoimentos/${d1.id}`, { aprovar: true });
await ana.api('POST', `/vinicut/u/${vini.usuario}/depoimentos`, { texto: 'Amigo leal, engraçado e o melhor DJ das festas da faculdade.' });

for (const p of [ana, beto]) {
  await p.api('POST', `/vinicut/u/${vini.usuario}/fa`, { sim: true });
  await p.api('POST', `/vinicut/u/${vini.usuario}/karma`, { confiavel: 3, legal: 3, gente_boa: p === ana ? 3 : 2 });
  await p.api('GET', `/vinicut/u/${vini.usuario}`);
}
await carla.api('GET', `/vinicut/u/${vini.usuario}`);

const p1 = await ana.api('POST', '/vinicut/posts', { texto: 'Primeiro dia no Vinicut e já mandei recado pra metade da turma da faculdade. Orkut feelings 💙' });
await beto.api('POST', '/vinicut/posts', { texto: 'Alguém lembra da comunidade "Eu odeio acordar cedo"? Recriaram aqui! 😴' });
await vini.api('POST', '/vinicut/posts', { texto: 'Bem-vindos ao Vinicut! Recados, depoimentos, comunidades e o "quem visitou meu perfil" estão de volta. Contem o que mais vocês querem aqui.' });
await vini.api('POST', `/vinicut/posts/${p1.id}/reacao`, { tipo: 'amei' });
await beto.api('POST', `/vinicut/posts/${p1.id}/reacao`, { tipo: 'haha' });
await beto.api('POST', `/vinicut/posts/${p1.id}/comentarios`, { texto: 'Eu também! Já recebi uns 5 recados 😂' });

const c = await beto.api('POST', '/vinicut/comunidades', { nome: 'Eu odeio acordar cedo', descricao: 'Para quem aperta o soneca 5 vezes e ainda chega atrasado.', categoria: 'Humor' });
const c2 = await vini.api('POST', '/vinicut/comunidades', { nome: 'Programadores de Mogi Guaçu', descricao: 'Vagas, eventos e café com código na região.', categoria: 'Tecnologia' });
await ana.api('POST', '/vinicut/comunidades', { nome: 'Fotografia de celular', descricao: 'Dicas e as melhores fotos tiradas no celular.', categoria: 'Outros' });
for (const p of [vini, ana]) await p.api('POST', `/vinicut/c/${c.id}/participar`, { sim: true });
await ana.api('POST', `/vinicut/c/${c2.id}/participar`, { sim: true });
const t = await beto.api('POST', `/vinicut/c/${c.id}/topicos`, { titulo: 'Quantas vezes você aperta o soneca?', texto: 'Eu: 4 vezes, no mínimo.' });
await vini.api('POST', `/vinicut/t/${t.id}/respostas`, { texto: 'Umas 6. E ainda acho pouco.' });
await ana.api('POST', `/vinicut/t/${t.id}/respostas`, { texto: 'Eu desativei o soneca e coloquei 8 alarmes 🙃' });
await vini.api('POST', `/vinicut/c/${c2.id}/topicos`, { titulo: 'Meetup em novembro?', texto: 'Quem topa um encontro de devs da região?' });

console.log('Vinicut de exemplo pronto: entre com vini.demo@exemplo.com / senha123');
