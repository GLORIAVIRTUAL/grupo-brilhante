# Checklist de ativação — hardening da auditoria integral

**Autor:** Manus AI

**Data:** 5 de setembro de 2026

**Branch:** `fix/full-system-audit-hardening`

**Base sincronizada:** `origin/main` em `5861985`

> **Estado atual:** as correções permanecem isoladas na branch e não foram mergeadas nem publicadas no Base44. A ativação deve permanecer bloqueada até que os secrets, webhooks, agendas e o piloto administrativo abaixo estejam preparados.

## 1. Resumo da mudança

A entrega fecha os bloqueadores P0/P1 encontrados na auditoria: autenticação explícita em endpoints privilegiados, proteção contra SSRF no download de mídia, enforcement de suspensão/revogação/MFA, autorização por unidade, logout real, alçadas comerciais configuráveis, aposentadoria do relatório DOCX fictício e integração idempotente de pagamentos com fidelidade, vouchers e pacotes.

| Área | Situação após a correção | Condição para ativar |
|---|---|---|
| Funções com `asServiceRole` | 82 de 82 possuem guard de usuário, token interno ou assinatura de provedor | Configurar token interno e credenciais dos provedores antes da publicação |
| WhatsApp/Z-API | Remetentes e webhooks falham de forma segura; não simulam sucesso | Configurar tokens e ajustar os webhooks para enviar `client-token` |
| WhatsApp Cloud/Meta | GET usa verify token e POST valida HMAC SHA-256 do corpo bruto | Configurar verify token e app secret; validar assinatura real em sandbox |
| Mídia remota | HTTPS, DNS público, allowlist opcional, bloqueio de redirects, timeout, MIME e limite de 15 MB | Definir allowlist mínima recomendada e testar URLs reais do provedor |
| Acesso e sessão | Suspensão, revogação, MFA e escopo de unidade são verificados no frontend e nas funções privilegiadas | Validar `mfa_status` e o claim JWT `iat` com conta administrativa real |
| Alçadas | Desconto/acréscimo consulta política ativa por unidade e papel | Conferir políticas comerciais ativas e limites do piloto |
| Pagamentos e CRM | Pontos apenas após confirmação; voucher/pacote antes da liquidação; estorno tenta compensação auditável | Testar em ambiente controlado, sem transação financeira real |
| Relatórios | Endpoint DOCX fictício retorna `410`; central especializada usa dados reais e escopo de unidade | Confirmar que nenhuma integração externa depende do endpoint aposentado |

## 2. Secrets e variáveis obrigatórias

Os valores devem ser criados diretamente no gerenciador de secrets do Base44. **Não inserir valores no Git, em documentação, mensagens, logs ou parâmetros de URL.** O arquivo `.env.example` contém apenas nomes vazios.

| Integração | Variáveis | Obrigatoriedade e observação |
|---|---|---|
| Chamadas internas | `INTERNAL_FUNCTION_TOKEN` | Obrigatório antes da publicação. Gerar valor aleatório forte, exclusivo deste aplicativo e com rotação controlada. O cabeçalho preferencial é `x-internal-token`; chamadas server-side encadeadas usam `_internal_token` no corpo. |
| Z-API principal | `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_SECURITY_TOKEN` | Os dois primeiros autorizam envio; o terceiro valida o webhook pelo cabeçalho `client-token`. Sem qualquer item, a integração fica indisponível com falha segura. |
| Z-API Moinhos | `ZAPI_MOINHOS_INSTANCE_ID`, `ZAPI_MOINHOS_TOKEN`, `ZAPI_MOINHOS_SECURITY_TOKEN` | Mesmo contrato da integração principal, isolado por unidade/provedor. |
| WhatsApp Cloud Moinhos | `WHATSAPP_MOINHOS_ACCESS_TOKEN`, `WHATSAPP_MOINHOS_PHONE_NUMBER_ID`, `WHATSAPP_MOINHOS_VERIFY_TOKEN`, `WHATSAPP_MOINHOS_APP_SECRET` | GET de verificação compara o verify token; POST exige `x-hub-signature-256` calculado sobre o corpo bruto. |
| Download de mídia | `MEDIA_DOWNLOAD_HOST_ALLOWLIST` | Recomendado. Informar somente hosts HTTPS realmente usados pelo provedor, separados por vírgula. Não usar IPs, curingas amplos ou domínios não controlados. |
| IA de imagens | `GEMINI_API_KEY`, `AI_IMAGE_ALLOWED_HOSTS` | Manter os hosts de imagens no menor conjunto possível. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Necessários somente se a integração Stripe for ativada. O webhook continua sujeito à assinatura criptográfica. |
| Asaas | `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT` | Manter `ASAAS_ENVIRONMENT=sandbox` durante a homologação. Nenhum pagamento real deve ser disparado nesta etapa. |
| Build Base44 | `VITE_BASE44_APP_ID`, `VITE_BASE44_APP_BASE_URL`, `BASE44_APP_ID` | Configuração do aplicativo/build; não substitui secrets de integração. |

