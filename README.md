# backend-soudev

Backend dos jogos online do [soudev](https://soudev.vercel.app), na Cloudflare (Workers + Durable Objects).

Publicado em `https://backend-soudev.backend-soudev.workers.dev`.

## O que tem

| Rota | O que faz |
|---|---|
| `GET /saude` | Responde `{ ok: true }` |
| `GET /online` | Quantas salas públicas e pessoas online |
| `POST /jogar` | Código de uma sala pública com vaga (a mais cheia), ou de uma nova |
| `POST /salas` | Código de uma sala privada nova |
| `GET /sala/:codigo` | WebSocket da sala (`?id=&nome=&skin=`) |

- **Sala** (`src/sala.ts`): um Durable Object por sala, até 12 pessoas. Repassa poses em lotes (10 por segundo), emotes e skins. Usa hibernação: sala parada não gasta.
- **Diretório** (`src/diretorio.ts`): lista das salas públicas para o "Jogar".
- **Protocolo** (`src/protocolo.ts`): tipos das mensagens. `npm run protocolo` copia para `soudev/games/praca/src`.
- Só os sites em `ORIGENS` (`wrangler.jsonc`) podem criar salas e conectar.

## Desenvolvimento

```bash
npm install
npm run dev        # servidor local em http://localhost:8787
npm run teste      # em outro terminal: simula jogadores contra o servidor local
npm run typecheck
```

Para testar o publicado: `BASE=https://backend-soudev.backend-soudev.workers.dev npm run teste`.

## Deploy

Cada push na `main` roda tipos + testes e publica pelo GitHub Actions (`.github/workflows/deploy.yml`).
Precisa de dois segredos no repositório (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN`: token criado em dash.cloudflare.com → My Profile → API Tokens → modelo "Edit Cloudflare Workers"
- `CLOUDFLARE_ACCOUNT_ID`: `c86ebb125090e3207a40813a26ca6f0c`

Sem os segredos, o workflow testa mas não publica. Deploy manual: `npx wrangler login` e `npm run deploy`.
