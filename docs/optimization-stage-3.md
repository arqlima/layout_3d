# Etapa 3 — carregamento e memória

O estado anterior está na tag `pre-optimization-stage3-2026-11-12`, commit `f07995f`.
O backup local `.backups/pre-stage3-2026-11-12/` contém banco SQLite consistente,
uploads e build anterior. `manifest.json` registra tamanhos e SHA-256.
Os ZIPs passaram por verificação de CRC e o banco por `integrity_check`.
Para recuperar o código, preservar o trabalho posterior e criar uma branch a partir dessa tag.
Para recuperar dados, parar o servidor e conferir os backups antes da restauração.

## Arestas

O carregamento compartilhado do projeto prepara a geometria e os metadados primeiro.
A vista 3D solicita as arestas quando abre. A Simulação usa o modelo disponível sem
disparar esse processamento visual. O carregador Rhino chamado diretamente continua
incluindo as arestas por padrão.

Cada peça conserva um helper independente, associado ao GUID e à layer do objeto.
Peças com a mesma `BufferGeometry` reutilizam a geometria das arestas. Materiais das
arestas são compartilhados por opacidade. Chamadas concorrentes ou repetidas usam
a mesma preparação. O cálculo cede à interface após aproximadamente 8 ms de trabalho
entre peças. Uma peça isolada muito complexa ainda pode exceder esse intervalo.

O benchmark compara a função anterior, lida da tag de restauração, com a função nova.
Usa caixas sintéticas, em uma execução por cenário.

| Cenário | Tempo anterior | Tempo novo | Buffers anteriores | Buffers novos |
| --- | ---: | ---: | ---: | ---: |
| 32 peças, geometria compartilhada | 4,71 ms | 0,84 ms | 32 | 1 |
| 1.024 peças, geometria compartilhada | 46,48 ms | 7,03 ms | 1.024 | 1 |
| 32 peças, geometrias distintas | 3,32 ms | 2,08 ms | 32 | 32 |
| 1.024 peças, geometrias distintas | 41,08 ms | 62,99 ms | 1.024 | 1.024 |

Nas 1.024 peças compartilhadas, o buffer de posições das arestas passou de 294.912
para 288 bytes. Isso mede apenas esses buffers. Com geometrias distintas, o teste
novo cedeu quatro vezes ao event loop e levou mais tempo total. Essa escolha melhora
a capacidade de resposta durante a preparação, com custo de agendamento.
Os ganhos de abertura dependem da quantidade de geometria realmente compartilhada.
Tempos de download e decodificação de modelos reais exigem avaliação específica.

Reprodução em `projects3d/frontend` com um nome novo para o resultado

```powershell
node scripts/benchmark-edges.mjs ../../.backups/pre-stage3-2026-11-12/edges-recheck.json
```

## Posse e descarte de recursos

O visualizador libera os recursos da cena demonstrativa ao substituí-la, incluindo
geometrias, materiais e texturas. Referências compartilhadas com a cena seguinte
são preservadas. Recursos repetidos são liberados uma única vez por descarte.
O descarte também considera texturas de uniforms, materiais de profundidade,
instâncias, skeletons e texturas de ambiente.

O modelo compartilhado entre abas usa `ownsResources: false`. Ao encerrar o
visualizador, os materiais originais são restaurados, os cortes são removidos
e o material de profundidade do visualizador é desassociado. A cena compartilhada
pode ser montada por outro visualizador. O contexto WebGL encerrado é liberado.

## Imagens

As prévias WebP são geradas sob demanda e guardadas no storage de mídia.
Os limites do maior lado são 240 px para miniaturas, 640 px para cards e 1.920 px
para a capa. Qualidade WebP é 85, mantendo proporção, transparência, orientação
EXIF e perfil ICC de imagens RGB/RGBA. Imagens menores conservam suas dimensões.
As imagens principais da galeria continuam vinculadas aos originais.

As rotas exigem login e conferem projeto, imagem, variante e revisão do arquivo.
O cache HTTP é privado e usa ETag. Substituições pelo upload geram uma nova URL.
Se a conversão falhar ou a imagem for animada, a resposta encaminha ao original.
Variantes de revisões anteriores ficam no cache de mídia para limpeza futura.

Amostra com uma imagem institucional PNG de 3.341.828 bytes, usando storage em memória

| Variante | Dimensões | Bytes | Primeira geração | Leitura do cache |
| --- | --- | ---: | ---: | ---: |
| Miniatura | 192 × 240 | 10.218 | 111,05 ms | 0,10 ms |
| Card | 512 × 640 | 63.864 | 125,99 ms | 0,12 ms |
| Capa | 1.440 × 1.800 | 468.276 | 488,69 ms | 0,11 ms |

Os tempos de cache dessa amostra excluem disco e rede. A primeira visita pode
aguardar a geração. O tamanho final depende da imagem.

## Validação

- Django check e 57 testes, incluindo cache, login, isolamento por projeto, revisão,
  orientação, transparência, perfil de cor e fallback.
- 15 scripts frontend, incluindo geometria compartilhada, idempotência, GUIDs,
  preservação de posições e descarte com referências compartilhadas.
- Chrome/RTX 2060 com 19 verificações anteriores e sete verificações da etapa 3,
  usando um Rhino sintético e o carregador real, troca de cena, textura, corte,
  reabertura e liberação do contexto WebGL.
- Build de produção e TypeScript. Sem migrações ou dependências adicionais.
- Verificação de alterações autorais e segurança das rotas. Lint e cobertura global
  não foram executados porque o projeto não tem essas verificações configuradas.
- Avaliação visual com modelos de clientes e medição da memória total do processo
  não foram realizadas. A economia medida de buffers refere-se ao cenário sintético.

Os resultados completos ficam no backup local em `edges.json`, `images.json` e
`browser-final.json`. A execução no Chrome pode ser repetida com

```powershell
node scripts/benchmark-viewer.mjs ../../.backups/pre-stage3-2026-11-12/browser-recheck.json --verify --stage3
```
