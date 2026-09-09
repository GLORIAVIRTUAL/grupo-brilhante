# Matriz de aceite — ERP Grupo Brilhante

**Autor:** Manus AI

**Data:** 9 de setembro de 2026

Esta matriz distingue **cobertura de código** de **ativação operacional**. Um módulo pode estar implementado e validado estaticamente, mas depender de cadastro, secret, sandbox ou aceite humano antes de produzir efeitos externos.

| # | Domínio do roteiro | Cobertura de código | Evidência principal | Condicionante operacional |
|---:|---|---|---|---|
| 1 | Grupo econômico e multiempresa | Implementado | `BusinessGroup`, `LegalEntity`, `Unit`, `manage_enterprise_core` | Cadastrar CNPJs e vincular unidades |
| 2 | Centros de custo, depósitos e contas | Implementado | `CostCenter`, `Warehouse`, `BankAccount` | Definir estrutura real por CNPJ |
| 3 | Segurança por papel, unidade e CNPJ | Implementado | `CompanyAccessGrant`, `functionSecurity.js`, `manage_access_control` | Provar MFA real e revisar grants |
| 4 | Auditoria, eventos e reparo | Implementado | `AuditLog`, `DomainEvent`, `RepairTask` | Definir retenção e rotina de monitoramento |
| 5 | Gestão documental | Implementado | `DocumentAsset`, `manage_document_assets`, `DocumentRepository.jsx` | Configurar armazenamento e retenção |
| 6 | Cadastro unificado | Implementado | `BusinessParty`, papéis, contatos, endereços e documentos | Migrar/deduplicar clientes e fornecedores |
| 7 | CRM e funil B2B | Implementado | `SalesOpportunity`, `BusinessActivity`, `BusinessRegistry.jsx` | Configurar etapas e responsáveis reais |
| 8 | Contratos e preços | Implementado | `BusinessContract`, `ContractVersion`, `ContractPriceItem` | Cadastrar cláusulas, reajustes e preços aprovados |
| 9 | Ordens de serviço | Implementado | `ServiceOrder`, `manage_service_orders` | Definir SLAs e evidências por contrato |
| 10 | Financeiro multiempresa | Implementado | `FinancialPeriod`, `FinancialProjection`, `manage_financial_core` | Cadastrar saldos e competências iniciais |
| 11 | Intercompany | Implementado | `IntercompanyEntry`, lados espelhados, checkpoints e reparo | Homologar plano de contas entre CNPJs |
| 12 | Migração Conta Azul | Implementado até dry-run | `MigrationBatch`, `MigrationRecord`, `manage_conta_azul_migration` | Export real, reconciliação e aprovação; gate fechado |
| 13 | Banco do Brasil, boleto e Pix | Preparado para homologação | `BankCharge`, gateway, webhook, conciliação e `BankingOperations.jsx` | Credenciais, convênio, sandbox e gates fechados |
| 14 | NFS-e e Focus NFe | Preparado para homologação | Perfil fiscal por CNPJ, reserva de RPS, filas, gateway e webhook | Token de homologação, município, série e gates fechados |
| 15 | Compras corporativas | Implementado | Requisição, pedido, recebimento físico e `manage_procurement_core` | Cadastrar fornecedores, alçadas e depósitos |
| 16 | Estoque corporativo | Implementado | Estoque por CNPJ/depósito, lotes, FEFO/FIFO e transferências | Saldos iniciais e inventário de abertura |
| 17 | Lavanderia hospitalar por peso | Implementado | Coleta, pesagem, lote, qualidade, entrega e medição | Contratos, balanças, preços e piloto operacional |
| 18 | Aluguel e gestão de enxovais | Implementado | Catálogo, patrimônio, QR, movimentos, inventário e perdas | Cadastro patrimonial e termos assinados |
| 19 | Limpeza empresarial | Implementado | Locais, checklists, inspeções, ocorrências, SLA e medições | Cadastrar locais, modelos e equipes |
| 20 | Terceirização e escalas | Implementado; DP preparado | Postos, escalas e `payroll_sync_gateway` | Contrato do provedor DP e gates fechados |
| 21 | Atendimento omnichannel e IA | Implementado | Consentimentos, templates, conhecimento, filas, handoff e token efêmero | Secrets dos canais e revisão de consentimentos |
| 22 | Site institucional e leads | Implementado | Landing preservada, `B2BLeadForm`, `public_b2b_lead` e UTM | Allowlist, CNPJ/unidade padrão e política de privacidade |
| 23 | Relatórios e inteligência gerencial | Implementado | Datasets permitidos, relatórios, agendamentos e resumo executivo | Destinatários e entrega externa ainda bloqueada |
| 24 | Automações e jobs | Implementado | `IntegrationJob`, token interno, backoff e tarefas de reparo | Configurar agendas com segredo interno |
| 25 | Operação herdada de lavanderia | Preservada | Validadores das Ondas 1–4 aprovados | Smoke test no ambiente Base44 |
| 26 | Agenda e encaixes | Corrigido | Capacidade por unidade, coletas fixas e limite de dois encaixes/dia | Validar parâmetros reais de capacidade |
| 27 | Logística de campo | Preservada | Frota, rotas, eventos, comprovantes e permissões | Cadastrar frota e motoristas do Grupo |
| 28 | Homologação e rollback | Documentado | `erp-grupo-brilhante-release-readiness.md` | Executar no ambiente antes da produção |

## Critérios de aceite globais

| Critério | Resultado atual |
|---|---|
| Escopo por CNPJ nas novas operações | Aprovado em testes determinísticos |
| Funções server-side compiláveis | 130/130 |
| Schemas válidos | 152/152 |
| Novas páginas protegidas | 14/14 |
| Efeitos externos inativos por padrão | Aprovado |
| Credenciais no código | Nenhuma detectada |
| Operação herdada | Ondas 1–4 aprovadas |
| Build | Aprovado |
| Publicação | Não realizada |

## Classificação final

| Classe | Itens |
|---|---|
| **Implementado e testado em código** | 1–12, 15–24, 26–28 |
| **Preparado para homologação externa** | 13 e 14 |
| **Preservado e revalidado** | 25 e 27 |
| **Ativado em produção** | Nenhum item novo |

> A aceitação de produção depende de bootstrap, dados de teste, MFA real, homologação do Banco do Brasil, Focus NFe e DP, ensaio de migração e smoke test Base44. A aprovação do pull request não deve ativar automaticamente esses serviços.
