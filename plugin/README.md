# CatOPanda Subathon 0.4.7

The LivePix template now sends an accounting receipt after Register Donate. Update
LivePix and its dashboard to the recovery-capable build first. Existing flows need
**LivePix: confirmar contabilização** connected after Register Donate, with `eventKey`
set to `{{ $trigger.metadata.eventKey }}` and `accounted` set to
`{{ $json.accepted || $json.duplicate }}`. Keep the accounting ledger intact when
recovering donations; a repeated key returns `duplicate: true` without adding time.

Instale este ZIP por **Integrações → Install from zip** no OSC Flow Studio 0.5.x. O pacote é
`io.github.osc-flow-studio.catopanda-subathon`. Para receber doações do LivePix, instale também o plugin **LivePix** 2.0.0 (ZIP
separado), conectado ao OSC LivePix Dashboard, e importe o template **CatOPanda Subathon:
LivePix pronta**. Com o início do subathon configurado no plugin LivePix, só doações a
partir dele chegam ao cronômetro.

## Situação das metas e painel do streamer

Uma meta **alcançada** (o total cruzou o alvo) agora tem uma situação separada, que diz
se o combinado já foi feito:

| Situação | Quando usar | Nos overlays |
|---|---|---|
| Pendente | Alcançada, mas ainda não começou. É a situação de toda meta ao atualizar. | "Alcançada", com o check. |
| Em andamento | Está acontecendo agora. **Só uma meta por vez**: iniciar outra devolve a anterior para Pendente. | Destaque na cor da meta, selo "Em andamento", primeiro lugar no Totem e na Lista. |
| Concluída | Já foi cumprida na live. | Riscada e esmaecida; vai para o fim da Lista. |

Uma meta ainda não alcançada também pode ser colocada em andamento ou concluída, caso
você decida cumpri-la antes.

Três jeitos de mudar a situação, todos com as mesmas regras:

1. **Painel no navegador**: abra `http://127.0.0.1:8798/dashboard`. Mostra a meta em
   andamento com os botões **Concluir meta** e **Voltar para pendente**, a lista de
   metas com progresso, filtros (alcançadas pendentes, em andamento, a caminho,
   concluídas), busca pelo título e um seletor Pendente / Em andamento / Concluída em
   cada meta. **Concluir todas as alcançadas** pede um segundo clique para confirmar.
   No fim da página ficam os endereços de todos os overlays, com botão de copiar. O
   mesmo painel controla o cronômetro e testa os alertas (veja abaixo). Cadastrar,
   editar e reordenar metas continua na aba **Metas**: a API de plugins do Studio só lê
   a configuração, então o painel não grava metas.
2. **Bloco CatOPanda: definir situação da meta**: escolha a meta numa lista das metas
   cadastradas (sem digitar ID) e a situação. A lista traz três atalhos: **a meta em
   andamento agora**, **a próxima meta alcançada e pendente** e **todas as metas
   alcançadas**.
3. **Template "situação das metas pelo chat"**: `!metainicia` coloca em andamento a
   próxima meta alcançada e `!metaconcluida` conclui a que está em andamento. Só
   broadcaster e moderadores. Importa desligado.

O gatilho **CatOPanda: situação da meta alterada** dispara a cada mudança (filtre por
Em andamento, Concluída ou Pendente) e entrega `metadata.title`, `metadata.status`,
`metadata.statusLabel`, `metadata.previousStatus` e `metadata.activeTitle`. Use-o para
avisar o chat ou trocar de cena.

A situação fica no mesmo cofre do cronômetro e dos totais e sobrevive a reinícios. A
atualização não altera a configuração, os totais, o cronômetro, o histórico nem as chaves
de deduplicação. Se você voltar para a 0.4.6, totais e cronômetro continuam intactos,
mas a situação das metas se perde: a versão antiga não conhece esse campo. **zerar
estado** ganhou o escopo **Somente situação das metas**; **Somente totais** não mexe na
situação.

### Cronômetro pelo painel

A seção **Cronômetro** do painel mostra o tempo restante e se ele está correndo,
pausado ou encerrado. Tem **Pausar/Retomar**, ajustes rápidos (−10, −5 e −1 min; +1,
+5 e +10 min; +1 h) e um campo com unidade (minutos, horas ou segundos, aceita `1,5`)
para **Adicionar**, **Subtrair** ou **Definir**. **Definir** e **Restaurar valor
inicial** substituem o tempo da live, então pedem um segundo clique em até 4 segundos;
restaurar também pausa o cronômetro. Valores inválidos são recusados antes de qualquer
mudança. Como no bloco **controlar cronômetro**, esses ajustes não entram no total
"adicionado na live".

