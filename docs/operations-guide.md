# Guia operacional da nova Gestão

A página **Gestão** agora possui um centro de comando acima dos indicadores e tabelas já existentes. Os novos recursos foram adicionados sem remover o financeiro, os tickets, os gráficos, a auditoria e o orçamento manual anteriores.

## Atendimento e orçamento por fotos

O funcionário seleciona **Orçamento por fotos**, informa cliente e unidade e adiciona imagens das peças. Cada arquivo passa por validação de formato, tamanho e hash antes do envio. A IA devolve sugestões de item do catálogo, serviços, atributos, avarias e confiança. O funcionário pode corrigir produto, quantidade, serviço e preço antes de salvar.

O resultado é um **orçamento**, não um pedido e não um pagamento. A conversão em pedido ocorre pela função `approve_quote`, que cria as peças individuais de forma idempotente. O orçamento manual permanece acessível e utiliza o mesmo caminho seguro de aprovação.

> Pix informado ou comprovante fotografado não significa dinheiro liquidado. A confirmação exige conciliação bancária ou ação autorizada no fluxo financeiro.

## Operação por peça

Cada roupa recebe um código próprio e aparece no quadro operacional. Os cartões mostram cliente, ticket, localização, prazo e estado. A movimentação é feita por ações controladas, evitando saltos inválidos no processo.

| Estado operacional | Próxima ação típica |
|---|---|
| Recebida | Etiquetar e registrar evidências de entrada. |
| Etiquetada | Enviar à fila da produção. |
| Na fila | Iniciar lavagem ou etapa compatível. |
| Lavagem | Encaminhar à secagem. |
| Secagem | Encaminhar à passadoria. |
| Passadoria | Encaminhar ao controle de qualidade. |
| Controle de qualidade | Aprovar a peça ou abrir retrabalho. |
| Pronta | Separar para retirada ou entrega. |
| Em entrega | Confirmar a entrega da peça. |

Todos os movimentos geram `GarmentEvent`, formando o histórico da peça e permitindo medir permanência, atraso, retrabalho e cadeia de custódia.

## Qualidade e retrabalho

Na coluna **Qualidade**, o operador abre um checklist com limpeza, odor, acabamento, integridade e identificação. Uma aprovação libera a peça. Uma reprovação exige ao menos um motivo e abre automaticamente um `ReworkCase`, preservando observações e responsáveis.

Peças devolvidas por terceiros também entram no controle de qualidade antes de o serviço externo ser concluído e transformado em conta a pagar.

## Terceirização

A seção **Terceiros e retrabalho** permite selecionar parceiro, peças, serviço, custo estimado e data prevista. O envio exige uma evidência anexada, registra a cadeia de custódia e marca as peças como `with_third_party`. O retorno também exige evidência e encaminha as peças à qualidade.

O encerramento é permitido somente depois da aprovação de qualidade. Quando existe custo, o sistema cria uma conta a pagar pendente; ele não registra pagamento automaticamente.

## Notas de compra e estoque

Em **Ler nota de compra**, a administração pode usar XML, PDF ou imagem. O sistema extrai fornecedor, número, datas, chave, itens, quantidades, preços e total. As descrições são relacionadas aos insumos existentes por SKU, código do fornecedor, código de barras ou nome normalizado.

Se todos os itens estiverem relacionados e os totais forem coerentes, a aprovação gera movimentos de entrada, atualiza quantidade e custo médio e cria uma conta a pagar. Divergências são enviadas à central de revisão. Reenvios do mesmo arquivo são bloqueados pelo hash.

## Contas e documentos financeiros

Em **Ler conta**, o usuário escolhe o tipo esperado e envia a imagem ou PDF. São extraídos emissor, identificação, competência, vencimento, valor, consumo, unidade, linha digitável e referência Pix quando disponíveis. Valores atípicos e duplicidades geram alerta.

A aprovação cria uma conta a pagar pendente. A conta precisa ser aprovada antes de o pagamento ser registrado. Quando a liquidação é registrada, o lançamento passa a aparecer no financeiro legado e permanece vinculado à obrigação original.

## Caixa

O caixa é aberto por operador e unidade com um fundo inicial. Suprimentos e sangrias exigem valor e motivo; movimentos sensíveis exigem papel apropriado. No fechamento, o operador informa o valor contado. Diferenças exigem justificativa e podem ficar aguardando aprovação.

## Revisão humana

A central de revisão reúne baixa confiança em peças, notas, contas, comprovantes, estoque e qualidade. Marcar uma pendência como revisada não executa automaticamente a ação financeira ou operacional associada; a aprovação especializada continua no módulo correspondente.

## Cancelamentos

Pedidos, pagamentos pendentes e lançamentos não são mais apagados pelo navegador. A Gestão solicita uma justificativa e usa `cancel_management_record`. Pagamentos já liquidados bloqueiam o cancelamento e exigem um fluxo de estorno ou reembolso. O registro original e a auditoria são preservados.
