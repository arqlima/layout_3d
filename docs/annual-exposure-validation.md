# Mapa de exposição anual

Na aba **Estudo solar**, o painel **Exposição anual** oferece **Calcular mapa
anual**, progresso, cancelamento e **Mostrar mapa em gradiente**. O ano vem da
data selecionada. O cálculo usa latitude, longitude, fuso e norte do projeto.
Após mudar o ano, a localização, o norte, os filtros de geometria visível ou
o corte, o resultado é invalidado e precisa ser recalculado. Mudar o dia,
o horário, a iluminação ou a faixa solar não altera o resultado anual.
Ao trocar de aba o mapa é ocultado; ao voltar, um resultado ainda válido e
marcado pode ser exibido novamente.

## Interpretação

O mapa mostra **horas estimadas de sol direto por ano nas superfícies**,
considerando orientação das faces e oclusões geométricas.
Geometrias REP não recebem gradiente nem entram na área usada para definir
a resolução das superfícies analisadas. REP opaco e visível continua como
obstáculo para o cálculo das sombras. A identificação segue a convenção já
usada pelo visualizador: grupo/uso REP na layer, uso REP nos dados ou nome
isolado REP. Com apenas superfícies REP, o cálculo informa que não há
superfícies elegíveis. Cenas salvas aplicam essa regra ao recalcular.
Azul indica menos horas; vermelho indica mais. A escala vai de zero ao total
de horas acima do horizonte nos períodos amostrados para aquele local/ano.
Não representa temperatura, energia em kWh, radiação difusa, reflexão,
transmissão pelo vidro ou previsão meteorológica.

São usados 12 dias representativos (dia 15 de cada mês), amostras horárias
no meio de cada hora e pesos iguais ao número de dias do mês, incluindo ano
bissexto. Triângulos grandes são subdivididos segundo um espaçamento derivado
da área total, tendo 1.500 como referência inicial de resolução. A quantidade
efetiva de amostras depende da geometria e aparece no painel. Calculam-se horas
de sol nos vértices, com cache separado por posição e normal da face.
Assim, fachadas e coberturas que compartilham uma quina mantêm seus próprios
valores. A quantidade é limitada a 25 mil amostras e 250 mil triângulos de
visualização; modelos mais complexos pedem simplificação.

O gradiente interpola o valor escalar dentro de cada triângulo subdividido e
aplica a escala azul/ciano/verde/amarelo/vermelho por fragmento. Não mistura
resultados entre faces com normais diferentes. A suavização é de apresentação:
não aumenta a precisão do cálculo. Sombras estreitas ainda podem não ser
representadas pela resolução espacial/temporal adotada.

As sombras são verificadas por interseções de raios com triângulos opacos,
com aceleração por uma árvore de caixas envolventes. Geometria, normais e
áreas são transformadas para coordenadas mundiais. Materiais originais são
preservados; superfícies transparentes não são receptoras nem bloqueadoras.
Considera a geometria visível, incluindo objetos contextuais esmaecidos.
Objetos instanciados, deformáveis ou com morph targets ativos são ignorados
com aviso da quantidade. A análise exige corte desativado e limita o modelo
a 200 mil triângulos opacos; modelos acima desse limite pedem simplificação.

O cálculo cede execução entre etapas para permitir progresso e cancelamento.
O gradiente é uma malha separada, opaca e sem iluminação, sobreposta às faces
analisadas com ajuste de profundidade. Ela cobre as cores originais sem alterar
geometrias nem materiais de origem. Ao ocultar o mapa, os materiais aparecem
novamente. Não interfere na seleção, enquadramento ou quantitativos.
Não há alteração dos arquivos do cliente. O resultado calculado fica na sessão
atual. As cenas guardam a indicação de mapa visível e seus parâmetros solares,
filtros e câmera; ao abrir, o mapa é recalculado sem mudar a aba atual.
Isso evita armazenar a malha do gradiente no localStorage.

## Cenas e PNG

Com o mapa pronto e visível, clique em uma cena vazia ou use **Atualizar cena**
na cena selecionada. Aguarde o cálculo terminar antes de salvar ou exportar.
Ao abrir uma cena com mapa, os controles de cena aguardam o recálculo e só
informam sucesso após sua conclusão. Cancelamento ou erro não é reportado como
cena aberta com sucesso. Cenas antigas continuam funcionando sem cálculo anual.

**Imprimir → Gerar PNG** inclui a faixa solar e o gradiente quando visíveis,
tanto com fundo transparente quanto normal, mantendo câmera, cores e filtros.
Análises ocultas continuam ocultas. Piso artificial e auxiliares continuam
excluídos. A visibilidade e o fundo da tela são preservados, inclusive em erro.

