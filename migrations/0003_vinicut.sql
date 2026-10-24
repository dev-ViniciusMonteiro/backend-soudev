-- Vinicut: a rede social do site (estilo Orkut). A conta é a mesma dos sistemas (sx_contas, e-mail e senha);
-- aqui fica o perfil público e tudo o que as pessoas publicam. As fotos ficam no R2 (bucket vinicut-fotos).

CREATE TABLE IF NOT EXISTS vc_perfis (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  usuario TEXT NOT NULL UNIQUE,      -- o @ do perfil (minúsculas, letras, números, ponto e _)
  nome TEXT NOT NULL,
  foto TEXT,                         -- chave da foto no R2
  cidade TEXT NOT NULL DEFAULT '',
  relacionamento TEXT NOT NULL DEFAULT '',
  aniversario TEXT NOT NULL DEFAULT '', -- MM-DD (sem o ano)
  quem_sou_eu TEXT NOT NULL DEFAULT '',
  interesses TEXT NOT NULL DEFAULT '',
  criado_em INTEGER NOT NULL,
  visto_em INTEGER NOT NULL DEFAULT 0,
  banido INTEGER NOT NULL DEFAULT 0
);

-- Amizade: um pedido vira amizade quando o outro aceita. Uma linha por par (a = quem pediu).
CREATE TABLE IF NOT EXISTS vc_amizades (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  aceita INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS vc_amizades_b ON vc_amizades (b);

CREATE TABLE IF NOT EXISTS vc_recados (
  id TEXT PRIMARY KEY,
  para TEXT NOT NULL,
  de TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_recados_para ON vc_recados (para, criado_em);

CREATE TABLE IF NOT EXISTS vc_depoimentos (
  id TEXT PRIMARY KEY,
  para TEXT NOT NULL,
  de TEXT NOT NULL,
  texto TEXT NOT NULL,
  aprovado INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_depoimentos_para ON vc_depoimentos (para, aprovado);

CREATE TABLE IF NOT EXISTS vc_fas (
  fa TEXT NOT NULL,
  de TEXT NOT NULL,                  -- "fa" é fã "de"
  PRIMARY KEY (fa, de)
);
CREATE INDEX IF NOT EXISTS vc_fas_de ON vc_fas (de);

-- Karma do Orkut: confiável, legal e gente boa (0 a 3 cada), um voto por pessoa.
CREATE TABLE IF NOT EXISTS vc_karma (
  de TEXT NOT NULL,
  para TEXT NOT NULL,
  confiavel INTEGER NOT NULL DEFAULT 0,
  legal INTEGER NOT NULL DEFAULT 0,
  gente_boa INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (de, para)
);
CREATE INDEX IF NOT EXISTS vc_karma_para ON vc_karma (para);

-- Quem visitou meu perfil: a última visita de cada pessoa.
CREATE TABLE IF NOT EXISTS vc_visitas (
  perfil TEXT NOT NULL,
  visitante TEXT NOT NULL,
  em INTEGER NOT NULL,
  PRIMARY KEY (perfil, visitante)
);

CREATE TABLE IF NOT EXISTS vc_posts (
  id TEXT PRIMARY KEY,
  autor TEXT NOT NULL,
  texto TEXT NOT NULL,
  foto TEXT,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_posts_autor ON vc_posts (autor, criado_em);

CREATE TABLE IF NOT EXISTS vc_reacoes (
  post TEXT NOT NULL,
  de TEXT NOT NULL,
  tipo TEXT NOT NULL,
  PRIMARY KEY (post, de)
);

CREATE TABLE IF NOT EXISTS vc_comentarios (
  id TEXT PRIMARY KEY,
  post TEXT NOT NULL,
  de TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_comentarios_post ON vc_comentarios (post, criado_em);

CREATE TABLE IF NOT EXISTS vc_comunidades (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',
  dono TEXT NOT NULL,
  membros INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vc_participantes (
  comunidade TEXT NOT NULL,
  perfil TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (comunidade, perfil)
);
CREATE INDEX IF NOT EXISTS vc_participantes_perfil ON vc_participantes (perfil);

CREATE TABLE IF NOT EXISTS vc_topicos (
  id TEXT PRIMARY KEY,
  comunidade TEXT NOT NULL,
  autor TEXT NOT NULL,
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  respostas INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_topicos_comunidade ON vc_topicos (comunidade, atualizado_em);

CREATE TABLE IF NOT EXISTS vc_respostas (
  id TEXT PRIMARY KEY,
  topico TEXT NOT NULL,
  autor TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_respostas_topico ON vc_respostas (topico, criado_em);

CREATE TABLE IF NOT EXISTS vc_fotos (
  chave TEXT PRIMARY KEY,
  autor TEXT NOT NULL,
  legenda TEXT NOT NULL DEFAULT '',
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_fotos_autor ON vc_fotos (autor, criado_em);

CREATE TABLE IF NOT EXISTS vc_notificacoes (
  id TEXT PRIMARY KEY,
  para TEXT NOT NULL,
  de TEXT NOT NULL,
  tipo TEXT NOT NULL,                -- recado | depoimento | amizade | aceitou | fa | comentario | reacao | resposta
  ref TEXT NOT NULL DEFAULT '',      -- onde abrir (usuario, post, tópico)
  lida INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_notificacoes_para ON vc_notificacoes (para, criado_em);

CREATE TABLE IF NOT EXISTS vc_bloqueios (
  de TEXT NOT NULL,
  bloqueado TEXT NOT NULL,
  PRIMARY KEY (de, bloqueado)
);

CREATE TABLE IF NOT EXISTS vc_denuncias (
  id TEXT PRIMARY KEY,
  de TEXT NOT NULL,
  tipo TEXT NOT NULL,                -- perfil | recado | depoimento | post | comentario | comunidade | topico | resposta | foto
  alvo TEXT NOT NULL,
  motivo TEXT NOT NULL,
  resolvida INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vc_denuncias_abertas ON vc_denuncias (resolvida, criado_em);
