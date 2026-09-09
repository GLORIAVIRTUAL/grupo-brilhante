# 📦 BLUEPRINT — Chat IA + Humano (WhatsApp via Z-API + OpenAI)

> Documento técnico completo para replicar o sistema de **Chat IA & Humano** em outro projeto Base44.
> Versão adaptável: aqui o caso de uso original é uma lavanderia, mas este pacote foi escrito para ser usado em um **Studio de Pilates** (basta trocar o conteúdo do `system prompt` e o catálogo de serviços).

---

## 🧭 1. VISÃO GERAL DA ARQUITETURA

```
WhatsApp (cliente)
    │
    ▼
Z-API (instância WhatsApp) ──webhook──▶  functions/zapi_webhook_receiver
                                                │
                                                ├── salva Customer + Conversation + Message
                                                ├── faz download da mídia (zapi_media_downloader)
                                                └── dispara em background ──▶  functions/orchestrator
                                                                                      │
                                                                                      ├── decide fluxo (estado da conversa)
                                                                                      ├── chama OpenAI (gpt-4o + tools)
                                                                                      ├── executa tools (agendar, transferir, etc)
                                                                                      └── responde ──▶  functions/zapi_sender ──▶ WhatsApp
                                                                                                                │
                                                                                                                └── salva Message OUT no DB

Frontend: pages/Chat
    └── lê Conversation/Message via SDK (com subscribe em tempo real)
    └── permite humano assumir conversa (handoff_required = true bloqueia IA)
```

### Princípios-chave
1. **Webhook responde rápido**: a chamada ao Orchestrator é fire-and-forget (não bloqueia o webhook).
2. **Realtime no front**: `base44.entities.Message.subscribe()` mantém a UI sincronizada sem polling.
3. **Handoff**: enquanto `Conversation.handoff_required === true`, a IA é silenciada.
4. **Fluxos por estado**: `conversation.metadata.flow` controla a etapa atual (ex: `QUOTE`, `WAITING_RECEIPT`, `HANDOFF`).
5. **Tools do OpenAI**: ações concretas (agendar, transferir, registrar reclamação) são chamadas via `tool_calls`.

---

## 🔑 2. SECRETS NECESSÁRIOS

Configure no painel Base44 (Settings → Secrets):

| Secret | Descrição |
|---|---|
| `ZAPI_INSTANCE_ID` | ID da instância Z-API |
| `ZAPI_TOKEN` | Token da instância Z-API |
| `ZAPI_SECURITY_TOKEN` | Client-Token de segurança da Z-API |
| `OPENAI_API_KEY` | Chave OpenAI (gpt-4o + Whisper) |
| `GOOGLE_MAPS_API_KEY` | (Opcional) — apenas se quiser tool de "loja mais próxima" |

---

## 🗄️ 3. ENTIDADES (JSON Schema)

Crie estes arquivos em `entities/`:

### `entities/Customer.json`
```json
{
  "name": "Customer",
  "type": "object",
  "properties": {
    "full_name": { "type": "string" },
    "email": { "type": "string" },
    "phones": { "type": "array", "items": { "type": "string" } },
    "preferred_language": { "type": "string", "enum": ["pt", "en", "es"], "default": "pt" },
    "birthdate": { "type": "string", "format": "date" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "opt_in_whatsapp": { "type": "boolean", "default": false },
    "opt_in_whatsapp_at": { "type": "string", "format": "date-time" },
    "last_inbound_at": { "type": "string", "format": "date-time" },
    "last_outbound_at": { "type": "string", "format": "date-time" },
    "status": { "type": "string", "enum": ["active", "inactive", "vip"], "default": "active" },
    "notes": { "type": "string" }
  },
  "required": ["full_name"]
}
```

### `entities/Conversation.json`
```json
{
  "name": "Conversation",
  "type": "object",
  "properties": {
    "customer_id": { "type": "string" },
    "channel": { "type": "string", "enum": ["WHATSAPP"], "default": "WHATSAPP" },
    "zapi_instance_id": { "type": "string" },
    "status": { "type": "string", "enum": ["OPEN", "CLOSED"], "default": "OPEN" },
    "last_message_id": { "type": "string" },
    "last_message_at": { "type": "string", "format": "date-time" },
    "handoff_required": { "type": "boolean", "default": false },
    "metadata": { "type": "object", "description": "Estado: { flow: 'QUOTE', step: 1, ... }" }
  },
  "required": ["customer_id", "channel"]
}
```

