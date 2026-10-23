// Dados de uma equipe dos sistemas de gestão: um Durable Object (SQLite) por equipe.
// Faz o mesmo que o Apps Script da planilha (lib/sistemas/apps-script no soudev): cada registro é guardado como
// texto, vale a alteração mais recente (atualizado_em), vendas e ordens ganham número e código público, e a
// descida manda o que mudou depois do cursor ("rev"). Também atende as páginas públicas (cardápio, agendamento
// online e acompanhamento). Quem chama já conferiu a sessão e o papel (index.ts); aqui só confere as regras.

import { DurableObject } from 'cloudflare:workers';
import { hashSenha } from './contas';
import { COLUNAS, CONFIG_PUBLICA, horariosLivres, hhmm, minutos, ocupaHorario, precificar, round2, totalItens } from './gerado';

type Texto = Record<string, string>;
type Registro = Record<string, unknown>;

export class ErroSx extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

const NUMERADAS = ['vendas', 'ordens'];
const SO_GESTOR = ['usuarios', 'config'];
const MAX_LOTE = 300;
const MAX_DESCIDA = 1500;
const MAX_CAMPOS = 80;
const MAX_VALOR = 20000;
const DIAS_AGENDA = 31;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const CAMPO_RE = /^[a-z_][a-z0-9_]{0,40}$/;
/** Brasília (sem horário de verão desde 2019): as regras de horário usam getHours() da data. */
const agoraBR = () => new Date(Date.now() - 3 * 3600000);

function paraTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).slice(0, MAX_VALOR);
}

/** O que sai para o navegador: sem campos vazios (igual à planilha). */
function semVazios(t: Texto): Texto {
  const o: Texto = {};
  for (const [k, v] of Object.entries(t)) if (v !== '' && v !== undefined) o[k] = v;
  return o;
}

function codigoCurto(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => letras[x % letras.length]).join('');
}

const num = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0;
const sim = (v: unknown, padrao: boolean) => (v === undefined || v === '' ? padrao : v === '1' || v === 'true');
const reais = (n: unknown) => `R$ ${(Number(n) || 0).toFixed(2).replace('.', ',')}`;

export class EmpresaSx extends DurableObject<Env> {
  private sql: SqlStorage;
  private limites = new Map<string, { n: number; ate: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reg (tabela TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, dados TEXT NOT NULL, PRIMARY KEY (tabela, id))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS reg_rev ON reg (rev)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }

  /* ---------- Básico ---------- */

  private meta(k: string): string | null {
    return (this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v as string | undefined) ?? null;
  }

