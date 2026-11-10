# Amostragem adaptativa da exposição anual

Ao clicar em **Calcular mapa anual**, o visualizador mantém a amostragem
anterior quando ela cabe no limite de 25 mil pontos. Se a malha exigir mais,
agrupa pontos próximos com orientação semelhante e amplia os grupos até
respeitar o limite. A contagem é feita antes de calcular os raios solares.

O mapa continua cobrindo todas as faces analisadas. Nenhum objeto do arquivo
3D é modificado; os obstáculos usados para calcular sombras mantêm sua
geometria original, inclusive REP visível. Grupos de orientação e uma faixa
de profundidade mais fina ajudam a separar fachadas, coberturas e pisos
próximos. Cada grupo reutiliza o resultado calculado em um ponto real de sua
superfície. Isso é uma aproximação: pequenos detalhes e transições de sombra
podem perder definição. O painel informa **Detalhe reduzido automaticamente**.

As subdivisões adicionais também respeitam um limite de 250 mil triângulos,
reservando espaço para todas as faces originais. O cancelamento continua
ativo durante a preparação e o cálculo. O limite de entrada de 200 mil
triângulos opacos permanece como proteção de memória. Objetos animados ou
instanciados continuam sem suporte, conforme informado pelo painel.

## Evidências e validação

Pedido: concluir o mapa de modelos detalhados por meio de redução automática
do detalhe. Nenhuma dependência foi instalada.

O teste `node scripts/test-annual-exposure.mjs`, executado em
`projects3d/frontend`, usa um plano com 25.921 vértices e 51.200 triângulos.
Antes da mudança, falhou com **O gradiente exige mais de 25 mil amostras**.
Depois da mudança, verifica que o mapa é concluído com até 25 mil amostras,
cobre todos os triângulos e indica a redução de detalhe.

O mesmo teste verifica um piso sob cobertura opaca a 1 mm: o piso permanece
sombreado e a cobertura ensolarada. Também verifica cancelamento, preservação
de materiais, geometrias transparentes/REP e modelos simples sem redução.
Uma solicitação de 500 mil amostras também é concluída dentro dos limites,
com área coberta igual à original. O teste `node scripts/test-location.mjs`
verifica o aviso de detalhe reduzido no painel e a restauração de cenas.
Os testes solares, de sombras, seleção, barra de cenas, TypeScript, build
Vite e vinculação de oito módulos passaram. Django check e os 51 testes
Django também passaram.
Essa validação é numérica e geométrica; não substitui uma comparação visual
com o modelo específico do usuário. Não foi medida cobertura percentual nem
executado teste de ponta a ponta em navegador.
