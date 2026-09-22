# CatOPanda Subathon 0.4.5

Instale este ZIP por **Integrações → Install from zip** no OSC Flow Studio 0.5.x. O pacote é
`io.github.osc-flow-studio.catopanda-subathon`. Para receber doações do LivePix, instale também o plugin **LivePix** 2.0.0 (ZIP
separado), conectado ao OSC LivePix Dashboard, e importe o template **CatOPanda Subathon:
LivePix pronta**. Com o início do subathon configurado no plugin LivePix, só doações a
partir dele chegam ao cronômetro.

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

**Alertas** é a camada de avisos: toast de tempo adicionado com o nome do apoiador, faixa
e confete ao concluir meta, faixa de reta final e de encerramento. Sempre transparente;
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
| zerar estado | Zera totais, cronômetro, deduplicação ou tudo. |
| ler estado | Cronômetro, totais, metas e URLs. |
| contribuição registrada | Gatilho. Filtra por tipo e valor mínimo. |
| meta concluída | Gatilho. Filtra por ID ou tipo da meta. Nunca acrescenta tempo. |
| cronômetro abaixo de | Gatilho. Dispara uma vez em cada marco da aba Cronômetro. |
| cronômetro finalizado | Gatilho. Dispara uma vez quando o tempo chega a zero. |

Informe uma **chave única do evento** sempre que puder: a mesma chave nunca soma duas
vezes, mesmo que o gatilho repita a entrega. Os templates já preenchem a chave.

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

Na aba **Overlays**, a seção **Efeitos** liga o brilho e o movimento dos cartões, o
confete ao concluir meta e o aviso de tempo adicionado, e escolhe o canto dos avisos no
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
- O estado (cronômetro, totais, deduplicação) fica no cofre criptografado do Studio.

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
`npm run test:host-contract` here. The 21 host contract tests execute the built
FlowEngine and Twitch normalization and validate output schemas and downstream
formulas using Studio's shared executable contract helper.

The host suite requires Node.js 22 or newer and defaults to the sibling checkout
at `../osc-flow-studio`. Set `OSC_FLOW_STUDIO_ROOT` to use another checkout.
