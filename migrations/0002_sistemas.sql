-- Sistemas de gestão na nuvem (soudev.vercel.app/sistemas): contas com e-mail e senha, equipes e membros.
-- Os dados de cada equipe (vendas, clientes, agenda...) ficam num Durable Object próprio (EmpresaSx).

CREATE TABLE IF NOT EXISTS sx_contas (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,          -- PBKDF2-SHA256 da senha (base64)
  sal TEXT NOT NULL,
  iteracoes INTEGER NOT NULL,
  temporaria INTEGER NOT NULL DEFAULT 0, -- 1 = senha provisória dada pelo dono da equipe: trocar ao entrar
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sx_equipes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  nicho TEXT NOT NULL,
  dono TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sx_membros (
  equipe_id TEXT NOT NULL,
  email TEXT NOT NULL,
  papel TEXT NOT NULL,         -- dono | gerente | operador
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (equipe_id, email)
);
CREATE INDEX IF NOT EXISTS sx_membros_email ON sx_membros (email);

-- Sessões: sem equipe = a conta (lista e cria equipes); com equipe = o sistema daquela equipe (sincronizar).
CREATE TABLE IF NOT EXISTS sx_sessoes (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  equipe_id TEXT,
  expira INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sx_sessoes_email ON sx_sessoes (email);

-- Limite de tentativas (login, cadastro) por chave.
CREATE TABLE IF NOT EXISTS sx_limites (
  chave TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  ate INTEGER NOT NULL
);
