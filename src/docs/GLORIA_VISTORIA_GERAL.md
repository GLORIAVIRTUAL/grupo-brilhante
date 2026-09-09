# Vistoria Geral — Glória (IA do Chat 5àsec)
Documento de auditoria: tudo que a Glória consulta, executa e obedece.
Atualizado em 20/08/2026.

---

## 1. Caminho de uma mensagem (do WhatsApp até a resposta)

1. **Cliente envia mensagem no WhatsApp**
2. **Webhook recebe** (`zapi_webhook_receiver` para a conexão principal / `zapi_moinhos_webhook` para a loja Moinhos / `whatsapp_moinhos_webhook` para a API oficial Meta)
   - Valida token de segurança da Z-API
   - Ignora: mensagens de GRUPO, placeholders, ecos de template, duplicadas
   - Normaliza o telefone e identifica/cria o **Customer** (com recuperação de identidade por LID e histórico)
   - Cria/reabre a **Conversation** e grava a **Message**
   - Mídia (imagem/áudio/doc) é baixada por `zapi_media_downloader`
   - Marca a mensagem como `ai_pending = true` e responde 200 na hora
3. **Gatilho da IA** (`aiReplyTrigger`, automação na entidade Message)
   - Espera ~2,5s (agrupa rajadas de mensagens)
   - Cancela se: atendente humano ativo, conversa em handoff, ou já chegou mensagem mais nova
   - Chama o `orchestrator`
4. **Orchestrator** (cérebro): monta o contexto, chama a IA, executa ferramentas, valida a resposta
5. **Guardas anti-alucinação** revisam o texto
6. **Sender** envia (`zapi_sender`, `zapi_moinhos_sender` ou `whatsapp_moinhos_sender`)
7. **Rede de segurança** (`recoverUnansweredMessages`, a cada 5 min): responde qualquer mensagem que ficou sem resposta. Há **trava de idempotência** (`ai_answered` na Message) para nunca duplicar resposta.

---

## 2. Quando a Glória fica CALADA (bloqueios)

| Situação | Comportamento |
|---|---|
| `handoff_required = true` na conversa | IA não responde (atendimento humano) |
| Atendente respondeu nas últimas 6h (painel `sent_by` ou celular/WhatsApp Web `fromMe`) | IA não responde |
| Atendente clicou "Voltar p/ IA" | Grava `ai_resumed_at`; mensagens humanas anteriores deixam de silenciar a IA |
| Mensagem de grupo | Ignorada totalmente (entrada e saída) |
| Mensagem só de agradecimento/ok (sem fluxo ativo) | Ignorada |
| Mensagem já respondida (`ai_answered`) | Ignorada (anti-duplicação) |
| Handoff criado por campanha/disparo | Limpo automaticamente — a IA continua o atendimento |

---

## 3. Prompt que ela consulta (regras de negócio)

O prompt é montado **em tempo de execução** no `orchestrator` e combina texto fixo + dados vivos do banco.

📄 **O TEXTO LITERAL E COMPLETO DO PROMPT está no arquivo `src/docs/GLORIA_PROMPT_FIXO.md`** (prompt principal, prompt exclusivo de Moinhos, fatos determinísticos e instruções de correção). O resumo abaixo é o índice das regras.

### 3.1 Postura
- Responde primeiro e só o que foi perguntado; nada de despejar listas.
- Concisa, com emojis, linguagem de WhatsApp.
- Saudação variada (evita bloqueio da Meta por repetição).
- Nunca vaza raciocínio interno.

### 3.2 Memória obrigatória
- Últimas 60 mensagens da conversa + fatos de continuidade (`shared/conversationContinuity.js`).
- Proibido pedir de novo: foto, endereço, data, turno, forma de pagamento já informados.
- "Novo orçamento" zera o estado anterior sem misturar peças/pagamento.
- **Turno já escolhido** pelo cliente (manhã/tarde) é injetado como fato: proibido perguntar de novo.

### 3.3 Preços e catálogo
- Preços vêm **somente** da entidade **Product** (catálogo ativo).
- Grupos de variação (ex: todos os "EDREDOM") são listados obrigatoriamente e por inteiro.
- Sem variação informada → usa o **menor preço** + aviso de inspeção e possível valor adicional.
- Passadoria = 70% do valor da lavagem.
- Peça fora do catálogo: não inventa valor.

