# Changelog

## 2.0.0 · 2026-10-13
- Portal reorganizado em módulos JavaScript (ES modules), mantendo as rotas da versão 1.x.
- Base pública passa a ser **agregada** (`data/indicadores.json`): sem coordenadas de estabelecimentos, endereços ou códigos. `data/monitoramento.geojson` (pontos) foi descontinuado.
- Indicador “satisfatória” com critério microbiológico documentado; percentuais sobre amostras com resultado.
- Painel com filtros de ano, mês, Região de Saúde (restringe RAs), RA, motivo e resultado microbiológico; mapa coroplético, ranking e gráficos com tabela acessível.
- WebGIS com limite do DF, 35 RAs, 7 Regiões de Saúde, macrorregiões, hidrografia, legenda dinâmica, escala, retorno à extensão do DF, quatro mapas-base e ficha territorial; “sem dados” distinto de zero.
- Módulos de Regiões Administrativas e Regiões de Saúde com análises e evolução temporal.
- Hidrografia e Território: Rios e Córregos, Lagos e Barragens (visualização), inventário e síntese por RA.
- Catálogo pesquisável com metadados, licença e restrições; downloads Shapefile ZIP (.shp/.shx/.dbf/.prj/.cpg), GeoJSON, CSV e Excel.
- Tabela RA–Região de Saúde v2.0.0 versionada no script de build, compatível com o PDS 2024–2027 (Lago Norte e Varjão na Região Central).
- Leaflet e Chart.js servidos localmente em `vendor/`.
- Script Python reprodutível substitui `build-public-data.ps1`.

## 1.2
- WebGIS inicial com Regiões e Macrorregiões de Saúde e painel de pontos geolocalizados.
