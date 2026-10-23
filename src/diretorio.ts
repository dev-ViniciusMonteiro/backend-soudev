// Lista das salas públicas com quantas pessoas cada uma tem. O "Jogar" pega a mais cheia que ainda tem vaga,
// para as pessoas se encontrarem em vez de cada uma cair numa sala vazia.
// Um único objeto basta: só recebe uma chamada quando alguém entra ou sai de uma sala, não a cada movimento.

import { DurableObject } from 'cloudflare:workers';
import { MAX_JOGADORES } from './protocolo';

const VALIDADE_MS = 10 * 60 * 1000; // sala sem notícia há 10 min sai da lista
const RESERVA_MS = 60 * 1000; // sala recém-criada e ainda vazia fica reservada por 1 min

export function novoCodigo(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const n of crypto.getRandomValues(new Uint32Array(6))) s += abc[n % abc.length];
  return s;
}

export class Diretorio extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS salas (
        codigo TEXT PRIMARY KEY,
        jogadores INTEGER NOT NULL,
        aberta INTEGER NOT NULL,
        atualizado INTEGER NOT NULL
      )`);
    });
  }

  /** Sala pública com vaga (a mais cheia) ou uma nova; devolve o código. */
  async reservar(): Promise<{ codigo: string; nova: boolean }> {
    const agora = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM salas WHERE atualizado < ? OR (jogadores = 0 AND atualizado < ?)', agora - VALIDADE_MS, agora - RESERVA_MS);
    const livre = sql.exec<{ codigo: string }>('SELECT codigo FROM salas WHERE aberta = 1 AND jogadores < ? ORDER BY jogadores DESC LIMIT 1', MAX_JOGADORES).toArray()[0];
    if (livre) return { codigo: livre.codigo, nova: false };
    const codigo = novoCodigo();
    sql.exec('INSERT INTO salas (codigo, jogadores, aberta, atualizado) VALUES (?, 0, 1, ?)', codigo, agora);
    return { codigo, nova: true };
  }

  /** A sala avisa quando alguém entra ou sai (e, nas próximas etapas, quando fecha para uma partida). */
  async atualizar(codigo: string, jogadores: number, aberta: boolean): Promise<void> {
    const sql = this.ctx.storage.sql;
    if (jogadores <= 0) sql.exec('DELETE FROM salas WHERE codigo = ?', codigo);
    else
      sql.exec(
        'INSERT INTO salas (codigo, jogadores, aberta, atualizado) VALUES (?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET jogadores = excluded.jogadores, aberta = excluded.aberta, atualizado = excluded.atualizado',
        codigo,
        jogadores,
        aberta ? 1 : 0,
        Date.now(),
      );
  }

  /** Para o painel: quantas salas e pessoas online. */
  async resumo(): Promise<{ salas: number; jogadores: number }> {
    const r = this.ctx.storage.sql.exec<{ salas: number; jogadores: number }>('SELECT COUNT(*) AS salas, COALESCE(SUM(jogadores), 0) AS jogadores FROM salas WHERE atualizado > ?', Date.now() - VALIDADE_MS).one();
    return r;
  }
}
