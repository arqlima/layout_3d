# Mapa de exposição anual

Na aba **Estudo solar**, o painel **Exposição anual** oferece **Calcular mapa
anual**, progresso, cancelamento e **Mostrar mapa por pontos**. O ano vem da
data selecionada. O cálculo usa latitude, longitude, fuso e norte do projeto.
Após mudar o ano, a localização, o norte, os filtros de geometria visível ou
o corte, o resultado é invalidado e precisa ser recalculado. Mudar o dia,
o horário, a iluminação ou a faixa solar não altera o resultado anual.
Ao trocar de aba o mapa é ocultado; ao voltar, um resultado ainda válido e
marcado pode ser exibido novamente.

## Interpretação

O mapa mostra **horas estimadas de sol direto por ano em pontos amostrados
nas superfícies**, considerando orientação das faces e oclusões geométricas.
Azul indica menos horas; vermelho indica mais. A escala vai de zero ao total
de horas acima do horizonte nos períodos amostrados para aquele local/ano.
Não representa temperatura, energia em kWh, radiação difusa, reflexão,
transmissão pelo vidro ou previsão meteorológica.

São usados 12 dias representativos (dia 15 de cada mês), amostras horárias
no meio de cada hora e pesos iguais ao número de dias do mês, incluindo ano
bissexto. Há 1.500 pontos distribuídos pelas superfícies proporcionalmente
à área. Os locais são determinísticos, evitando resultados aleatórios ao
recalcular o mesmo modelo. A visualização é pontual, não um preenchimento
contínuo de todas as fachadas. Regiões pequenas e sombras estreitas podem
não ser representadas por essa resolução espacial/temporal.

As sombras são verificadas por interseções de raios com triângulos opacos,
com aceleração por uma árvore de caixas envolventes. Geometria, normais e
áreas são transformadas para coordenadas mundiais. Materiais originais são
preservados; superfícies transparentes não são receptoras nem bloqueadoras.
Considera a geometria visível, incluindo objetos contextuais esmaecidos.
Objetos instanciados, deformáveis ou com morph targets ativos são ignorados
com aviso da quantidade. A análise exige corte desativado e limita o modelo
a 200 mil triângulos opacos; modelos acima desse limite pedem simplificação.

O cálculo cede execução entre etapas para permitir progresso e cancelamento.
Os pontos são um objeto separado que não interfere na seleção, enquadramento
ou quantitativos. Não há alteração dos arquivos do cliente. Resultados ficam
apenas na sessão atual e não são persistidos nas cenas nesta implementação.

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
Testes usam Three.js real sem contexto WebGL; o shader dos pontos não foi
executado nesses testes. Cobertura percentual não medida. O resultado é um
estudo geométrico aproximado, com as amostragens informadas acima.
