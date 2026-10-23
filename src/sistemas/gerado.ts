// @ts-nocheck
// GERADO por soudev (node lib/sistemas/apps-script/build-nuvem.mjs). Não edite aqui: mude lib/sistemas/schema.js ou regras.js.

export const COLUNAS: Record<string, string[]> = {"clientes":["nome","telefone","email","documento","nascimento","endereco","bairro","objetivo","restricoes","limite_fiado","empresa","obs"],"categorias":["nome","ordem"],"produtos":["nome","tipo","categoria_id","preco","custo","codigo_barras","ncm","cfop","unidade","controla_estoque","estoque_minimo","duracao_min","comissao_pct","descricao","foto_url","visual","adicionais","publicado","ativo"],"estoque_mov":["produto_id","qtd","motivo","custo_unit","fornecedor_id","ref_id","obs"],"fornecedores":["nome","cnpj","contato","telefone","email","obs"],"vendas":["numero","codigo_publico","cliente_id","cliente_nome","itens","subtotal","desconto","taxa_entrega","acrescimo","total","pagamentos","fiscal","troco","status","etapa","origem","entrega","endereco","telefone","pagamento_previsto","mesa","caixa_id","profissional_id","ref_id","concluida_em","operador","obs"],"caixas":["aberto_em","fechado_em","valor_inicial","valor_contado","valor_esperado","resumo","status","operador"],"caixa_mov":["caixa_id","tipo","valor","motivo"],"lancamentos":["tipo","descricao","valor","vencimento","pago_em","categoria","cliente_id","fornecedor_id","forma","ref_id","obs"],"profissionais":["nome","telefone","funcao","comissao_pct","cor","publicado","ativo"],"agendamentos":["codigo_publico","inicio","fim","profissional_id","servico_id","cliente_id","cliente_nome","telefone","pet_id","valor","status","origem","venda_id","obs"],"ordens":["numero","codigo_publico","cliente_id","equipamento","marca_modelo","serie","acessorios","defeito","laudo","checklist","itens","total","status","previsao","tecnico","garantia_dias","venda_id"],"planos":["nome","valor","meses","aulas_semana","descricao","ativo"],"matriculas":["cliente_id","plano_id","inicio","dia_vencimento","desconto","status","obs"],"presencas":["cliente_id"],"pets":["nome","cliente_id","especie","raca","porte","nascimento","peso","alergias","obs"],"vacinas":["pet_id","vacina","aplicada_em","proxima_em","obs"],"leads":["nome","empresa","telefone","email","interesse","valor","etapa","origem","responsavel","proximo_contato","motivo_perda","cliente_id","obs"],"atividades":["lead_id","tipo","descricao","data","feita"],"usuarios":["email","nome","papel","ativo"],"config":["valor"]}
export const CONFIG_PUBLICA: string[] = ["empresa_nome","empresa_telefone","whatsapp","endereco","cidade","pix_chave","pix_nome","abre","fecha","dias","intervalo_agenda","loja_aberta","taxa_entrega","pedido_minimo","tempo_entrega"]

export const pad = (n) => String(n).padStart(2, '0')

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export function parseValor(texto) {
  if (typeof texto === 'number') return texto
  let s = String(texto ?? '').replace(/[^\d,.-]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function lerAdicionais(texto) {
  return String(texto ?? '')
    .split(/[;\n]/)
    .map((parte) => {
      const i = parte.lastIndexOf(':')
      if (i < 0) return null
      const nome = parte.slice(0, i).trim()
      const preco = parseValor(parte.slice(i + 1))
      return nome ? { nome, preco } : null
    })
    .filter(Boolean)
}

export function precificar(carrinho, produtos) {
  const porId = new Map(produtos.map((p) => [p.id, p]))
  const itens = []
  for (const linha of carrinho) {
    const p = porId.get(linha.produto_id)
    if (!p || p.excluido || p.ativo === false || p.publicado === false) throw new Error('Um item do pedido não está mais disponível. Atualize o cardápio.')
    const qtd = Math.max(1, Math.min(99, Math.round(Number(linha.qtd) || 1)))
    const possiveis = lerAdicionais(p.adicionais)
    const adicionais = (linha.adicionais || []).map((nome) => possiveis.find((a) => a.nome === nome)).filter(Boolean)
    const unit = round2(Number(p.preco) + adicionais.reduce((s, a) => s + a.preco, 0))
    itens.push({
      produto_id: p.id,
      nome: p.nome + (adicionais.length ? ` (+ ${adicionais.map((a) => a.nome).join(', ')})` : ''),
      qtd,
      preco: unit,
      obs: String(linha.obs ?? '').slice(0, 140),
    })
  }
  return itens
}

export const totalItens = (itens) => round2((itens || []).reduce((s, i) => s + Number(i.preco) * Number(i.qtd), 0))

export const minutos = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

export const hojeISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function ocupaHorario(a, profissionalId) {
  // Na planilha "excluido" chega como texto ("0" ou "1").
  if (a.excluido === true || a.excluido === '1' || a.status === 'cancelado' || a.status === 'faltou' || a.status === 'recusado') return false
  return a.profissional_id === profissionalId || (a.status === 'bloqueio' && !a.profissional_id)
}

export function horariosLivres({ data, duracao, profissionalId, agendamentos, config, agora = new Date() }) {
  const dia = new Date(`${data}T12:00`).getDay()
  const dias = String(config.dias ?? '1,2,3,4,5,6').split(',').map((d) => Number(d.trim()))
  if (!dias.includes(dia)) return []
  const abre = minutos(config.abre || '09:00')
  const fecha = minutos(config.fecha || '19:00')
  const passo = Math.max(10, Number(config.intervalo_agenda) || 30)
  const dur = Math.max(10, Number(duracao) || passo)
  const ocupados = agendamentos
    .filter((a) => ocupaHorario(a, profissionalId) && String(a.inicio).startsWith(data))
    .map((a) => [minutos(String(a.inicio).slice(11, 16)), minutos(String(a.fim || a.inicio).slice(11, 16))])
  const livres = []
  const hoje = hojeISO(agora) === data
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  for (let t = abre; t + dur <= fecha; t += passo) {
    if (hoje && t <= agoraMin + 15) continue
    if (ocupados.some(([i, f]) => t < f && t + dur > i)) continue
    livres.push(hhmm(t))
  }
  return livres
}
