# Contratos de domínio do ERP Grupo Brilhante

## Convenções

Todos os registros críticos utilizam `legal_entity_id`, `unit_id` quando aplicável, `status`, `created_by_user_id`, `updated_by_user_id` e timestamps da plataforma. Valores monetários são números com arredondamento em centavos. Pesos usam quilogramas com três casas decimais. Identificadores externos são strings e nunca substituem o `id` interno.

## Fundação empresarial

| Entidade | Finalidade | Campos centrais |
|---|---|---|
| `BusinessGroup` | Grupo econômico | `name`, `trade_name`, `status`, `default_currency`, `timezone` |
| `LegalEntity` | Empresa/CNPJ e regime | `group_id`, `legal_name`, `trade_name`, `tax_id`, `state_registration`, `municipal_registration`, `tax_regime`, `status`, endereço fiscal, contatos |
| `CostCenter` | Centro de custo hierárquico | `legal_entity_id`, `code`, `name`, `parent_id`, `unit_id`, `status`, vigência |
| `BankAccount` | Conta bancária empresarial | `legal_entity_id`, `bank_code`, agência/conta mascaradas, `account_type`, `pix_key_type`, `status`, `integration_status` |
| `Warehouse` | Depósito e posição de estoque | `legal_entity_id`, `unit_id`, `code`, `name`, `warehouse_type`, endereço, `status` |
| `CompanyAccessGrant` | Escopo empresarial adicional por usuário | `user_id`, `legal_entity_id`, `unit_ids`, permissões, vigência, status |

`Unit` recebe `legal_entity_id`, `code`, `unit_type`, `cost_center_id`, `default_warehouse_id`, `status` e endereço estruturado. Registros legados podem manter `legal_entity_id` vazio até migração; comandos do novo ERP não podem criar registros órfãos.

## Cadastro unificado

| Entidade | Finalidade | Campos centrais |
|---|---|---|
| `BusinessParty` | Pessoa/empresa multipapel | tipo, nome/razão, documento, situação, segmento, dados fiscais e relacionamento |
| `PartyRole` | Papel do cadastro | cliente, fornecedor, tomador, prestador, transportador, hospital, parceiro, colaborador |
| `PartyContact` | Contatos múltiplos | tipo, nome, função, telefone, e-mail, preferências e consentimentos |
| `PartyAddress` | Endereços múltiplos | fiscal, cobrança, entrega, coleta, operacional; CEP e geolocalização |
| `PartyDocument` | Certidões e documentos | tipo, validade, hash, arquivo, verificação e status |

`Customer` e `Supplier` permanecem durante a migração e podem apontar para `business_party_id`. Novos contratos e documentos usam `BusinessParty` como fonte canônica.

## CRM, contratos e ordens de serviço

| Entidade | Finalidade | Campos centrais |
|---|---|---|
| `SalesOpportunity` | Funil B2B | origem, etapa, temperatura, score, valor, probabilidade, responsável, próxima ação, perda |
| `BusinessActivity` | Reunião, visita, ligação e tarefa | oportunidade, responsável, início/fim, resultado, próxima ação e anexos |
| `BusinessContract` | Contrato operacional/comercial | empresa, cliente, modalidade, vigência, ciclo, reajuste, SLA, status e responsáveis |
| `ContractVersion` | Versão/aditivo imutável | contrato, versão, snapshot, motivo, aprovação, vigência |
| `ContractPriceItem` | Tabela contratual | serviço/item, unidade de cobrança, faixa, preço, franquia, excedente e vigência |
| `ServiceOrder` | Ordem de serviço genérica | contrato, cliente, local, prioridade, diagnóstico, equipe, materiais, evidências, assinatura e status |

Estados de contrato: `draft`, `pending_approval`, `active`, `suspended`, `expired`, `terminated`. Estados de OS: `draft`, `scheduled`, `in_progress`, `waiting_customer`, `quality_review`, `completed`, `cancelled`.

## Financeiro e controladoria

Entidades existentes `AccountsPayable`, `AccountsReceivable`, `PaymentReceipt`, `PaymentAllocation`, `CashSession`, `CashMovement`, `BankTransaction`, `BillingAgreement` e `BillingStatement` recebem empresa legal, centro de custo, conta bancária, competência e identificadores de migração.

| Entidade nova | Finalidade |
|---|---|
| `FinancialPeriod` | Abertura/fechamento mensal por empresa |
| `IntercompanyEntry` | Operação entre CNPJs com lados espelhados |
| `FinancialProjection` | Fluxo de caixa previsto e cenário |
| `ReconciliationBatch` | Importação e conciliação de extrato/retorno |
| `MigrationBatch` | Lote de migração Conta Azul |
| `MigrationRecord` | Registro de origem, hash, resultado e reconciliação |

Nenhuma baixa atualiza saldo sem preservar documento, alocação, conta, empresa, data de competência e evento idempotente.

## Banco do Brasil

| Entidade | Finalidade |
|---|---|
| `BankingAgreement` | Convênio e parâmetros não secretos por empresa/conta |
| `BankCharge` | Boleto/Pix cobrança e seu estado |
| `BankEvent` | Evento imutável do provedor |
| `BankReturnFile` | Arquivo CNAB/OFX, hash, processamento e conciliação |