### 3.4 Serviços especiais (Bactericida, Branco+, Revitalizante, Engomagem, Impermeabilização)
- Valores vivos da entidade **SpecialServicePricing** (editável em Configurações).
- Detecção da peça citada → injeta a linha correta (edredom, casaco, cortina, tapete, vestido, macacão, demais peças).
- Proibido dizer que é grátis/incluso.

### 3.5 Cálculo por m² (cortinas e tapetes)
- Sempre pela ferramenta `calculate_area_quote` → função `calculateSquareMeterQuote`.
- Preços vivos da entidade **SquareMeterPricing** (Cortina Tipo I/II/III e Tapete).
- Prazos: cortina 3–5 dias úteis; tapete 10–15 dias.
- Proibido pedir foto no lugar das medidas; interpreta "2x2", "1,50 x 2", cm→m, diâmetro.

### 3.6 Coleta / entrega (tele)
- Total das peças após desconto **> R$ 150,00** → tele **grátis**.
- **≤ R$ 150,00** → taxa fixa **R$ 15,00** (garantida por guarda determinística).
- Atende toda a área urbana de Porto Alegre.
- Horários de coleta: **Seg–Sex 8h–16h**, **Sáb 9h–12h**, sem domingo/feriado.
- Capacidade: Manhã 5 vagas | Tarde 7 vagas.
- Fluxo: data → `check_pickup_availability` → oferecer turno(s) reais → endereço → `schedule_pickup` → depois tratar pagamento.
- Proibido confirmar coleta sem `success: true` da ferramenta.

### 3.7 Pagamentos
- Pix chave 51993003927 (comprovante por foto).
- Na coleta: dinheiro, crédito e débito na maquininha do entregador.
- Na loja: balcão (dinheiro/cartão) ou Pix antecipado.
- Proibido dizer que coleta é "só Pix".

### 3.8 Promoções
- Somente as ativas da entidade **Promotion**, e só se o cliente atender à condição exata.
- Proibido mencionar promoção "genericamente" ou inventar.

### 3.9 Bags e Planos
- Bags: Minha Bag R$ 90 (18 peças) | Bag R$ 160 (35) | Bag Família R$ 185 (50).
- Regras de peças permitidas; proibido sugerir Bag com edredom, terno, tapete, cortina, casaco, etc.
- Planos pré-pagos vêm do catálogo (categoria/família "Planos").

### 3.10 Outras regras fixas
- Lavagem a água **e** a seco (proibido negar a seco); segue a etiqueta da peça.
- Manchas: sim, fazemos tratamento localizado, sem garantia total; valor avaliado pela equipe.
- Prazo padrão: 3 dias úteis (data calculada em `shared/dateFacts.js`, com feriados).
- Horário de funcionamento das 5 lojas respondido direto (nunca confundir com coleta).
- Restrição de dia do cliente é respeitada; proibido reoferecer dia recusado.
- Candidatura a emprego: pedir currículo no WhatsApp ou poa.riobranco@5asec.com.br (RH avalia).
- Endereços/telefones (fixo + celular) das 5 lojas: Rio Branco, Petrópolis, Zaffari, Bourbon Wallig, Moinhos.

### 3.11 Prompt exclusivo da Loja Moinhos
Ativado quando a origem é `zapi_moinhos` / `whatsapp_moinhos`:
- Identidade fixa Moinhos Shopping; proibido citar/oferecer outras lojas.
- Fluxo próprio de promoções (`shared/promotionFlow.js`, `shared/promotionOrchestrator.js`) com `start_regular_quote` e `create_promotional_quote`.

---

## 4. Ferramentas que a IA pode executar (function calling)

| Ferramenta | O que faz |
|---|---|
| `check_pickup_availability` | Consulta vagas reais de coleta na data (manhã/tarde) |
| `schedule_pickup` | Cria a coleta no sistema (entidade Pickup) |
| `approve_quote` | Aprova orçamento, aplica taxa de R$ 15 quando cabe, cria cards de CRM e pagamento |
| `calculate_area_quote` | Valor por m² de cortina/tapete |
| `sell_package` | Vende Bag ou Plano e abre pagamento |
| `register_complaint` | Registra reclamação e transfere para humano |
| `request_urgent_delivery` | Pede análise de prazo urgente |
| `transfer_to_human` | Transfere o atendimento |
| `check_distance_to_stores` | Distância/tempo até as lojas (Google Maps) |
| `start_regular_quote` / `create_promotional_quote` | Fluxo promocional Moinhos |

