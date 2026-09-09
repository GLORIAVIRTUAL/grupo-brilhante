# Onda 3 — Estoque e Produção

## Objetivo

A Onda 3 transforma a fundação técnica de insumos e produção em jornadas operacionais completas. O sistema passa a controlar o saldo físico por unidade e lote, o consumo planejado e realizado, a capacidade das máquinas, a execução de lotes, o tempo dos operadores, as perdas, os custos e as exceções que exigem decisão.

> A peça continua sendo a unidade principal de rastreabilidade. O lote agrupa peças para execução eficiente, mas não substitui o histórico individual de cada roupa.

## Cobertura implantada

| Domínio | Recursos |
|---|---|
| Cadastro de insumos | SKU, categoria, unidade-base, estoque mínimo, ponto de reposição, custo médio, armazenagem, lote e validade. |
| Operações de estoque | Cadastro, ajuste, perda, devolução, transferência entre unidades e recebimento por nota. |
| Lotes de insumos | Número do lote, fornecedor, fabricação, validade, localização, custo unitário, saldo e estado. |
| Inventário | Abertura, congelamento lógico, contagem cega, divergência, justificativa, revisão, aprovação e ajuste auditado. |
| Fichas técnicas | Versões por unidade, serviço, etapa, tipo de peça, máquina e base de consumo. |
| Consumo | Previsão, disponibilidade, baixa automática FEFO/FIFO, substituto permitido, tolerância e reversão gerencial. |
| Máquinas | Cadastro, capacidade em quilos e peças, custo, manutenção, estado e importação dos identificadores legados. |
| Produção | Criação, agendamento, fila, início, pausa, retomada, consumo, conclusão e cancelamento de lotes. |
| Pessoas e custos | Apontamento do operador, duração, pausas, custo-hora, custos de máquina, água, energia, embalagem e rateio. |
| Indicadores | Utilização, atraso, produtividade, custo realizado, desvio e perdas. |
| Alertas | Estoque baixo, lote a vencer, máquina parada, manutenção vencida, atraso, sobrecarga, falta de insumos e desvio de custo. |

## Entidades principais

| Entidade | Responsabilidade |
|---|---|
| `StockItem` | Posição agregada do insumo em uma unidade. |
| `StockLot` | Saldo físico e validade por lote. |
| `StockMovement` | Razão imutável de todas as entradas e saídas. |
| `InventoryCount` | Sessão de inventário e suas contagens. |
| `ConsumptionRecipe` | Ficha técnica versionada. |
| `ProductionBatch` | Planejamento e estado atual de uma carga. |
| `ProductionEvent` | Linha do tempo imutável da produção. |
| `LaborEntry` | Apontamento de tempo e custo do operador. |
| `MachineState` | Cadastro e estado compatível com as máquinas legadas. |
| `ProductionCostProfile` | Parâmetros versionados de custo por unidade. |
| `OperationalAlert` | Exceção deduplicada e acompanhada até sua resolução. |

## Operação de estoque

A central **Gestão → Estoque** contém cinco visões: posição, lotes, movimentos, inventário e fichas técnicas. A posição apresenta saldo físico, saldo disponível, reserva, mínimo, custo médio, localização e necessidade de reposição.

### Entradas e recebimentos

A leitura de nota de compra permanece como caminho preferencial. Na aprovação, cada item passa a gerar lote físico quando houver controle por lote ou validade. O custo médio, a conta a pagar, o saldo agregado, o lote e o movimento de entrada são atualizados de forma idempotente.

### Ajustes, perdas e devoluções

Toda operação exige justificativa. O saldo negativo é bloqueado; uma exceção exige perfil gerencial, autorização explícita e motivo suficiente. Perdas vinculadas a um lote de produção e a uma máquina passam a integrar o custo real da carga.

### Transferências

A transferência cria movimentos correspondentes de saída e entrada, preserva o custo e valida a unidade de destino. O mesmo insumo é localizado por SKU na unidade receptora. O processo não permite transferir além do saldo disponível.

## Inventário físico

O inventário começa em **Iniciar inventário**. Quando a opção de congelamento estiver ativa, ajustes, transferências e recebimentos que afetem a unidade ficam bloqueados até o encerramento da contagem.

A contagem é cega: o operador registra o encontrado sem visualizar o saldo esperado na etapa de coleta. Depois do envio, a revisão mostra as diferenças. Divergências podem receber justificativa, mas a contagem física original não é sobrescrita. A aprovação gera movimentos de ajuste, atualiza os saldos e preserva o valor financeiro da diferença.

| Estado | Significado |
|---|---|
| `draft` | Sessão preparada, ainda não contando. |
| `counting` | Contagem em andamento; pode congelar movimentos. |
| `review` | Todos os itens contados e divergências disponíveis. |
| `approved` | Ajustes aplicados e sessão encerrada. |
| `cancelled` | Sessão cancelada sem aplicar diferenças. |

## Fichas técnicas e consumo automático

Cada ficha define a etapa, a base de cálculo e os insumos necessários. As bases disponíveis incluem peça, quilo, ciclo, área e valor fixo. Uma nova alteração cria outra versão; fichas anteriores permanecem no histórico.