## 3. Agendas, gatilhos e chamadas internas

Antes da publicação, revisar cada invocador abaixo. Uma agenda sem o token correto será recusada deliberadamente; isso é preferível a executar anonimamente.

| Função | Origem esperada | Contrato após o hardening |
|---|---|---|
| `scheduled_automations` | Agenda Base44 | POST com `x-internal-token` ou `_internal_token` |
| `checkInactiveNewCustomers` | Agenda Base44 | POST com token interno |
| `checkExpiredQuotes` | Agenda ou execução administrativa | Token interno; usuário gestor também pode executar manualmente |
| `generateRecurringExpenses` | Agenda ou execução administrativa | Token interno; usuário gestor/financeiro também pode executar manualmente |
| `recoverUnansweredMessages` | Agenda ou administrador | Token interno ou sessão administrativa elegível |
| `processDispatchQueue` | Fila/agendamento ou administrador | Token interno ou sessão de `super_admin`/`admin` |
| `aiReplyTrigger` | Gatilho de nova mensagem | Token interno obrigatório no payload/cabeçalho do gatilho |
| `orchestrator` | Webhooks e gatilhos internos | Token interno obrigatório; chamadores internos já propagam o secret |
| `schedulePickupTool` | Somente orquestrador | Token interno obrigatório |
| `calculateSquareMeterQuote` | Painel autenticado ou orquestrador | Usuário elegível ou token interno |

O cabeçalho legado `x-automation-token` continua aceito temporariamente **somente com o valor de `INTERNAL_FUNCTION_TOKEN`**, para facilitar a migração de agendas existentes. Novas configurações devem usar `x-internal-token`.

## 4. Ordem segura de ativação

| Etapa | Ação | Critério de aprovação |
|---|---|---|
| 1 | Registrar o commit atual da `main`, exportar configuração dos webhooks/agendas e definir responsável pelo rollback | Evidência armazenada fora do repositório |
| 2 | Criar `INTERNAL_FUNCTION_TOKEN` no gerenciador de secrets | Valor forte, não exposto e acessível às funções |
| 3 | Configurar tokens de provedor e allowlists | Painel de status mostra itens necessários como configurados |
| 4 | Atualizar agendas e gatilhos para o novo contrato | Cada invocador obtém resposta autorizada em teste controlado |
| 5 | Configurar webhooks Z-API com `client-token` | Evento de teste do provedor é aceito; token ausente/incorreto retorna 401 |
| 6 | Configurar webhook Meta | Verificação GET aprovada; POST válido aceito; assinatura inválida retorna 401 |
| 7 | Validar conta administrativa com MFA | `mfa_status=verified` proveniente de fluxo confiável e rotas administrativas acessíveis |
| 8 | Validar revogação de sessão | Token anterior a `session_revoked_after` é recusado e login novo funciona |
| 9 | Executar piloto sem efeitos externos | Usar registros temporários identificados; não enviar WhatsApp, cobrar, emitir NFS-e ou alterar dados reais |
| 10 | Publicar em janela controlada | Monitoramento ativo e responsável disponível para rollback |

## 5. Roteiro de homologação controlada

O piloto deve utilizar uma unidade e clientes de teste. Nenhuma confirmação deve representar dinheiro real, mensagem real ou documento fiscal real.

| Cenário | Resultado esperado |
|---|---|
| Usuário suspenso chama função diretamente | Recusa com `ACCOUNT_BLOCKED` |
| Papel com MFA obrigatório e `mfa_status` pendente | Recusa com `MFA_REQUIRED` |
| Sessão com JWT anterior a `session_revoked_after` | Recusa com `SESSION_REVOKED` |
| Usuário limitado solicita unidade externa | Recusa com `UNIT_SCOPE_DENIED` ou recurso não encontrado |
| Webhook Z-API sem `client-token` | 401; nenhum registro e nenhum envio |
| Webhook Meta com HMAC inválido | 401; corpo não processado |
| Downloader recebe host privado, DNS privado ou redirect | Bloqueio antes do download |
| Desconto acima da política | `commercial_approval_required`; desconto não persistido |
| Voucher/pacote em pedido já pago | `benefit_requires_unpaid_order` |
| Retry com mesma chave e payload diferente | `idempotency_conflict` |
| Falha parcial de recebimento/confirmação | Código `*_repair_required`; o sistema não repete automaticamente a mutação financeira |
| Pagamento pendente | Nenhum ponto concedido |
| Pagamento confirmado | Pontos concedidos uma vez |
| Estorno integral | Pontos revertidos e benefícios restaurados ou marcados como `attention_required` para reparo |
| Endpoint `generateReport` | HTTP 410 sem dados fictícios |

