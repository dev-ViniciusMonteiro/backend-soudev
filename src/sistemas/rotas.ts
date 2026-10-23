// Rotas dos sistemas de gestão na nuvem. Tudo POST com JSON no corpo (o mesmo jeito do Apps Script da planilha,
// para o site usar o mesmo código) e resposta { ok: true, ... } ou { ok: false, codigo, erro }.
//   POST /sistemas/conta     → acao: cadastrar | entrar | equipes | criar_equipe | abrir | renomear | membros |
//                              membro_salvar | membro_remover | senha_provisoria | trocar_senha | sair
//   POST /sistemas/e/:equipe → acao: sincronizar (com o token da equipe) | publico_* (cardápio, agenda, acompanhar)

import * as contas from './contas';
import { ErroSx } from './empresa';

type Corpo = Record<string, unknown>;

const ID_EQUIPE = /^[A-Za-z0-9]{8,32}$/;

export function urlDaEquipe(req: Request, equipe: string): string {
  return `${new URL(req.url).origin}/sistemas/e/${equipe}`;
}

async function conta(req: Request, env: Env, d: Corpo): Promise<Corpo> {
  const db = env.DB;
  const senhas = env.EMPRESA.getByName('__senhas');
  contas.usarDerivador((senha, sal, it) => senhas.derivarSenha(senha, sal, it));
  const acao = String(d.acao ?? '');
  if (acao === 'cadastrar') return contas.cadastrar(db, d.email, d.senha, req.headers.get('CF-Connecting-IP') ?? 'local');
  if (acao === 'entrar') return contas.entrar(db, d.email, d.senha);
  const token = contas.tokenDoCorpo(d);
  if (acao === 'sair') {
    await contas.sair(db, token, d.todas === true);
    return {};
  }
  const email = await contas.contaDaSessao(db, token);
  const equipe = String(d.equipe ?? '');
  if (acao !== 'equipes' && acao !== 'criar_equipe' && acao !== 'trocar_senha' && !ID_EQUIPE.test(equipe)) throw new ErroSx('invalido', 'Equipe inválida.');
  switch (acao) {
    case 'equipes':
      return { email, equipes: await contas.equipesDe(db, email) };
    case 'criar_equipe':
      return { equipe: await contas.criarEquipe(db, email, d.nome, d.nicho) };
    case 'abrir': {
      const a = await contas.abrirEquipe(db, email, equipe);
      return { ...a, email, url: urlDaEquipe(req, equipe) };
    }
    case 'renomear':
      await contas.renomearEquipe(db, email, equipe, d.nome);
      return {};
    case 'membros':
      return { membros: await contas.membros(db, email, equipe) };
    case 'membro_salvar':
      await contas.salvarMembro(db, email, equipe, d.email, d.papel);
      return { membros: await contas.membros(db, email, equipe) };
    case 'membro_remover':
      await contas.removerMembro(db, email, equipe, d.email);
      return { membros: await contas.membros(db, email, equipe) };
    case 'senha_provisoria':
      return { senha: await contas.senhaProvisoria(db, email, equipe, d.email) };
    case 'trocar_senha':
      await contas.trocarSenha(db, email, d.atual, d.nova);
      return {};
    default:
      throw new ErroSx('invalido', 'Ação desconhecida.');
  }
}

async function equipe(env: Env, id: string, d: Corpo): Promise<Corpo> {
  const acao = String(d.acao ?? '');
  const stub = env.EMPRESA.getByName(id);
  if (acao.startsWith('publico_')) {
    const existe = await env.DB.prepare('SELECT 1 FROM sx_equipes WHERE id = ?').bind(id).first();
    if (!existe) throw new ErroSx('nao_encontrado', 'Loja não encontrada. Confira o link.');
    return (await stub.publico(acao, d)) as Corpo;
  }
  if (acao !== 'sincronizar') throw new ErroSx('invalido', 'Ação desconhecida.');
  const quem = await contas.sessaoDaEquipe(env.DB, contas.tokenDoCorpo(d), id);
  try {
    const r = await stub.sincronizar(quem.papel, d.mudancas, d.desde);
    return { ...r, papel: quem.papel, token: quem.novoToken };
  } catch (e) {
    throw new ErroSx('invalido', (e as Error).message || 'Erro ao sincronizar.');
  }
}

/** Atende /sistemas/... (ou devolve null se não for daqui). */
export async function rotasSistemas(req: Request, env: Env, caminho: string): Promise<Corpo | null> {
  const ehConta = caminho === '/sistemas/conta';
  const m = caminho.match(/^\/sistemas\/e\/([A-Za-z0-9]+)$/);
  if (!ehConta && !m) return null;
  if (req.method !== 'POST') return { ok: false, codigo: 'invalido', erro: 'Use POST.' };
  let d: Corpo;
  try {
    const texto = await req.text();
    if (texto.length > 600000) throw new ErroSx('invalido', 'Pedido grande demais.');
    d = JSON.parse(texto) as Corpo;
    if (!d || typeof d !== 'object') throw new Error();
  } catch (e) {
    return { ok: false, codigo: 'invalido', erro: e instanceof ErroSx ? e.message : 'JSON inválido.' };
  }
  try {
    if (m && !ID_EQUIPE.test(m[1])) throw new ErroSx('invalido', 'Equipe inválida.');
    const r = ehConta ? await conta(req, env, d) : await equipe(env, m![1], d);
    return 'ok' in r ? r : { ok: true, ...r };
  } catch (e) {
    if (e instanceof ErroSx) return { ok: false, codigo: e.codigo, erro: e.message, ...e.extra };
    console.error(e);
    return { ok: false, codigo: 'interno', erro: 'Erro no servidor. Tente de novo em instantes.' };
  }
}
