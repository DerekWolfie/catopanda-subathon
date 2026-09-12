# SDK incorporado

`ofs-package.mjs` e `community-plugin-manifest.schema.json` são cópias sem alterações
do SDK exportado pelo OSC Flow Studio **0.5.0**. Servem para validar, empacotar e
gerar o catálogo; não são incluídos no ZIP instalado.

Ao atualizar o SDK, substitua os dois arquivos juntos, revise o contrato de runtime,
ajuste a faixa `engines.oscFlowStudio` e execute `npm run package`.