## Evidências

Jornada: calcular a exposição acumulada anual, inspecionar o mapa colorido,
ocultar/mostrar o resultado, cancelar um cálculo e recalcular após alterações.

- RED: `node scripts/test-solar.mjs` falhou por `annualSunSamples` indefinido;
  checkpoint Git `a122c82`.
- GREEN: mesmo comando passou; pesos positivos, apenas sol acima do horizonte
  e independência do dia e horário selecionados dentro do mesmo ano.
- `node scripts/test-annual-exposure.mjs`: passou; superfície horizontal livre
  recebe todas as horas amostradas, cobertura opaca sombreia o chão,
  amostragem por área, materiais preservados, cancelamento, modelos vazios e
  transparentes e liberação de recursos.
- `node scripts/test-shadows.mjs`: passou; cálculo integrado no visualizador,
  visibilidade, manutenção do resultado ao mudar dia/horário, invalidação ao
  mudar o norte, bloqueio de resultado desatualizado e rejeição de corte ativo.
- `node scripts/test-location.mjs`: passou; controles existentes, conclusão
  do cálculo simulado, legenda e invalidação do resultado.
- `npm.cmd test`: regressões de seleção, cenas, filtros, exportação e simulações
  aprovadas.
- `npm.cmd run build -- --emptyOutDir false`: TypeScript e build aprovados;
  arquivos anteriores preservados.
- `npm.cmd run test:build`: oito módulos vinculados com sucesso.
- `.venv/Scripts/python.exe manage.py check`: sem problemas.
- `.venv/Scripts/python.exe manage.py test`: 51 testes aprovados.

Sem validação visual em navegador ou benchmark no modelo real do usuário.
Testes usam Three.js real sem contexto WebGL; o shader do gradiente não foi
executado nesses testes. Cobertura percentual não medida. O resultado é um
estudo geométrico aproximado, com as amostragens informadas acima.

## Gradiente contínuo

- RED: `node scripts/test-annual-exposure.mjs` falhou em
  `Exposure is a continuous surface mesh instead of points`; checkpoint `c612417`.
- GREEN: o mesmo teste passou; malha contínua, subdivisão de faces grandes,
  materiais de origem preservados, cobertura opaca dos materiais originais,
  ordem de renderização, valores separados em quinas e sombras reais aprovados.
- `node scripts/test-shadows.mjs`: cálculo integrado, visibilidade e invalidação
  continuam aprovados com a quantidade adaptativa de amostras.
- `node scripts/test-location.mjs` e `npm.cmd test`: regressões aprovadas.

## Correção da exportação e persistência nas cenas

- RED: `npm.cmd test` falhou em `Visible solar band must be included in PNG
  export`, pois a exportação ocultava todos os objetos fora do modelo;
  checkpoint `79a7377`.
- GREEN: mesmo comando aprovado. A faixa e o mapa usam a marca explícita
  `includeInImageExport`; apenas esses auxiliares são preservados na imagem.
  Os testes cobrem fundos transparente/normal e análises ocultas.
- `npm.cmd test` também cobre captura do mapa na cena, persistência JSON,
  restauração e recálculo reais, legado, validação do estado e bloqueio de
  salvamento/exportação durante cálculos.
- `node scripts/test-scene-toolbar.mjs`: gravação, recálculo assíncrono,
  progresso, bloqueio de cliques concorrentes e erro na abertura aprovados.
- `node scripts/test-location.mjs`: sincronização dos controles após restaurar
  o mapa e propagação de falhas aprovadas.
- TypeScript/build, vinculação de módulos, testes anuais/sombras,
  `manage.py check` e 51 testes Django aprovados.
- Sem validação visual em navegador; o renderer de exportação é simulado nos
  testes e a geometria solar usa Three.js real.

## Exclusão de REP como superfície analisada

- RED: `node scripts/test-annual-exposure.mjs` falhou em
  `REP blockers must not receive the exposure gradient`; checkpoint `42be5b3`.
- GREEN: mesmo comando passou; REP não recebe a malha, continua bloqueando
  sol sobre outras superfícies e modelos apenas REP não geram resultado.
- `node scripts/test-shadows.mjs`: classificação real de entradas do viewer
  por layer REP, uso REP e nome isolado REP aprovada.
- `npm.cmd test`, teste do painel solar, TypeScript/build, vinculação dos
  módulos, `manage.py check` e os 51 testes Django passaram.
- Sem validação visual em navegador nesta alteração.