### Testar alertas

A seção **Testar alertas** envia um exemplo de cada aviso: tempo adicionado (Donate de
R$ 10, Sub Tier 1, 500 Bits), meta alcançada, meta em andamento, meta concluída, reta
final e subathon encerrado. O teste aparece como o aviso real: no overlay Alertas e nas
fontes com `?alerts=1`, e com o destaque e o brilho nos outros overlays. Os testes de
meta usam a meta em andamento ou, se não houver, a próxima a alcançar. Nada é gravado:
cronômetro, totais, metas e histórico não mudam, e nenhum flow dispara. Um efeito
desligado na aba **Overlays** também não aparece no teste. Os eventos de teste levam
`test: true` para leitores externos de `/events` ou `/api/poll`.

Para quem lê o estado por fórmula: `goals[].completed` e o gatilho **meta alcançada**
(antes chamado "meta concluída", mesmo tipo de bloco) continuam significando "alvo
cruzado". As novidades são `goals[].reached`, `goals[].execution` (`pending`,
`in-progress`, `done`), `goals[].stage` (`open`, `reached`, `in-progress`, `done`) com
`stageLabel`, `activeGoal` e `goalCounts`.

## Depois de ativar

Para acompanhar atualizações, depois da primeira release pública, adicione esta fonte
em **Integrações → Sources** e abra **Catalog**:

```text
https://github.com/DerekWolfie/catopanda-subathon/releases/latest/download/listing.json
```

O pacote preserva IDs de blocos, configurações, metas e estado das versões anteriores.
Ao atualizar uma instalação em uso, conclua o reinício solicitado pelo Studio.

1. Ajuste porta, conversões, metas, efeitos e tema nas abas da configuração. Salvar
   reinicia o plugin com os valores novos; não é preciso desligar e ligar.
2. Importe os templates que fizerem sentido: **Twitch pronta** (Bits, Sub, Resub e Sub
   presenteado), **LivePix pronta** (cada pagamento vira Donate) e **acompanhar no
   console** (para testar as regras antes da live). Os templates chegam desligados;
   revise e ative cada flow.
3. No OBS, adicione as URLs abaixo como Browser Source em 1920 × 1080. A ação
   **CatOPanda: ler estado** também devolve as URLs em `urls.*`.

## Rotas na porta padrão 8798

| Visual | URL |
|---|---|
| Palco CatOPanda | `http://127.0.0.1:8798/overlay/brb-stage` |
| Rodapé de metas | `http://127.0.0.1:8798/overlay/goals-footer` |
| Totem editorial | `http://127.0.0.1:8798/overlay/goals-totem` |
| Placar triplo | `http://127.0.0.1:8798/overlay/progress-triple` |
| Pílula dupla | `http://127.0.0.1:8798/overlay/progress-pill` |
| Dígitos gigantes | `http://127.0.0.1:8798/overlay/timer-giant` |
| Alertas | `http://127.0.0.1:8798/overlay/alerts` |
| Meta em andamento | `http://127.0.0.1:8798/overlay/goals-active` |
| Lista de metas | `http://127.0.0.1:8798/overlay/goals-list` |
| Painel do streamer (navegador, não é overlay) | `http://127.0.0.1:8798/dashboard` |

**Meta em andamento** mostra um único cartão com a meta em andamento e some quando não
há nenhuma. O cartão ocupa a largura da Browser Source até 960 px; uma fonte de
900 × 240 fica justa.

**Lista de metas** é vertical e rola sozinha, subindo e descendo com uma pausa em cada
ponta. A ordem é: a meta em andamento, depois as que ainda não foram concluídas (na
ordem da configuração) e por fim as concluídas. Quando outra meta entra em andamento, a
rolagem recomeça do topo. Use uma fonte estreita (por exemplo 480 × 1080); em tela cheia
a lista fica à esquerda com até 560 px. `?speed=40` muda a velocidade (8 a 200 pixels
por segundo). Passar o mouse ou focar pausa a rolagem.

No **Rodapé de metas** e no **Totem**, a meta em andamento ganha destaque; metas
alcançadas mostram "Alcançada" e só as concluídas aparecem riscadas.

The goals footer stays in one row at the bottom, with a fixed logo. Overflowing
goals scroll horizontally, pause for two seconds at each end, then reverse.
Progress updates keep the current scroll position. Hover or keyboard focus pauses
the track. With effects disabled or reduced motion enabled, scroll manually in
OBS Browser Source Interact. The footer also supports short browser sources
(for example, 1920 ? 180) without wrapping goals into extra rows.

