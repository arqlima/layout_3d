# Preservação de cenas nas atualizações do modelo

Salve ou atualize uma das dez cenas antes de substituir o modelo do projeto.
Depois da atualização, abra o mesmo projeto e clique no número da cena.
Não há salvamento automático dos ajustes ainda não registrados em uma cena.

As cenas passam a usar uma chave estável por projeto, baseada no endpoint da
tabela de objetos, em vez do endereço do arquivo 3D. Trocar o arquivo, inclusive
pela importação de uma pasta atualizada, mantém as cenas no mesmo navegador.
Criar outro projeto resulta em um armazenamento separado.

Ao abrir uma cena de outra versão:

- Câmera, cores, cortes, filtros e parâmetros solares são reaplicados.
- A visibilidade das layers é associada pelo nome, independentemente da ordem.
  Layers novas mantêm seu estado atual; layers removidas são ignoradas.
- Seleções são recuperadas somente pelos IDs dos objetos que ainda existem.
  Índices antigos não são usados para selecionar outra geometria por engano.
- Mapas de exposição salvos são recalculados sobre a geometria atual pelo
  fluxo de restauração já existente.

O armazenamento legado é copiado automaticamente sem remover suas chaves.
Na primeira recuperação, prioriza-se a versão do arquivo atual; na ausência
dela, procura-se uma entrada válida do mesmo projeto na ordem inversa das
chaves do navegador. Se houver várias versões antigas, elas não são mescladas
nem apagadas. Uma chave estável existente nunca é sobrescrita pela migração.
Dados inválidos são ignorados. Falhas de gravação continuam sendo informadas
pela barra de cenas.

As cenas continuam no armazenamento local: não são sincronizadas entre
computadores ou navegadores e não sobrevivem à limpeza desses dados.

Validação: testes de recuperação entre URLs, isolamento entre projetos,
preservação dos dados legados, adaptação de layers, câmera e seleção sem
fallback por índice; testes existentes de cenas, cores e estudo solar; teste
da barra de cenas; TypeScript, Vite e vinculação de oito módulos; Django check
e 51 testes Django aprovados. Sem validação visual em navegador.
