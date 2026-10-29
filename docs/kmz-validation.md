# Localização por KMZ — implementação e validação

Requisitos derivados da solicitação: KMZ opcional; com KMZ, extrair coordenadas
e impedir edição manual; sem KMZ, exigir latitude e longitude. O usuário escolheu
o centro dos limites geográficos quando houver vários pontos ou polígonos.

## Evidências

- RED: `manage.py test projects3d.test_location` executou os 7 testes iniciais,
  com 4 falhas e 3 erros decorrentes da ausência da funcionalidade. Checkpoint:
  `ba01d13`.
- GREEN final: `.venv/Scripts/python.exe manage.py test --verbosity 1`:
  **51 testes aprovados**, incluindo 11 testes específicos de localização.
- `manage.py check`: sem problemas. `makemigrations --check --dry-run`:
  nenhuma alteração pendente. Migração `projects3d.0005` aplicada com sucesso,
  após backup SQLite em `media/backups/` (fora do Git).
- `npm.cmd run build -- --emptyOutDir false`: build e TypeScript aprovados.
  Arquivos de builds anteriores foram preservados.
- `node scripts/test-location.mjs` e `node scripts/test-solar.mjs`: aprovados.
- Cobertura de linhas com a biblioteca padrão, sem instalar dependências:
  `python -m trace --count --missing --summary --coverdir media/kmz-coverage
  manage.py test projects3d.test_location --verbosity 0`:
  `location.py` **91%**, `forms.py` **90%**, `folder_import.py` **66%**.
  Esta última medição cobre apenas os 11 testes de localização, não a suíte
  completa de importação já incluída nos 51 testes aprovados.
- Verificação de whitespace do código-fonte: aprovada. Os chunks gerados
  pelo Vite preservam espaços dos shaders do Three.js; esses avisos do
  `git diff --cached --check` não foram corrigidos manualmente nos bundles.

## Garantias dos testes

| Comportamento | Evidência |
| --- | --- |
| Latitude e longitude obrigatórias sem KMZ; zero e limites válidos aceitos | `LocationFormTests` |
| KMZ substitui valores manuais, inclusive valores malformados | `LocationFormTests` |
| Centro dos limites de polígonos e passagem pelo antimeridiano | `LocationFormTests` |
| Rejeição de ZIP/XML inválidos, ausência de geometria, entidades, limites de tamanho e coordenadas inválidas | `LocationFormTests` |
| Criação, retenção e substituição de KMZ; remoção exige coordenadas manuais | `LocationIntegrationTests` |
| Importação e substituição por pasta; configuração do visualizador | `LocationIntegrationTests` |
| Painel solar usa coordenadas do cadastro e bloqueia mudanças com KMZ | `scripts/test-location.mjs` |

## Revisão e limites

O leitor não extrai ZIP no disco, não resolve links externos e rejeita DTD e
entidades antes de analisar XML. O backend usa os valores extraídos mesmo se o
cliente adulterar os campos. Autenticação e CSRF existentes foram preservados.
O administrador utiliza a mesma validação do cadastro.

Não houve validação visual em navegador nem lint independente (não há comando
de lint configurado). Os testes do painel usam elementos simulados; não são
testes de navegador. Projetos antigos sem localização preservam o comportamento
solar anterior até o preenchimento das coordenadas no cadastro.
