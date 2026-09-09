# ERP Grupo Brilhante — prontidão para homologação

**Autor:** Manus AI

**Data:** 9 de setembro de 2026

**Branch de implementação:** `feat/erp-grupo-brilhante-full-implementation`

**Base integrada:** `9e061e3` da `main`

## 1. Parecer executivo

A implementação cobre o núcleo multiempresa e os módulos previstos no roteiro do ERP Grupo Brilhante, preservando a operação herdada. O código contém **152 schemas**, **130 funções server-side** e as novas centrais empresariais protegidas. Todas as chamadas bancárias, fiscais, de DP, de relatórios externos e de migração permanecem **desativadas por padrão**.

> **Decisão de release:** o código está apto para revisão por pull request e para homologação controlada. Não está autorizado para ativação de produção sem cadastro dos CNPJs, grants empresariais, credenciais de homologação, webhooks, agendas e execução dos testes operacionais deste documento.

| Área | Estado do código | Estado operacional |
|---|---|---|
| Multiempresa, CNPJs, unidades, centros de custo e depósitos | Implementado | Requer bootstrap cadastral |
| Segurança, MFA, grants por CNPJ e auditoria | Implementado | Requer IdP/MFA real e revisão de papéis |
| Cadastro unificado, CRM B2B, contratos e OS | Implementado | Pronto para piloto com dados controlados |
| Financeiro multiempresa e intercompany | Implementado | Pronto para piloto sem liquidação externa |
| Migração Conta Azul | Staging, validação e dry-run implementados | Execução bloqueada até arquivo real e aprovação |
| Banco do Brasil | Adaptador, fila, webhook e conciliação implementados | Sandbox/homologação pendente |
| Focus NFe | Lifecycle, reserva de RPS, gateway e webhook implementados | Homologação pendente; produção bloqueada |
| Compras e estoque corporativo | Implementado | Requer depósitos, fornecedores e saldos iniciais |
| Lavanderia hospitalar e enxovais | Implementado | Requer contratos, preços e cadastro patrimonial |
| Limpeza e terceirização | Implementado | Requer locais, postos, equipes e checklists |
| Atendimento, consentimento, site e BI | Implementado | Entrega externa permanece bloqueada |

## 2. Evidências de validação

| Validação | Resultado |
|---|---|
| Compilação server-side | **130/130 funções** compiladas |
| Schemas | **152/152** válidos |
| Bateria ERP | **11 baterias** aprovadas |
| Escopo estrutural da bateria | 69 entidades, 24 funções centrais e 14 páginas obrigatórias |
| Ondas herdadas 1–4 | Aprovadas após integração da `main` |
| Build Vite | Aprovado |
| Lint dos arquivos alterados | Aprovado, sem erros |
| Typecheck global | 122 erros herdados contra 129 na `main`; nenhum nos novos arquivos do ERP |
| Dependências | 0 críticas, 0 altas e 4 moderadas |
| Credenciais no diff | Nenhum segredo de alta confiança detectado |
| Whitespace e conflitos | Sem erros e sem marcadores de conflito |

Os 122 erros globais restantes são débitos legados do projeto; a implementação reduziu a contagem em relação à `main`. Eles não devem ser ocultados, mas não são introduzidos pelas páginas e helpers novos.

## 3. Bootstrap obrigatório

Antes do primeiro teste com usuário, executar em ambiente de homologação e nesta ordem:

| Ordem | Cadastro | Critério de saída |
|---:|---|---|
| 1 | `BusinessGroup` | Um grupo econômico ativo |
| 2 | `LegalEntity` | Cada CNPJ validado, com nome, regime e estado de implantação |
| 3 | `Unit` | Cada unidade vinculada ao CNPJ correto |
| 4 | `CostCenter` | Estrutura mínima por CNPJ e unidade |
| 5 | `Warehouse` | Depósitos ativos e depósito padrão por unidade |
| 6 | `BankAccount` | Contas cadastradas sem credenciais no banco de dados |
| 7 | `CompanyAccessGrant` | Administradores, financeiro, operação e auditoria limitados aos CNPJs necessários |
| 8 | `FiscalProfile` | Perfil por CNPJ, município, série e sequência de RPS revisados |
| 9 | Contratos B2B | Preços por kg, peça, posto, hora e perda configurados conforme cada operação |
| 10 | Catálogos operacionais | Insumos, enxovais, serviços, checklists e motivos padronizados |

Unidades legadas sem `legal_entity_id` devem permanecer visíveis apenas para administradores durante a vinculação. Não criar lançamentos empresariais enquanto a unidade estiver sem CNPJ e depósito padrão.

## 4. Variáveis e secrets

Nenhum valor secreto deve ser registrado no Git, em documentação ou em tickets. Os valores abaixo devem existir somente no cofre de secrets da plataforma.