### `entities/Message.json`
```json
{
  "name": "Message",
  "type": "object",
  "properties": {
    "conversation_id": { "type": "string" },
    "direction": { "type": "string", "enum": ["IN", "OUT"] },
    "type": { "type": "string", "enum": ["TEXT", "IMAGE", "AUDIO", "DOC"] },
    "text": { "type": "string" },
    "media_file_id": { "type": "string" },
    "raw_payload": { "type": "object" },
    "language_detected": { "type": "string" }
  },
  "required": ["conversation_id", "direction", "type"]
}
```

### `entities/QuickReply.json`
```json
{
  "name": "QuickReply",
  "type": "object",
  "properties": { "text": { "type": "string" } },
  "required": ["text"]
}
```

### `entities/StaffNotification.json` (para alertas internos)
```json
{
  "name": "StaffNotification",
  "type": "object",
  "properties": {
    "type": { "type": "string", "enum": ["NEW_LEAD", "COMPLAINT", "SLA_BREACH", "SYSTEM_ERROR", "NEW_IMAGES"] },
    "target_team": { "type": "string" },
    "payload": { "type": "object" },
    "sent_at": { "type": "string", "format": "date-time" },
    "ack_at": { "type": "string", "format": "date-time" }
  },
  "required": ["type", "target_team"]
}
```

> **Studio de Pilates**: crie também entidades para o seu negócio, ex:
> - `ClassSchedule` (aula, instrutor, horário, vagas)
> - `Booking` (agendamento de aula por aluno)
> - `Plan` (planos mensais: 2x/sem, 3x/sem, ilimitado)

---

## ⚙️ 4. BACKEND FUNCTIONS

Crie os arquivos abaixo em `functions/`. Todos usam `npm:@base44/sdk@0.8.25`.

### 4.1 `functions/zapi_webhook_receiver.js`
**Função**: Recebe todo evento do WhatsApp via webhook da Z-API, identifica o cliente, salva a mensagem e dispara o Orchestrator em background.

Pontos críticos:
- Valida `Client-Token` (header).
- Deduplica por `messageId`.
- Ignora `waitingMessage` (placeholder), eco de templates/campanha, e reações de emoji.
- Localiza/cria `Customer` por múltiplas estratégias de match de telefone (com/sem 9º dígito BR, últimos 10 dígitos).
- Cria/reabre `Conversation`.
- Cria `Message` com `raw_payload` completo (útil para debug).
- Faz download de mídia via `zapi_media_downloader`.
- Bloqueia IA para broadcasts/campanhas (LID).
- Dispara `orchestrator` SEM `await` (fire-and-forget).

> Código completo: **ver arquivo `functions/zapi_webhook_receiver` no projeto original** (~450 linhas). Copie como está.

### 4.2 `functions/zapi_sender.js`
**Função**: Envia mensagens para o WhatsApp via Z-API (texto, imagem, áudio, documento, botões, lista de opções) e registra a `Message` OUT no banco.

Suporta tipos: `TEXT`, `IMAGE`, `AUDIO`, `DOC`, `BUTTONS`, `OPTION_LIST`.
Faz fallback automático: se botões/lista falharem, envia como texto puro com as opções listadas.

> Código completo: **ver `functions/zapi_sender` no projeto original** (~140 linhas).

### 4.3 `functions/zapi_media_downloader.js`
**Função**: Baixa a mídia da URL da Z-API (que expira) e re-uploada para o storage permanente do Base44.

> ~50 linhas. Ver original.

### 4.4 `functions/zapi_connection.js`
**Função**: Endpoints admin para `status`, `qrcode`, `restart`, `disconnect` e `set_webhook` da instância Z-API. Usado pela tela de configuração.

### 4.5 `functions/orchestrator.js` 🧠 (o cérebro)
**Função**: É chamado pelo webhook e decide o que responder. Roda em background.

Estrutura interna:

