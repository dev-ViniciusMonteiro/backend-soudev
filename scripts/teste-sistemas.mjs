// Teste dos sistemas de gestão na nuvem (contas, equipes, sincronização e páginas públicas) contra o servidor local.

const BASE = process.env.BASE ?? 'http://localhost:8787';
const ORIGEM = 'http://localhost:3000';

let falhas = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? 'OK  ' : 'ERRO'} ${texto}`);
  if (!cond) falhas++;
};
const chamar = async (caminho, corpo) => {
  const r = await fetch(BASE + caminho, { method: 'POST', headers: { Origin: ORIGEM, 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corpo) });
  return r.json();
};
const conta = (corpo) => chamar('/sistemas/conta', corpo);
const sufixo = Math.random().toString(36).slice(2, 8);
const emailDono = `teste.dono.${sufixo}@exemplo.com`;
const emailOp = `teste.op.${sufixo}@exemplo.com`;

/* ---------- Conta e equipe ---------- */
let t0 = Date.now();
let r = await conta({ acao: 'cadastrar', email: emailDono, senha: 'segredo123' });
const ms = Date.now() - t0;
ok(r.ok && r.token && r.equipes.length === 0, `Cadastro com e-mail e senha (${ms} ms)`);
const tokenDono = r.token;
r = await conta({ acao: 'cadastrar', email: emailDono, senha: 'outra123' });
ok(!r.ok && r.codigo === 'existe', 'Não cadastra o mesmo e-mail duas vezes');
r = await conta({ acao: 'cadastrar', email: `x${sufixo}@exemplo.com`, senha: '123' });
ok(!r.ok && r.erro.includes('6 caracteres'), 'Senha curta é recusada');
r = await conta({ acao: 'entrar', email: emailDono, senha: 'errada' });
ok(!r.ok && r.codigo === 'login', 'Senha errada não entra');
r = await conta({ acao: 'entrar', email: emailDono.toUpperCase(), senha: 'segredo123' });
ok(r.ok && r.email === emailDono, 'Entra com a senha certa (e-mail sem diferenciar maiúsculas)');

r = await conta({ acao: 'criar_equipe', token: tokenDono, nome: 'Barbearia do Teste', nicho: 'barbearia-salao' });
ok(r.ok && r.equipe.papel === 'dono', 'Cria a equipe e vira dono');
const equipe = r.equipe.id;
r = await conta({ acao: 'equipes', token: tokenDono });
ok(r.equipes.length === 1 && r.equipes[0].nome === 'Barbearia do Teste', 'A equipe aparece na lista da conta');
r = await conta({ acao: 'abrir', token: tokenDono, equipe });
ok(r.ok && r.url.endsWith(`/sistemas/e/${equipe}`) && r.papel === 'dono' && r.token, 'Abrir a equipe dá o endereço e o token do sistema');
const urlEquipe = r.url.replace(/^https?:\/\/[^/]+/, '');
const tokenSx = r.token;

/* ---------- Sincronização ---------- */
const sync = (token, mudancas, desde = 0) => chamar(urlEquipe, { acao: 'sincronizar', authorization: `Bearer ${token}`, mudancas, desde });
const agora = Date.now();
r = await sync(tokenSx, [
  { tabela: 'config', registro: { id: 'empresa_nome', valor: 'Barbearia do Teste', atualizado_em: agora } },
  { tabela: 'config', registro: { id: 'dias', valor: '0,1,2,3,4,5,6', atualizado_em: agora } },
  { tabela: 'config', registro: { id: 'abre', valor: '08:00', atualizado_em: agora } },
  { tabela: 'config', registro: { id: 'fecha', valor: '22:00', atualizado_em: agora } },
  { tabela: 'produtos', registro: { id: 'p1', nome: 'Corte', tipo: 'servico', preco: 40, duracao_min: 30, publicado: true, ativo: true, atualizado_em: agora } },
  { tabela: 'profissionais', registro: { id: 'b1', nome: 'Zé', ativo: true, publicado: true, atualizado_em: agora } },
  { tabela: 'vendas', registro: { id: 'v1', itens: [{ produto_id: 'p1', nome: 'Corte', preco: 40, qtd: 1 }], total: 40, status: 'concluida', atualizado_em: agora } },
  { tabela: 'tabela_que_nao_existe', registro: { id: 'x' } },
]);
const ecoVenda = r.mudancas?.find((m) => m.tabela === 'vendas');
ok(r.ok && ecoVenda?.registro.numero === '1' && /^[A-Z0-9]{6}$/.test(ecoVenda.registro.codigo_publico), 'Sincronizar grava e a venda volta com número 1 e código público');
const cursor1 = r.cursor;
r = await sync(tokenSx, [], 0);
ok(r.mudancas.length === 7 && !r.mudancas.some((m) => m.tabela === 'tabela_que_nao_existe'), `Outro aparelho baixa tudo (${r.mudancas.length} registros; tabela desconhecida ignorada)`);
r = await sync(tokenSx, [{ tabela: 'produtos', registro: { id: 'p1', nome: 'Corte antigo', atualizado_em: agora - 5000 } }], cursor1);
ok(r.mudancas.some((m) => m.registro.id === 'p1' && m.registro.nome === 'Corte'), 'Alteração mais velha é recusada e volta a versão atual');
r = await sync(tokenSx, [{ tabela: 'vendas', registro: { id: 'v2', total: 10, status: 'concluida', atualizado_em: Date.now() } }], r.cursor);
ok(r.mudancas.find((m) => m.registro.id === 'v2')?.registro.numero === '2', 'A venda seguinte ganha o número 2');
r = await sync('token-falso', [], 0);
ok(!r.ok && r.codigo === 'sessao', 'Token inválido não sincroniza');

/* ---------- Membros ---------- */
r = await conta({ acao: 'membro_salvar', token: tokenDono, equipe, email: emailOp, papel: 'operador' });
ok(r.ok && r.membros.some((m) => m.email === emailOp && m.papel === 'operador' && !m.temConta), 'Dono adiciona um operador pelo e-mail (ainda sem conta)');
r = await conta({ acao: 'cadastrar', email: emailOp, senha: 'operador1' });
ok(r.ok && r.equipes.length === 1 && r.equipes[0].id === equipe && r.equipes[0].papel === 'operador', 'O operador cria a conta e já vê a equipe');
const tokenOp = r.token;
r = await conta({ acao: 'membros', token: tokenOp, equipe });
ok(!r.ok && r.codigo === 'acesso', 'Operador não mexe na equipe');
r = await conta({ acao: 'abrir', token: tokenOp, equipe });
const tokenOpSx = r.token;
r = await sync(tokenOpSx, [
  { tabela: 'config', registro: { id: 'empresa_nome', valor: 'Hackeado', atualizado_em: Date.now() } },
  { tabela: 'clientes', registro: { id: 'c1', nome: 'Maria', telefone: '11999990000', atualizado_em: Date.now() } },
]);
const r2 = await sync(tokenSx, [], 0);
ok(r2.mudancas.find((m) => m.registro.id === 'empresa_nome')?.registro.valor === 'Barbearia do Teste' && r2.mudancas.some((m) => m.registro.id === 'c1'), 'Operador grava cliente mas não muda as configurações');

r = await conta({ acao: 'senha_provisoria', token: tokenDono, equipe, email: emailOp });
ok(r.ok && r.senha?.length >= 6, 'Dono gera senha provisória para o operador');
r = await conta({ acao: 'entrar', email: emailOp, senha: 'operador1' });
ok(!r.ok, 'A senha antiga parou de valer');
r = await conta({ acao: 'entrar', email: emailOp, senha: (await conta({ acao: 'senha_provisoria', token: tokenDono, equipe, email: emailOp })).senha });
ok(r.ok && r.trocarSenha === true, 'Entra com a provisória e é avisado para trocar');
const tokenOp2 = r.token;
r = await conta({ acao: 'trocar_senha', token: tokenOp2, atual: 'errada', nova: 'nova12345' });
ok(!r.ok, 'Trocar senha confere a atual');

r = await conta({ acao: 'membro_remover', token: tokenDono, equipe, email: emailOp });
ok(r.ok && !r.membros.some((m) => m.email === emailOp), 'Dono remove o operador');
r = await sync(tokenOpSx, [], 0);
ok(!r.ok && r.codigo === 'sessao', 'Quem foi removido não sincroniza mais');
r = await conta({ acao: 'membro_remover', token: tokenDono, equipe, email: emailDono });
ok(!r.ok, 'O dono não sai da equipe');

/* ---------- Páginas públicas ---------- */
const pub = (acao, dados = {}) => chamar(urlEquipe, { acao, ...dados });
r = await pub('publico_loja');
ok(r.ok && r.loja.produtos.length === 1 && r.loja.profissionais[0].nome === 'Zé' && !('empresa_nome' in r.loja.config && r.loja.config.empresa_nome !== 'Barbearia do Teste'), 'Página pública: produtos e profissionais da equipe');
r = await pub('publico_agenda');
ok(r.ok && r.agenda.desde && Array.isArray(r.agenda.ocupados), 'Página pública: agenda dos próximos dias');
const amanha = new Date(Date.now() - 3 * 3600000 + 86400000).toISOString().slice(0, 10);
const cliente = { nome: 'João', telefone: '(11) 98888-7777' };
r = await pub('publico_agendar', { agendamento: { servico_id: 'p1', profissional_id: 'b1', inicio: `${amanha}T10:00`, cliente } });
ok(r.ok && r.codigo && r.agenda.ocupados.some((o) => o.inicio === `${amanha}T10:00`), 'Agendamento online reserva o horário e devolve a agenda atualizada');
const codigoAg = r.codigo;
r = await pub('publico_agendar', { agendamento: { servico_id: 'p1', profissional_id: 'b1', inicio: `${amanha}T10:00`, cliente: { nome: 'Ana', telefone: '11977776666' } } });
ok(!r.ok && r.codigo === 'ocupado' && r.agenda, 'Mesmo horário de novo: "ocupado", com a agenda nova');
r = await pub('publico_acompanhar', { codigo: codigoAg });
ok(r.ok && r.resultado.tipo === 'agendamento' && r.resultado.servico === 'Corte', 'Acompanhar pelo código');
r = await pub('publico_pedido', { pedido: { itens: [{ produto_id: 'p1', qtd: 2 }], cliente, entrega: 'retirada' } });
ok(r.ok && r.numero === 3 && r.total === 80, `Pedido pelo cardápio: preço do servidor (total ${r.total}) e número 3`);
r = await chamar('/sistemas/e/naoexiste123', { acao: 'publico_loja' });
ok(!r.ok && r.codigo === 'nao_encontrado', 'Link de loja que não existe');

r = await conta({ acao: 'sair', token: tokenDono });
r = await conta({ acao: 'equipes', token: tokenDono });
ok(!r.ok && r.codigo === 'sessao', 'Depois de sair, o token da conta não vale mais');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes dos sistemas passaram.');
process.exit(falhas ? 1 : 0);