O **Placar triplo** mostra apenas as categorias (Donate, Subs, Bits) que têm pelo menos uma
meta configurada; os cards restantes ficam centralizados. Uma contribuição de uma categoria
sem meta continua somando tempo e total, só não ganha card.

O **Placar triplo** e o **Rodapé de metas** mostram "Foi adicionado um total de X na live":
o tempo que as contribuições somaram ao cronômetro desde o último "zerar estado". Ajustes
manuais em **controlar cronômetro** não entram na conta. O mesmo valor sai em
`totals.addedSeconds` e `totals.addedLabel` no bloco **ler estado** e em
`metadata.totalAddedSeconds` no gatilho **contribuição registrada**. Estados salvos por
versões anteriores começam em zero; para corrigir, use **definir total** com o tipo
**Tempo adicionado (segundos)**.

Os overlays consultam `/api/poll` uma vez por segundo, sem manter conexão aberta. Por isso
qualquer quantidade de Browser Sources carrega ao mesmo tempo no OBS.

`?transparent=1` força fundo transparente e `?transparent=0` força o fundo configurado.
`?scale=0.85` ajusta a escala daquela fonte sem alterar a configuração global.

**Alertas** é a camada de avisos: toast de tempo adicionado com o nome do apoiador e as
faixas grandes de meta e de cronômetro. As faixas aparecem **no centro da tela** por
padrão; `?banner=top` ou `?banner=bottom` na URL muda a posição. Cada uma tem sua
animação:

| Faixa | O que acontece na tela |
|---|---|
| Meta alcançada | Clarão, raios girando, ondas de choque, selo "BATEMOS!" e confete. |
| Meta em andamento | Cartão entra com impacto, título letra a letra, ondas e feixes de luz que se repetem, brilho pulsando, ponto "ao vivo" e selo "AGORA!". |
| Meta concluída | Raios dourados, check desenhado, estrelas piscando, selo "FEITO!" e confete: estouro inicial, canhões e chuva durante a faixa. |
| Reta final | Bordas da tela pulsando em vermelho como batimento, listras de alerta correndo, cartão tremendo e o tempo restante pulsando. |
| Subathon finalizado | Festa: luz de balada girando, emojis subindo, letras coloridas dançando, borda arco-íris, chuva de confete, canhões e fogos. Fica no ar por pelo menos 15 segundos. |

As faixas entram em fila, uma por vez. Metas do mesmo tipo que chegam juntas viram uma
faixa só, por exemplo "3 metas concluídas" com os títulos embaixo. Reta final e
encerramento interrompem a fila; a faixa interrompida volta depois da reta final. Com
**Brilho e movimento** desligado, ou com `prefers-reduced-motion`, aparece o mesmo
cartão parado, sem clarão nem partículas. A duração segue **Duração das celebrações**,
com mínimos de 5 segundos para andamento, conclusão e reta final. Sempre transparente;
coloque-a acima das outras fontes no OBS. A posição dos toasts vem da configuração ou de
`?position=bottom-left` (top-right, top-left, top-center, bottom-right, bottom-left,
bottom-center). Os outros overlays não mostram avisos; para uma cena com uma única fonte,
acrescente `?alerts=1` à URL dela.

## Blocos

Todo campo de texto, número e seleção dos blocos de ação aceita fórmula: clique em Fx
no editor ou escreva `{{ $trigger.metadata.bits }}` direto.

| Bloco | O que faz |
|---|---|
| registrar Donate | Soma centavos ao total Donate e converte em tempo. Origem: LivePix, manual ou outra. |
| registrar Bits | Soma Bits e converte em tempo por unidade. |
| registrar Sub | Soma Subs e converte em tempo pelo tier: 1, 2, 3 ou Prime. |
| registrar contribuição | Bloco genérico com tipo por fórmula, para ligar qualquer plataforma. |
| controlar cronômetro | Pausar, retomar, alternar, adicionar, subtrair, definir ou restaurar. |
| definir total | Corrige um total, ou o tempo adicionado, sem mexer no cronômetro. |
| zerar estado | Zera totais, cronômetro, deduplicação, situação das metas ou tudo. |
| definir situação da meta | Marca uma meta como Pendente, Em andamento ou Concluída. A meta sai de uma lista; há atalhos para a meta em andamento, a próxima alcançada e todas as alcançadas. |
| ler estado | Cronômetro, totais, metas, meta em andamento e URLs. |
| contribuição registrada | Gatilho. Filtra por tipo e valor mínimo. |
| meta alcançada | Gatilho (antes "meta concluída"). Filtra por ID ou tipo da meta. Nunca acrescenta tempo. |
| situação da meta alterada | Gatilho. Filtra pela nova situação. |
| cronômetro abaixo de | Gatilho. Dispara uma vez em cada marco da aba Cronômetro. |
| cronômetro finalizado | Gatilho. Dispara uma vez quando o tempo chega a zero. |