1. **Carrega contexto**: `Conversation`, `Message`, `Customer` em paralelo.
2. **Ignora outbound** (loop prevention).
3. **Transcreve áudio** com OpenAI Whisper se a mensagem for `AUDIO` sem texto.
4. **Verifica handoff**: se `conversation.handoff_required === true`, retorna sem responder.
5. **Bloqueia campanhas/disparos**: força handoff humano para contatos com nome `@lid` ou que receberam disparo nas últimas 48h.
6. **Comandos globais**: se o cliente digitar "atendente"/"humano" → marca handoff.
7. **Máquina de estados** baseada em `conversation.metadata.flow`:
   - `WAITING_RECEIPT`: aguardando comprovante (imagem/doc) → processa pagamento.
   - `QUOTE`: cliente enviando fotos → chama Vision e monta orçamento.
8. **Caso geral**: chama **OpenAI gpt-4o** com um system prompt rico + **histórico** das últimas 6 mensagens + **tools**.

**Tools (function calling)** que a IA pode chamar:
| Tool | O que faz |
|---|---|
| `check_distance_to_stores` | Calcula rota até as lojas via Google Maps |
| `check_pickup_availability` | Verifica vagas em data/turno |
| `schedule_pickup` | Agenda uma coleta |
| `approve_quote` | Aprova orçamento e dispara fluxo de pagamento |
| `sell_package` | Vende plano/pacote |
| `register_complaint` | Registra reclamação e transfere para humano |
| `request_urgent_delivery` | Pede operação verificar urgência |
| `transfer_to_human` | Transfere atendimento |

Após executar tools, faz **segunda chamada à OpenAI** para gerar a resposta final em português natural.

Por fim, envia via `zapi_sender` e, se detectar palavras-chave ("aprovar", "atendente", "coleta/entrega por R$ 15"), envia **lista de opções interativa** como botões.

**⚠️ ADAPTAÇÃO PARA STUDIO DE PILATES — SUBSTITUA O `system prompt` E AS TOOLS:**

```
Tools recomendadas para Pilates:
- check_class_availability(date, time, instructor?) → consulta vagas em aula
- book_class(class_id, customer_id) → reserva vaga
- cancel_booking(booking_id) → cancela reserva
- list_plans() → lista planos (2x/sem, 3x/sem, ilimitado)
- subscribe_plan(plan_name, customer_id) → matricula em plano
- schedule_trial_class(date, time) → aula experimental
- transfer_to_human(reason) → mantém igual
- register_complaint(summary) → mantém igual
```

O system prompt deve cobrir:
- Apresentação do studio, modalidades (Pilates Solo, Reformer, etc.)
- Tabela de planos e preços
- Horários de funcionamento
- Endereço e como chegar
- Regras de cancelamento/remarcação
- Política de aula experimental
- Quando transferir para humano

> Código completo do orchestrator: **ver `functions/orchestrator` no projeto original** (~1970 linhas). Use a estrutura, troque o domínio.

### 4.6 `functions/openai_vision.js` (opcional)
**Função**: Recebe URL de imagem e classifica usando GPT-4o Vision com base em um catálogo. Para Pilates pode ser usado para identificar comprovantes de pagamento ou fichas de avaliação.

### 4.7 `functions/refreshCustomerNames.js`
**Função**: Busca o nome real do WhatsApp na API da Z-API (`/contacts/{phone}`) para clientes salvos como "Novo Cliente". Roda em background no Chat.

---

## 🖥️ 5. FRONTEND — `pages/Chat.js`

Tela completa de chat em duas colunas:

### Coluna esquerda — Lista de conversas
- Busca por nome/telefone.
- Filtros: "Todas" / "Só da unidade" (se for multi-unidade).
- Cada item mostra: nome, último horário, badge laranja se `handoff_required`.
- **Unifica conversas** do mesmo cliente quando ele aparece com IDs diferentes (LID vs número real) por chave de telefone normalizado.
- Subscribe em `Conversation` para atualizar a lista em tempo real.

### Coluna direita — Chat ativo
- Header com avatar, nome, telefone, status (IA Ativa / Solicita Atendente).
- Botões: **Orçamento** (modal), **Assumir/Transferir**, **Encaminhar**, **Finalizar**, **Tela Cheia**.
- Lista de mensagens (estilo WhatsApp, bolhas verde/branco).
- Suporta imagem, áudio (player), documento, texto com markdown e links.
- Quando IA está ativa, **overlay** bloqueia o input com botão "Assumir Conversa para Responder".
- Input bottom: anexo, emojis, gravação de áudio (MediaRecorder), respostas rápidas, envio.
- Subscribe **global** em `Message` (mounted once) — garante que nenhuma mensagem é perdida em troca de conversa.

