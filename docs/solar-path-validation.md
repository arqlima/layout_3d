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

O controle **Tamanho da faixa** ajusta apenas o guia solar, de **5% a 200%**,
com resposta imediata. O padrão é **50%** (metade do tamanho da primeira
implementação); **100%** corresponde ao tamanho original. O centro do guia,
o modelo, a câmera e a iluminação são preservados. O tamanho escolhido continua
valendo ao alterar o horário/data e ao ocultar/mostrar a faixa, até recarregar
a página. Pode ser ajustado mesmo com a faixa oculta.

O controle **Opacidade da faixa**, abaixo do tamanho, ajusta o preenchimento
anual de **0% a 100%**, com padrão de **12%**. A linha diária, o marcador do
sol e o horizonte mantêm sua aparência. O ajuste é imediato, pode ser feito
com a faixa oculta e é preservado durante a sessão ao alterar data, horário,
tamanho ou visibilidade. Em 0%, apenas o preenchimento fica transparente.

## Salvar a faixa em uma cena

Configure a faixa e clique em uma posição vazia na barra de cenas para salvar.
Para substituir uma cena, abra a posição desejada, faça os ajustes e clique em
**Atualizar cena**. São guardados visibilidade, tamanho, opacidade, data,
horário, coordenadas, fuso, orientação do norte e iluminação, junto com os
demais dados da cena. O armazenamento continua sendo no navegador e por projeto.

Ao abrir uma cena, a aplicação mantém a aba atual e restaura a faixa também
no **Estudo de massa**, sincronizando os controles solares e o indicador de
norte. As coordenadas
de um KMZ cadastrado continuam prevalecendo. Cenas anteriores, sem informação
solar, continuam aceitas e ocultam uma faixa que estivesse visível.

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

## Controle de tamanho

- RED: `node scripts/test-shadows.mjs` falhou com
  `TypeError: viewer.setSolarPathScale is not a function`; checkpoint `e024b94`.
- GREEN: o mesmo teste passou: escala proporcional, centro preservado,
  manutenção do tamanho após alterar o horário e alternar a visibilidade,
  rejeição de valores inválidos.
- `node scripts/test-location.mjs`: tamanho inicial de 50%, callback do slider
  e percentual exibido aprovados.
- TypeScript, build, vinculação dos módulos, testes solares e de seleção,
  `manage.py check` e os 51 testes Django passaram novamente.

## Controle de opacidade

- RED: `node scripts/test-shadows.mjs` falhou com
  `TypeError: viewer.setSolarPathOpacity is not a function`; checkpoint `3162ce2`.
- GREEN: mesmo comando aprovado; padrão de 12%, conversão percentual,
  extremos 0% e 100%, rejeição de valores inválidos, preservação da linha
  diária e manutenção do ajuste ao mudar data, horário e visibilidade.
- `node scripts/test-location.mjs`: callback e percentual exibido pelo slider,
  padrão e limites aprovados.
- TypeScript, build, vinculação dos módulos, testes de seleção,
  `manage.py check` e os 51 testes Django passaram novamente.

## Faixa solar nas cenas

- RED: `npm.cmd test` falhou em `Scenes reject invalid solar opacity`, pois
  o validador ignorava o estado solar. Checkpoint: `d8a1bb0`.
- GREEN: `npm.cmd test` passou; captura e restauração exercitam o visualizador
  real, incluindo recriação da faixa, escala/opacidade, parâmetros solares,
  persistência JSON após reabrir o armazenamento e compatibilidade legada.
  Estados solares com opacidade, escala, data ou norte inválidos são rejeitados.
- `node scripts/test-location.mjs`: restauração dos controles e callbacks,
  percentuais e preservação das coordenadas bloqueadas por KMZ aprovados.
- `node scripts/test-north.mjs` e `node scripts/test-shadows.mjs`: aprovados.
- TypeScript, build, vinculação dos módulos, `manage.py check` e os 51 testes
  Django aprovados. Sem validação visual em navegador nesta alteração.
