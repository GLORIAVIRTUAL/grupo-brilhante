# Validação visual da Onda 2

## Painel financeiro

A prévia controlada foi aberta em viewport desktop e exibiu corretamente os quatro indicadores de contas a pagar, valores a receber, vencidos e conciliações. As tabelas de contas a receber e pagar mantiveram boa separação visual, valores alinhados e ações claramente distinguíveis.

Os novos botões **Crédito** e **Receber** aparecem no contexto de cada cliente/título. A fila **Pagamentos aguardando confirmação** ficou visível e destacada, com referência, valor e ação de confirmação. O conteúdo principal coube em duas colunas no desktop e a hierarquia visual permaneceu coerente com a interface existente.

A inspeção não executou operações financeiras; todos os dados da prévia são controlados e locais. A transmissão fiscal permanece desativada.

## Orçamentos e faturados

A central comercial exibiu os orçamentos em formato tabular com número, cliente, versão, validade, valor, estado e ações contextuais. O orçamento enviado apresentou ajuste, aceite, rejeição, duplicação e cancelamento; o orçamento aceito apresentou a conversão explícita em pedido. Os ícones ficaram legíveis e a separação entre ciclo do orçamento e convênios evitou mistura de contextos.

O cartão do convênio mostrou limite, faturas abertas, clientes vinculados e responsável financeiro, seguido das ações de fechar período, vincular cliente e autorizar pedido faturado. A tabela de fechamentos recentes permaneceu legível no desktop. A ausência de responsável nos dados controlados ficou corretamente exposta, permitindo identificar uma pendência cadastral.

## Estrutura fiscal

A central fiscal apresentou destaque visível de **Transmissão desativada**, perfil da unidade, situação de homologação, dados fiscais, série e próximo RPS. A preparação local lista pedidos e faturamentos elegíveis, e os documentos preparados aparecem com número, tomador, estado e valor.

A interface deixa claro que não acessa certificado nem envia dados nesta etapa. O layout em duas colunas ficou equilibrado, os campos mantiveram boa densidade e o alerta de desativação permaneceu visível acima do formulário.

## Resultado visual

Os três módulos validados mantiveram o mesmo padrão visual escuro do sistema, boa hierarquia e ações contextualizadas. Não foram encontrados cortes, sobreposições ou textos ilegíveis no viewport desktop. Nenhuma operação de backend foi executada durante a inspeção; todos os dados utilizados eram locais e controlados.

## Verificação do caixa

Na primeira abertura da prévia, o modal exibiu o formulário de abertura porque o arquivo temporário havia enviado a coleção pela propriedade `cashSessions`, enquanto o componente usa `sessions`. A aplicação real já utilizava corretamente `sessions={cashSessions}` no `ManagementCommandCenter`; portanto, o comportamento não afetava o código de produção. A prévia foi corrigida e recarregada para manter o ensaio fiel ao contrato real.

Com o contrato correto, o modal reconheceu a sessão `CX-000042` e exibiu operador, fundo, dinheiro esperado, quantidade de recebimentos, pendências de conciliação e resumo por meio. As áreas de suprimento/sangria e conferência/fechamento ficaram separadas e visíveis dentro de um modal com rolagem própria. A organização evita confundir posição informativa com movimentos e fechamento.

## Recebimento misto

O modal de recebimento exibiu saldo devido, valor apresentado, aplicação imediata e saldo restante antes da confirmação. A primeira forma foi preenchida com o saldo do título, e a interface ofereceu dinheiro, Pix, crédito, débito, transferência, boleto, crédito do cliente e cortesia, além da inclusão de outros meios.

Os totais ficaram destacados no topo, os campos de forma, valor e referência permaneceram alinhados, e as ações **Recomeçar** e **Registrar recebimento** ficaram claramente separadas. A inspeção não acionou o botão de registro, portanto nenhum dado financeiro foi submetido.
