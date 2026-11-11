# Otimização gradual: etapas 1 e 2

## Ponto de restauração

- Tag: `pre-optimization-2026-11-11`.
- Commit: `0592a43ca4b825ac27c9cb4947c949ed151f73af`.
- Backup local, ignorado pelo Git: `.backups/pre-optimization-2026-11-11/`.
- `db.sqlite3`: cópia consistente pela API de backup SQLite, com `integrity_check`.
- `media.zip`: todos os uploads existentes no momento do backup.
- `build-and-config.zip`: build original, `.gitignore`, package.json e vite.config.ts.
- `manifest.json`: tamanhos e SHA-256 dos três arquivos de backup. Os ZIPs passaram por verificação de CRC.

Não remover `.backups/`. Copiar esse diretório para outro disco é recomendado para proteção contra falha física.
Os backups contêm dados privados e não devem ser publicados ou adicionados ao Git.

Para voltar ao código original, primeiro preservar qualquer trabalho posterior e criar uma branch a partir da tag:
`git switch -c restauracao-pre-otimizacao pre-optimization-2026-11-11`.
O Git não restaura uploads ignorados. Se também for necessário restaurar dados, parar o servidor,
salvar o estado atual e restaurar o banco e os uploads do backup, conferindo o manifesto antes.
Não extrair os arquivos sobre dados atuais sem revisão. Para reprodução exata do build, usar o ZIP original.

## Etapa 1: referência reproduzível

Em `projects3d/frontend`, `npm.cmd test` no PowerShell executa todos os scripts `test-*.mjs`.
Em ambientes com pnpm disponível, `pnpm test` executa o mesmo comando.
Não é necessário instalar dependências novas.

Benchmark local: `node scripts/benchmark-viewer.mjs ../../.backups/pre-optimization-2026-11-11/baseline.json`.
O script inicia Vite em localhost e Chrome headless com perfil temporário independente.
`CHROME_PATH` permite escolher outra instalação de Chrome/Chromium.
Ele usa o visualizador real, viewport 960 × 640 e cenas sintéticas de 32 e 1.024 caixas.
Mede abertura, quadros em repouso/navegação, desenhos de sombras, pausa e retorno à aba.
Não lê banco, modelos de clientes ou perfil pessoal do navegador.

Os tempos de submissão medem trabalho JavaScript/CPU ao chamar render, não duração real na GPU.
Tempo inicial inclui preparação sintética e aquecimento; não representa download/decodificação de 3DM.
Medições não equivalem a porcentagens de utilização do processador ou da placa gráfica.
Régua e exposição anual exigem medições específicas posteriores; não foram alteradas nesta etapa.
