# Sobreposição de cor e arestas

Na engrenagem **Configurações**, há dois controles independentes:

- **Cor do modelo · exceto REP → Sobrepor cor**: seletor de cor e canais
  R/G/B (inteiros de 0 a 255) para as superfícies.
- **Arestas · exceto REP → Sobrescrever arestas**: seletor de cor e canais
  R/G/B próprios para arestas e linhas existentes.

As opções começam desligadas. As cores podem ser escolhidas antes de ativar
as caixas. Grupo/uso REP em layers, uso REP nos dados e objetos chamados REP
(incluindo suas arestas filhas) preservam a aparência original.

As alterações usam cópias de materiais com cache, sem editar os materiais de
origem. A cor sobreposta ignora a textura de cor, cores de vértices e emissão
colorida. A transparência, o recorte por alfa, o comportamento de profundidade,
a seleção, os filtros e a iluminação são mantidos. Desativar a opção restaura
o material anterior. As arestas existentes são recoloridas; este controle não
gera novas arestas nem altera sua espessura. Linhas de corte mantêm seus
controles próprios; o preenchimento do corte acompanha a cor da superfície.

As cenas guardam os dois estados e as duas cores, com restauração dos controles
na engrenagem. Cenas antigas sem essa informação desativam as sobreposições.
As cores também acompanham a exportação da vista. Quando o mapa de exposição
está ativo, seu gradiente continua sobreposto às superfícies analisadas;
oculte-o para enxergar a cor uniforme escolhida.

## Evidências

Jornada: deixar as geometrias fora de REP em uma cor uniforme, escolher uma cor
independente para arestas, salvar a cena e recuperar as opções depois.

- RED: `npm.cmd test` falhou com `viewer.setModelAppearance is not a function`;
  checkpoint `ffb5c9b`.
- GREEN: mesmo comando passou; cor e arestas, materiais de origem preservados,
  REP por grupo e por nome herdado nas arestas, restauração de cenas, legado,
  persistência JSON e rejeição de cores inválidas.
- `node scripts/test-presentation-settings.mjs`: seletor/RGB sincronizados,
  caixas independentes, rejeição de canais inválidos e restauração sem ciclo
  de callbacks aprovados.
- `node scripts/test-model-appearance.mjs`: independência de superfícies/arestas,
  texturas, cores de vértices, emissão, transparência, identidade dos materiais
  originais, cache e liberação dos clones aprovados.
- Testes de sombras, barra de cenas e painel solar aprovados.
- `npm.cmd run build -- --emptyOutDir false`: TypeScript e build aprovados;
  bundles anteriores preservados.
- `npm.cmd run test:build`: oito módulos vinculados com sucesso.
- `.venv/Scripts/python.exe manage.py check`: sem problemas.
- `.venv/Scripts/python.exe manage.py test`: 51 testes aprovados.

Sem validação visual em navegador nesta alteração. Testes de materiais usam
Three.js real sem WebGL; os controles HTML são simulados. Cobertura percentual
não medida.