---

## 5. Respostas determinísticas (não passam pela criatividade da IA)

- Disponibilidade de coleta hoje/amanhã (`shared/pickupAvailability.js`, `shared/pickupSchedule.js`)
- Preço do frete/tele (`shared/quoteSafety.js`)
- Pergunta sobre mancha com fotos (`shared/stainInquiry.js`)
- Datas, feriados e prazo de entrega (`shared/dateFacts.js`)
- Serviços especiais (`shared/specialServiceContext.js` + banco)
- Fotos enviadas: classificação por `openai_vision`; comprovante de pagamento reconhecido automaticamente

---

## 6. Guardas anti-alucinação (antes de enviar)

1. **Confirmação de coleta sem agendar** → força a execução real de `schedule_pickup`.
2. **Afirmação de "lotado/sem vaga" sem consultar** → força `check_pickup_availability`.
3. **`hallucinationGuard`** (fact-check final): confere catálogo, variações, promoções, disponibilidade, prazo, preços por m², serviços especiais e taxa de R$ 15.
4. **`enforceVariableQuoteSafety`** → sempre inclui aviso de inspeção/valor adicional.
5. **`enforceDeliveryFeeNotice`** → garante a taxa de R$ 15,00 quando há coleta e total ≤ R$ 150.

---

## 7. Bancos de dados (entidades) que a Glória lê/escreve

| Entidade | Uso |
|---|---|
| Customer | Identificação, telefone, endereço, unidade, opt-in |
| Conversation | Estado do atendimento (`flow`, `step`), handoff, metadata |
| Message | Histórico, mídia, autoria, `ai_pending` / `ai_answered` |
| Product | Catálogo de preços, planos, bags |
| SpecialServicePricing | Preços dos serviços especiais |
| SquareMeterPricing | Preços por m² |
| Promotion | Promoções ativas |
| Quote | Orçamentos (rascunho, enviado, aprovado) |
| Order | Pedidos/tickets |
| Payment | Pagamentos confirmados |
| Pickup | Coletas agendadas (origem `ai` = Glória) |
| CrmCard | Pipelines: NEW_CUSTOMER, QUOTE, PAYMENT, ORDER, PLAN, COMPLAINT |
| StaffNotification | Alertas para a equipe (novas imagens, reclamação, urgência) |
| Unit | Unidades/lojas |
| AiSettings | Modelo e temperatura da IA |
| DispatchQueue / AutomatedDispatch | Campanhas e disparos |

---

## 8. Integrações externas

| Integração | Para quê |
|---|---|
| **Z-API** (2 instâncias: principal e Moinhos) | Enviar/receber WhatsApp |
| **WhatsApp Cloud API (Meta)** | Conexão oficial Moinhos |
| **OpenAI** | Conversa (chat), visão das fotos, transcrição de áudio (Whisper) |
| **Google Maps** | Distância e rota até as lojas |
| **Stripe** | Links de pagamento e webhook |
| **Meta Ads / Google Ads** | Campanhas de tráfego (fora do chat) |
| **Make (webhooks)** | Publicação de campanhas/vídeos |

Modelo e temperatura são configuráveis em **Configurações → IA** (entidade AiSettings, padrão temperatura 0,3).

---

## 9. Automações ativas

| Automação | Frequência | Função |
|---|---|---|
| Gatilho de resposta da IA | Ao marcar mensagem pendente | `aiReplyTrigger` |
| Rede de segurança de mensagens sem resposta | ~5 min | `recoverUnansweredMessages` |
| Automações programadas (re-engajamento, aniversário, pesquisas) | Agendada | `scheduled_automations` |
| Fila de disparos | Agendada | `processDispatchQueue` |
| Orçamentos expirados / clientes novos inativos | Agendada | `checkExpiredQuotes`, `checkInactiveNewCustomers` |
| Despesas recorrentes | Mensal | `generateRecurringExpenses` |

---

## 10. Pontos de atenção conhecidos

- Latência final depende da Z-API/WhatsApp; o sistema responde em segundos.
- Disparos automáticos não devem ligar handoff (para não poluir o painel do atendente).
- Se o atendente responder pelo celular da loja, a IA fica calada por 6h — usar "Voltar p/ IA" para liberar.
- Instância Moinhos precisa estar conectada na Z-API, senão a mensagem sai no sistema mas não chega ao cliente.