  private setMeta(k: string, v: string | number): void {
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, String(v));
  }

  private novaRev(): number {
    const rev = Number(this.meta('rev') ?? 0) + 1;
    this.setMeta('rev', rev);
    return rev;
  }

  /** Limite simples por chave (memória do objeto). */
  private limite(chave: string, max: number, segundos: number): void {
    const agora = Date.now();
    const l = this.limites.get(chave);
    if (!l || l.ate < agora) {
      this.limites.set(chave, { n: 1, ate: agora + segundos * 1000 });
      return;
    }
    if (++l.n > max) throw new ErroSx('limite', 'Muitas tentativas seguidas. Aguarde alguns minutos.');
  }

  private ler(tabela: string, id: string): Texto | null {
    const r = this.sql.exec<{ dados: string }>('SELECT dados FROM reg WHERE tabela = ? AND id = ?', tabela, id).toArray()[0];
    return r ? (JSON.parse(r.dados as string) as Texto) : null;
  }

  private ativos(tabela: string): Texto[] {
    return this.sql
      .exec<{ dados: string }>('SELECT dados FROM reg WHERE tabela = ?', tabela)
      .toArray()
      .map((r) => JSON.parse(r.dados as string) as Texto)
      .filter((o) => o.excluido !== '1');
  }

  private proximoNumero(tabela: string): number {
    const n = Number(this.meta(`num_${tabela}`) ?? 0) + 1;
    this.setMeta(`num_${tabela}`, n);
    return n;
  }

  /** Grava registros (vale o "atualizado_em" maior). Devolve o resultado de cada um. */
  private gravar(tabela: string, registros: Registro[], rev: number): { registro: Texto; anterior: Texto | null; recusado?: boolean; servidorMexeu?: boolean }[] {
    const feitos = [];
    for (const r of registros) {
      const id = String(r.id);
      const antes = this.ler(tabela, id);
      if (antes && Number(antes.atualizado_em || 0) > Number(r.atualizado_em || 0)) {
        feitos.push({ registro: semVazios(antes), anterior: antes, recusado: true });
        continue;
      }
      const linha: Texto = { ...(antes ?? {}) };
      let campos = Object.keys(linha).length;
      for (const k of Object.keys(r)) {
        if (!CAMPO_RE.test(k) || k === '_rev') continue;
        // Número e código são do servidor: não deixa uma versão antiga apagar.
        if ((k === 'numero' || k === 'codigo_publico') && antes?.[k] && !r[k]) continue;
        if (!(k in linha) && ++campos > MAX_CAMPOS) continue;
        linha[k] = paraTexto(r[k]);
      }
      linha.id = id;
      let mexeu = false;
      if (NUMERADAS.includes(tabela)) {
        if (!linha.numero) {
          linha.numero = String(this.proximoNumero(tabela));
          mexeu = true;
        }
        if (!linha.codigo_publico) {
          linha.codigo_publico = codigoCurto();
          mexeu = true;
        }
      }
      linha._rev = String(rev);
      if (!linha.criado_em) linha.criado_em = new Date().toISOString();
      if (!linha.atualizado_em) linha.atualizado_em = String(Date.now());
      this.sql.exec('INSERT INTO reg (tabela, id, rev, dados) VALUES (?, ?, ?, ?) ON CONFLICT (tabela, id) DO UPDATE SET rev = excluded.rev, dados = excluded.dados', tabela, id, rev, JSON.stringify(linha));
      feitos.push({ registro: semVazios(linha), anterior: antes, servidorMexeu: mexeu });
    }
    return feitos;
  }

  /* ---------- Sincronização ---------- */

  /** Sobe as mudanças do aparelho e desce o que mudou depois de "desde" (mesmo formato do Apps Script). */
  sincronizar(papel: string, mudancas: unknown, desde: unknown): { mudancas: { tabela: string; registro: Texto }[]; cursor: number; mais: boolean } {
    const lista = Array.isArray(mudancas) ? (mudancas as { tabela?: unknown; registro?: Registro }[]) : [];
    if (lista.length > MAX_LOTE) throw new ErroSx('invalido', 'Lote grande demais.');
    const porTabela: Record<string, Registro[]> = {};
    for (const m of lista) {
      const nome = String(m?.tabela);
      const r = m?.registro;
      if (!COLUNAS[nome] || !r || typeof r !== 'object' || !ID_RE.test(String(r.id ?? ''))) continue;
      if (SO_GESTOR.includes(nome) && papel === 'operador') continue;
      (porTabela[nome] ??= []).push(r);
    }
    const ecoar: { tabela: string; registro: Texto }[] = [];
    if (Object.keys(porTabela).length) {
      this.ctx.storage.transactionSync(() => {
        const rev = this.novaRev();
        for (const nome of Object.keys(porTabela)) for (const f of this.gravar(nome, porTabela[nome], rev)) if (f.recusado || f.servidorMexeu) ecoar.push({ tabela: nome, registro: f.registro });
      });
    }
    const enviados = new Set(lista.map((m) => `${m?.tabela}:${m?.registro?.id}`));
    const d = this.baixar(Number(desde) || 0, enviados);
    return { mudancas: ecoar.concat(d.mudancas), cursor: d.cursor, mais: d.mais };
  }

  private baixar(desde: number, enviados: Set<string>): { mudancas: { tabela: string; registro: Texto }[]; cursor: number; mais: boolean } {
    const atual = Number(this.meta('rev') ?? 0);
    // Lê um pouco além do limite para não cortar uma revisão no meio (um lote tem até MAX_LOTE registros).
    const linhas = this.sql.exec<{ tabela: string; dados: string; rev: number }>('SELECT tabela, dados, rev FROM reg WHERE rev > ? ORDER BY rev LIMIT ?', desde, MAX_DESCIDA + MAX_LOTE + 1).toArray();
    let fim = linhas.length;
    let mais = false;
    if (linhas.length > MAX_DESCIDA) {
      fim = MAX_DESCIDA;
      while (fim < linhas.length && linhas[fim].rev === linhas[fim - 1].rev) fim++;
      mais = true;
    }
    const parte = linhas.slice(0, fim);
    const cursor = mais ? Number(parte[parte.length - 1].rev) : Math.max(atual, desde);
    return {
      mudancas: parte
        .map((l) => ({ tabela: l.tabela as string, registro: semVazios(JSON.parse(l.dados as string) as Texto) }))
        .filter((x) => !enviados.has(`${x.tabela}:${x.registro.id}`)),
      cursor,
      mais,
    };
  }

  /** Hash de senha (o objeto "__senhas" só faz isso): aqui tem CPU de sobra para o PBKDF2. */
  derivarSenha(senha: string, sal: string, iteracoes: number): Promise<string> {
    return hashSenha(senha, sal, iteracoes);
  }

  /** Nome da empresa (config "empresa_nome"), para mostrar na lista de equipes. */
  nomeEmpresa(): string {
    return this.ler('config', 'empresa_nome')?.valor ?? '';
  }

  /** Tamanho da equipe no banco (para o painel). */
  resumo(): { registros: number; rev: number } {
    const r = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reg').toArray()[0];
    return { registros: Number(r?.n ?? 0), rev: Number(this.meta('rev') ?? 0) };
  }

  /* ---------- Páginas públicas ---------- */

  private configuracao(): Texto {
    const o: Texto = {};
    for (const c of this.ativos('config')) o[c.id] = c.valor;
    return o;
  }

  private lojaPublica() {
    const cfg = this.configuracao();
    const config: Texto = {};
    for (const k of CONFIG_PUBLICA) if (cfg[k] !== undefined) config[k] = cfg[k];
    return {
      config,
      produtos: this.ativos('produtos')
        .filter((p) => sim(p.ativo, true) && sim(p.publicado, true))
        .map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, categoria_id: p.categoria_id, preco: num(p.preco), descricao: p.descricao || '', foto_url: p.foto_url || '', adicionais: p.adicionais || '', duracao_min: num(p.duracao_min) })),
      categorias: this.ativos('categorias')
        .map((c) => ({ id: c.id, nome: c.nome, ordem: num(c.ordem) }))
        .sort((a, b) => a.ordem - b.ordem),
      profissionais: this.ativos('profissionais')
        .filter((p) => sim(p.ativo, true) && sim(p.publicado, true))
        .map((p) => ({ id: p.id, nome: p.nome, funcao: p.funcao || '' })),
    };
  }

  private contato(c: Registro | undefined) {
    const nome = String(c?.nome ?? '').trim().slice(0, 80);
    const telefone = String(c?.telefone ?? '').trim().slice(0, 20);
    if (!nome) throw new ErroSx('invalido', 'Informe seu nome.');
    if (telefone.replace(/\D/g, '').length < 10) throw new ErroSx('invalido', 'Informe um telefone com DDD.');
    const email = String(c?.email ?? '').trim().slice(0, 120);
    return { nome, telefone, email: EMAIL_RE.test(email) ? email : '', endereco: String(c?.endereco ?? '').trim().slice(0, 160), bairro: String(c?.bairro ?? '').trim().slice(0, 60) };
  }

  /** Acha o cliente pelo telefone ou cria um novo (dentro da transação). */
  private clientePorTelefone(d: ReturnType<EmpresaSx['contato']>, rev: number): Texto {
    const tel = d.telefone.replace(/\D/g, '');
    const achado = this.ativos('clientes').find((c) => String(c.telefone ?? '').replace(/\D/g, '') === tel);
    if (achado) return achado;
    const novo = { id: crypto.randomUUID(), nome: d.nome, telefone: d.telefone, email: d.email, endereco: d.endereco, bairro: d.bairro, obs: 'Cadastrado pelo site', atualizado_em: Date.now(), excluido: false };
    return this.gravar('clientes', [novo], rev)[0].registro;
  }

  private produtosParaPreco() {
    return this.ativos('produtos').map((p) => ({ id: p.id, nome: p.nome, preco: num(p.preco), adicionais: p.adicionais || '', ativo: sim(p.ativo, true), publicado: sim(p.publicado, true), duracao_min: num(p.duracao_min) }));
  }

  private pedido(corpo: Registro) {
    const p = (corpo.pedido ?? {}) as Registro;
    const c = this.contato(p.cliente as Registro);
    this.limite(`ped:${c.telefone.replace(/\D/g, '')}`, 6, 900);
    this.limite('ped', 60, 60);
    const cfg = this.configuracao();
    if (!sim(cfg.loja_aberta, true)) throw new ErroSx('fechado', 'A loja não está recebendo pedidos agora.');
    let itens;
    try {
      itens = precificar(((p.itens as unknown[]) ?? []).slice(0, 60), this.produtosParaPreco());
    } catch (e) {
      throw new ErroSx('invalido', (e as Error).message);
    }
    if (!itens.length) throw new ErroSx('invalido', 'O carrinho está vazio.');
    const subtotal = totalItens(itens);
    if (num(cfg.pedido_minimo) && subtotal < num(cfg.pedido_minimo)) throw new ErroSx('invalido', `O pedido mínimo é de ${reais(cfg.pedido_minimo)}.`);
    const entrega = p.entrega === 'entrega' ? 'entrega' : 'retirada';
    if (entrega === 'entrega' && !c.endereco) throw new ErroSx('invalido', 'Informe o endereço de entrega.');
    const taxa = entrega === 'entrega' ? num(cfg.taxa_entrega) : 0;
    const venda = this.ctx.storage.transactionSync(() => {
      const rev = this.novaRev();
      const cliente = this.clientePorTelefone(c, rev);
      const v = {
        id: crypto.randomUUID(),
        cliente_id: cliente.id,
        cliente_nome: c.nome,
        telefone: c.telefone,
        itens,
        subtotal,
        desconto: 0,
        taxa_entrega: taxa,
        total: round2(subtotal + taxa),
        pagamentos: [],
        status: 'aberta',
        etapa: 'novo',
        origem: 'cardapio',
        entrega,
        endereco: entrega === 'entrega' ? [c.endereco, c.bairro].filter(Boolean).join(' - ') : '',
        pagamento_previsto: String(p.pagamento ?? '').slice(0, 80),
        obs: String(p.obs ?? '').slice(0, 300),
        atualizado_em: Date.now(),
        excluido: false,
      };
      return this.gravar('vendas', [v], rev)[0].registro;
    });
    return { numero: Number(venda.numero), codigo: venda.codigo_publico, total: Number(venda.total) };
  }

  private ocupadosDoDia(data: string, profissionalId: string) {
    return this.ativos('agendamentos')
      .filter((a) => String(a.inicio).startsWith(data) && ocupaHorario(a, profissionalId))
      .map((a) => ({ inicio: a.inicio, fim: a.fim, profissional_id: a.profissional_id, status: a.status === 'bloqueio' ? 'bloqueio' : 'ocupado' }));
  }

  private agendaPublica() {
    const hoje = agoraBR().toISOString().slice(0, 10);
    const ate = new Date(agoraBR().getTime() + DIAS_AGENDA * 86400000).toISOString().slice(0, 10);
    return {
      desde: hoje,
      ate,
      ocupados: this.ativos('agendamentos')
        .filter((a) => {
          const d = String(a.inicio).slice(0, 10);
          return d >= hoje && d <= ate && !['cancelado', 'faltou', 'recusado'].includes(a.status);
        })
        .map((a) => ({ inicio: a.inicio, fim: a.fim, profissional_id: a.profissional_id, status: a.status === 'bloqueio' ? 'bloqueio' : 'ocupado' })),
    };
  }

  private agendar(corpo: Registro) {
    const a = (corpo.agendamento ?? {}) as Registro;
    const c = this.contato(a.cliente as Registro);
    this.limite(`ag:${c.telefone.replace(/\D/g, '')}`, 5, 900);
    this.limite('ag', 40, 60);
    const inicio = String(a.inicio ?? '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(inicio)) throw new ErroSx('invalido', 'Horário inválido.');
    const servico = this.produtosParaPreco().find((p) => p.id === a.servico_id && p.ativo && p.publicado);
    const prof = this.ativos('profissionais').find((p) => p.id === a.profissional_id && sim(p.ativo, true) && sim(p.publicado, true));
    if (!servico || !prof) throw new ErroSx('invalido', 'Serviço ou profissional indisponível.');
    const cfg = this.configuracao();
    const data = inicio.slice(0, 10);
    const hora = inicio.slice(11, 16);
    const registro = this.ctx.storage.transactionSync(() => {
      // Confere de novo dentro da transação: dois clientes no mesmo horário, só o primeiro leva.
      const livres = horariosLivres({ data, duracao: servico.duracao_min, profissionalId: prof.id, agendamentos: this.ocupadosDoDia(data, prof.id), config: cfg, agora: agoraBR() });
      if (!livres.includes(hora)) throw new ErroSx('ocupado', 'Esse horário acabou de ser ocupado. Escolha outro.', { agenda: this.agendaPublica() });
      const rev = this.novaRev();
      const cliente = this.clientePorTelefone(c, rev);
      const ag = {
        id: crypto.randomUUID(),
        codigo_publico: codigoCurto(),
        inicio,
        fim: `${data}T${hhmm(minutos(hora) + (servico.duracao_min || 30))}`,
        profissional_id: prof.id,
        servico_id: servico.id,
        cliente_id: cliente.id,
        cliente_nome: c.nome,
        telefone: c.telefone,
        valor: servico.preco,
        status: 'pendente',
        origem: 'online',
        obs: String(a.obs ?? '').slice(0, 300),
        atualizado_em: Date.now(),
        excluido: false,
      };
      return this.gravar('agendamentos', [ag], rev)[0].registro;
    });
    return { id: registro.id, codigo: registro.codigo_publico, status: 'pendente', agenda: this.agendaPublica() };
  }

  private acompanhar(corpo: Registro) {
    const codigo = String(corpo.codigo ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(codigo)) throw new ErroSx('invalido', 'Código inválido.');
    this.limite('acomp', 120, 60);
    const etapas: Texto = { novo: 'Novo', preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu p/ entrega', entregue: 'Entregue' };
    const status: Texto = { aberta: 'Aberta', orcamento: 'Orçamento enviado', aprovada: 'Aprovada', execucao: 'Em execução', pronta: 'Pronta', entregue: 'Entregue', cancelada: 'Cancelada' };
    const v = this.ativos('vendas').find((x) => x.codigo_publico === codigo);
    if (v) {
      let itens: { nome: string; qtd: number }[] = [];
      try {
        itens = (JSON.parse(v.itens || '[]') as { nome: string; qtd: number }[]).map((i) => ({ nome: i.nome, qtd: i.qtd }));
      } catch {
        /* itens em formato antigo */
      }
      return { tipo: 'pedido', numero: num(v.numero), status: v.status, etapa: v.etapa, etapaNome: etapas[v.etapa] || '', itens, total: num(v.total), entrega: v.entrega, criado_em: v.criado_em };
    }
    const o = this.ativos('ordens').find((x) => x.codigo_publico === codigo);
    if (o) {
      const mostraLaudo = ['orcamento', 'aprovada', 'execucao', 'pronta', 'entregue'].includes(o.status);
      return { tipo: 'os', numero: num(o.numero), status: o.status, statusNome: status[o.status] || '', equipamento: [o.equipamento, o.marca_modelo].filter(Boolean).join(' '), previsao: o.previsao || '', total: num(o.total), laudo: mostraLaudo ? o.laudo || '' : '', criado_em: o.criado_em };
    }
    const ag = this.ativos('agendamentos').find((x) => x.codigo_publico === codigo && x.status !== 'bloqueio');
    if (ag) {
      const servico = this.ler('produtos', ag.servico_id ?? '');
      const prof = this.ler('profissionais', ag.profissional_id ?? '');
      return { tipo: 'agendamento', status: ag.status, inicio: ag.inicio, servico: servico?.nome ?? '', profissional: prof?.nome ?? '', total: num(ag.valor), criado_em: ag.criado_em };
    }
    throw new ErroSx('nao_encontrado', 'Código não encontrado.');
  }

  /** Rotas públicas, com o mesmo formato de resposta do Apps Script. */
  publico(acao: string, corpo: Registro): Record<string, unknown> {
    try {
      switch (acao) {
        case 'publico_loja':
          this.limite('loja', 300, 60);
          return { ok: true, loja: this.lojaPublica() };
        case 'publico_agenda':
          this.limite('agenda', 300, 60);
          return { ok: true, agenda: this.agendaPublica() };
        case 'publico_ocupados': {
          const data = String(corpo.data ?? '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroSx('invalido', 'Data inválida.');
          this.limite('ocup', 120, 60);
          return { ok: true, ocupados: this.ocupadosDoDia(data, String(corpo.profissional_id ?? '')) };
        }
        case 'publico_pedido':
          return { ok: true, ...this.pedido(corpo) };
        case 'publico_agendar':
          return { ok: true, ...this.agendar(corpo) };
        case 'publico_acompanhar':
          return { ok: true, resultado: this.acompanhar(corpo) };
        default:
          throw new ErroSx('invalido', 'Ação desconhecida.');
      }
    } catch (e) {
      if (e instanceof ErroSx) return { ok: false, codigo: e.codigo, erro: e.message, ...e.extra };
      throw e;
    }
  }
}
