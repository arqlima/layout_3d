# Identidade visual compartilhada

Referência: `novo_estilo/auragen-design-system/auragen-design-system/design-system.html`.

- Geist 300–700: texto e títulos principais.
- Manrope 300–800: títulos de cards e marca.
- Inter: controles e botões.
- Fundo slate `#020617`, vidro branco a 5%, bordas brancas a 10%.
- Acentos índigo `#8484ff` e fúcsia `#e879f9`.
- Botões principais brancos em cápsula; secundários em vidro e controles compactos arredondados.
- Ícones SVG locais em grade 24 × 24, traço fino, sem preenchimento e extremidades arredondadas, seguindo o estilo Lucide da referência.

As fontes foram copiadas dos arquivos WOFF2 presentes na própria referência. Não
há consulta ao Google Fonts para carregá-las. `auragen.css` é carregado pelo
template base do Django e importado pelo frontend do visualizador, que compila
essa mesma fonte para os assets versionados do Vite. Os SVGs são usados pelos
templates e pelo helper `frontend/src/ui/icons.ts`.

As cores das layers pertencem aos modelos enviados e não são alteradas pelo tema.
