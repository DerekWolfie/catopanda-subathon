# CatOPanda Subathon

Cronômetro persistente, metas de Donate, Subs e Bits e sete overlays para OBS,
integrados aos flows do **OSC Flow Studio 0.5.x**. Recebe contribuições de Twitch,
LivePix e outros gatilhos por ações e fórmulas.

| Contrato | Valor |
| --- | --- |
| Versão do plugin | 0.4.6 |
| OSC Flow Studio | `>=0.5.0 <0.6.0` |
| Pacote | `io.github.osc-flow-studio.catopanda-subathon` |
| ID de blocos e configurações | `catopanda-subathon` |
| Runtime SDK | API 1 |
| Repositório | [DerekWolfie/catopanda-subathon](https://github.com/DerekWolfie/catopanda-subathon) |

## Instalação

1. Baixe `io.github.osc-flow-studio.catopanda-subathon-0.4.6.zip` da release ou gere
   localmente. No Studio, abra **Integrações → Install from zip**, revise e confirme.
2. Configure porta, conversões de tempo, metas, efeitos e tema; ative a integração.
3. Importe os templates **Twitch pronta** e **acompanhar no console** conforme necessário.
   Para doações LivePix, instale também o [plugin LivePix](https://github.com/OSC-Flow-Studio/livepix-plugin)
   e importe **CatOPanda Subathon: LivePix pronta**. Os templates chegam desligados;
   revise e ative cada flow.
4. Adicione as URLs dos overlays como Browser Sources no OBS em 1920 × 1080.
   A ação **CatOPanda: ler estado** devolve as URLs em `urls.*`.

Veja [blocos, regras e as sete URLs dos overlays](plugin/README.md).
O LivePix é opcional: o CatOPanda também recebe contribuições por outros gatilhos.
Nenhuma credencial de pagamento é necessária neste plugin.

Na versão 0.4.4, **Metas → Alvo (R$ para Donate)** recebe reais: `52,01` ou `52.01`
mostra **R$ 52,01**, e `52` significa R$ 52. Subs/Bits usam quantidade e também aceitam
decimais. Nas metas antigas, **Alvo anterior** preserva o valor salvo em centavos;
preencha o novo Alvo para alterar. Em metas novas, deixe Alvo anterior em `0`.
Os blocos e eventos do LivePix continuam em centavos, sem alterar os flows existentes.

## Catálogo de atualizações

Depois da primeira release pública, adicione esta fonte em **Integrações → Sources**:

```text
https://github.com/DerekWolfie/catopanda-subathon/releases/latest/download/listing.json
```

Abra **Catalog**, escolha CatOPanda Subathon e confirme. O catálogo mantém as versões
anteriores para rollback. Uma atualização em uso é preparada para o próximo reinício
do backend; conclua o reinício oferecido pelo Studio.

A identidade `io.github.osc-flow-studio.catopanda-subathon` foi preservada da versão
0.4.0, mesmo com o repositório em `DerekWolfie`. Não altere esse identificador nem
`id=catopanda-subathon`: isso criaria outra integração. A 0.4.1 acrescentou distribuição
pelo GitHub e não muda o formato do estado, a chave do cofre, a deduplicação ou as
configurações legadas. O Studio pode adotar a instalação local mantendo esses dados.

A URL acima só fica disponível após publicar a primeira release. `dist/listing.json`
é uma prévia local que aponta para os futuros artefatos da release.

## Desenvolvimento e pacote

Requisitos: Node.js 22 ou superior e npm. Schema e empacotador oficiais do SDK 0.5.0
estão incluídos em `sdk/`; este repositório funciona sem a pasta original do SDK.

```powershell
cd J:\Projetos\Portfolio\catopanda-subathon
npm ci
npm run package
npm run catalog
```

`npm run package` executa a validação do schema, as regras de pacote e os testes
antes de gerar:

- `dist/io.github.osc-flow-studio.catopanda-subathon-0.4.6.zip`
- `dist/io.github.osc-flow-studio.catopanda-subathon-0.4.6.zip.sha256`

`npm run catalog` gera `dist/listing.json`, com tamanho e SHA-256 do ZIP real.
O ZIP contém somente `plugin/`, incluindo os assets dos overlays, com o manifest
na raiz. Os scripts de publicação e as dependências de desenvolvimento ficam fora.

```powershell
Get-FileHash dist/io.github.osc-flow-studio.catopanda-subathon-0.4.6.zip -Algorithm SHA256
Get-Content dist/io.github.osc-flow-studio.catopanda-subathon-0.4.6.zip.sha256
```

Use `npm run check` para validar sem gerar artefatos. Para inspecionar os overlays
com dados de demonstração:

```powershell
npm run dev
```

O preview usa `http://127.0.0.1:8798`. Se a porta já estiver ocupada pelo Studio,
escolha outra para o preview: `$env:CATOPANDA_PORT = '8799'`. Para contribuições
demonstrativas a cada sete segundos, defina `$env:CATOPANDA_DEMO = '1'` antes de
executar `npm run dev`. O estado do preview fica em memória.

## Publicação no GitHub

Responsável: mantenedor com escrita em `DerekWolfie/catopanda-subathon`. O repositório
precisa ser público para o Studio acessar catálogo e ZIP. Habilite GitHub Actions;
o workflow utiliza `GITHUB_TOKEN` com `contents: write`. Não precisa de GitHub Pages
nem de registro npm: este é um pacote ZIP para o gerenciador do OSC Flow Studio.

Primeiro envio, usando o `origin` já configurado:

```powershell
npm ci
npm run package
git add .
git commit -m "Prepare CatOPanda Subathon 0.4.6 package"
git push -u origin main
```

Aguarde **Validate plugin** passar no Windows e Linux. Depois publique a tag:

```powershell
git tag v0.4.6
git push origin v0.4.6
```

O workflow **Release OSC Flow Studio package** valida novamente, recupera o catálogo
da última release e preserva seu histórico. Cria um draft com ZIP, SHA-256 e
`listing.json`, e publica os três juntos. Assim o catálogo público já encontra o ZIP.
A URL estável passa a servir o catálogo da nova release.

Conclua a publicação somente quando o workflow estiver verde, os três assets forem
públicos e o hash do ZIP coincidir com o catálogo. Adicione a fonte no Studio 0.5.0,
instale o pacote e confira cronômetro, uma contribuição e um overlay no OBS.

Pare se falhar validação, divergir a tag da versão ou faltar o catálogo anterior.
Releases existentes não são sobrescritas. Se a execução parar após criar o draft,
confira seus três assets no GitHub e publique esse draft para concluir a release.

### Nova versão

Durante o desenvolvimento, descreva cada mudança em `## Unreleased` no `CHANGELOG.md`.
Para lançar, um comando prepara tudo no working tree:

```powershell
npm run release:prepare -- patch     # ou minor, major, ou a versão exata: 0.4.6
```

O script:

1. grava a mesma versão em `package.json`, `package-lock.json`, `plugin/manifest.json`,
   `PLUGIN_VERSION` em `plugin/index.mjs` e nas linhas de versão dos dois READMEs
   (trechos históricos, como "Na versão 0.4.4", ficam como estão);
2. transforma `## Unreleased` em `## X.Y.Z (data)` e abre um `## Unreleased` vazio;
   recusa continuar se não houver nada descrito;
3. roda `npm run package` (schema, regras de pacote e testes) e `npm run catalog`;
4. mostra as notas que vão para a release e os comandos de commit e tag.

Ele não faz commit, tag nem push. Recusa uma versão menor que uma tag existente e
avisa, com os comandos para corrigir, quando a tag da versão já existe. Use
`--dry-run` para só ver o que mudaria e `--skip-build` para pular o empacotamento.
Se a validação falhar, corrija e rode o mesmo comando de novo: ele é idempotente.

Um teste falha sempre que algum desses arquivos fica com versão diferente, então uma
troca manual incompleta não chega à tag. A release no GitHub mostra só a seção da
versão no `CHANGELOG.md`. Uma versão já distribuída não deve receber outro ZIP com
bytes diferentes.

Para gerar manualmente um catálogo com histórico, use a cópia pública anterior:

```powershell
npm run catalog -- --previous caminho/para/listing-anterior.json
```

Em atualizações, não publique um catálogo gerado sem o histórico. O workflow recupera
esse histórico automaticamente e interrompe a publicação se não conseguir lê-lo.

## Validação

Os testes cobrem contribuições, deduplicação, persistência, metas legadas, cronômetro,
Prime, rotas HTTP/SSE, porta ocupada e encerramento com conexões abertas. Também
conferem ZIPs reproduzíveis, hashes do catálogo, preservação do histórico e publicação
com GitHub simulado. A execução local não publica releases nem altera o Studio aberto.
CI remoto e instalação pela fonte pública precisam ser conferidos após a publicação.
