# Visualização de projetos 3D

O Django mantém os apps `accounts` (login e cadastro) e `projects3d` (cadastro,
edição, exclusão e visualização). O visualizador de `novo_input/Visualizacao_3d`
foi integrado ao app `projects3d`, sem servidor frontend separado em execução.

## Executar

```powershell
.venv/Scripts/python.exe manage.py migrate
.venv/Scripts/python.exe manage.py runserver
```

Abra `/accounts/login/` e acesse a lista de projetos. Em **Novo projeto**, selecione
a pasta preparada, confira os arquivos identificados e clique em **Salvar projeto**.
O nome é preenchido a partir da pasta e pode ser alterado antes de salvar.

```text
Projeto 01/
├── massa.3dm             # obrigatório
├── objetos.csv           # obrigatório
├── resumo.txt            # opcional; também aceita resumo.csv
├── diretrizes.csv        # opcional
├── localizacao.mp4       # opcional
├── capa.png              # opcional; PNG, JPEG ou WebP
├── 01.png                # imagens numeradas; também aceita imagens/01.png
├── 02.png
└── fontes/               # ignorada, junto com arquivos não reconhecidos
```

Somente os arquivos reconhecidos são enviados pelo seletor de pasta. A plataforma
grava uma cópia independente em `media/projects3d/projetos/<id>/`; depois de
concluir a importação, mover ou excluir a pasta original não afeta essa cópia.
Pastas com o mesmo nome geram projetos distintos. Arquivos de clientes ficam fora
do Git. Não há acesso direto a caminhos do computador pelo servidor.

O importador exige o par `massa.3dm` e `objetos.csv`, identifica automaticamente as
colunas `Id`, `Area`, `Uso`, `Cota` ou as colunas da exportação Rhino descritas abaixo,
e valida GUIDs, números e imagens antes de copiar. CSV vazio ou inválido impede a
importação. O resumo aceita linhas `indicador;valor`, com valores vazios e cabeçalho
opcional `indicador;valor`. Diretrizes usam CSV com uma linha de cabeçalhos, seguida
dos valores. Resumo e diretrizes aceitam UTF-8 ou Windows-1252 e até 10 MB cada.

Ao abrir um projeto, a aba **Capa** é exibida inicialmente. As cinco abas ficam
no cabeçalho: **Capa**, **Localização** (vídeo), **Diretrizes** (indicadores do
resumo TXT/CSV e tabela complementar), **Estudo de massa** (modelo 3D) e
**Conceito** (primeira imagem em destaque e miniaturas na ordem numérica abaixo;
selecione uma miniatura para trocar a imagem principal). Sem arquivos opcionais, a aba informa
a ausência do conteúdo. Em Diretrizes, os números são apresentados no padrão
brasileiro com até duas casas decimais; os valores originais são preservados.
O modelo é carregado apenas ao abrir Estudo de massa. Ao sair da aba, a
renderização é pausada, preservando a câmera e os filtros; o vídeo também é
pausado ao sair de Localização. As setas do teclado, Home e End navegam pelas abas.

Em **Atualizar pasta**, selecione e confira o novo conjunto, marque a confirmação
e salve. A nova importação substitui o conjunto completo: opcionais ausentes são
removidos. Os arquivos atualizados são gravados em
`media/projects3d/projetos/<id>/versoes/<identificador>/`, sem sobrescrever os
arquivos em uso. Os arquivos antigos são removidos após confirmar a transação;
se houver falha, os dados anteriores são preservados e a cópia parcial é desfeita.
Ao excluir um projeto, seus arquivos e imagens também são removidos.

O link **Usar cadastro individual** mantém o fluxo anterior para enviar:

- Modelo `.3dm`, `.glb` ou `.gltf` (para glTF, os recursos devem estar embutidos;
  use GLB quando houver texturas ou buffers externos).
- CSV UTF-8 separado por `;`, com um GUID original do Rhino por linha.
- Vídeo de localização `.mp4`, em codificação compatível com o navegador.

