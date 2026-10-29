# Seleção com Shift e Ctrl

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
