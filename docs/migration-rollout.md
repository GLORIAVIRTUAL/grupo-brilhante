# Plano de migração e ativação gradual

A evolução deve ser aplicada primeiro em **homologação**. Os novos schemas são aditivos e os campos ampliados preservam os nomes usados pelo sistema anterior, mas a ativação simultânea de IA, estoque, financeiro e produção aumentaria desnecessariamente o risco operacional.

## Etapas de implantação

| Etapa | Ações | Critério de saída |
|---|---|---|
| 0. Linha de base | Associar o repositório a uma aplicação Base44 de homologação, configurar somente as variáveis Base44 e publicar a branch. | Login, Dashboard, Chat, CRM, Coletas, Gestão, Configurações, Disparos e Marketing continuam abrindo. |
| 1. Segurança | Aplicar usuário ampliado, papéis, unidades permitidas, auditoria, idempotência e endpoints endurecidos. | Usuários de unidades diferentes não acessam registros indevidos; diagnóstico permanece bloqueado. |
| 2. Dados mestres | Cadastrar serviços, produtos/SKUs, sinônimos, regras de preço, posições, fornecedores e insumos. | Orçamento manual e pesquisa de catálogo continuam corretos; estoque inicial foi conferido. |
| 3. Peças | Ativar aprovação de orçamento para novos tickets e validar geração de `GarmentItem` e `GarmentEvent`. | Contagem de peças do pedido coincide com a conferência física. |
| 4. Operação | Pilotar o quadro por peça, localização, qualidade e retrabalho em uma unidade. | Nenhuma peça fica sem estado ou localização; entrega parcial é rastreável. |
| 5. Compras | Ativar entrada de notas sem IA, revisar manualmente e aprovar estoque/contas. Depois configurar IA. | Totais, custo médio, saldo e duplicidade conferem com documentos reais controlados. |
| 6. Financeiro | Ativar documentos, contas, caixa e conciliação. Manter lançamentos legados disponíveis durante a conferência paralela. | Saldo diário, contas e caixa coincidem com a conferência independente. |
| 7. IA | Configurar `GEMINI_API_KEY`, hosts de imagens e monitorar confiança, revisão e falhas. | Taxa de correção, tempo de revisão e custo por documento estão dentro da meta definida pela operação. |
| 8. Pagamentos | Configurar Stripe somente depois dos testes de webhook, idempotência, retorno e reembolso. | Um único evento não cria duplicidades e nenhum comprovante visual confirma pagamento. |
| 9. Expansão | Repetir cadastro, treinamento e validação nas demais unidades. | Indicadores e auditoria permanecem separados por unidade. |

## Backfill recomendado

Os registros antigos de `Order` e `Quote` não precisam ser alterados para que as telas atuais continuem funcionando. A criação de peças individuais deve começar nos novos pedidos. Se houver necessidade de migrar pedidos ainda em aberto, um procedimento controlado deve gerar peças a partir de `items_snapshot`, marcar `origin=backfill` nos metadados e registrar um evento inicial com o estado correspondente ao ticket.

Pagamentos antigos devem conservar seu estado original. Não se deve inferir conciliação retroativa apenas pela presença de comprovantes. Contas e lançamentos antigos também devem permanecer no financeiro legado; a migração para `AccountsPayable` ou `AccountsReceivable` deve ser seletiva e reconciliada.

## Dados mínimos para o piloto

| Cadastro | Conteúdo mínimo |
|---|---|
| Serviços | Lavagem, lavagem a seco, secagem, passadoria, acabamento, impermeabilização e serviços especiais utilizados pela unidade. |
| Produtos | SKU, nome, categoria, sinônimos visuais, preço base e serviços compatíveis. |
| Posições | Balcão, triagem, filas, máquinas, qualidade, araras, prateleiras, expedição e lockers existentes. |
| Insumos | SKU, unidade base, saldo inicial, estoque mínimo, custo médio e códigos dos fornecedores. |
| Fornecedores | Identificação fiscal, nome, contato, condições e códigos de produtos. |
| Usuários | Papel, unidade principal, unidades permitidas e permissões excepcionais justificadas. |

## Testes de aceite

O piloto deve cobrir orçamento manual, orçamento por fotos com correção, aprovação repetida do mesmo orçamento, peça rejeitada na qualidade, terceirização com retorno, nota duplicada, item de nota sem correspondência, conta atípica, despesa recorrente, Pix pendente, pagamento em dinheiro, caixa com diferença, cancelamento com pagamento liquidado e webhook repetido.

## Rollback

A interface nova pode ser revertida removendo `ManagementCommandCenter` de `Management.jsx`, sem apagar entidades ou dados criados. As tabelas e gráficos legados permanecem no mesmo arquivo. Os schemas aditivos devem permanecer para preservar registros já gravados. Integrações podem ser desativadas removendo seus segredos do ambiente; o sistema retorna ao caminho manual e à revisão humana.

Nunca faça rollback por exclusão em massa. Se uma função crítica apresentar comportamento incorreto, desative a integração afetada, interrompa a automação, preserve `ProcessedEvent` e `AuditLog`, corrija em uma branch e repita os testes na homologação.