Ao planejar um lote, o sistema calcula o consumo esperado, verifica a disponibilidade e identifica faltas. A baixa usa primeiro o lote com validade mais próxima e, quando não houver validade, o mais antigo. Substitutos só são usados quando declarados na ficha.

O lote com ficha técnica não pode ser concluído sem a baixa do consumo. A reversão exige perfil gerencial e devolve as quantidades aos mesmos lotes utilizados, produzindo movimentos inversos em vez de excluir o histórico.

## Planejamento e execução da produção

A central **Gestão → Produção** reúne indicadores, mapa de máquinas e quadro de lotes.

### Criação de lote

O planejador seleciona peças compatíveis e define etapa, máquina, ficha técnica, peso, duração, prioridade e agendamento. A capacidade considera peso e quantidade. Sobreocupação é bloqueada; uma exceção exige permissão gerencial e justificativa.

O planejamento sem insumo suficiente é gravado como `waiting_materials`. O lote só entra na fila quando os materiais estiverem disponíveis. A mesma peça não pode estar simultaneamente em dois lotes ativos.

### Execução

| Ação | Efeito |
|---|---|
| Enviar à fila | Confirma capacidade e materiais. |
| Iniciar | Ocupa a máquina, atualiza as peças e inicia a execução. |
| Iniciar apontamento | Registra o operador quando não houver apontamento ativo. |
| Pausar | Pausa lote, máquina e apontamentos ativos. |
| Retomar | Retoma execução e apontamentos. |
| Baixar consumo | Registra quantidades reais e custos por lote de insumo. |
| Concluir | Finaliza apontamentos, libera máquina, atualiza peças e consolida custos. |
| Cancelar | Libera máquina e peças sem apagar o histórico. |

## Máquinas e compatibilidade legada

O cadastro de máquinas mantém o `machine_id` utilizado pelos temporizadores existentes. Equipamentos legados podem ser importados e enriquecidos com nome, tipo, fabricante, capacidade, custo por ciclo, potência, consumo de água e plano de manutenção.

Uma máquina inativa ou em manutenção não aceita novos lotes. A execução associa o lote ao equipamento e sincroniza seu estado operacional sem remover os campos usados pelo dashboard anterior.

## Custos reais

O perfil de custos da unidade é versionado e inclui mão de obra por hora, energia por kWh, água por metro cúbico, embalagem, qualidade e rateio indireto. Custos específicos da máquina permanecem no equipamento.

O custo realizado do lote combina material baixado, mão de obra concluída, máquina, energia, água, embalagem, perdas e outros valores informados na conclusão. O custo histórico de lotes encerrados não é recalculado quando uma nova versão do perfil entra em vigor.

## Alertas e indicadores

A ação **Atualizar análise** executa uma varredura local e idempotente. Alertas já existentes são atualizados em vez de duplicados. Quando a causa deixa de existir, o alerta pode ser resolvido automaticamente.

**Reconhecer** indica que alguém viu a exceção, mas não declara a causa resolvida. **Resolver** exige observação quando não houver evidência automática de que o problema desapareceu.

## Papéis e segregação

| Papel | Acesso principal |
|---|---|
| Produção | Planejamento, execução, máquinas e alertas operacionais. |
| Estoque | Insumos, lotes, inventário, fichas e alertas de abastecimento. |
| Gerente | Exceções de capacidade, sobresaldo, custos e resolução de alertas. |
| Financeiro | Perfil de custos operacionais e leitura dos impactos financeiros. |
| Administrador | Acesso integral e configuração multiunidade. |

A interface esconde módulos sem permissão, mas a autorização definitiva é repetida nas funções server-side. Nenhuma operação crítica depende apenas da visibilidade no navegador.

## Ordem recomendada de homologação

1. Aplicar os novos schemas e funções em uma aplicação Base44 de homologação.
2. Cadastrar uma unidade de teste e conferir os papéis de produção, estoque e gerente.
3. Importar as máquinas legadas e complementar capacidade e custos.
4. Cadastrar três insumos, incluindo um com controle de lote e validade.
5. Receber uma nota de teste e confirmar lote, saldo, custo e movimento.
6. Criar uma ficha técnica de lavagem e validar sua versão.
7. Abrir um inventário, contar, revisar e aprovar uma divergência controlada.
8. Criar um lote com duas peças, testar capacidade e falta de material.
9. Executar início, pausa, retomada, consumo, apontamento e conclusão.
10. Registrar uma perda vinculada ao lote e conferir o custo realizado.
11. Atualizar alertas e validar reconhecer, resolver e resolução automática.
12. Comparar o dashboard legado de máquinas antes e depois da execução.

## Validação reproduzível

Execute a bateria oficial:

```bash
npm run validate:wave3
```

A bateria valida schemas, autenticação, invariantes, cálculos determinísticos, lint direcionado, typecheck direcionado, empacotamento das funções server-side e build do frontend. A inspeção visual está registrada em [`wave3-visual-validation.md`](wave3-visual-validation.md).

## Rollback

Os módulos anteriores continuam disponíveis. A Onda 3 adiciona novas abas e funções, sem remover a operação por peça, os temporizadores legados, o recebimento de notas ou os módulos financeiros. Em caso de interrupção durante a homologação, interrompa a criação de novos lotes, conclua ou cancele os lotes ativos e volte a operação por peça. Movimentos, eventos, contagens e custos já registrados não devem ser excluídos.
