// Teste do Vinicut (rede social) contra o servidor local.
// O servidor local precisa ter VINICUT_ADMINS com o e-mail do moderador deste teste (no .dev.vars, ou):
//   npx wrangler dev --var VINICUT_ADMINS:moderador.vinicut@exemplo.com

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:3000';
const ADMIN = process.env.ADMIN ?? 'moderador.vinicut@exemplo.com';

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const sufixo = Math.random().toString(36).slice(2, 7);

async function chamar(token, metodo, caminho, dados, extra = {}) {
  const h = { Origin: ORIGEM, ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (dados instanceof Uint8Array) body = dados;
  else if (dados !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(dados);
  }
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}

async function pessoa(nome, email = `${nome.toLowerCase()}.${sufixo}@exemplo.com`) {
  let r = await chamar(null, 'POST', '/sistemas/conta', { acao: 'cadastrar', email, senha: 'senha123' });
  if (!r.d.ok) r = await chamar(null, 'POST', '/sistemas/conta', { acao: 'entrar', email, senha: 'senha123' });
  const token = r.d.token;
  const usuario = `${nome.toLowerCase()}_${sufixo}`;
  const api = (m, c, d, e) => chamar(token, m, c, d, e);
  return { nome, email, token, usuario, api };
}

const a = await pessoa('Ana');
const b = await pessoa('Beto');
const c = await pessoa('Caio');
const mod = await pessoa('Mod', ADMIN);

/* ---------- Perfil ---------- */
let r = await a.api('GET', '/vinicut/eu');
ok(r.status === 200 && r.d.perfil === null, 'Conta do site sem perfil no Vinicut ainda');
r = await a.api('POST', '/vinicut/perfil', { usuario: a.usuario, nome: 'Ana' });
ok(r.status === 400 && r.d.erro.includes('18'), 'Precisa confirmar 18 anos ou mais');
for (const p of [a, b, c]) r = await p.api('POST', '/vinicut/perfil', { usuario: p.usuario, nome: p.nome, maior18: true });
ok(r.status === 200, 'Ana, Beto e Caio criam o perfil');
await mod.api('POST', '/vinicut/perfil', { usuario: `mod_${sufixo}`, nome: 'Moderação', maior18: true });
r = await c.api('POST', '/vinicut/perfil', { usuario: a.usuario, nome: 'Outro', maior18: true });
ok(r.status === 409, 'Não cria dois perfis na mesma conta');
r = await a.api('PATCH', '/vinicut/perfil', { cidade: 'Mogi Guaçu', relacionamento: 'namorando', aniversario: '10-24', quem_sou_eu: 'Gosto de café e código.' });
ok(r.status === 200, 'Edita cidade, relacionamento, aniversário e "quem sou eu"');
r = await chamar(null, 'GET', '/vinicut/eu', undefined, { Origin: '' });
ok(r.status === 403 || r.status === 401, 'Sem origem do site ou sem sessão: recusado');

/* ---------- Amizade ---------- */
r = await a.api('POST', `/vinicut/u/${b.usuario}/amizade`, { acao: 'pedir' });
ok(r.d.amizade === 'enviado', 'Ana pede amizade ao Beto');
r = await b.api('GET', '/vinicut/pedidos');
ok(r.d.pedidos?.length === 1 && r.d.pedidos[0].usuario === a.usuario, 'Beto vê o pedido');
r = await b.api('POST', `/vinicut/u/${a.usuario}/amizade`, { acao: 'aceitar' });
ok(r.d.amizade === 'amigos', 'Beto aceita: agora são amigos');

/* ---------- Recados e depoimentos ---------- */
r = await a.api('POST', `/vinicut/u/${b.usuario}/recados`, { texto: 'Oi Beto! Saudades do Orkut :)' });
ok(r.status === 200, 'Ana deixa um recado para o Beto');
r = await c.api('POST', `/vinicut/u/${b.usuario}/depoimentos`, { texto: 'Gente boa!' });
ok(r.status === 403, 'Quem não é amigo não escreve depoimento');
r = await a.api('POST', `/vinicut/u/${b.usuario}/depoimentos`, { texto: 'O Beto é o amigo mais leal que eu tenho.' });
const dep = r.d.id;
r = await c.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.depoimentos.length === 0 && r.d.recados.length === 1, 'Depoimento só aparece depois de aprovado; o recado já aparece');
r = await b.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.depoimentos.length === 1 && r.d.depoimentos[0].aprovado === false, 'O dono vê o depoimento pendente');
await b.api('POST', `/vinicut/depoimentos/${dep}`, { aprovar: true });
r = await c.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.depoimentos.length === 1 && r.d.depoimentos[0].autor.usuario === a.usuario, 'Aprovado: todos veem o depoimento');

/* ---------- Fãs, karma e visitas ---------- */
await c.api('POST', `/vinicut/u/${b.usuario}/fa`, { sim: true });
await c.api('POST', `/vinicut/u/${b.usuario}/karma`, { confiavel: 3, legal: 2, gente_boa: 9 });
r = await a.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.fas === 1 && r.d.karma.votos === 1 && r.d.karma.gente_boa === 3 && r.d.karma.legal === 2, 'Fã e karma contam (karma vai de 0 a 3)');
r = await b.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.visitas.some((v) => v.usuario === c.usuario) && r.d.visitas.some((v) => v.usuario === a.usuario), 'O dono vê quem visitou o perfil');
r = await a.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.visitas.length === 0, 'Os outros não veem as visitas');