| Domínio | Configuração necessária | Gate inicial |
|---|---|---|
| Interno | `INTERNAL_FUNCTION_TOKEN` aleatório e exclusivo | Obrigatório para agendas e gateways |
| Site público | Allowlist de origem e CNPJ/unidade padrão do formulário/widget | Somente domínios oficiais |
| Meta | App secrets, verify tokens, conta/página e CNPJ/unidade por canal | Webhooks somente após teste de assinatura |
| Z-API | Tokens de segurança e provider tokens por instância | Inativo sem todos os campos |
| Banco do Brasil | Client ID, client secret, developer application key, convênio, token/HMAC de webhook e URLs homologadas | `BB_EXTERNAL_REQUESTS_ENABLED=false`; `BB_PRODUCTION_ENABLED=false` |
| Focus NFe | Token de homologação e token dedicado de webhook | `FOCUSNFE_EXTERNAL_REQUESTS_ENABLED=false`; `FOCUSNFE_PRODUCTION_ENABLED=false` |
| Conta Azul | Fonte documental, escopo e aprovação | `CONTA_AZUL_MIGRATION_ENABLED=false` |
| DP | URL, allowlist, token e caminho configurado | `PAYROLL_SYNC_ENABLED=false`; `PAYROLL_SYNC_PRODUCTION_ENABLED=false` |
| Relatórios | Destinatários consentidos e canal homologado | `REPORT_EXTERNAL_DELIVERY_ENABLED=false` |

## 5. Homologação Banco do Brasil

O Banco do Brasil oferece APIs de Cobrança e Pix para clientes pessoa jurídica e orienta criação de aplicação, seleção das APIs, testes em sandbox e posterior promoção para produção.[1] [2] [3] O CNAB deve usar o leiaute exato acordado para o convênio; o ERP, por isso, exige perfil versionado antes do parsing definitivo.[4] [5]

1. Cadastrar uma conta BB de homologação e o convênio sem armazenar credenciais na entidade `BankAccount`.
2. Configurar OAuth e developer application key no cofre de secrets.
3. Manter os dois gates de chamadas externas e produção em `false`.
4. Criar cobrança local em rascunho e verificar payload sanitizado.
5. Habilitar somente o gate de homologação e executar uma cobrança de valor simbólico autorizada.
6. Validar consulta, cancelamento, expiração e falha de timeout.
7. Configurar webhook dedicado; testar token, HMAC, replay e entrega duplicada.
8. Importar OFX/CSV de teste; para CNAB, cadastrar primeiro o perfil oficial do convênio.
9. Confirmar que sugestões não baixam recebíveis automaticamente.
10. Somente após aceite formal, considerar o gate de produção em mudança separada.

## 6. Homologação Focus NFe

A Focus NFe separa homologação e produção; documentos de homologação não têm validade fiscal.[6] A autenticação usa HTTP Basic com o token como usuário e senha vazia.[7] A referência deve ser única no escopo do token, e a emissão de NFS-e é assíncrona, devendo ser acompanhada por consulta ou webhook.[8] [9] O cancelamento é definitivo, exige justificativa e pode depender da prefeitura.[10]

1. Revisar perfil fiscal, município, códigos de serviço, tributação, série e sequência de RPS por CNPJ.
2. Configurar token exclusivamente de homologação e manter produção bloqueada.
3. Criar documento fiscal local e verificar reserva única de RPS.
4. Enfileirar emissão; confirmar que o endpoint humano não chama o provedor diretamente.
5. Processar o job pelo gateway interno e validar estados assíncronos.
6. Configurar webhook com cabeçalho de autorização dedicado. A Focus permite informar nome e valor do cabeçalho e realiza retentativas quando não recebe resposta 2xx.[11] [12]
7. Testar autorização, erro de validação, duplicidade, replay, consulta e reenvio de webhook.
8. Testar cancelamento apenas com documento homologado e justificativa válida.
9. Validar XML/PDF e retenção no repositório documental.
10. Promover para produção somente após aceite fiscal por CNPJ e plano de rollback aprovado.

## 7. Ensaio de migração Conta Azul

O pipeline não foi executado com dados reais porque nenhum export foi fornecido. O ensaio obrigatório deve ocorrer com cópia anonimizada e hash registrada.

| Etapa | Controle |
|---|---|
| Upload | Arquivo CSV/JSON/XML registrado no repositório documental |
| Staging | Nenhum registro operacional criado |
| Validação | CNPJ, datas, valores, chaves externas e duplicidades conferidos |
| Dry-run | Totais por entidade, competência e centro de custo comparados |
| Aprovação | MFA, motivo e responsável administrativo |
| Execução | Gate temporário, lotes pequenos e checkpoints |
| Reconciliação | Contagens, somas e amostras contra a origem |
| Rollback | Registros do lote marcados/revertidos conforme plano ensaiado |

Nenhum lote deve avançar quando houver divergência de totais, CNPJ não mapeado, competência fechada ou registro sem chave externa estável.

