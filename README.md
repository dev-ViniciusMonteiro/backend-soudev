# backend-soudev

Backend dos jogos online do [soudev](https://soudev.vercel.app), na Cloudflare (Workers + Durable Objects).

Publicado em `https://backend-soudev.backend-soudev.workers.dev`.

## O que tem

| Rota | O que faz |
|---|---|
| `GET /saude` | Responde `{ ok: true }` |
| `GET /online` | Quantas salas públicas e pessoas online |
| `POST /perfil` | Cria perfil de convidado `{ apelido, skin }` → `{ token, perfil }` |
| `GET /perfil` · `PATCH /perfil` | Seu perfil / trocar apelido e skin (`Authorization: Bearer <token>`) |
| `GET /ranking?por=` | `nivel`, `moedas` ou o nome de um jogo (top 20 + a sua posição) |
| `POST /jogar` | Código de uma sala pública com vaga (a mais cheia), ou de uma nova |
| `POST /salas` | Código de uma sala privada nova |
| `GET /sala/:codigo` | WebSocket da sala (`?token=`) |

- **Sala** (`src/sala.ts`): um Durable Object por sala, até 12 pessoas. Repassa poses em lotes (10 por segundo), emotes e skins. Usa hibernação: sala parada não gasta.
- **Diretório** (`src/diretorio.ts`): lista das salas públicas para o "Jogar".
- **Protocolo** (`src/protocolo.ts`): tipos das mensagens. `npm run protocolo` copia para `soudev/games/praca/src`.
- **Perfis** (`src/perfis.ts`, banco D1 `soudev-jogos`, tabelas em `migrations/`): convidado com token secreto (só o hash fica no banco), XP e nível, moedas com extrato, itens liberados por nível ou conquista, partidas e ranking por jogo e temporada (estilo Elo). XP de presença: 1 por minuto na praça, até 60 por dia.
- Só os sites em `ORIGENS` (`wrangler.jsonc`) podem criar salas e conectar.

## Desenvolvimento

```bash
npm install
npx wrangler d1 migrations apply soudev-jogos --local
printf "MODO_TESTE=1
PRESENCA_MS=200
" > .dev.vars   # rotas de teste e XP acelerado, só local
npm run dev        # servidor local em http://localhost:8787
npm run teste      # em outro terminal: simula jogadores contra o servidor local
npm run typecheck
```

Para testar o publicado: `BASE=https://backend-soudev.backend-soudev.workers.dev npm run teste` e depois `npm run limpar-teste` (apaga os perfis "Teste ...").

Mudou o banco? Crie `migrations/000N_nome.sql` e rode `npx wrangler d1 migrations apply soudev-jogos --remote` antes do deploy.

## Deploy

Cada push na `main` roda tipos + testes e publica pelo GitHub Actions (`.github/workflows/deploy.yml`).
Precisa de dois segredos no repositório (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN`: token criado em dash.cloudflare.com → My Profile → API Tokens → modelo "Edit Cloudflare Workers"
- `CLOUDFLARE_ACCOUNT_ID`: `c86ebb125090e3207a40813a26ca6f0c`

Sem os segredos, o workflow testa mas não publica. Deploy manual: `npx wrangler login` e `npm run deploy`.
