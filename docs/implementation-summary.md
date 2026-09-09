# Resumo da implementação

A branch `feat/intelligent-management-suite` transforma a página **Gestão** em um centro de comando operacional sem remover os indicadores, tabelas, modais e módulos que já existiam. A implementação foi realizada de modo aditivo, com novos schemas e funções server-side, além de ampliações compatíveis nos modelos existentes.

## Entregas

| Domínio | Entrega |
|---|---|
| Gestão | Hero operacional, ações rápidas, indicadores de exceção e áreas de operação, estoque, financeiro e revisão. |
| Orçamento | Caminho manual com características por peça e caminho por múltiplas fotos, ambos usando catálogo, revisão humana e aprovação idempotente. |
| Peças | `GarmentItem`, `GarmentEvent`, estados, atributos, avarias, fotos, localização, prazo e entrega parcial. |
| Qualidade | Checklist, decisão, evidências, retrabalho automático e liberação controlada. |
| Terceiros | Parceiros, ordens externas, evidências de envio e retorno, qualidade e conta a pagar. |
| Compras | Fornecedor, nota, itens, associação a insumos, custo médio, entrada de estoque e obrigação financeira. |
| Estoque | Insumos, movimentos, inventários, lotes, mínimo, custo médio e fichas de consumo. |
| Financeiro | Contas a pagar/receber, documentos, aprovação, liquidação, caixa, alocação e conciliação. |
| Segurança | Papéis, permissões, unidades, idempotência, auditoria, proteção de endpoints, upload e cancelamento auditado. |
| Integrações | `.env.example`, diagnóstico de prontidão sem revelar segredos e comportamento seguro sem tokens. |
| Serviços por peça | Composição de vários serviços, compatibilidade por produto, regras específicas e preço recalculado no servidor. |
| Etiquetas e localização | QR térmico por peça, reimpressão auditada, leitor por câmera/USB, posições, capacidade e movimentação em lote. |
| Entrega | Retirada total ou parcial, bloqueio por saldo, liberação gerencial, prova opcional e comprovante. |
| Recebimentos | Recibo composto, múltiplos meios, pagamento parcial, troco, confirmação posterior e estorno sem perda do histórico. |
| Crédito e faturados | Razão de crédito, convênios, limites, autorização de pedidos, fechamento periódico e títulos consolidados. |
| Orçamentos | Validade individual, versões imutáveis, alçadas, envio, aceite, rejeição, reabertura, cancelamento e conversão em pedido. |
| Fiscal | Perfil por unidade, RPS sequencial, preparação e validação local; transmissão NFS-e bloqueada até homologação futura. |
| Estoque operacional | Lotes, validade, disponibilidade, transferências, perdas, inventário cego, congelamento lógico e ajustes auditados. |
| Produção e consumo | Fichas técnicas versionadas, previsão e baixa FEFO/FIFO, lotes por capacidade, máquinas configuráveis, execução guiada e reversão controlada. |
| Custos e alertas | Apontamento do operador, custos reais por lote, perfil versionado, perdas, desvios, gargalos e alertas deduplicados. |
| Governança | Papéis canônicos, permissões excepcionais, múltiplas unidades, suspensão, revisão de acesso, políticas de MFA e eventos de sessão. |
| Auditoria avançada | Consulta mult domínio, severidade, resultado, histórico antes/depois, mascaramento e exportação justificada. |
| Preços e catálogos | Regras versionadas, simulação pelo motor real, alçadas e catálogos pesquisáveis de características e exceções. |
| CRM 360 | Consumo, recorrência, crédito, inadimplência, pontos, vouchers, pacotes, preferências e atividade recente. |
| Analytics | Treze relatórios especializados com comparação, séries, distribuições, dados detalhados, definições e exportações. |
| Logística de campo | Frota, rotas, motorista, capacidade, GPS, tentativas, provas, recebedor, odômetro e eventos imutáveis. |

## Correção do orçamento manual

O fluxo manual agora inclui uma etapa dedicada às características de cada peça física. Cor, marca, material, estampa, tamanho, dimensões e detalhes podem ser copiados entre peças iguais, enquanto avarias, riscos, observações e ciência do cliente exigem conferência individual. Mesmo quando o carrinho possui várias unidades do mesmo produto, o orçamento persiste cada unidade com `qty: 1`, permitindo que `approve_quote` gere um `GarmentItem` distinto e preserve a condição observada.

Os campos de condição e ciência permanecem persistidos por peça, mas os ajustes posteriores incorporados à `main` permitem avançar com características pendentes e não bloqueiam a aprovação quando `condition_checked` é falso. A interface sinaliza as pendências sem interromper o atendimento, preservando o comportamento definido pelo usuário.

## Novas funções server-side