## 8. Agendas e automações

Cada agenda deve invocar exclusivamente endpoints internos com `INTERNAL_FUNCTION_TOKEN`. O token não pode constar no payload visível de logs. Configurar limites de lote, timeout, backoff, alertas e uma tarefa de reparo para falhas parciais.

| Agenda | Frequência inicial recomendada | Efeito externo padrão |
|---|---|---|
| Relatórios executivos | Diário, após fechamento operacional | Somente notificação interna |
| Despesas recorrentes | Diário | Gera rascunhos, não paga |
| Expiração de orçamentos | Horária | Apenas atualização interna |
| Recuperação de conversas | Intervalo controlado | Mensageria depende de gate e consentimento |
| Jobs bancários/fiscais/DP | Worker interno com lote pequeno | Bloqueado até homologação |

## 9. Smoke test funcional

Executar em CNPJ e unidade de homologação, usando prefixo `HML-ERP-`, e excluir ou inativar os registros ao final.

| Jornada | Critério de aceite |
|---|---|
| Acesso | Usuário sem grant não visualiza nem consulta outro CNPJ |
| Cadastro B2B | Parte, contatos e endereços sem duplicidade documental |
| Contrato/OS | Versão aprovada por MFA e OS concluída somente após qualidade |
| Financeiro | Período fechado bloqueia lançamento e intercompany mantém dois lados |
| Compras | Requisição, pedido, recebimento físico e estoque no mesmo depósito/CNPJ |
| Hospitalar | Coleta, peso líquido, lote, qualidade, entrega e medição conciliam |
| Enxovais | QR, movimento, inventário cego, perda e cobrança sem baixa automática |
| Limpeza | Posto, escala, checklist, inspeção, ocorrência e medição mensal |
| Atendimento | Consentimento, fila, handoff humano/IA e nota interna |
| BI | Dataset permitido, filtro, CSV, favorito e resumo executivo |
| Site | Formulário cria lead com UTM e consentimento, sem cobrança ou mensagem automática |

## 10. Rollback

1. Desabilitar todos os gates externos antes de qualquer rollback de código.
2. Pausar agendas e gateways internos.
3. Preservar logs, jobs, eventos e hashes; não excluir evidências.
4. Reverter o deploy para o commit anterior da `main`.
5. Marcar jobs pendentes como suspensos, sem reprocessamento automático.
6. Executar compensações somente por função auditada e com aprovação.
7. Revalidar autenticação, escopo por CNPJ e landing pública após o rollback.
8. Reabrir integrações uma por vez apenas depois da análise de causa.

## 11. Riscos residuais

| Risco | Tratamento antes de produção |
|---|---|
| 122 erros globais de typecheck herdados | Plano técnico separado; não afetam arquivos novos, mas devem ser reduzidos continuamente |
| 25 erros globais de lint herdados | Corrigir por lote sem misturar com homologação funcional |
| 4 vulnerabilidades moderadas transitivas | Monitorar e atualizar sem `--force` quando houver versão compatível |
| Ausência de dados reais de migração | Executar dry-run com export autenticado e anonimizado |
| MFA depende do provedor de identidade | Provar segundo fator real e atualização confiável de `mfa_status` |
| Sem homologação BB/Focus/DP | Manter gates fechados até evidência end-to-end |
| Base44 sem transação multi-entidade explícita | Preservar idempotência, checkpoints, eventos e tarefas de reparo |

## Referências

[1]: https://www.bb.com.br/site/developers/api-cobranca/ "API Cobrança v2 — Portal Developers BB"
[2]: https://www.bb.com.br/site/developers/api-pix/ "API Pix v2 — Portal Developers BB"
[3]: https://developers.bb.com.br/ "Portal Developers BB"
[4]: https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20padrao%20CNAB240%20V%2010%2011%20-%2021_08_2023.pdf "Padrão Febraban CNAB 240 — versão 10.11"
[5]: https://bb.com.br/site/pro-seu-negocio/aplicativos-leiautes-de-arquivos/ "Leiautes de arquivos — Banco do Brasil"
[6]: https://doc.focusnfe.com.br/reference/ambiente.md "Ambientes da API Focus NFe"
[7]: https://doc.focusnfe.com.br/reference/autenticacao.md "Autenticação HTTP Basic — Focus NFe"
[8]: https://doc.focusnfe.com.br/reference/referencia.md "Referência única — Focus NFe"
[9]: https://doc.focusnfe.com.br/reference/emitir_nfse.md "Emitir NFS-e — Focus NFe"
[10]: https://doc.focusnfe.com.br/reference/cancelar_nfse.md "Cancelar NFS-e — Focus NFe"
[11]: https://doc.focusnfe.com.br/reference/webhooks.md "Webhooks e retentativas — Focus NFe"
[12]: https://doc.focusnfe.com.br/reference/criar_webhook.md "Criar webhook — Focus NFe"
