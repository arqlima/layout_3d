# Faixa solar no estudo solar

Na aba **Estudo solar**, marque **Mostrar faixa solar** para exibir:

- faixa translúcida anual aproximada entre as trajetórias de 21 de junho e
  21 de dezembro;
- linha dourada da trajetória completa da data selecionada;
- ponto e raio indicando a posição do sol no horário escolhido;
- círculo do horizonte, no nível inferior do modelo.

Desmarque para ocultar. A opção começa desligada e é mantida enquanto a página
está aberta. Ao sair da aba, a faixa fica oculta; ao voltar, a opção marcada é
respeitada. A iluminação continua funcionando como antes nas outras abas.
O ponto e o raio desaparecem quando o sol está abaixo do horizonte.

A geometria usa o mesmo cálculo solar já empregado pela iluminação, com
latitude, longitude, fuso e orientação do norte. As trajetórias usam amostras
de cinco minutos do dia completo, independentemente dos limites do slider de
horário. A faixa anual é uma aproximação interpolada entre os solstícios,
subdividida sobre a cúpula celeste e recortada no horizonte; não representa
obstruções ou um cálculo de horas de insolação das fachadas.

O guia tem escala relativa ao modelo e não altera seus arquivos, seus
quantitativos, o enquadramento automático ou os objetos selecionáveis.
Alterar apenas o horário ou a iluminação reutiliza a geometria dos percursos.
Ao desligar, o objeto é ocultado e reutilizado; ao encerrar o visualizador,
geometrias e materiais são liberados.

## Evidências

Jornada: ativar a faixa anual, inspecionar a trajetória da data selecionada,
alterar o horário e ocultar o guia novamente.

- RED: `node scripts/test-solar.mjs` falhou por ausência de `solarDayPath`,
  com `actual: 'undefined'`, `expected: 'function'`. Checkpoint: `262a626`.
- GREEN: o mesmo comando passou, incluindo dia completo, independência do
  slider de horário, rotação do norte e coordenadas finitas nos polos.
- `node scripts/test-location.mjs`: passou; teste do checkbox desligado por
  padrão, ativação, desativação e preservação das coordenadas bloqueadas por KMZ.
- `node scripts/test-shadows.mjs`: passou; geometria Three.js real, faixa e
  percurso acima do horizonte, raio unitário, cache ao alterar horário,
  marcador noturno, noite/dia polar, reutilização e liberação de recursos.
- `npm.cmd test`: passou; regressões de seleção, filtros, cenas, exportação,
  simulação e interação solar continuam aprovadas.
- `npm.cmd run build -- --emptyOutDir false`: TypeScript e build aprovados,
  preservando os bundles anteriores.
- `npm.cmd run test:build`: oito módulos vinculados com sucesso.
- `.venv/Scripts/python.exe manage.py check`: sem problemas.
- `.venv/Scripts/python.exe manage.py test`: 51 testes aprovados.

Não houve validação visual em navegador. Os testes exercitam geometrias e
métodos reais sem contexto WebGL; os controles de formulário são simulados.
Cobertura percentual não medida.
