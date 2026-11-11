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
Antes de trocar para a tag original, manter `.backups/` excluído localmente em `.git/info/exclude`
ou guardar o backup fora do checkout: o `.gitignore` antigo ainda não contém essa pasta.

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
Também mede 30 buscas de vértices da régua e o cálculo anual nas duas cenas.
Os algoritmos dessas duas funções não foram alterados nesta etapa.

## Etapa 2: renderização e sombras

`RenderScheduler` reúne mudanças no mesmo quadro. Eventos de câmera solicitam novos quadros
enquanto o damping converge; a vista em repouso não mantém um loop de renderização.
Trocas de aba e `document.visibilitychange` suspendem o agendamento. Reativação e resize
redesenham a vista. O descarte cancela trabalho pendente.

O sol usa `shadow.autoUpdate = false`. Mudanças de direção/projeção solar, visibilidade,
seleção que altera os objetos que projetam sombras, cotas e cortes invalidam o mapa.
Movimentar a câmera, mudar a cor de fundo, a cor do modelo ou apenas a exposição não o recalcula.
Resolução de sombras, antialiasing e pixel ratio continuam com os mesmos valores.
O PNG gera sombras no contexto separado da exportação e solicita atualização da vista após terminar.

### Resultados observados

Chrome headless, Windows, ANGLE/Direct3D11, NVIDIA GeForce RTX 2060; uma execução de referência
e uma execução final, usando as mesmas cenas sintéticas e viewport. Tempos iniciais incluem
aquecimento e não permitem concluir melhoria no carregamento de modelos reais.

| Medida | 32 objetos antes | 32 depois | 1.024 objetos antes | 1.024 depois |
| --- | ---: | ---: | ---: | ---: |
| Quadros em 2 s de repouso | 120 | 0 | 121 | 0 |
| Desenhos de malhas no passe de sombras em repouso | 3.840 | 0 | 123.904 | 0 |
| Quadros no percurso de câmera | 90 | 90 | 90 | 90 |
| Desenhos de malhas no passe de sombras no percurso | 2.880 | 0 | 92.160 | 0 |
| Tempo CPU de submissão no percurso (ms) | 42,5 | 49,4 | 406,7 | 294,0 |
| Quadros com vista desativada | 0 | 0 | 0 | 0 |
| Quadros em repouso após reativar (0,5 s) | 30 | 0 | 31 | 0 |
| Preparação e primeira vista sintética (ms) | 137,2 | 157,8 | 57,7 | 55,6 |

O ganho comprovado é a eliminação dos quadros em repouso e dos passes de sombra durante
a navegação da câmera. Tempos isolados variam: não representam garantia de FPS ou porcentagem
de CPU/GPU economizada. O damping pode continuar nas pequenas amostras de fundo/aparência
imediatamente após o percurso de câmera; o teste separado de integração desabilita damping
para verificar as invalidações sem esse efeito.

Dados completos ficam no backup local em `baseline.json` e `optimized-verified.json`.
Uma rodada complementar, incluindo régua e exposição anual, está em `reference-complete.json`
e `optimized-complete.json`. O modo `--reference` lê o código original da tag por um plugin
local do Vite, sem alterar o checkout, o banco ou os uploads.

| Medida complementar | 32 antes | 32 depois | 1.024 antes | 1.024 depois |
| --- | ---: | ---: | ---: | ---: |
| 30 buscas de vértice (ms) | 5,1 | 19,2 | 22,2 | 22,7 |
| Exposição anual (ms) | 77,7 | 90,9 | 1.011,5 | 1.017,0 |
| Amostras do mapa anual | 2.752 | 2.752 | 24.576 | 24.576 |

Esses tempos isolados têm variação e não demonstram melhora da régua ou do cálculo solar.
Servem como referência para etapas posteriores. A régua foi amostrada ao centro da vista,
sem medir interação humana; o cálculo anual foi executado até concluir.

Para repetir a validação real de WebGL e gerar outro resultado:
`node scripts/benchmark-viewer.mjs ../../.backups/pre-optimization-2026-11-11/recheck.json --verify`.
Usar um nome novo para preservar medições anteriores.

### Verificação e limites

- RED: teste do agendador falhou antes da implementação (`83be8dd`).
- RED adicional: exportação não atualizava sombras com a política de cache ativada; teste reproduziu a falha antes da correção.
- GREEN: 14 scripts frontend, incluindo agendamento, exportação e testes anteriores de seleção/cenas/cortes/régua/solar.
- Cobertura do módulo novo `RenderScheduler.ts`: 100% de linhas, branches e funções, com Node test coverage.
- Chrome/WebGL: 19 verificações de fundo, câmera, materiais, sol, exposição, faixa solar, layers,
  cotas, cortes/contornos, restauração de cena, PNG, exposição anual e retorno ao repouso.
- Django: `check` sem problemas e 51 testes aprovados.
- Build de produção e TypeScript aprovados. Build feito com `--emptyOutDir false` para preservar os artefatos anteriores.
- Revisão de diff e busca de segredos/logs no código alterado realizadas. Nenhum dado de cliente foi incluído nos commits.
- `git diff --check` do código autoral passou; os chunks gerados preservam whitespace dos shaders upstream do Three.js.
- Lint: não executado; o projeto não tem ferramenta/comando configurado. Nenhuma dependência instalada.
- Cobertura global e validação visual manual com modelos reais: não executadas. Não houve medição de utilização percentual de CPU/GPU.

Comandos locais: `npm.cmd test`, `node --test --experimental-test-coverage "--test-coverage-include=**/RenderScheduler.ts" scripts/test-rendering.mjs`
e `npm.cmd run build -- --emptyOutDir false`, em `projects3d/frontend`.

As etapas 3 a 6 e a limpeza de arquivos não fazem parte desta alteração.
