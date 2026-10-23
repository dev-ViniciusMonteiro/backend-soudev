// Copia o contrato das mensagens para o jogo (soudev/games/praca). Rode depois de mudar src/protocolo.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const origem = fileURLToPath(new URL('../src/protocolo.ts', import.meta.url));
const destino = fileURLToPath(new URL(process.env.DESTINO ?? '../../soudev/games/praca/src/protocolo.ts', import.meta.url));
const aviso = '// GERADO por backend-soudev (npm run protocolo). Não edite aqui: mude em backend-soudev/src/protocolo.ts.\n\n';
writeFileSync(destino, aviso + readFileSync(origem, 'utf8'));
console.log(`Protocolo copiado para ${destino}`);