Os uploads individuais mantêm os caminhos anteriores em `media/projects3d/`.
Os projetos existentes continuam disponíveis após as migrações; use **Atualizar
pasta** para adicionar capa, resumo e imagens a eles.

O mapeamento padrão do CSV é:

```json
{
  "id": "ID_OBJETO",
  "area": "AREA_BASE_M2",
  "areaFallback": "AREA_CURVA_M2",
  "use": "USO",
  "elevation": "COTA_BASE_M"
}
```

Altere os valores no cadastro para os cabeçalhos do seu arquivo. Remova
`areaFallback` se não houver essa coluna. Áreas e cotas aceitam vírgula ou ponto
decimal; células vazias ficam sem valor. IDs inválidos ou repetidos e números
inválidos impedem salvar a tabela. Os usos reconhecidos são `COM`, `EST`, `PRIV`,
`VAGAS` e `REP`. IDs sem correspondência permanecem sem dados; apenas objetos visíveis
com IDs correspondentes entram nos totais. Em glTF/GLB, o exportador precisa
preservar os GUIDs em `extras.objectId` ou `extras.id` para associar o CSV.

Em **Estudo de massa**, estão disponíveis seleção de peças, layers do Rhino, filtro de
cotas, filtro de usos com totais, enquadramento, vistas padrão e projeções.
A aba **Localização** reproduz o vídeo e pausa ao retornar ao estudo de massa.
Sem modelo, ou quando seu carregamento falha, aparece uma cena demonstrativa
identificada na interface. Sem CSV, a navegação e os filtros geométricos continuam
funcionando. Modelos grandes são processados no navegador; o carregamento 3DM
depende das malhas salvas pelo Rhino.

## Alterar o visualizador

O código editável está em `projects3d/frontend/src/`: `viewer/` concentra Three.js,
`ui/` a interface, `data/` a integração com o Django e `styles/` a apresentação.
`novo_input/` permanece como referência original; seus arquivos privados não são
copiados para os estáticos.

Com Node.js 22.12+ e pnpm no PATH:

```powershell
cd projects3d/frontend
pnpm install --frozen-lockfile
pnpm build
```

O build verifica TypeScript, copia somente o runtime público do Rhino e gera os
arquivos em `projects3d/static/projects3d/viewer/`. Esses arquivos são entregues
com a aplicação; Node e pnpm são necessários apenas para recompilar. Após alterar
o CSV ou o vídeo pelo cadastro, não é necessário recompilar.

## Validar

```powershell
.venv/Scripts/python.exe manage.py check
.venv/Scripts/python.exe manage.py test
.venv/Scripts/python.exe manage.py makemigrations --check --dry-run
```

### Sele??o por Nome, Uso ou Grupo

No Estudo de massa, os bot?es acima da cena atual definem como agrupar a lista
lateral e a sele??o ao clicar no 3D. **Nome** seleciona a layer clicada;
**Uso** seleciona todas as layers com o mesmo uso; **Grupo** seleciona todas as
layers do mesmo grupo. As marca??es s?o compartilhadas entre os tr?s modos;
um checkbox parcialmente marcado indica que apenas parte das layers daquela
categoria est? marcada.

Os nomes seguem `grupo-nome-uso`, por exemplo `00-Res_des-PRIV`: grupo `00`,
nome `Res_des`, uso `PRIV`. O nome pode conter h?fens e sublinhados; os usos
ignoram diferen?as entre mai?sculas e min?sculas. Layers fora dessa conven??o
continuam na lista Nome e aparecem em **Sem uso** e **Sem grupo** nos outros modos.

**Marcar todos** e **Marcar nenhum** alteram todas as marca??es. Objetos
desmarcados ficam esmaecidos; ligue **Ocultar desmarcados** para remov?-los da
vista, inclusive suas arestas. Desligar o interruptor restaura o esmaecimento.
O filtro de cotas continua sendo respeitado.

Para testar a sele??o sem precisar de um contexto WebGL, use Node.js 22.13+
e execute `pnpm test` em `projects3d/frontend`.