### Modal de Teste
Permite simular uma mensagem chegando (chama `zapi_webhook_receiver` direto) sem WhatsApp real — útil para QA.

### Modal de Encaminhar
Permite encaminhar texto + imagem da conversa atual para outro cliente.

> Código completo: **ver `pages/Chat` no projeto original** (~1390 linhas).

---

## 📡 6. SUBSCRIPTIONS EM TEMPO REAL (padrão)

```jsx
// Sidebar — mantém lista de conversas atualizada
useEffect(() => {
  const unsub = base44.entities.Conversation.subscribe((event) => {
    if (event.type !== 'create' && event.type !== 'update') return;
    setConversations(prev => /* merge + re-sort por last_message_at */);
  });
  return () => unsub();
}, []);

// Chat ativo — recebe mensagens em tempo real
useEffect(() => {
  const unsub = base44.entities.Message.subscribe((event) => {
    if (!event.data) return;
    if (relatedConvIdsRef.current.includes(event.data.conversation_id)) {
      setMessages(prev => /* append + sort por created_date */);
    }
  });
  return () => unsub();
}, []);
```

---

## 🎯 7. FLUXO DE HANDOFF (humano assume)

1. Usuário clica em **Assumir** ou **Transferir** no header do chat.
2. Frontend chama `base44.entities.Conversation.update(id, { handoff_required: true })`.
3. Orchestrator vê `handoff_required === true` na próxima mensagem do cliente e **não responde**.
4. Atendente humano digita no campo (que destrava quando handoff está ativo) e envia via `zapi_sender`.
5. Para devolver à IA: marca `handoff_required: false`.

---

## 🔔 8. NOTIFICAÇÕES (sons + toasts no layout)

No `Layout.jsx` global, faça subscribe em `Message`, `Quote`, `StaffNotification` e dispare:
- `toast()` com som (`new Audio(...)`).
- Badge no menu lateral com contador de não-lidas.
- Som ligado/desligado via `localStorage`.

---

## 🚀 9. CHECKLIST DE IMPLEMENTAÇÃO

- [ ] Criar todos os secrets no Base44.
- [ ] Criar entidades: `Customer`, `Conversation`, `Message`, `QuickReply`, `StaffNotification` (+ entidades do Pilates).
- [ ] Criar functions: `zapi_webhook_receiver`, `zapi_sender`, `zapi_media_downloader`, `zapi_connection`, `orchestrator`, `refreshCustomerNames`.
- [ ] Adaptar **system prompt** e **tools** no `orchestrator` para o domínio Pilates.
- [ ] Criar `pages/Chat.js` (frontend).
- [ ] Configurar webhook na Z-API apontando para `https://{APP_ID}.base44.app/api/functions/zapi_webhook_receiver` (use `action: 'set_webhook'` em `zapi_connection`).
- [ ] Testar com a modal "Simular Cliente" antes de plugar WhatsApp real.
- [ ] Conectar WhatsApp (QR Code) via tela de Settings chamando `zapi_connection action='qrcode'`.

---

## 💡 10. ARQUIVOS QUE A OUTRA IA DEVE COPIAR (lista final)

```
entities/
  Customer.json
  Conversation.json
  Message.json
  QuickReply.json
  StaffNotification.json

functions/
  zapi_webhook_receiver.js   ← copiar AS IS
  zapi_sender.js             ← copiar AS IS
  zapi_media_downloader.js   ← copiar AS IS
  zapi_connection.js         ← copiar AS IS
  refreshCustomerNames.js    ← copiar AS IS
  orchestrator.js            ← COPIAR e TROCAR o system prompt + tools

pages/
  Chat.js                    ← copiar AS IS (remover referências a AdvancedQuoteModal/useUnitAccess se não usar multi-unidade)
```

> **Importante**: o `pages/Chat.js` do projeto original tem dependências em `AdvancedQuoteModal` (modal de orçamento de lavanderia) e `useUnitAccess` (multi-unidade). Para o studio de Pilates, **remova ou substitua** essas duas peças por um modal próprio (ex: "Agendar Aula Experimental") e dispense o filtro de unidade se for um studio único.

---

## ✅ É ISSO

Com esse blueprint + os arquivos brutos que estão em `functions/` e `pages/Chat` do projeto original, qualquer outra IA consegue reproduzir o sistema 1:1 e só precisa reescrever o **system prompt** e as **tools do OpenAI** para o domínio do Studio de Pilates.