Estados de cobrança: `draft`, `pending_submission`, `submitted`, `registered`, `paid`, `overdue`, `cancelled`, `refunded`, `error`, `repair_required`. O adaptador é desativado por padrão e não armazena credenciais.

## Fiscal e Focus NFe

`FiscalProfile`, `FiscalDocument` e `FiscalEvent` são preservados e recebem `legal_entity_id`. A transmissão é controlada por configuração empresarial e ambiente. Perfis precisam de município, regime, certificado configurado fora do banco, séries, códigos de serviço/produto e regras de retenção.

| Entidade nova | Finalidade |
|---|---|
| `TaxRule` | Regra tributária versionada por empresa, município, operação e vigência |
| `FiscalBatch` | Emissão/consulta em lote com checkpoints |
| `AccountingExport` | Pacote XML/PDF/relatório enviado à contabilidade |

## Compras e estoque

| Entidade | Finalidade |
|---|---|
| `PurchaseRequest` | Solicitação de compra e alçada |
| `SupplierQuotation` | Resposta de fornecedor e condições |
| `PurchaseOrder` | Pedido aprovado, parcelas e entregas |
| `GoodsReceipt` | Recebimento parcial/total e divergências |

`StockItem`, `StockLot`, `StockMovement` e `InventoryCount` recebem `legal_entity_id` e `warehouse_id`. Movimentos válidos incluem recebimento, transferência, consumo, devolução, ajuste, perda, empréstimo, veículo, cliente e reversões correspondentes.

## Lavanderia hospitalar

| Entidade | Finalidade |
|---|---|
| `HospitalPickup` | Coleta hospitalar contratual |
| `WeighingRecord` | Peso bruto, tara, líquido, classe e evidências |
| `HospitalProcessingLot` | Lote industrial por cliente/classificação |
| `HospitalDeliveryConference` | Conferência de entrega e divergência |
| `HospitalBillingMeasurement` | Medição do período para faturamento |

Pesos não podem ser negativos; `net_weight_kg = gross_weight_kg - tare_weight_kg` é calculado no servidor. Toda correção preserva o valor anterior e a justificativa.

## Enxovais

| Entidade | Finalidade |
|---|---|
| `LinenCatalogItem` | Tipo, propriedade, custo e vida útil esperada |
| `LinenAsset` | Item/lote patrimonial com QR/RFID opcional |
| `LinenMovement` | Movimentação entre lavanderia, rota e cliente |
| `LinenInventorySession` | Inventário em hospital/cliente |
| `LinenLiabilityTerm` | Termo de responsabilidade |
| `LinenLossCharge` | Cobrança por perda ou dano |

## Limpeza empresarial

| Entidade | Finalidade |
|---|---|
| `CleaningSite` | Local/contrato atendido |
| `WorkPost` | Posto, função, turno e quantidade |
| `WorkSchedule` | Escala planejada e realizada |
| `CleaningChecklistTemplate` | Modelo por ambiente/frequência |
| `CleaningInspection` | Execução, evidência, nota e não conformidade |
| `ServiceMeasurement` | Medição mensal e aceite do cliente |
| `PayrollSyncJob` | Sincronização desacoplada com o DP |

## Assíncrono, reparo e observabilidade

| Entidade | Finalidade |
|---|---|
| `IntegrationJob` | Comando externo, tentativas, próxima tentativa e erro seguro |
| `RepairTask` | Falha parcial que exige continuação ou decisão humana |
| `DomainEvent` | Evento de negócio imutável para integrações e relatórios |
| `ReportSchedule` | Agendamento e destinatários de relatórios |

## Permissões novas

| Domínio | Permissões principais |
|---|---|
| Empresas | `companies.view`, `companies.view_all`, `companies.manage` |
| Centros e contas | `cost_centers.manage`, `bank_accounts.manage` |
| Cadastro | `parties.view`, `parties.manage`, `party_documents.manage` |
| CRM/contratos | `crm.manage`, `contracts.view`, `contracts.manage`, `contracts.approve` |
| OS | `service_orders.view`, `service_orders.execute`, `service_orders.approve` |
| Financeiro | `finance.view`, `finance.manage`, `finance.approve`, `finance.close_period` |
| Banco | `banking.view`, `banking.manage`, `banking.reconcile` |
| Fiscal | `fiscal.view`, `fiscal.manage`, `fiscal.transmit` |
| Compras | `purchases.view`, `purchases.manage`, `purchases.approve`, `receipts.manage` |
| Hospitalar | `hospital.view`, `hospital.weigh`, `hospital.quality`, `hospital.bill` |
| Enxovais | `linen.view`, `linen.manage`, `linen.inventory`, `linen.charge_loss` |
| Limpeza | `cleaning.view`, `cleaning.manage`, `cleaning.inspect`, `cleaning.measure` |
| Migração | `migration.view`, `migration.execute`, `migration.approve` |
| Integrações | `integrations.view`, `integrations.manage`, `repairs.manage` |

## Compatibilidade

Campos novos entram opcionais no schema durante a migração. Funções novas exigem os vínculos. Um validador progressivo mede registros órfãos e impede a promoção de uma empresa enquanto houver financeiro, fiscal, banco, estoque ou contratos sem `legal_entity_id`.
