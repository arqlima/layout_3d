# REP fora do filtro de cotas

Elementos identificados como REP pela convenção existente de layers (grupo REP,
uso REP ou layer REP) não entram nos níveis ou nos limites da régua e não sofrem
ocultação pela faixa de cotas. Os controles de visibilidade existentes continuam
ativos. A escala usa somente as cotas dos objetos elegíveis, sem acrescentar
o topo físico calculado a partir da geometria.

RED: `node scripts/test-selection.mjs` falhou no novo teste dos limites:
`[-105, 0, 95, 195, 205]` em vez de `[0, 10]`. Checkpoint: `5f03d69`.
Na correção posterior, o teste reproduziu a inclusão de um topo físico extra
(`[0, 10]` em vez da única cota elegível `[0]`); esse topo adicional foi removido.
GREEN: o mesmo comando passou após o ajuste, incluindo casos de grupo, uso,
layer REP, ausência de metadados CSV e visibilidade independente. Os demais
testes existentes de seleção e filtros também passaram.

TypeScript sem erros. Build e vinculação dos módulos gerados aprovados.
`manage.py check` sem problemas e `manage.py test` com 51 testes aprovados.
Whitespace das fontes verificado. Sem teste visual no navegador, lint separado
ou medição percentual de cobertura. Builds antigos preservados.
