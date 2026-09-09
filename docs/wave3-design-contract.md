# Contrato de desenho — Onda 3: Estoque e Produção

**Autor:** Manus AI
**Base:** `main` no commit `c074f43`
**Branch:** `feat/inventory-production-wave3`

## Objetivo

A Onda 3 transforma as estruturas já existentes de insumos, receitas, lotes e máquinas em uma operação diária completa. O desenho preserva o recebimento de notas, o quadro por peça e os temporizadores do dashboard, mas move decisões críticas de saldo, capacidade, consumo e custo para funções autenticadas no servidor.

## Diagnóstico da base

| Domínio | Situação antes da Onda 3 | Decisão de compatibilidade |
|---|---|---|
| Compras | Aprovação de nota já atualiza saldo e custo médio | Reutilizar a transação e acrescentar lote/validade |
| Estoque | `StockItem` possui saldo agregado; `StockMovement` já é um razão | Tornar o razão a fonte auditável e adicionar lotes físicos |
| Inventário | Schema de sessão existe, sem operação completa | Implementar abertura, contagem, revisão, aprovação e ajustes |
| Receitas | Schema básico por peça/kg/ciclo | Versionar, calcular previsão e registrar consumo real |
| Produção | `ProductionBatch` existe sem motor de execução | Completar planejamento, reserva, execução, pausa, conclusão e cancelamento |
| Máquinas | `MachineState` controla temporizadores por ticket em máquinas fixas | Preservar os campos legados e estender para cadastro, capacidade e lote ativo |
| Peças | Quadro individual avança estados manualmente | Vincular as peças aos lotes sem perder rastreabilidade individual |
| Interface | Estoque é quase somente leitura; produção é kanban por peça | Criar centrais operacionais sem remover as telas atuais |

## Entidades e responsabilidades

| Entidade | Responsabilidade |
|---|---|
| `StockItem` | Saldo agregado, saldo disponível, custo médio, política de reposição e armazenagem |
| `StockLot` | Saldo por lote, validade, custo de entrada, fornecedor e estado de qualidade |
| `StockMovement` | Razão imutável de entradas, saídas, transferências, perdas, inventário e reversões |
| `InventoryCount` | Sessão de contagem, congelamento lógico, divergências, revisão e aprovação |
| `ConsumptionRecipe` | Ficha técnica versionada por serviço/produto/etapa/máquina |
| `ProductionBatch` | Planejamento e execução de uma carga ou lote de peças |
| `ProductionEvent` | Linha do tempo imutável do lote e de cada ação operacional |
| `LaborEntry` | Apontamento de operador, duração, custo-hora, retrabalho e motivo de parada |
| `MachineState` | Cadastro operacional e estado em tempo real da máquina, preservando o temporizador legado |
| `OperationalAlert` | Alertas deduplicados de estoque, validade, capacidade, atraso, parada e custo |

## Invariantes transacionais

1. O navegador nunca altera saldo, custo médio, ocupação de máquina ou custo de produção diretamente.
2. Toda operação crítica exige autenticação, escopo de unidade, permissão e `idempotency_key`.
3. O saldo agregado de `StockItem` deve corresponder à soma dos lotes ativos quando o item controla lote.
4. Estoque negativo é bloqueado; exceções exigem papel gerencial, motivo e auditoria.
5. Uma transferência gera saída e entrada vinculadas pelo mesmo identificador e nunca edita movimentos anteriores.
6. A aprovação do inventário cria movimentos de diferença e preserva quantidade anterior, contada e justificativa.
7. Consumo é calculado no servidor a partir da versão da ficha técnica registrada no lote.
8. Consumo por lote usa FEFO quando houver validade; sem validade, usa FIFO.
9. Uma peça não pode participar de dois lotes ativos da mesma etapa.
10. Uma máquina não pode executar dois lotes simultaneamente.
11. A carga não pode superar a capacidade configurada; exceção gerencial fica registrada.
12. Início, pausa, retomada, conclusão e cancelamento do lote geram eventos imutáveis.
13. Concluir um lote registra consumo real, custo de insumos, custo de mão de obra e atualiza a etapa das peças.
14. Cancelar uma operação não apaga histórico; cria estorno ou evento compensatório.
15. Os campos legados de `MachineState` permanecem válidos para o dashboard durante a migração.

## Estratégia de implantação

A implantação será compatível e incremental. O dashboard antigo continuará lendo `MachineState`, enquanto o novo motor gravará também `production_batch_id`, capacidade, operador e estado operacional. O arraste legado continuará funcionando; quando não houver lote estruturado, será tratado como execução legada e não realizará consumo automático. A central nova será a jornada recomendada para lotes com custo e consumo completos.

## Critérios de aceite

A Onda 3 será considerada pronta quando for possível cadastrar e movimentar insumos, receber lotes, realizar inventário, configurar fichas técnicas, planejar uma carga, validar capacidade, iniciar e concluir produção, baixar estoque automaticamente, apontar operador e perdas, visualizar custo previsto versus real e identificar alertas e gargalos, mantendo build e fluxos anteriores íntegros.