Provide a unique event key whenever available. The templates already map this field.
Keys are retained in encrypted pages across restarts, without the previous 1,000-key
limit. Available legacy keys are migrated; keys discarded by older versions cannot
be reconstructed. Resetting the ledger or all state intentionally forgets these keys.

### Sub Prime

A aba **Cronômetro** tem um valor próprio para **Segundos por Sub Prime**, e os blocos
de Sub oferecem o tier **Prime**. Uma ressalva honesta: o EventSub da Twitch entrega uma
Sub Prime como Tier 1 e não diz que é Prime, então o template automático conta Prime como
Tier 1. O tier Prime vale quando você escolhe no bloco, quando a fórmula vem de uma fonte
que informa Prime, ou em um registro manual.

## Goal validation and recovery

The configuration supports up to 50 goals. The ID column declares `unique: true`.
A Studio build with unique-column validation highlights conflicting IDs and blocks
saving until they are corrected. Older Studio builds do not provide this form
validation; the plugin still preserves valid goals when it encounters duplicates. Each goal needs a unique ID and a
positive target. A blank Alvo uses the legacy Alvo anterior value; if both are
empty or zero, that row is invalid.

Version 0.4.4 keeps the other valid goals active and reports the invalid row number
in the plugin status and `goalErrors` returned by the state action and HTTP API.
The invalid row remains in the configuration for correction. Fix its ID or target
and save again. Contributions and the timer are preserved. The plugin no longer
substitutes sample goals when a configured row is invalid.

If an older version displays sample goals after a save, preserve your configuration
before editing it. Updating does not reconstruct goals that were already overwritten.

## Metas e efeitos

Na aba **Metas**, preencha **Alvo (R$ para Donate)** em reais: `52,01` ou `52.01`
equivale a **R$ 52,01**, e `300` equivale a R$ 300. Também aceita `1.234,56`.
Subs e Bits usam quantidade, inclusive fracionada. Valores em reais com mais de duas
casas são arredondados para o centavo mais próximo (`1,005` equivale a R$ 1,01).

Nas metas já salvas, **Alvo anterior (centavos no Donate)** mantém o valor legado:
`5201` continua sendo R$ 52,01. Para alterar, preencha o novo **Alvo**, que tem prioridade.
Em metas novas, preencha Alvo e deixe Alvo anterior em `0`. ID, título e ordem não mudam.

Os blocos de contribuição, os totais e os eventos do LivePix continuam usando centavos;
os flows existentes não precisam de conversão adicional.

Ao voltar para 0.4.1 ou anterior, o novo Alvo é ignorado: essas versões usam Alvo
anterior. Antes de um rollback, preencha esse campo com o equivalente em centavos
para Donate (ou quantidade para Subs/Bits) se tiver alterado ou criado metas.

Na aba **Overlays**, a seção **Efeitos** liga o brilho e o movimento dos cartões, as
celebrações de meta (confete ao alcançar, faixa ao entrar em andamento ou concluir) e o
aviso de tempo adicionado, e escolhe o canto dos avisos no
overlay Alertas. A duração das celebrações é configurável. Browser Sources com `prefers-reduced-motion` recebem tudo estático.

## Porta ocupada

Se outro programa já estiver usando a porta, o plugin não morre: o cronômetro, as metas,
os gatilhos e os blocos continuam funcionando, o card fica em **degradado** dizendo qual
porta está ocupada, e a cada quinze segundos ele tenta abrir a mesma porta de novo. Assim
que a porta liberar, os overlays voltam sozinhos, com as mesmas URLs já coladas no OBS.

## Segurança

- O servidor responde apenas em `127.0.0.1`; nenhuma outra máquina da rede o alcança.
- Uma porta ocupada nunca vira outra porta: as URLs do OBS não mudam por baixo do pano.
- Nenhuma credencial passa por este plugin. Pagamentos chegam pelo plugin LivePix (que
  fala com o OSC LivePix Dashboard) e eventos da Twitch pela integração nativa.
- A rota de fonte local serve somente arquivos `.woff`, `.woff2`, `.ttf` e `.otf`
  apontados na configuração.
- O estado (cronômetro, totais, deduplicação, situação das metas) fica no cofre
  criptografado do Studio.
