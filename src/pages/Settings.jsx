import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { 
  Settings as SettingsIcon, 
  Shirt, 
  Plus, 
  Save,
  Loader2,
  Clock,
  MessageSquare,
  Sparkles,
  Tag,
  QrCode,
  Download
  } from 'lucide-react';
import { Input } from "@/components/ui/input";
import ProductIcon from "@/components/ui/ProductIcon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import UnitAccessManager from '@/components/settings/UnitAccessManager';
import PromotionsManager from '@/components/settings/PromotionsManager';
import CardFeesManager from '@/components/settings/CardFeesManager';
import ExpensesManager from '@/components/settings/ExpensesManager';
import SquareMeterCalculator from '@/components/settings/SquareMeterCalculator';
import SpecialServicesManager from '@/components/settings/SpecialServicesManager';
import IroningServiceManager from '@/components/settings/IroningServiceManager';
import GuardTelemetryPanel from '@/components/settings/GuardTelemetryPanel';
import ZapiConnectionCard from '@/components/settings/ZapiConnectionCard';
import MoinhosPromptCard from '@/components/settings/MoinhosPromptCard';
import AiModelSettings from '@/components/settings/AiModelSettings';
import PricingRulesManager from '@/components/settings/PricingRulesManager';
import OperationalCatalogManager from '@/components/settings/OperationalCatalogManager';
import LoyaltyProgramManager from '@/components/settings/LoyaltyProgramManager';
import { CreditCard, Receipt, Calculator, ShieldCheck, Tags, ListChecks, Gift } from "lucide-react";

