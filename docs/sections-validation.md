# Cortes arquitetônicos — implementação e validação

## Comportamento

O usuário desenha uma linha na vista superior, com trava X/Y, escolhe uma seta
de observação e alterna entre corte ortogonal e navegação 3D. Há um corte ativo;
as dez cenas existentes podem guardar cortes diferentes. Não há mudança de schema
do Django, de dependências ou do arquivo 3D enviado.

`SectionTool` controla o desenho, a prévia, as setas e o cancelamento. Durante o
desenho, eventos do canvas não acionam a seleção ou os controles de câmera.
Salvar uma cena exige concluir ou cancelar o desenho.

`sectionLines` cria os contornos dos preenchimentos com `EdgesGeometry`, removendo
as diagonais coplanares. `LineSegments2`/`LineMaterial`, da dependência Three.js
existente, permitem espessura em pixels. A resolução é atualizada pelo próprio
Three.js a cada renderização, inclusive no PNG. Os contornos respeitam profundidade
e herdam a visibilidade dos objetos; o deslocamento de profundidade evita conflito
com o preenchimento. Há liberação explícita das geometrias/materiais ao trocar o corte.

A engrenagem de apresentação reúne exibição, cor e espessura (0,5–8 px em passos
de 0,5 px). O padrão é `#3f4a4d`, 1 px, visível. Os valores são validados na interface,
no visualizador e na leitura das cenas. Alterar o estilo não recalcula os contornos.
O campo opcional `ViewerSnapshot.sectionLines` preserva os ajustes; cenas sem esse
campo usam o padrão. A interface da engrenagem acompanha a cena aberta.

`sectionGeometry` intercepta os triângulos pelo plano, reúne contornos fechados,
identifica ilhas/vazios e triangula os preenchimentos. As superfícies auxiliares
são filhas dos objetos originais e herdam suas transformações e sua visibilidade.
As cores/transparências acompanham a aparência do objeto, incluindo filtros.
Trocar apenas o modo de câmera reutiliza as geometrias calculadas. Desativar ou
substituir o corte libera as geometrias e os materiais auxiliares.

X/Y referem-se à planta Rhino; no visualizador o plano horizontal é X/Z. Uma linha
X fixa Z, e uma linha Y fixa X. O lado salvo determina o semiespaço visível.
O plano é infinito; o comprimento desenhado não limita o corte a um trecho.

O estado opcional `ViewerSnapshot.section` registra eixo, coordenada, lado e modo.
A câmera continua no estado existente. A versão e a chave de armazenamento das
cenas são preservadas; ausência de `section` desativa o corte ao abrir uma cena
antiga. O armazenamento continua local ao navegador e separado por projeto/modelo.

## Limites

- Contornos abertos/ramificados não recebem fechamento artificial; há aviso no painel.
- `SkinnedMesh` e `InstancedMesh` recebem o recorte, sem preenchimentos auxiliares.
- Em objetos com vários materiais, cada ilha usa o material predominante no seu
  contorno. Texturas e variações por vértice não são projetadas na superfície nova.
- Vazios dependem de contornos fechados e coerentes; não há reparo automático de malhas.
- Quantitativos não são recalculados a partir da porção cortada.

## Evidência TDD

As jornadas foram derivadas do comportamento autorizado na conversa. Primeiro
foi adicionado e executado `scripts/test-sections.mjs`; o resultado inicial foi
RED por ausência de `src/viewer/sectionGeometry.ts` (implementação ainda inexistente).
Checkpoint: `09177ce` (`test: specify architectural sections before implementation`).
O mesmo teste passou depois da implementação e foi ampliado com integração e
interações. A medição de cobertura usa os módulos TypeScript em URLs reais e
o executor nativo do Node, sem instalar ferramentas.

Para os contornos, o checkpoint RED foi `e3c4f4f`: o teste falhou por ausência de
`sectionLines.ts`. Após criar os contornos, passou a verificar o perímetro de um
retângulo (20 unidades) e de uma seção vazada (32 unidades, incluindo o contorno
interno). O teste da engrenagem também foi executado em RED pela ausência do método
de assinatura dos ajustes, antes de conectar os controles. Ambos passaram em GREEN.

