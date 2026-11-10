# Preservação de cenas nas atualizações do modelo

Salve ou atualize uma das dez cenas antes de substituir o modelo do projeto.
Depois da atualização, abra o mesmo projeto e clique no botão da cena.
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

## Nomes e impressão em lote

Digite um nome (até 40 caracteres, por exemplo `persp1` ou `pav1`) no campo
**Nome da cena** e clique em um espaço vazio para salvar. Para renomear, abra
a cena, altere o campo e clique em **Atualizar**. Esse botão salva o nome e
substitui a vista da cena aberta pelos ajustes atuais. Sem editar o campo,
mantém seu nome. Salvar em outro espaço mantém a cena anterior e seu nome.

Espaços ocupados têm fundo escuro, inclusive quando outra cena está aberta.
A cena ativa recebe uma borda laranja. Nomes longos são abreviados no botão
e podem ser consultados por inteiro ao passar o mouse.

Em **Imprimir**, escolha **Vista atual**, **Todas as cenas salvas** ou
**Escolher cenas…**. Na última opção, marque apenas as cenas desejadas.
**Imprimir / Salvar PDF** abre uma janela com uma cena por página A4 em
paisagem, identificada pelo nome. Escolha a impressora ou salvar como PDF
na janela do navegador. Se necessário, permita a abertura dessa janela.
**Gerar PNG** continua disponível para a vista atual.

As cenas escolhidas são restauradas sequencialmente antes de cada captura;
mapas de exposição são recalculados quando necessário. Ao terminar, inclusive
se uma captura falhar, o visualizador tenta recuperar a vista anterior e seus
ajustes ainda não salvos. Se essa recuperação falhar, a atualização de cenas
fica bloqueada até abrir uma cena novamente. Nenhuma cena salva é sobrescrita
pela impressão.

Validação desta alteração: teste da barra de cenas (nomes, persistência,
marcação de espaços, ordem do lote, seleção vazia e recuperação após falhas),
suíte de seleção/exportação PNG, TypeScript, build Vite, Django check e 51
testes Django aprovados. O teste de nome
falhou antes da implementação, como esperado. Sem teste de ponta a ponta da
janela de impressão: a conexão de automação do navegador estava indisponível.

Validação: testes de recuperação entre URLs, isolamento entre projetos,
preservação dos dados legados, adaptação de layers, câmera e seleção sem
fallback por índice; testes existentes de cenas, cores e estudo solar; teste
da barra de cenas; TypeScript, Vite e vinculação de oito módulos; Django check
e 51 testes Django aprovados. Sem validação visual em navegador.