| Função | Responsabilidade |
|---|---|
| `analyze_garment_images` | Processar fotos e registrar confiança, tarefa de IA e revisão. |
| `approve_quote` | Converter orçamento em pedido e peças sem duplicidade. |
| `update_garment_status` | Aplicar transições válidas e gerar eventos. |
| `inspect_garment_quality` | Registrar inspeção, liberar ou abrir retrabalho. |
| `manage_third_party_job` | Controlar cadeia de custódia e retorno de terceiros. |
| `extract_purchase_document` | Extrair nota, fornecedor e itens com correspondência de estoque. |
| `approve_purchase_document` | Movimentar estoque, atualizar custo e criar conta a pagar. |
| `extract_financial_document` | Extrair contas e detectar duplicidades ou anomalias. |
| `approve_financial_document` | Criar obrigação financeira pendente. |
| `manage_accounts_payable` | Aprovar, rejeitar, liquidar ou cancelar obrigações. |
| `manage_cash_session` | Abrir, movimentar, conferir e fechar caixa. |
| `record_counter_payment` | Registrar pagamento presencial com valor recalculado no servidor. |
| `reconcile_payment` | Relacionar pagamento a transação bancária e alocar valores. |
| `resolve_human_review` | Registrar decisões da fila de revisão. |
| `cancel_management_record` | Substituir exclusão destrutiva por cancelamento auditado. |
| `integration_status` | Expor somente a presença dos segredos necessários. |
| `price_garment_services` | Recalcular composição, preço, prazo e etapas de cada peça no servidor. |
| `register_label_print` | Registrar impressão e exigir motivo para reimpressão de etiqueta. |
| `manage_location` | Criar, atualizar e arquivar posições físicas com autorização. |
| `move_garments` | Movimentar peças em lote com capacidade, ocupação, idempotência e eventos. |
| `complete_garment_delivery` | Concluir entrega total/parcial com validação financeira e comprovante. |
| `manage_payment_receipt` | Receber com múltiplos meios, alocar saldos e executar estorno auditado. |
| `confirm_payment_tender` | Confirmar posteriormente meios eletrônicos e aplicar o valor ao saldo atual. |
| `manage_customer_credit` | Conceder e ajustar crédito em razão imutável. |
| `manage_billing_agreement` | Administrar convênios, limites, clientes e pedidos faturados. |
| `close_billing_period` | Gerar prévia, demonstrativo e conta a receber consolidada por período. |
| `manage_quote_lifecycle` | Versionar e governar todo o ciclo comercial do orçamento. |
| `manage_fiscal_document` | Preparar e validar RPS, manter eventos e bloquear transmissão não homologada. |
| `manage_stock_operation` | Cadastrar, ajustar, transferir, devolver e registrar perdas com lote, saldo e auditoria. |
| `manage_inventory_count` | Executar inventário cego, revisar divergências e gerar ajustes transacionais. |
| `manage_consumption_recipe` | Versionar fichas técnicas por serviço, etapa, máquina e base de consumo. |
| `post_production_consumption` | Prever, baixar e reverter consumo por lote usando FEFO/FIFO. |
| `manage_machine` | Cadastrar máquinas, capacidades, custos, manutenção e identificadores legados. |
| `manage_production_batch` | Planejar e executar lotes com capacidade, materiais, estados e eventos. |
| `manage_labor_entry` | Apontar início, pausa, retomada, conclusão e custo do operador. |
| `manage_production_cost_profile` | Versionar mão de obra, energia, água, embalagem, qualidade e rateio. |
| `manage_operational_alerts` | Detectar, reconhecer, resolver e deduplicar exceções operacionais. |
| `manage_access_control` | Administrar papéis, permissões, unidades, suspensão, revisão e estado verificável de MFA. |
| `query_audit_log` | Consultar e exportar auditoria com escopo, filtros, mascaramento e justificativa. |
| `manage_pricing_rules` | Criar, simular, ativar, encerrar e versionar regras de preço e alçadas. |
| `manage_operational_catalog` | Normalizar, deduplicar, pesquisar e inativar catálogos operacionais. |
| `manage_loyalty_crm` | Gerir programas, pontos, vouchers, pacotes e gerar o snapshot CRM 360. |
| `generate_specialized_report` | Calcular os treze relatórios especializados com qualidade e definições. |
| `manage_fleet` | Administrar veículos, documentos, capacidade, custos e manutenção. |
| `manage_delivery_route` | Controlar rotas, paradas, jornada do motorista, geolocalização, tentativas e provas. |

## Funções endurecidas

`generate_payment_link` recalcula o valor e valida unidade e origem. `stripe_webhook` valida evento, impede duplicidade e preserva conversão de orçamento. `openai_vision` limita URLs, tamanho, tipo, tempo e preço por catálogo. `generateRecurringExpenses` passa a criar obrigação pendente em vez de despesa paga. `debug_orchestrator` e `list_files` ficam bloqueados por padrão. O orquestrador não confirma comprovantes visuais como pagamento.

## Compatibilidade

O orçamento manual, os gráficos financeiros, a tabela de tickets, os registros financeiros, a auditoria, o CRM e os demais módulos existentes continuam no projeto. O novo centro de comando é renderizado antes da área legada, e o rollback visual pode ser feito removendo apenas sua integração de `Management.jsx`.

## Validação

O build Vite conclui. Todos os arquivos novos e modificados passam no lint direcionado. As funções TypeScript alteradas passam no parser `esbuild`. O comando `npm run validate:wave2` verifica os domínios financeiro, comercial e fiscal. O comando `npm run validate:wave3` verifica os domínios de estoque e produção. O comando `npm run validate:wave4` confirma **84 schemas e 46 funções autenticadas**, os testes determinísticos de governança, analytics, fidelidade, vouchers e pacotes, lint, typecheck direcionado, oito funções server-side e build. Os sete módulos foram inspecionados em prévia local controlada; relatórios, catálogos e auditoria foram validados com dados completos. O typecheck direcionado registra zero erros na Onda 4; os 132 erros globais remanescentes pertencem ao legado fora desta entrega.
