# Arquitetura de segurança

A evolução adota o princípio de que o frontend apresenta intenções, enquanto decisões críticas são recalculadas e autorizadas nas funções server-side. O navegador não é fonte confiável para preço, total do pedido, estado do pagamento, escopo de unidade ou resultado de documentos.

## Limites de confiança

| Limite | Regra aplicada |
|---|---|
| Navegador → função | A função autentica o usuário, valida papel e unidade e recalcula valores sensíveis. |
| Arquivo → armazenamento | Formato, tamanho, extensão, nome, hash e duplicidade são avaliados antes do processamento. |
| IA → regra de negócio | A saída é tratada como sugestão. Catálogo, preço, totais e transições são validados determinística e separadamente. |
| Provedor → webhook | Assinatura e idempotência são obrigatórias antes de criar pedido ou confirmar pagamento. |
| Usuário → financeiro | Aprovação, pagamento, conciliação, cancelamento e estorno são eventos distintos. |
| Unidade → unidade | O papel e as unidades permitidas são validados no frontend para experiência e no backend para segurança. |

## Papéis

| Papel | Escopo principal |
|---|---|
| `super_admin` | Administração global, configuração e todas as unidades. |
| `admin` | Administração, usuários, unidades e auditoria. |
| `manager` | Supervisão operacional, aprovações, caixa, terceiros e exceções. |
| `attendant` | Cliente, orçamento, entrada e identificação de peças. |
| `cashier` | Recebimento presencial, caixa e consultas financeiras permitidas. |
| `production` | Movimentação de peças, lotes e controle de qualidade. |
| `inventory` | Fornecedores, notas de compra, insumos, inventário e movimentos. |
| `finance` | Contas, documentos, aprovação, liquidação e conciliação. |
| `driver` | Coletas, entregas e estados logísticos autorizados. |
| `auditor` | Consulta de auditoria e relatórios, sem alteração operacional. |

O array `permissions` permite exceções explícitas sem ampliar todo o papel. O array `allowed_unit_ids`, em conjunto com `primary_unit_id`, define o escopo multiunidade.

## Pagamentos

`generate_payment_link` autentica o usuário, carrega pedido ou orçamento no backend, valida unidade, recalcula o valor e restringe a URL de retorno. `stripe_webhook` valida o evento e registra `ProcessedEvent` antes de converter orçamento ou atualizar pagamento.

`record_counter_payment` calcula o saldo aberto a partir do pedido. Dinheiro pode ser confirmado no balcão; cartão exige confirmação explícita do terminal; Pix sem conciliação permanece `pending_confirmation`. Comprovantes recebidos por imagem entram em revisão e não geram `succeeded`.

## Documentos e IA

`DocumentAsset` registra classificação, URL, hash, tamanho, tipo MIME, retenção e estado de validação. `AIJob` registra modelo, duração, confiança, resultado, erro e necessidade de revisão. `HumanReview` registra motivo, prioridade, responsável, decisão e correções.

A ausência de `GEMINI_API_KEY` não aciona respostas simuladas. O documento permanece disponível para revisão manual, permitindo que o sistema continue operacional sem confundir indisponibilidade de integração com análise real.

## Idempotência e consistência

`ProcessedEvent` protege aprovação de orçamento, documentos, despesas recorrentes, pagamentos e webhooks. Cada operação crítica usa uma chave derivada da origem e do identificador externo ou interno. Repetições concluídas retornam o resultado existente em vez de criar novos registros.

Operações que envolvem múltiplas entidades usam estados intermediários, auditoria e, quando possível, compensação. A ausência de transações distribuídas nativas exige atenção especial durante a homologação de falhas parciais.

## Auditoria e cancelamento

`AuditLog` registra ator, papel, unidade, solicitação, motivo, valores, estado anterior e posterior. O cancelamento substitui exclusões destrutivas. Um pagamento liquidado não pode ser simplesmente apagado; deve seguir o fluxo de estorno ou reembolso.

## Endpoints internos

`debug_orchestrator` e `list_files` estão bloqueados por padrão. Mesmo quando `ENABLE_INTERNAL_DEBUG_ENDPOINTS=true`, ambos exigem usuário administrativo. Essa variável deve permanecer desativada em produção.

## Pendências de segurança antes da produção

A homologação deve confirmar as regras efetivas de acesso das entidades no Base44, o armazenamento privado dos documentos, a política de retenção, o mecanismo de rotação de segredos, o fluxo de reembolso do provedor escolhido e a assinatura de todos os webhooks públicos. O painel visual de permissões no frontend não substitui as regras server-side.
