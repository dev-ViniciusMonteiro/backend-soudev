-- Perfis de convidado, economia de moedas, itens liberados, conquistas, partidas e ranking por jogo.

-- O id é público (vai para os outros na sala); o token é segredo do aparelho e só o hash fica guardado.
CREATE TABLE jogadores (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  apelido TEXT NOT NULL,
  skin TEXT NOT NULL DEFAULT '',
  xp INTEGER NOT NULL DEFAULT 0,
  moedas INTEGER NOT NULL DEFAULT 0,
  -- XP de presença ganho hoje (limite diário) e o dia a que se refere (AAAA-MM-DD, UTC).
  xp_presenca_hoje INTEGER NOT NULL DEFAULT 0,
  dia_presenca TEXT NOT NULL DEFAULT '',
  criado_em INTEGER NOT NULL,
  visto_em INTEGER NOT NULL
);
CREATE INDEX jogadores_xp ON jogadores (xp DESC);
CREATE INDEX jogadores_moedas ON jogadores (moedas DESC);

-- Itens liberados por conquista (os liberados por nível não precisam de linha: saem do XP).
CREATE TABLE itens (
  jogador_id TEXT NOT NULL REFERENCES jogadores (id),
  item TEXT NOT NULL,
  desbloqueado_em INTEGER NOT NULL,
  PRIMARY KEY (jogador_id, item)
);

CREATE TABLE conquistas (
  jogador_id TEXT NOT NULL REFERENCES jogadores (id),
  conquista TEXT NOT NULL,
  data INTEGER NOT NULL,
  PRIMARY KEY (jogador_id, conquista)
);

-- Extrato de moedas: todo ganho e gasto fica registrado (dá para auditar e desfazer erro).
CREATE TABLE extrato (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jogador_id TEXT NOT NULL REFERENCES jogadores (id),
  valor INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  partida_id TEXT,
  data INTEGER NOT NULL
);
CREATE INDEX extrato_jogador ON extrato (jogador_id, data DESC);

CREATE TABLE partidas (
  id TEXT PRIMARY KEY,
  jogo TEXT NOT NULL,
  sala TEXT NOT NULL,
  inicio INTEGER NOT NULL,
  fim INTEGER NOT NULL
);

CREATE TABLE participacoes (
  partida_id TEXT NOT NULL REFERENCES partidas (id),
  jogador_id TEXT NOT NULL REFERENCES jogadores (id),
  posicao INTEGER NOT NULL,
  pontos INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  moedas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (partida_id, jogador_id)
);
CREATE INDEX participacoes_jogador ON participacoes (jogador_id);

-- Ranking por jogo e temporada (mês, AAAA-MM), com rating estilo Elo.
CREATE TABLE ranking (
  jogo TEXT NOT NULL,
  temporada TEXT NOT NULL,
  jogador_id TEXT NOT NULL REFERENCES jogadores (id),
  rating INTEGER NOT NULL DEFAULT 1000,
  vitorias INTEGER NOT NULL DEFAULT 0,
  partidas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jogo, temporada, jogador_id)
);
CREATE INDEX ranking_ordem ON ranking (jogo, temporada, rating DESC);
