# Seleção com Shift e Ctrl

## Desfazer seleção com Ctrl+Z

Ctrl+Z (ou Cmd+Z) recupera a seleção anterior após clique simples,
adição com Shift, remoção com Ctrl, limpeza ou marcação de layers.
O histórico guarda até 100 alterações e ignora ações sem mudança.
Restaura objetos, layers e usos marcados, atualizando destaque e totais.
Campos de edição preservam seu desfazer nativo; Ctrl+Shift+Z não é tratado.
O atalho fica inativo quando o visualizador está oculto, a seleção está
bloqueada ou a ferramenta de medição está ativa.

O histórico é da sessão atual. Trocar o modelo, restaurar uma cena,
alterar o modo de seleção ou os filtros de uso/elevação reinicia o histórico.
Não há refazer de seleção nesta implementação.

- Jornada: recuperar uma seleção múltipla perdida ao clicar em outro bloco.
- RED: `node scripts/test-selection.mjs` executou o novo teste e falhou
  com `TypeError: viewer.undoSelection is not a function`; checkpoint `217cbc4`.
- GREEN: `npm.cmd test` aprovado, incluindo restauração de objetos/layers,
  remoção, limpeza, checkboxes, grupos, usos, Cmd+Z, edição de texto,
  histórico vazio, limite de 100 etapas e bloqueios do atalho.
- `npm.cmd run build -- --emptyOutDir false`: TypeScript e build aprovados;
  bundles antigos preservados e manifesto atualizado.
- `npm.cmd run test:build`: os oito módulos do build foram vinculados.
- `.venv/Scripts/python.exe manage.py check`: sem problemas.
- `.venv/Scripts/python.exe manage.py test`: 51 testes aprovados.
- Sem teste visual em navegador; os testes exercitam métodos reais com
  Three.js e eventos simulados. Cobertura percentual não medida.

## Seleção com modificadores

Requisitos: Shift + clique adiciona; Ctrl + clique remove; clique simples
substitui a seleção. Ctrl tem prioridade se ambas as teclas estiverem pressionadas.
Os atalhos respeitam os modos individuais, de grupo e uso existentes.

- RED: `node scripts/test-selection.mjs` falhou em `Shift adds across layers`,
  antes da implementação. Checkpoint Git: `1f88f07`.
- GREEN: o mesmo comando passou após a implementação. Testa adição entre
  layers, remoção parcial e total, clique simples, cliques modificados no fundo,
  prioridade do Ctrl, arrasto, grupos, cenas múltiplas/vazias e cenas antigas.
  Os testes existentes de materiais, arestas, GUIDs, totais, filtros e estudo
  solar continuam aprovados.
- TypeScript e build: `npm.cmd run build -- --emptyOutDir false` aprovado.
  Builds antigos preservados; manifesto atualizado para os novos arquivos.
- Django: `manage.py check` sem problemas; `manage.py test` com 51 testes aprovados.
- Whitespace: `git diff --check` aprovado para fontes; bundles preservam espaços
  de shaders do Three.js, como no build anterior.

Não houve teste visual em navegador. Os testes exercitam os métodos reais do
visualizador com objetos Three.js e eventos simulados, sem contexto WebGL.
Cobertura percentual não medida e lint independente não configurado.