export default function Settings() {
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  
  // Product Form
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [newProduct, setNewProduct] = useState({ name: "", description: "", family: "", category: "Limpeza", price: "" });

  const DEFAULT_SYSTEM_PROMPT = `Você é o “Chat 5àsec”, assistente virtual oficial de atendimento ao cliente 24/7 da rede 5àsec no Brasil. Você atende via WhatsApp (integração Z-API), app e web. Seu objetivo é: (1) orientar e resolver dúvidas com precisão, (2) criar e administrar orçamentos por imagem com revisão humana, (3) acompanhar pedidos e pagamentos com base nos dados do sistema, (4) registrar incidentes e encaminhar para humanos com contexto completo, (5) operar com segurança, privacidade (LGPD) e governança, mesmo usando um conector não-oficial (Z-API).

IMPORTANTE — CONTEXTO DE RISCO (Z-API):
A integração Z-API pode permitir envio de mensagens a qualquer momento e pode também gerar eventos/entradas “inbound” que não necessariamente representam uma iniciativa do cliente. Portanto, você deve assumir que qualquer evento recebido pode ser: (a) mensagem real do cliente, (b) eco/registro de uma mensagem enviada pelo sistema, (c) disparo indevido/automatizado de outbound sem opt-in, ou (d) evento técnico.
Você NUNCA deve iniciar conversas proativas com o cliente sem verificar consentimento (opt-in) e sem registrar compliance, mesmo se o sistema tecnicamente permitir. Se detectar sinais de outbound sem opt-in, você deve tratar como incidente de compliance, registrar ticket e acionar mitigação (vide “MITIGAÇÃO OPERACIONAL”).

REGRAS DE OURO (NUNCA QUEBRE):
1) PREÇOS E SERVIÇOS: você não pode inventar preços, prazos, serviços, promoções, políticas ou disponibilidade. Para qualquer preço/serviço, você DEVE consultar e retornar apenas o que vier do catálogo Base44 via API GET /catalog/services. Se não houver dado, diga que precisa confirmar e faça handoff humano (ticket).
2) DADOS SENSÍVEIS: nunca solicite nem processe dados sensíveis (ex.: número completo de cartão, CVV, senhas, códigos, documentos completos, dados bancários). Se o cliente enviar, peça para não compartilhar e ofereça alternativa segura (chave Pix oficial + envio de comprovante) ou atendente humano.
3) CONSENTIMENTO PARA PROATIVIDADE: antes de qualquer mensagem iniciada pela empresa (aniversário, reengajamento 30 dias, CSAT 7 dias, lembrete, marketing), confirme e valide opt-in registrado no CRM (/customers + consents). Sem opt-in válido: NÃO ENVIE. Crie tarefa/registro e ou ticket para humano.
4) TRATAR INBOUND COMO POTENCIALMENTE “NÃO-CLIENTE”: antes de responder com conteúdo proativo, ou antes de continuar uma sequência automatizada, verifique metadados de origem da mensagem: direction/initiator/source (CUSTOMER vs SYSTEM vs STAFF). Se for SYSTEM/STAFF ou “eco”, não responda como se fosse cliente; apenas registre em logs/auditoria e siga regras de compliance.
5) HANDOFF HUMANO SEMPRE DISPONÍVEL: se o cliente pedir atendente (“atendente”, “humano”, “falar com alguém”), se houver ambiguidade, ou se o caso for sensível/alto risco, transfira para humano e crie ticket com contexto.
6) ORÇAMENTOS: todo orçamento finalizado pelo cliente deve ir para estágio HUMAN_REVIEW com SLA máximo de 1 hora para correção/aprovação humana. Você deve notificar equipe interna e informar claramente ao cliente que o valor final será validado.
7) MULTIMODAL: áudios devem ser transcritos antes de interpretação. Imagens devem ser processadas para identificar tipo de peça e serviços aplicáveis. Qualquer mídia recebida via Z-API deve ser copiada para o storage Base44 via /attachments antes de ser utilizada em orçamento/pedido; se não for possível copiar, abra incidente técnico e faça handoff.
8) SEGURANÇA: nunca exponha tokens, IDs de instância, chaves do Stripe/OpenAI, segredos do webhook. Nunca oriente o usuário a fornecer credenciais. Exija validação de webhook e aplique rate-limit. Se suspeitar de abuso/fraude/spam/vazamento, interrompa e faça handoff.

IDENTIDADE, TOM E LIMITES:
- Tom: moderno, empático, profissional, direto e útil. Pode usar no máximo 1 emoji discreto quando fizer sentido. Evite informalidade excessiva.
- Idioma: detecte automaticamente o idioma do cliente e responda no mesmo idioma (pt-BR por padrão). Se houver dúvida, pergunte: “Você prefere português, inglês ou espanhol?”.
- Limites: ao listar preços, mostre no máximo 3 alternativas (sempre do catálogo). Não negocie políticas da franquia, reembolsos, exceções ou promessas de compensação. Se pedirem exceção, registre ticket e encaminhe.

POLÍTICAS PRÁTICAS DE PRIVACIDADE (LGPD) — COMO AGIR:
- Minimização: peça somente o mínimo necessário. Para status, priorize {{order_id}}. Para orçamento, imagens + confirmação rápida (se dúvida). Para pagamentos, use apenas a chave Pix oficial e solicite o comprovante.
- Consentimento (opt-in/out): antes de mensagens proativas, confirme e registre opt-in. Se o cliente disser “PARAR”, “REMOVER”, “NÃO QUERO”, registre opt-out imediatamente e confirme por mensagem.
- Finalidade: use dados somente para atendimento e execução do serviço. Não reutilize para marketing sem opt-in.
- Solicitações LGPD (acesso/exclusão): abra ticket “Privacidade/LGPD” e encaminhe para fluxo do DPO/encarregado.
- Redação (PII): ao escrever resumos e logs, mascare PII (ex.: telefone parcial).

FALLBACK E HANDOFF HUMANO (COM CONTEXTO, FILAS E PRIORIDADE):
Acione humano quando:
- Cliente pediu atendente.
- Após 2 tentativas você não entendeu a intenção/slots, ou há baixa confiança.
- Reclamação grave (dano/extravio), cobrança contestada, urgência alta, suspeita de fraude, problemas técnicos, ou falta de dados em catálogo/OMS.
Ao fazer handoff:
- Crie ticket via /conversations/{{conversation_id}}/tickets com: conversation_id, customer_id, intent, slots coletados, anexos, quote_id/order_id, e um resumo estruturado.
- Classifique prioridade e fila:
  - ALTA: orçamento (SLA 1h), extravio/dano, locker travado/urgente, incidente de compliance, urgência por evento.
  - MÉDIA: atraso, cobrança, reagendamento.
  - BAIXA: dúvidas gerais, informações.
- Informe ao cliente: “Encaminhei para um atendente. Você receberá retorno por aqui/e-mail.”
- Nunca prometa compensação; diga que será analisado por equipe.

MULTIMODAL — ORÇAMENTO POR IMAGENS (PASSO A PASSO OPERACIONAL):
- Para cada imagem:
  1) Salvar mídia em /attachments (copiar do Z-API para storage Base44) e obter attachment_id.
  2) Classificar peça (visão) retornando garment_type + confidence + notes.
  3) Se confidence < 0,75, pedir confirmação com pergunta curta (uma escolha).
  4) Consultar catálogo via GET /catalog/services (por garment_type e unit_id, quando disponível).
  5) Adicionar item em /quotes/{{quote_id}}/items.
  6) Mostrar subtotal parcial e perguntar se há mais peças.
- Finalização:
  - Criar/atualizar quote com status HUMAN_REVIEW e deadline de 60 minutos.
  - Criar ticket de revisão (prioridade ALTA) e notificar equipe interna.
  - Enviar ao cliente um “pré-orçamento” e prazo de 1 hora para validação.

TRANSCRIÇÃO DE ÁUDIO:
- Se existir áudio: transcreva para texto antes de interpretar e detectar idioma.
- Se transcrição for incerta, faça confirmação do entendimento.

STATUS DO PEDIDO / ROUPA PRONTA:
- Se o cliente perguntar se a roupa está pronta ou qual o status do pedido, NUNCA tente consultar o sistema. Diga imediatamente para ele aguardar um minuto e faça o handoff para humano criando um ticket (HUMAN_HANDOFF).

PAGAMENTOS (PIX):
- Nunca peça dados de cartão.
- Informe a chave Pix oficial da operação e peça o envio do comprovante no próprio chat.
- Se o cliente enviar dados de cartão, recuse e peça para usar somente o Pix.

REGRA UNIVERSAL PARA MENSAGENS PROATIVAS (OBRIGATÓRIA):
Antes de qualquer disparo proativo, você deve:
1) Verificar opt-in no CRM (/customers + consents).
2) Confirmar explicitamente com o cliente quando necessário: “Você autoriza receber mensagens por WhatsApp/e-mail?”
3) Se não houver opt-in: NÃO enviar; criar tarefa/ticket.
4) Se houver discrepância (mensagem “parece proativa” sem opt-in), registrar incidente (compliance) e acionar mitigação.

DETECÇÃO E RESPOSTA A DISPARO INDEVIDO (COMPLIANCE) — OBRIGATÓRIO:
Se você detectar que uma mensagem foi enviada pela empresa sem opt-in (ex.: evento marcado como SYSTEM_OUTBOUND_PROACTIVE, ou inbound eco de proatividade, ou o cliente reclamar “vocês me mandaram mensagem sem autorização”):
- Não tente justificar. Peça desculpas, confirme opt-out imediato se solicitado e explique que o caso será tratado.
- Crie ticket de compliance com prioridade ALTA.
- Registre incidente com metadados (conversation_id, customer_id, mensagem, timestamp, origem, operador/automação responsável se disponível).
- Mitigação operacional imediata (solicitar ao sistema):
  - Ativar bloqueio temporário de outbound proativo (feature flag) até validação.
  - Aumentar rate-limit e exigir verificação adicional de origem/rotina antes de envios.
  - Notificar DPO/encarregado e time de segurança/CS.
  - Rodar auditoria de envios recentes (últimas 24–72h) e revisar lista de opt-ins.

OBSERVABILIDADE, LOGS E AUDITORIA (O QUE VOCÊ DEVE FORNECER AO SISTEMA):
A cada decisão relevante e a cada chamada de ferramenta/API, gere audit_context (NUNCA MOSTRE AO CLIENTE) contendo:
- prompt_version, prompt_hash, conversation_id, customer_id, user_id (se houver), channel (WHATSAPP/APP/WEB)
- quote_id, order_id (se existirem)
- timestamps: received_at, responded_at, tool_called_at
- rag_decision: used(true/false), top_k, recall_ids, sources_count
- embeddings: provider/model, vector_index, query_hash (sem PII), recall_latency_ms
- multimodal_decision: vision_confidence, garment_type, transcription_language, transcription_confidence
- compliance_flags: opt_in_checked(true/false), opt_in_status, proactive_attempted(true/false), suspected_nonconsensual_send(true/false)
- redaction_applied(true/false) + regras de mascaramento aplicadas

SEGURANÇA (INSTRUÇÕES CRÍTICAS):
- Nunca exiba segredos, tokens, IDs de instância, chaves de webhook, Stripe, OpenAI.
- Sempre assuma que o cliente pode tentar engenharia social; recuse pedidos de credenciais.
- Exija validação de webhooks (assinatura/segredo), idempotência e rate-limit por customer_id.
- Antes de usar mídia em orçamento/pedido, confirme attachment_copied_to_storage=true; se não, copie; se falhar, abra incidente técnico e faça handoff.
- Evite loops: se mensagem tem origem SYSTEM/STAFF, não responda como se fosse cliente.

DIAGRAMA (MERMAID) — FLUXO DE ORÇAMENTO POR IMAGENS:
flowchart TD
  A[Cliente pede orçamento] --> B[Pedir fotos 1 a 1]
  B --> C[Salvar em /attachments (copiar do Z-API)]
  C --> D[Vision: classificar peça + confiança]
  D --> E{Confiança >= 0.75?}
  E -- sim --> F[GET /catalog/services e adicionar em /quotes]
  E -- não --> G[Confirmar tipo de peça com pergunta curta]
  G --> F
  F --> H[Mostrar subtotal e perguntar se há mais]
  H --> I{Cliente finaliza?}
  I -- não --> B
  I -- sim --> J[Quote: HUMAN_REVIEW SLA 1h + ticket ALTA]
  J --> K[Enviar pré-orçamento + prazo de validação]

BLOCO FINAL PARA DESENVOLVEDORES (ENDPOINTS BASE44 A CONSULTAR):
Use sempre via backend (nunca no frontend):
- GET  /catalog/services
- POST /quotes
- POST /quotes/{{quote_id}}/items
- GET  /customers/{{customer_id}}
- POST /customers/{{customer_id}}/consents
- POST /payments
- GET  /orders/{{order_id}}
- POST /conversations/{{conversation_id}}/tickets
- POST /attachments

EXEMPLO JSON — obter preço (NUNCA inventar):
{
  "method": "GET",
  "path": "/catalog/services",
  "query": {
    "garment_type": "camisa_social",
    "service_type": "lavagem_profissional",
    "unit_id": "{{unit_id}}",
    "currency": "BRL"
  },
  "audit_context": {
    "prompt_version": "chat5asec_system_v2",
    "conversation_id": "{{conversation_id}}",
    "customer_id": "{{customer_id}}",
    "quote_id": "{{quote_id}}",
    "channel": "{{channel}}",
    "opt_in_checked": true,
    "redaction_applied": true
  }
}

EXEMPLO JSON — criar quote (pré-orçamento) e iniciar SLA humano 1h:
{
  "method": "POST",
  "path": "/quotes",
  "body": {
    "customer_id": "{{customer_id}}",
    "status": "HUMAN_REVIEW",
    "review_deadline_minutes": 60,
    "channel": "{{channel}}",
    "notes": "Pré-orçamento por imagens; revisar e aprovar em até 1h."
  },
  "audit_context": {
    "prompt_version": "chat5asec_system_v2",
    "conversation_id": "{{conversation_id}}",
    "customer_id": "{{customer_id}}",
    "channel": "{{channel}}"
  }
}
Exemplos in-context (10) — JSON array  [
  {
    "name": "iniciar_orcamento_por_imagens",
    "messages": [
      { "role": "user", "content": "Oi, quero um orçamento. Posso mandar fotos?" },
      {
        "role": "assistant",
        "content": "Claro, {{customer_name}}! Envie **1 foto por vez** (uma peça por imagem). Vou identificar a peça e montar um **pré-orçamento**.\\n\\nQuando terminar, diga **“finalizar”**. O valor final fica **em análise humana** e te retornamos em até **1 hora**."
      }
    ]
  },
  {
    "name": "adicionar_imagem_ao_orcamento",
    "messages": [
      { "role": "user", "content": "Segue a primeira peça (imagem)." },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/attachments",
          "body": { "source": "ZAPI", "media_type": "IMAGE", "zapi_media_url": "{{zapi_image_url}}" },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "customer_id": "{{customer_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "attachment_id": "att_001", "copied_to_storage": true } },
      {
        "role": "assistant",
        "tool": "openai_vision_classify",
        "input": { "attachment_id": "att_001", "instruction": "Retorne JSON: garment_type, confidence, notes." }
      },
      { "role": "tool", "tool": "openai_vision_classify", "output": { "garment_type": "camisa_social", "confidence": 0.88, "notes": "Peça clara; aparenta algodão." } },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "GET",
          "path": "/catalog/services",
          "query": { "garment_type": "camisa_social", "unit_id": "{{unit_id}}", "currency": "BRL" },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "customer_id": "{{customer_id}}", "attachment_id": "att_001" }
        }
      },
      {
        "role": "tool", "tool": "base44_request", "output": {
          "services": [
            { "service_id": "SVC-101", "name": "Lavagem profissional - Camisa social", "price": 19.9, "currency": "BRL" }
          ]
        }
      },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/quotes/{{quote_id}}/items",
          "body": {
            "garment_type": "camisa_social",
            "qty": 1,
            "attachment_ids": ["att_001"],
            "selected_services": ["SVC-101"],
            "unit_price": 19.9,
            "currency": "BRL",
            "confidence": 0.88
          },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "quote_id": "{{quote_id}}", "customer_id": "{{customer_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "ok": true } },
      {
        "role": "assistant",
        "content": "Perfeito! Identifiquei **camisa social** e somei **Lavagem profissional**: R$ {{price}}.\\n\\nVocê quer adicionar mais peças? Se sim, envie a próxima foto. Se terminou, diga **“finalizar”**."
      }
    ]
  },
  {
    "name": "confirmar_item_incerto",
    "messages": [
      { "role": "user", "content": "Mais uma peça (imagem)." },
      {
        "role": "assistant",
        "tool": "openai_vision_classify",
        "input": { "attachment_id": "att_002", "instruction": "Retorne garment_type e confidence." }
      },
      { "role": "tool", "tool": "openai_vision_classify", "output": { "garment_type": "vestido", "confidence": 0.62, "notes": "Pode ser vestido ou saia longa." } },
      {
        "role": "assistant",
        "content": "Estou em dúvida nesta imagem. Parece **vestido**, mas posso estar confundindo com **saia longa**.\\n\\nConfirma pra mim: é **(1) vestido** ou **(2) saia longa**?"
      }
    ]
  },
  {
    "name": "finalizar_orcamento_com_sla_humano",
    "messages": [
      { "role": "user", "content": "Finalizar." },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/quotes",
          "body": {
            "customer_id": "{{customer_id}}",
            "status": "HUMAN_REVIEW",
            "review_deadline_minutes": 60,
            "channel": "WHATSAPP",
            "notes": "Cliente finalizou envio de imagens; revisar em até 1h."
          },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "customer_id": "{{customer_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "quote_id": "{{quote_id}}", "status": "HUMAN_REVIEW" } },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/conversations/{{conversation_id}}/tickets",
          "body": { "type": "QUOTE_REVIEW", "quote_id": "{{quote_id}}", "priority": "HIGH", "sla_minutes": 60 },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "quote_id": "{{quote_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "ticket_id": "tkt_901", "queue": "CENTRAL" } },
      {
        "role": "assistant",
        "content": "Fechado! Seu pré-orçamento ficou como **{{quote_id}}** e agora está em **análise humana**.\\n\\nA gente valida e te retorna em até **1 hora**. Se preferir falar com atendente agora, diga **“atendente”**."
      }
    ]
  },
  {
    "name": "solicitar_handoff_humano",
    "messages": [
      { "role": "user", "content": "Quero falar com um atendente." },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/conversations/{{conversation_id}}/tickets",
          "body": {
            "type": "HUMAN_HANDOFF",
            "priority": "MEDIUM",
            "summary": "Cliente solicitou atendente humano.",
            "context": { "last_intent": "{{intent}}", "quote_id": "{{quote_id}}", "order_id": "{{order_id}}" }
          },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "customer_id": "{{customer_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "ticket_id": "tkt_902", "queue": "CENTRAL" } },
      {
        "role": "assistant",
        "content": "Perfeito. Já encaminhei para um atendente com todo o contexto (protocolo **tkt_902**). Você receberá retorno por aqui.\\n\\nPra eu agilizar: é sobre **orçamento**, **pedido** ou **reclamação**?"
      }
    ]
  },
  {
    "name": "reagendar_coleta",
    "messages": [
      { "role": "user", "content": "Preciso reagendar a coleta para amanhã à tarde." },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/appointments/reschedule",
          "body": { "order_id": "{{order_id}}", "new_window": "AMANHA_TARDE", "address_id": "{{address_id}}" },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "order_id": "{{order_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "ok": true, "scheduled_for": "2026-02-21T14:00:00-03:00" } },
      {
        "role": "assistant",
        "content": "Pronto! Reagendei a coleta para **amanhã à tarde**.\\n\\nSe quiser, me diga uma janela mais específica (ex.: 14h–16h) que eu tento ajustar."
      }
    ]
  },
  {
    "name": "enviar_link_pagamento_stripe",
    "messages": [
      { "role": "user", "content": "Pode me mandar o link pra eu pagar?" },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/payments",
          "body": { "quote_id": "{{quote_id}}", "method": "PIX", "amount": "{{price}}" },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "quote_id": "{{quote_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "payment_id": "pay_1001", "payment_link": "{{payment_link}}" } },
      {
        "role": "assistant",
        "content": "Claro! Aqui está seu link de pagamento seguro (Stripe): {{payment_link}}\\n\\nAssim que o pagamento confirmar, eu te aviso por aqui."
      }
    ]
  },
  {
    "name": "status_do_pedido_handoff",
    "messages": [
      { "role": "user", "content": "Minha roupa já está pronta?" },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/conversations/{{conversation_id}}/tickets",
          "body": {
            "type": "HUMAN_HANDOFF",
            "priority": "MEDIUM",
            "summary": "Cliente perguntou se a roupa está pronta.",
            "context": { "last_intent": "status_pedido" }
          },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "customer_id": "{{customer_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "ticket_id": "tkt_903", "queue": "CENTRAL" } },
      {
        "role": "assistant",
        "content": "Aguarde um minuto, por favor. Vou transferir para um de nossos atendentes conferir isso pra você agora mesmo!"
      }
    ]
  },
  {
    "name": "recusar_dado_sensivel",
    "messages": [
      { "role": "user", "content": "Meu cartão é 4111 1111 1111 1111, pode debitar?" },
      {
        "role": "assistant",
        "content": "Eu não posso receber nem processar dados de cartão aqui. Por segurança, **não envie número de cartão** pelo WhatsApp.\\n\\nEu posso te mandar um **link de pagamento seguro (Stripe)** ou te colocar com um atendente. Qual você prefere?"
      }
    ]
  },
  {
    "name": "csat_sete_dias_apos_finalizacao_com_optin",
    "messages": [
      {
        "role": "assistant",
        "content": "Antes de eu enviar uma pesquisa rápida de satisfação por WhatsApp, preciso confirmar: você autoriza receber mensagens proativas por aqui? (responda **SIM** ou **NÃO**)"
      },
      { "role": "user", "content": "SIM" },
      {
        "role": "assistant",
        "tool": "base44_request",
        "input": {
          "method": "POST",
          "path": "/customers/{{customer_id}}/consents",
          "body": { "type": "WHATSAPP_NOTIFICATIONS", "status": "OPT_IN", "source": "WHATSAPP" },
          "audit_context": { "prompt_version": "chat5asec_system_v2", "conversation_id": "{{conversation_id}}", "customer_id": "{{customer_id}}" }
        }
      },
      { "role": "tool", "tool": "base44_request", "output": { "ok": true } },
      {
        "role": "assistant",
        "content": "Obrigado! Pesquisa rápida (10 segundos):\\nDe 0 a 10, como foi sua experiência com o pedido **{{order_id}}**?\\n\\nSe quiser parar de receber mensagens, responda **PARAR**."
      }
    ]
  }
]
Templates WhatsApp (3) — JSON [
  {
    "name": "chat5asec_quote_ready_v2",
    "category": "UTILITY",
    "language": "pt_BR",
    "requires_opt_in": true,
    "body_text": "Olá, {{customer_name}}! Seu orçamento {{quote_id}} foi revisado e está pronto. Total: {{price}}. Quer que eu envie o link de pagamento?"
  },
  {
    "name": "chat5asec_payment_link_v2",
    "category": "UTILITY",
    "language": "pt_BR",
    "requires_opt_in": true,
    "body_text": "Olá, {{customer_name}}! Aqui está seu link de pagamento seguro referente ao pedido {{order_id}}: {{payment_link}}. Se precisar, responda esta mensagem."
  },
  {
    "name": "chat5asec_csat_7d_v2",
    "category": "UTILITY",
    "language": "pt_BR",
    "requires_opt_in": true,
    "body_text": "Olá, {{customer_name}}! Queremos melhorar 🙂 Sobre o pedido {{order_id}}, de 0 a 10, qual sua satisfação? (Para parar de receber mensagens, responda PARAR.)"
  }
]`;

  // General Config Mock (In real app, fetch from Config entity)
  const [config, setConfig] = useState({
    operatingHours: "08:00 - 18:00",
    autoReply: true,
    welcomeMessage: "Olá! Bem-vindo à 5àSec. Como podemos ajudar?",
    aiModel: "gpt-4o",
    aiTemperature: 0.7,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  });

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Product.list('name');
      setProducts(list);
    } catch (err) {
      console.error("Error loading products:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProduct = async () => {
    if (!newProduct.name || !newProduct.price) return;
    
    try {
      if (editingProduct) {
        await base44.entities.Product.update(editingProduct.id, {
          ...newProduct,
          price: parseFloat(newProduct.price)
        });
      } else {
        await base44.entities.Product.create({
          ...newProduct,
          price: parseFloat(newProduct.price),
          active: true
        });
      }
      setIsProductDialogOpen(false);
      setEditingProduct(null);
      setNewProduct({ name: "", description: "", family: "", category: "Limpeza", price: "" });
      loadProducts();
    } catch (err) {
      console.error("Error saving product:", err);
    }
  };

  const handleEditProduct = (product) => {
    setEditingProduct(product);
    setNewProduct({
      name: product.name,
      description: product.description || "",
      family: product.family || "",
      category: product.category || "Limpeza",
      price: product.price.toString()
    });
    setIsProductDialogOpen(true);
  };

  const handleDeleteProduct = async (id) => {
    if (confirm("Remover este serviço?")) {
      await base44.entities.Product.delete(id);
      loadProducts();
    }
  };

  const exportToCSV = () => {
    const headers = ['Nome', 'Família', 'Categoria', 'Descrição', 'Preço (R$)'];
    const rows = products.map(p => [
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${(p.family || '').replace(/"/g, '""')}"`,
      `"${(p.category || '').replace(/"/g, '""')}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      p.price
    ]);
    
    // Add BOM for correct UTF-8 rendering in Excel
    const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'tabela_precos_5asec.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-white">Configurações</h1>
        <p className="text-white/60 text-sm mt-1">Gerencie serviços, preços e automações.</p>
      </div>

      <Tabs defaultValue="services" className="w-full flex flex-col md:flex-row gap-6 items-start">
        <TabsList className="flex md:flex-col h-auto w-full md:w-60 shrink-0 flex-wrap md:flex-nowrap justify-start bg-white/5 border border-white/10 p-1.5 gap-1 md:sticky md:top-20">
          <TabsTrigger value="connection" className="w-auto md:w-full justify-start data-[state=active]:bg-green-600 data-[state=active]:text-white text-gray-400">
            <QrCode className="w-4 h-4 mr-2" /> Conexão WhatsApp
          </TabsTrigger>
          <TabsTrigger value="services" className="w-auto md:w-full justify-start data-[state=active]:bg-[#FF6600] data-[state=active]:text-white text-gray-400">
            <Shirt className="w-4 h-4 mr-2" /> Serviços e Preços
          </TabsTrigger>
          <TabsTrigger value="special_services" className="w-auto md:w-full justify-start data-[state=active]:bg-pink-600 data-[state=active]:text-white text-gray-400">
            <Sparkles className="w-4 h-4 mr-2" /> Serviços Especiais
          </TabsTrigger>
          <TabsTrigger value="ironing" className="w-auto md:w-full justify-start data-[state=active]:bg-sky-600 data-[state=active]:text-white text-gray-400">
            <Shirt className="w-4 h-4 mr-2" /> Passadoria
          </TabsTrigger>
          <TabsTrigger value="m2_calculator" className="w-auto md:w-full justify-start data-[state=active]:bg-cyan-600 data-[state=active]:text-white text-gray-400">
            <Calculator className="w-4 h-4 mr-2" /> Calculadora m²
          </TabsTrigger>
          <TabsTrigger value="promotions" className="w-auto md:w-full justify-start data-[state=active]:bg-yellow-500 data-[state=active]:text-black text-gray-400">
            <Tag className="w-4 h-4 mr-2" /> Promoções
          </TabsTrigger>
          <TabsTrigger value="ai_config" className="w-auto md:w-full justify-start data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400">
            <Brain className="w-4 h-4 mr-2" /> Inteligência Artificial
          </TabsTrigger>
          <TabsTrigger value="ai_telemetry" className="w-auto md:w-full justify-start data-[state=active]:bg-orange-600 data-[state=active]:text-white text-gray-400">
            <Sparkles className="w-4 h-4 mr-2" /> Telemetria da IA
          </TabsTrigger>
          <TabsTrigger value="general" className="w-auto md:w-full justify-start data-[state=active]:bg-[#4C12A1] data-[state=active]:text-white text-gray-400">
            <SettingsIcon className="w-4 h-4 mr-2" /> Geral
          </TabsTrigger>
          <TabsTrigger value="unit_access" className="w-auto md:w-full justify-start data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-gray-400">
            <ShieldCheck className="w-4 h-4 mr-2" /> Governança & Acessos
          </TabsTrigger>
          <TabsTrigger value="pricing_rules" className="w-auto md:w-full justify-start data-[state=active]:bg-violet-600 data-[state=active]:text-white text-gray-400">
            <Tags className="w-4 h-4 mr-2" /> Regras de Preço
          </TabsTrigger>
          <TabsTrigger value="operational_catalogs" className="w-auto md:w-full justify-start data-[state=active]:bg-orange-600 data-[state=active]:text-white text-gray-400">
            <ListChecks className="w-4 h-4 mr-2" /> Catálogos
          </TabsTrigger>
          <TabsTrigger value="loyalty" className="w-auto md:w-full justify-start data-[state=active]:bg-pink-600 data-[state=active]:text-white text-gray-400">
            <Gift className="w-4 h-4 mr-2" /> Fidelidade
          </TabsTrigger>
          <TabsTrigger value="card_fees" className="w-auto md:w-full justify-start data-[state=active]:bg-teal-600 data-[state=active]:text-white text-gray-400">
            <CreditCard className="w-4 h-4 mr-2" /> Taxas de Cartões
          </TabsTrigger>
          <TabsTrigger value="expenses" className="w-auto md:w-full justify-start data-[state=active]:bg-red-500 data-[state=active]:text-white text-gray-400">
            <Receipt className="w-4 h-4 mr-2" /> Despesas
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 w-full min-w-0">

        {/* CONNECTION TAB */}
        <TabsContent value="connection" className="mt-0 space-y-6">
            <ZapiConnectionCard
                store="main"
                title="Conexão WhatsApp (Z-API)"
                description="Instância 5àsec conectada ao atendimento."
                accent="green"
            />
        </TabsContent>

        {/* AI CONFIG TAB */}
        <TabsContent value="ai_config" className="mt-0 space-y-6">
          <AiModelSettings />

          <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-400" />
                Prompt da Rede (Geral)
              </CardTitle>
              <CardDescription className="text-gray-400">
                Personalidade e instruções principais usadas em todas as lojas da rede.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={config.systemPrompt}
                onChange={(e) => setConfig({...config, systemPrompt: e.target.value})}
                className="min-h-[200px] bg-white/5 border-white/10 font-mono text-sm leading-relaxed"
                placeholder="Ex: Você é um assistente útil..."
              />
              <div className="flex justify-end mt-4">
                 <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                   <Save className="w-4 h-4 mr-2" /> Salvar Configurações de IA
                 </Button>
               </div>
            </CardContent>
          </Card>

          <MoinhosPromptCard />
        </TabsContent>

        {/* SERVICES TAB */}
        <TabsContent value="services" className="mt-0">
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Catálogo de Serviços</CardTitle>
                <CardDescription className="text-gray-400">Defina os preços base para os orçamentos automáticos.</CardDescription>
              </div>
              <div className="flex gap-4">
                  <Input 
                      placeholder="Buscar serviço..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-black/20 border-white/10 w-64"
                  />
                  <Button variant="outline" onClick={exportToCSV} className="border-white/10 hover:bg-white/5 text-green-400 hover:text-green-300">
                    <Download className="w-4 h-4 mr-2" /> Exportar Excel
                  </Button>
                  <Dialog open={isProductDialogOpen} onOpenChange={(open) => {
                    setIsProductDialogOpen(open);
                    if (!open) {
                      setEditingProduct(null);
                      setNewProduct({ name: "", description: "", family: "", category: "Limpeza", price: "" });
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button className="bg-[#FF6600] hover:bg-[#ff7b24] text-white">
                        <Plus className="w-4 h-4 mr-2" /> Novo Serviço
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-[#1a0b36] border border-white/10 text-white">
                  <DialogHeader>
                    <DialogTitle>{editingProduct ? 'Editar Serviço' : 'Adicionar Serviço'}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nome do Serviço</Label>
                      <Input 
                        value={newProduct.name}
                        onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                        placeholder="Ex: Terno Completo"
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Descrição / Benefício</Label>
                      <Input 
                        value={newProduct.description}
                        onChange={(e) => setNewProduct({...newProduct, description: e.target.value})}
                        placeholder="Ex: Brancura extrema..."
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Família</Label>
                      <Input 
                        value={newProduct.family}
                        onChange={(e) => setNewProduct({...newProduct, family: e.target.value})}
                        placeholder="Ex: Roupas, Cama, Mesa"
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Categoria</Label>
                        <select 
                          value={newProduct.category}
                          onChange={(e) => setNewProduct({...newProduct, category: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-sm"
                        >
                          <option value="Limpeza">Limpeza</option>
                          <option value="Passadoria">Passadoria</option>
                          <option value="Costura">Costura</option>
                          <option value="Especial">Especial</option>
                          <option value="Planos">Planos</option>
                          <option value="Bags">Bags</option>
                          </select>
                      </div>
                      <div className="space-y-2">
                        <Label>Preço (R$)</Label>
                        <Input 
                          type="number"
                          value={newProduct.price}
                          onChange={(e) => setNewProduct({...newProduct, price: e.target.value})}
                          placeholder="0.00"
                          className="bg-white/5 border-white/10"
                        />
                      </div>
                    </div>
                    <Button onClick={handleCreateProduct} className="w-full bg-[#FF6600] hover:bg-[#ff7b24] mt-4">
                      Salvar
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#FF6600]" /></div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {products
                    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.family?.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((product) => (
                    <motion.div 
                      key={product.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-start justify-between gap-3 group hover:border-[#FF6600]/30 transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-blue-300 shrink-0">
                          <ProductIcon product={product} className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-sm break-words leading-snug" title={product.name}>{product.name}</h4>
                          {product.description && (
                            <p className="text-xs text-gray-400 line-clamp-2 mb-1" title={product.description}>{product.description}</p>
                          )}
                          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                             <span>{product.family}</span>
                             {product.category && product.category !== 'Limpeza' && <span>• {product.category}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-[#FF6600]">R$ {product.price.toFixed(2)}</div>
                        <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => handleEditProduct(product)}
                            className="text-xs text-blue-400 hover:underline"
                          >
                            Editar
                          </button>
                          <span className="text-gray-600">•</span>
                          <button 
                            onClick={() => handleDeleteProduct(product.id)}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {products.length === 0 && (
                    <div className="col-span-full text-center py-8 text-gray-500">
                      Nenhum serviço cadastrado.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SPECIAL SERVICES TAB */}
        <TabsContent value="special_services" className="mt-0 space-y-6">
          <SpecialServicesManager />
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-pink-400" />
                Benefícios dos Serviços Especiais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="hidden">
                <table className="w-full text-sm text-left text-gray-300">
                  <thead className="text-xs text-gray-400 uppercase bg-black/20 border-b border-white/10">
                    <tr>
                      <th className="px-6 py-3">Peça</th>
                      <th className="px-6 py-3">Bactericida (Saúde)</th>
                      <th className="px-6 py-3">Branco+ / Revitalizante / Engomagem</th>
                      <th className="px-6 py-3">Impermeabilização (Proteção)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Edredom</td>
                      <td className="px-6 py-4">R$ 40,00</td>
                      <td className="px-6 py-4">R$ 35,00</td>
                      <td className="px-6 py-4">R$ 35,00</td>
                    </tr>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Casacos</td>
                      <td className="px-6 py-4">R$ 26,00</td>
                      <td className="px-6 py-4">R$ 21,00</td>
                      <td className="px-6 py-4">R$ 21,00</td>
                    </tr>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Cortinas</td>
                      <td className="px-6 py-4">R$ 25,00</td>
                      <td className="px-6 py-4">R$ 20,00</td>
                      <td className="px-6 py-4">R$ 20,00</td>
                    </tr>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Tapete</td>
                      <td className="px-6 py-4">R$ 27,00 / m²</td>
                      <td className="px-6 py-4">-</td>
                      <td className="px-6 py-4">-</td>
                    </tr>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Vestidos</td>
                      <td className="px-6 py-4">R$ 22,00</td>
                      <td className="px-6 py-4">R$ 17,00</td>
                      <td className="px-6 py-4">R$ 17,00</td>
                    </tr>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Macacão</td>
                      <td className="px-6 py-4">R$ 20,00</td>
                      <td className="px-6 py-4">R$ 15,00</td>
                      <td className="px-6 py-4">R$ 15,00</td>
                    </tr>
                    <tr className="hover:bg-white/5">
                      <td className="px-6 py-4 font-medium text-white">Demais Peças</td>
                      <td className="px-6 py-4">R$ 14,00</td>
                      <td className="px-6 py-4">R$ 10,00</td>
                      <td className="px-6 py-4">R$ 14,00</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                  <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-white"></div> Branco+
                  </h4>
                  <p className="text-sm text-gray-400">Brancura extrema e alvejamento seguro para coloridas sem danificar a fibra.</p>
                </div>
                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                  <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-400"></div> Revitalizante
                  </h4>
                  <p className="text-sm text-gray-400">Recupera o brilho e a intensidade das cores e a maciez do toque.</p>
                </div>
                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                  <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400"></div> Bactericida
                  </h4>
                  <p className="text-sm text-gray-400">Higienização profunda (99,9%) e eliminação de odores e alérgenos.</p>
                </div>
                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                  <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-400"></div> Engomagem
                  </h4>
                  <p className="text-sm text-gray-400">Acabamento profissional, vincos perfeitos e economia de tempo.</p>
                </div>
                <div className="bg-black/20 p-4 rounded-xl border border-white/5 md:col-span-2">
                  <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400"></div> Impermeabilização
                  </h4>
                  <p className="text-sm text-gray-400">Proteção invisível contra líquidos e manchas em roupas e estofados.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai_telemetry" className="mt-0 space-y-6">
          <GuardTelemetryPanel />
        </TabsContent>

        <TabsContent value="ironing" className="mt-0 space-y-6">
          <IroningServiceManager />
        </TabsContent>

        <TabsContent value="m2_calculator" className="mt-0 space-y-6">
          <SquareMeterCalculator />
        </TabsContent>

        <TabsContent value="promotions" className="mt-0 space-y-6">
          <PromotionsManager />
        </TabsContent>

        <TabsContent value="unit_access" className="mt-0 space-y-6">
          <UnitAccessManager />
        </TabsContent>

        <TabsContent value="pricing_rules" className="mt-0 space-y-6">
          <PricingRulesManager />
        </TabsContent>

        <TabsContent value="operational_catalogs" className="mt-0 space-y-6">
          <OperationalCatalogManager />
        </TabsContent>

        <TabsContent value="loyalty" className="mt-0 space-y-6">
          <LoyaltyProgramManager />
        </TabsContent>

        <TabsContent value="card_fees" className="mt-0">
          <CardFeesManager />
        </TabsContent>

        <TabsContent value="expenses" className="mt-0">
          <ExpensesManager />
        </TabsContent>

        {/* GENERAL TAB */}
        <TabsContent value="general" className="mt-0 space-y-6">
           <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
             <CardHeader>
               <CardTitle>Horário de Atendimento Humano</CardTitle>
               <CardDescription className="text-gray-400">Configure o horário da equipe. A IA responde automaticamente 24h por dia.</CardDescription>
             </CardHeader>
             <CardContent className="space-y-4">
               <div className="flex items-center gap-4">
                 <Clock className="w-5 h-5 text-[#FF6600]" />
                 <Input 
                    value={config.operatingHours}
                    onChange={(e) => setConfig({...config, operatingHours: e.target.value})}
                    className="bg-white/5 border-white/10 max-w-xs"
                 />
                 <span className="text-xs text-gray-500">Seg-Sex</span>
               </div>
             </CardContent>
           </Card>

           <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
             <CardHeader>
               <CardTitle>Respostas Automáticas</CardTitle>
               <CardDescription className="text-gray-400">Personalize as mensagens padrão do chatbot.</CardDescription>
             </CardHeader>
             <CardContent className="space-y-6">
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2">
                   <MessageSquare className="w-5 h-5 text-purple-400" />
                   <Label>Ativar Auto-Resposta</Label>
                 </div>
                 <Switch 
                   checked={config.autoReply}
                   onCheckedChange={(v) => setConfig({...config, autoReply: v})}
                 />
               </div>
               
               <div className="space-y-2">
                 <Label>Mensagem de Boas-vindas</Label>
                 <textarea 
                    value={config.welcomeMessage}
                    onChange={(e) => setConfig({...config, welcomeMessage: e.target.value})}
                    className="w-full min-h-[100px] bg-white/5 border border-white/10 rounded-md p-3 text-sm focus:outline-none focus:border-[#FF6600]/50"
                 />
               </div>
               
               <div className="flex justify-end">
                 <Button className="bg-[#4C12A1] hover:bg-[#5d1dbf] text-white">
                   <Save className="w-4 h-4 mr-2" /> Salvar Alterações
                 </Button>
               </div>
             </CardContent>
           </Card>
        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}