/* ---------- Fotos ---------- */
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (x) => x.charCodeAt(0));
r = await a.api('POST', '/vinicut/fotos', png, { 'Content-Type': 'image/png', 'X-Legenda': encodeURIComponent('Pôr do sol') });
ok(r.status === 200 && r.d.url, 'Envia uma foto (R2)');
const foto = r.d;
const img = await fetch(foto.url);
ok(img.status === 200 && img.headers.get('content-type') === 'image/png', 'A foto abre pelo link público');
r = await a.api('POST', '/vinicut/fotos', new TextEncoder().encode('nada'), { 'Content-Type': 'text/plain' });
ok(r.status === 400, 'Só aceita imagem');
await a.api('PATCH', '/vinicut/perfil', { foto: foto.chave });
r = await b.api('PATCH', '/vinicut/perfil', { foto: foto.chave });
ok(r.status === 400, 'Não dá para usar a foto de outra pessoa');

/* ---------- Feed ---------- */
r = await a.api('POST', '/vinicut/posts', { texto: 'Primeiro post no Vinicut!', foto: foto.chave });
const post = r.d.id;
r = await b.api('GET', '/vinicut/feed');
ok(r.d.posts?.some((p) => p.id === post && p.foto), 'O post (com foto) aparece no feed do amigo');
r = await c.api('GET', '/vinicut/feed');
ok(!r.d.posts?.some((p) => p.id === post), 'Quem não é amigo não recebe no feed');
await b.api('POST', `/vinicut/posts/${post}/reacao`, { tipo: 'amei' });
await b.api('POST', `/vinicut/posts/${post}/comentarios`, { texto: 'Que foto linda!' });
r = await b.api('GET', '/vinicut/feed');
const p1 = r.d.posts.find((p) => p.id === post);
ok(p1.reacoes === 1 && p1.minha === 'amei' && p1.comentarios === 1, 'Reação e comentário contam no post');
r = await a.api('GET', '/vinicut/notificacoes');
const tipos = r.d.notificacoes.map((n) => n.tipo);
ok(['aceitou', 'reacao', 'comentario'].every((t) => tipos.includes(t)), `Notificações da Ana: ${[...new Set(tipos)].join(', ')}`);
r = await a.api('GET', '/vinicut/eu');
ok(r.d.naoLidas >= 3, `Contador de não lidas (${r.d.naoLidas})`);
await a.api('POST', '/vinicut/notificacoes/lidas');
r = await a.api('GET', '/vinicut/eu');
ok(r.d.naoLidas === 0, 'Marcar como lidas zera o contador');

/* ---------- Comunidades ---------- */
r = await a.api('POST', '/vinicut/comunidades', { nome: `Eu odeio acordar cedo ${sufixo}`, descricao: 'Para quem aperta soneca 5 vezes.', categoria: 'Humor' });
const com = r.d.id;
await b.api('POST', `/vinicut/c/${com}/participar`, { sim: true });
r = await b.api('POST', `/vinicut/c/${com}/topicos`, { titulo: 'Quantas vezes você aperta soneca?', texto: 'Eu: 4.' });
const top = r.d.id;
r = await c.api('POST', `/vinicut/t/${top}/respostas`, { texto: 'Eu nem acordo.' });
ok(r.status === 403, 'Quem não participa não responde no fórum');
await a.api('POST', `/vinicut/t/${top}/respostas`, { texto: 'Umas 6!' });
r = await c.api('GET', `/vinicut/c/${com}`);
ok(r.d.comunidade.membros === 2 && r.d.topicos[0].respostas === 1 && !r.d.souMembro, 'Comunidade com 2 membros, tópico com 1 resposta');
r = await c.api('GET', `/vinicut/busca?q=${encodeURIComponent('acordar cedo')}`);
ok(r.d.comunidades.some((x) => x.id === com), 'Busca acha a comunidade');
r = await c.api('GET', `/vinicut/busca?q=${a.usuario}`);
ok(r.d.pessoas.some((x) => x.usuario === a.usuario), 'Busca acha a pessoa pelo @');

/* ---------- Bloqueio, denúncia e moderação ---------- */
await c.api('POST', `/vinicut/u/${a.usuario}/bloquear`, { sim: true });
r = await a.api('POST', `/vinicut/u/${c.usuario}/recados`, { texto: 'oi' });
ok(r.status === 403, 'Bloqueado não manda recado');
r = await a.api('GET', `/vinicut/u/${c.usuario}`);
ok(r.status === 403, 'Bloqueado não vê o perfil');
r = await b.api('POST', '/vinicut/denunciar', { tipo: 'post', alvo: post, motivo: 'Teste de denúncia' });
ok(r.status === 200, 'Beto denuncia o post');
r = await b.api('GET', '/vinicut/moderacao');
ok(r.status === 403, 'Moderação: só administradores');
r = await mod.api('GET', '/vinicut/moderacao');
const den = r.d.denuncias?.find((d) => d.alvo === post);
ok(den?.conteudo?.texto.includes('Primeiro post'), 'O moderador vê a denúncia com o conteúdo');
r = await mod.api('POST', '/vinicut/moderacao', { id: den.id, acao: 'remover' });
r = await b.api('GET', '/vinicut/feed');
ok(!r.d.posts.some((p) => p.id === post), 'Removido pela moderação: o post sumiu');

/* ---------- Apagar o perfil (LGPD) ---------- */
r = await c.api('DELETE', '/vinicut/perfil');
ok(r.status === 200, 'Caio apaga o perfil');
r = await c.api('GET', '/vinicut/eu');
ok(r.d.perfil === null, 'Sem perfil depois de apagar (a conta do site continua)');
r = await b.api('GET', `/vinicut/u/${b.usuario}`);
ok(r.d.fas === 0 && r.d.karma.votos === 0, 'O fã e o karma do Caio saíram junto');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes do Vinicut passaram.');
process.exit(falhas ? 1 : 0);