## 6. Plano de rollback

Se houver bloqueio indevido de login, interrupção de webhook, agenda recusada ou inconsistência financeira, interromper novas operações do fluxo afetado e reverter a publicação para o commit anterior. Não remover os secrets durante a investigação, pois isso pode ampliar a indisponibilidade de funções ainda executando a versão nova.

| Sintoma | Ação imediata | Evidência a preservar |
|---|---|---|
| WhatsApp deixa de receber | Confirmar `client-token`/HMAC e status 401/503; se não for corrigível na janela, reverter o deploy | ID do request, horário e status HTTP; nunca o token ou corpo com dados pessoais |
| Agendas retornam 401/503 | Suspender a agenda, conferir `INTERNAL_FUNCTION_TOKEN` e contrato do invocador | Nome da agenda, função e ID do request |
| Administrador bloqueado por MFA/revogação | Não alterar `mfa_status` manualmente sem validar o IdP; usar outra conta administrativa homologada ou reverter | Usuário técnico, evento de sessão e horário |
| Recebimento retorna `*_repair_required` | Não repetir com nova chave; isolar o recibo/pagamento e conciliar manualmente por responsável financeiro | IDs do evento, recibo, pagamento, alocações e auditoria |
| Benefício retorna `attention_required` | Não reaplicar voucher/pacote; revisar ledgers e checkpoints antes de compensar | Pedido, voucher/pacote, chave idempotente e ledger |

## 7. Validações executadas

| Validação | Resultado |
|---|---|
| Empacotamento de todas as funções server-side | 0 falhas |
| Validadores cumulativos e testes das Ondas 1–4 | Aprovados |
| Testes de auditoria (guards, alçadas, fidelidade, benefícios, logout, relatório) | Aprovados |
| Lint dirigido dos arquivos alterados | 0 erros; avisos legados no `Chat.jsx` |
| Build Vite | Aprovado; o sandbox apenas alerta que variáveis Base44 de build não estão definidas localmente |
| `git diff --check` | Aprovado |
| Cobertura de guards em funções com `asServiceRole` | 82/82 |
| Auditoria de dependências | 0 críticas, 0 altas, 4 moderadas; correções restantes exigem mudança de major/downgrade incompatível |
| Typecheck global | 129 erros legados, contra 132 na `origin/main`; nenhuma regressão líquida |
| Lint global | 22 erros legados, contra 30 na `origin/main`; nenhuma regressão líquida |

## 8. Riscos residuais e condicionantes

O MFA implementado é **enforcement de aplicação**, não um segundo fator autônomo. A segurança depende de o provedor de identidade concluir um desafio real e atualizar `User.mfa_status` de forma confiável. A revogação depende do claim JWT `iat`; deve ser validada com uma sessão real do Base44 antes do deploy.

A Base44 não oferece, neste código, transação ACID abrangendo múltiplas entidades. Os fluxos financeiros e de benefícios usam chave idempotente, checkpoints, compensação e estados `*_repair_required`, mas concorrência simultânea extrema ainda pode exigir reparo administrativo. O procedimento correto é bloquear repetição automática e preservar a trilha de auditoria.

O motor de relatórios especializados ainda carrega coleções amplas antes de filtrar em memória. O escopo de unidade foi fechado, mas paginação/consulta server-side é uma otimização P2. O relatório de logística ainda se apoia principalmente em coletas e comprovantes, não em toda a telemetria de `DeliveryRoute`, `RouteStop` e `RouteEvent`.

As quatro vulnerabilidades moderadas restantes são transitivas/associadas a `react-quill` e `react-router-dom`; a correção automática disponível implicaria alteração incompatível. A vulnerabilidade crítica previamente identificada no jsPDF foi removida por atualização compatível.

## 9. Decisão de release

**Código:** apto para PR sob revisão.

**Produção:** aprovação condicionada à configuração e aos testes operacionais das seções 2–5.

**Ação proibida sem nova confirmação do usuário:** merge, publicação Base44, envio de WhatsApp, pagamento, emissão fiscal ou alteração de dados reais.
