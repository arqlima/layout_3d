# Cores por uso

Na aba **Uso**, ligue **Aplicar cores por uso** para mostrar um seletor junto
a cada categoria reconhecida (COM, EST, PRIV, VAGAS e REP) presente no modelo.
Alterar a cor recolore as superfícies de todos os blocos daquele uso, inclusive
em layers diferentes. Arestas e transparências são preservadas; objetos
desmarcados ou excluídos mantêm o comportamento dos filtros.

A cor por uso tem prioridade sobre a sobreposição geral de superfícies enquanto
a aba Uso estiver ativa. Desligar o interruptor ou mudar de aba recupera a
aparência anterior. A paleta permanece disponível ao voltar à aba. Objetos sem
uso reconhecido mantêm sua aparência anterior.

As cenas guardam a paleta e o interruptor. Cenas antigas abrem com a opção
desligada. A implementação usa cópias de materiais com cache por uso e não
modifica os materiais do arquivo de origem. Os controles reutilizam o painel
de layers existente, sem dependências adicionais.

Verificações:

- RED: `npm.cmd test` falhou por ausência de `setUsageColors`.
- GREEN: `npm.cmd test` passou, incluindo layers diferentes do mesmo uso,
  cores independentes, desativação, mudança de aba, filtros, arestas,
  rejeição de cores inválidas, persistência e restauração de cenas antigas.
- O mesmo comando testa os controles com DOM simulado: visibilidade do
  interruptor, seletores, eventos e restauração sem emitir alterações.
- `npm.cmd run build -- --emptyOutDir false`: TypeScript e Vite aprovados,
  preservando bundles anteriores.
- `npm.cmd run test:build`: oito módulos vinculados com sucesso.
- `.venv/Scripts/python.exe manage.py check`: sem problemas.
- `.venv/Scripts/python.exe manage.py test`: 51 testes aprovados.
- `git diff --check`: sem erros.

Não houve validação visual em navegador nem medição percentual de cobertura.
Os testes de materiais usam Three.js real sem contexto WebGL.
