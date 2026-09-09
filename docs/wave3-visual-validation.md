# Validação visual — Onda 3

## Ambiente

Prévia temporária local com dados controlados, sem conexão ao backend produtivo e sem executar operações transacionais.

## Produção

A hierarquia está clara em desktop: ações de **Custos**, **Máquinas** e **Novo lote** aparecem no cabeçalho; os cinco indicadores têm leitura imediata; o mapa de máquinas diferencia equipamento livre, em execução e em manutenção; e o quadro separa planejamento, fila, execução e concluídos. Os cartões mostram etapa, máquina, peças, ocupação e custo sem excesso de informação. A cor permanece complementar ao texto, não sendo o único indicador de estado.

## Estoque — posição

A central mostra ações primárias de cadastro, movimentação e leitura de nota, seguida de indicadores de catálogo, mínimo, valor, documentos e validade. As subabas **Posição**, **Lotes**, **Movimentos**, **Inventário** e **Fichas técnicas** estão visíveis e bem agrupadas. A tabela apresenta saldo, disponível, mínimo, custo médio, local e ações por item. O item abaixo do mínimo é explicitamente marcado como **Repor**. O layout permaneceu legível no viewport desktop e preservou o padrão visual da Gestão.

## Ajustes identificados

Nenhum bloqueio visual foi encontrado nas duas primeiras telas. Permanecem para inspeção as subabas de inventário/fichas e o painel de indicadores, além dos diálogos principais.

## Inventário

A subaba deixa claro que não existe contagem em andamento, oferece uma única ação principal para iniciar o processo e preserva o histórico aprovado com quantidade de itens, divergências e impacto financeiro. A separação entre inventário ativo e histórico reduz risco de iniciar contagens concorrentes.

## Fichas técnicas

A ficha ativa mostra versão, etapa, base de cálculo, tolerância, insumos, quantidades e custo-base de modo legível. As ações **Nova ficha** e **Desativar** estão corretamente separadas, evidenciando o caráter versionado em vez de edição destrutiva. Nenhuma quebra de layout foi observada.

## Indicadores e alertas

Os seis indicadores apresentam produtividade, atraso, utilização, perdas, custo realizado e desvio em uma única linha. Alertas críticos e de advertência são diferenciados por texto e cor, com ações distintas de **Reconhecer** e **Resolver**. O mapa lateral de capacidade mantém contexto suficiente sem competir com as exceções. O exemplo de desvio de custo de 23,5% ficou imediatamente perceptível.

## Navegação

A alternância entre Produção, Estoque e Indicadores preservou o estado visual e não apresentou conteúdo sobreposto. O retorno ao quadro de produção foi imediato e sem deslocamento inesperado. A próxima verificação cobre os diálogos de execução, custos e criação de lotes.

## Execução do lote

O diálogo de execução apresenta estado, capacidade, custo previsto e custo real no topo. A seção de consumo informa claramente que os insumos já foram baixados e impede edição posterior. Custos adicionais de energia, água e outros permanecem separados, com observação de conclusão. As ações **Iniciar apontamento**, **Pausar**, **Concluir lote** e **Cancelar** possuem hierarquia e contraste adequados. O botão de recuperação do apontamento aparece quando o lote está em execução sem registro ativo, evitando perda de custo de mão de obra após falha parcial. Nenhuma operação foi submetida durante a validação.

## Perfil de custos

O modal identifica a versão vigente e explica que custos de máquina por ciclo permanecem no cadastro de equipamentos. Mão de obra, energia, água, rateio indireto, embalagem e qualidade são apresentados em uma grade compacta com unidades explícitas. A ação **Salvar nova versão** deixa claro que o histórico não será sobrescrito. O diálogo foi fechado sem persistir dados.

## Criação de lote

O assistente divide a tela em seleção de peças e parâmetros da carga. A busca por peça, ticket ou cliente está acessível; cada candidato mostra descrição, código, cliente, estado e peso. Etapa, máquina compatível, ficha técnica, peso total, duração, prioridade e agendamento ficam agrupados na lateral. A seção **Carga selecionada** fornece retorno imediato de quantidade e peso. A criação permanece bloqueada sem peças, evitando lotes vazios. Nenhuma operação foi submetida.

## Conclusão visual

As jornadas principais da Onda 3 foram inspecionadas com dados controlados: quadro de produção, estoque, inventário, fichas técnicas, alertas, execução, custos e criação de lote. Não foram observados cortes, sobreposições ou ações críticas ambíguas no viewport desktop utilizado.
