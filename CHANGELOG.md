# Changelog

## 0.4.4 (2026-09-13)

- Declare goal IDs unique for Studio form and backend validation. Update the bundled
  manifest schema for the unique-column contract.

- Keep valid configured goals when another row has a duplicate ID, an empty target,
  or an invalid value. Never replace an invalid list with sample goals.
- Report the affected row through the plugin status and `goalErrors` in the state
  response. Keep invalid rows in the saved configuration so they can be corrected.
- Keep an explicitly empty goal list empty. Preserve valid legacy goal migration.
- Verify 20, 21, and 50 goals, restart persistence, contributions, and recovery after
  correcting an invalid row. The supported configuration limit remains 50 goals.

## 0.4.3 (2026-09-13)

- Keep the goals footer in one fixed-height row at the bottom of the overlay.
- Scroll overflowing goals horizontally at 32 pixels per second, with a two-second
  pause at each end before reversing. The logo stays fixed.
- Preserve the scroll position and title animations when goal progress updates.
- Pause on hover or keyboard focus. When effects are disabled or reduced motion
  is requested, use manual horizontal scrolling instead.
- Keep the existing goal configuration and contribution contracts.

## 0.4.2 — 2026-09-13

- Metas de Donate recebem reais no campo Alvo: `52,01` ou `52.01` resulta em R$ 52,01.
- Aceita decimais e valores agrupados em pt-BR (`1.234,56`); valores monetários são
  convertidos para centavos com arredondamento decimal, sem erro de ponto flutuante.
- Metas antigas mantêm o campo Alvo anterior, em centavos para Donate. O novo Alvo
  tem prioridade quando preenchido. Salvar outras configurações não multiplica os valores.
- Subs e Bits continuam em quantidade e aceitam alvos fracionados.
- Preservados o cofre, cronômetro, totais, deduplicação e contratos dos blocos em centavos.
- Testes de precisão, conclusão por centavo, configuração legada e reinício.
- Rollback para 0.4.1 ignora o novo Alvo: atualize Alvo anterior antes de voltar
  caso tenha alterado ou criado metas usando o campo em reais.

## 0.4.1 — 2026-09-12

- Repositório independente em `DerekWolfie/catopanda-subathon`.
- Metadados de autor, repositório, homepage e releases no manifest.
- Catálogo público com SHA-256 e preservação das versões anteriores.
- CI para Windows e Linux e workflow de release por tag, com ZIP, checksum e catálogo.
- Testes de empacotamento e publicação simulada; instruções de operação e publicação.
- Preservados o pacote `io.github.osc-flow-studio.catopanda-subathon`, o ID interno,
  os blocos, o formato persistido, a deduplicação e a configuração das metas.

## 0.4.0

- Compatibilidade com OSC Flow Studio 0.5.x e API de plugins 1.
- Identidade de pacote e empacotador oficial do SDK, com ZIP determinístico e SHA-256.
- Cancelamento por `ctx.signal`, encerramento de SSE/sockets e espera pelas gravações
  pendentes antes de liberar a instância.

## 0.3.1

- Configuração própria para Sub Prime.
- Porta ocupada deixa apenas os overlays indisponíveis; cronômetro e blocos continuam.
- Template integrado ao gatilho de doação única do LivePix 1.1.0.

## 0.3.0

- LivePix separado do subathon e conectado por flows.
- Contribuições por fórmula e eventos de aviso do cronômetro.
- Sete overlays com efeitos e camada própria de alertas.