- As escritas pelo HTTP são as do painel: `POST /api/goal-status`, `POST /api/timer` e
  `POST /api/test-alert`. Elas só aceitam
  corpo JSON, `Host` igual a `127.0.0.1` ou `localhost` na porta do plugin e, quando o
  navegador informa, `Origin` desse mesmo endereço. Assim uma página de outro site aberta
  no mesmo computador não consegue mudar metas nem o cronômetro, nem por formulário nem por DNS apontado
  para 127.0.0.1. O corpo é limitado a 4 KB.

## Manual subscription corrections

Use **CatOPanda: definir total** with **Tipo** set to **Subs**. Subscriptions,
resubscriptions, and gifted subscriptions share this total. Choose **Adicionar** to
add a missing count, **Subtrair** to remove an excess count, or **Definir** to enter
the correct total. Enter a whole, nonnegative quantity.

For each correction, choose whether **Alterar cronômetro** is on. It defaults to
off, so existing blocks still set totals without changing time. When on, the block
also adjusts remaining time and contributed time using the selected **Tier do
ajuste** and its configured seconds per subscription. Correct different tiers in
separate operations. For example, subtracting two Tier 1 subscriptions with 600
seconds per subscription removes two Subs and up to 1,200 seconds from each time
counter. If only one Sub remains, the correction removes one Sub and 600 seconds.

Totals and contributed time cannot fall below zero. Remaining time is capped at
365 days. A paused timer stays paused, including when time is added at zero.
Corrections refresh goals and overlays and survive restart. They preserve real
contribution history and duplicate-event keys and do not create a contribution
alert. Crossing a goal still emits the existing goal-completed event.

Donate, Bits, and contributed-time totals also support the three operations, but
**Alterar cronômetro** must be off for those types. The action returns `type`,
`total`, and `timerChanged`; the last field is true only when the correction
actually changes remaining time.

## Applying the subscription fix

Update both OSC Flow Studio and this plugin, then restart the Studio backend so
the new Twitch dispatch and plugin code are loaded. Subscription contributions
use the unified Twitch chat-notification source. Duplicate deliveries keep the
same event key, and the Twitch template excludes gifted subscription and gifted
resubscription notifications because the gift batch already includes them.

Updating a plugin does not rewrite a flow you already imported. To adapt
**CatOPanda Subathon: Twitch**, copy both guards and all three event-key formulas
from the updated **CatOPanda Subathon: Twitch pronta** template:

- Put `exclude-gift-recipient` between `twitch-subscribe` and `record-subscribe`.
  Compare `{{ $trigger.metadata.isGift }}` with the boolean `true` using **not
  equal**, and connect only the guard's **true** output to the recording block.
- Put `exclude-gift-resub` between `twitch-resub` and `record-resub`. Compare
  `{{ !!($trigger.metadata.raw && ($trigger.metadata.raw.isGift || $trigger.metadata.raw.is_gift)) }}`
  with the boolean `true` using **not equal**, and connect only the guard's
  **true** output to the recording block.
- Set **Chave única do evento** (`eventKey`) on `record-subscribe` to
  `twitch:subscribe:{{ ($trigger.metadata.raw && $trigger.metadata.raw.message_id) || ($trigger.actorId + ':' + $trigger.triggeredAt) }}`.
- Set `eventKey` on `record-resub` to
  `twitch:resub:{{ ($trigger.metadata.raw && $trigger.metadata.raw.message_id) || ($trigger.actorId + ':' + $trigger.triggeredAt) }}`.
- Set `eventKey` on `record-sub-gift` to
  `twitch:gift:{{ ($trigger.metadata.raw && $trigger.metadata.raw.message_id) || ($trigger.actorId + ':' + $trigger.triggeredAt) }}`.

Remove the old direct subscribe/resub connections to the recording blocks so
they cannot bypass the guards. Alternatively, import the updated template and
retire the old flow. Keep only one accounting flow enabled for the same events.
Do not run both copies during the transition.

This update does not infer historical duplicate contributions or alter existing
totals. Use the manual correction block after reviewing the excess counts, and
choose whether each correction should also change time.

## Host contract verification

`npm test` runs the standalone plugin suite. For integration verification, first
run `pnpm.cmd build:packages` in the OSC Flow Studio checkout, then run
`npm run test:host-contract` here. The 24 host contract tests execute the built
FlowEngine and Twitch normalization and validate output schemas and downstream
formulas using Studio's shared executable contract helper.

The host suite requires Node.js 22 or newer and defaults to the sibling checkout
at `../osc-flow-studio`. Set `OSC_FLOW_STUDIO_ROOT` to use another checkout.