| Garantia | Verificação | Resultado |
| --- | --- | --- |
| Trava X/Y, rejeição de pontos iguais e inversão de lado | `test-sections.mjs` | PASS |
| Área real do preenchimento, transformações, vazios e tangência | `test-sections.mjs` | PASS |
| Contornos abertos não são preenchidos | `test-sections.mjs` | PASS |
| Materiais válidos inclusive com grupos de faces | `test-sections.mjs` | PASS |
| Câmeras reais, rotação, filtros, quantitativos e geometria original | `test-sections.mjs` | PASS |
| Persistência do corte e abertura de cenas antigas | `test-sections.mjs` | PASS |
| Dois cliques, escolha explícita de seta, arraste, Esc e descarte | `test-sections.mjs` | PASS |
| Perímetros externos e vazios sem diagonais; espessura em pixels | `test-sections.mjs` | PASS |
| Cor, espessura e exibição atualizadas sem reconstrução; liberação de recursos | `test-sections.mjs` | PASS |
| Estilo salvo/restaurado, compatibilidade e rejeição de valores inválidos | `test-sections.mjs` | PASS |
| Controles na engrenagem, aplicação imediata e sincronização com cenas | `test-presentation-settings.mjs` | PASS |
| Régua ignora faces removidas e mede vértices do preenchimento | `test-measurement.mjs` | PASS |
| Exportação mantém recorte e superfícies auxiliares | `test-selection.mjs` | PASS |
| Regressões de seleção, cenas, sombras, solar, norte e apresentação | Scripts existentes | PASS |
| Verificações do Django e 51 testes | `manage.py check` / `manage.py test` | PASS |

O teste opcional em um arquivo Rhino local com 1573 malhas produziu 135
preenchimentos em X e 76 em Y, sem contornos abertos nas posições centrais testadas.
O arquivo foi apenas lido; não foi incluído no Git.

Comandos a partir de `projects3d/frontend`:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-sections.mjs
node scripts/test-sections.mjs "caminho/para/modelo.3dm"
node --test --experimental-test-coverage --test-coverage-include=**/sectionGeometry.ts --test-coverage-include=**/sectionLines.ts --test-coverage-include=**/SectionTool.ts --test-coverage-include=**/section.ts scripts/test-sections.mjs
node scripts/test-selection.mjs
node scripts/test-measurement.mjs
node scripts/test-shadows.mjs
node scripts/test-solar.mjs
node scripts/test-north.mjs
node scripts/test-presentation-settings.mjs
node scripts/stage-vendor.mjs
node node_modules/vite/bin/vite.js build --emptyOutDir false
node --experimental-vm-modules scripts/test-build.mjs
```

O build usa `--emptyOutDir false` para preservar os arquivos existentes. O manifest
gerado seleciona a versão atual; nenhum arquivo antigo foi excluído.

## Relatório de verificação

- Build e TypeScript: PASS.
- Testes: PASS; cobertura dos quatro módulos de corte medidos em 98,35% de
  linhas, 88,04% de ramos e 91,11% de funções. A cobertura não representa toda a aplicação.
- Lint: não há comando de lint configurado; TypeScript e `git diff --check` usados
  nos fontes/documentação. O bundle gerado preserva espaços dos shaders do Three.js.
- Revisão de segurança: nenhum segredo novo; o HTML do painel contém apenas texto
  fixo e as mensagens dinâmicas usam `textContent`. Não há endpoints novos.
- Revisão do diff: alterações limitadas ao visualizador, testes, documentação e build.
- Verificação visual/E2E em navegador: **não concluída**. A ferramenta de controle
  do computador interrompeu o acesso ao Chrome por não conseguir confirmar a URL
  atual para aplicar sua política. Os testes de interação usam uma superfície DOM
  mínima e não substituem a inspeção visual com WebGL.

Antes de considerar a aparência aprovada, conferir manualmente: criar cortes X/Y,
escolher ambos os lados, alternar modos, reposicionar/cancelar, salvar/reabrir cenas
e exportar uma imagem. A implementação e as verificações automatizadas estão
concluídas; a aprovação visual permanece pendente.

Para as linhas, conferir também a engrenagem: cor/espessura em ambos os modos,
visibilidade, preservação dos vazios, oclusão por geometrias à frente e sincronização
dos ajustes ao abrir uma cena. O PNG deve manter os mesmos contornos e a espessura
configurada em pixels da imagem de saída.
