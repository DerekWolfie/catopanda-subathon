# Changelog

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
