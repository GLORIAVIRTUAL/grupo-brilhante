# Onda 2 — Contrato funcional e transacional

## Objetivo

A Onda 2 fecha o ciclo comercial e financeiro sem confiar em valores calculados no navegador. Orçamento, pedido, conta a receber, pagamento, alocação, caixa e documento fiscal devem formar uma cadeia auditável, idempotente e conciliável.

## Estado atual validado

| Área | Cobertura existente | Lacuna principal |
|---|---|---|
| Pagamento no balcão | Um meio por chamada; dinheiro, Pix, crédito ou débito; valor limitado ao saldo do pedido | Não há composição de meios, troco, crédito do cliente, estorno transacional nem baixa de conta a receber |
| Alocação | Schema permite vincular pagamento a pedido ou título | Ainda não representa cada parcela de um recebimento misto nem consolida o recibo |
| Contas a receber | Saldo, vencimento e baixa parcial previstos | Falta criação e liquidação operacional, faturamento periódico e governança de crédito |
| Cliente | Cadastro e unidade preferida | Faltam limite, saldo, convênio, prazo, bloqueio e dados de faturamento |
| Orçamento | Itens por peça, serviços, validade e estados principais | Faltam versão imutável, histórico de mudanças, duplicação, reabertura, aceite/rejeição/cancelamento transacionais e justificativa de preço |
| Caixa | Abertura, movimentos, contagem e fechamento | Falta aprovação posterior, reabertura controlada, resumo do turno e vínculo integral aos recebimentos |
| Fiscal | Ausente | Criar RPS/NFS-e, eventos, tomador, tributação e adaptador municipal inativo |

## Invariantes

1. O servidor recalcula o saldo elegível do pedido e/ou título antes de receber.
2. Um recebimento possui uma chave idempotente única e pode conter vários meios.
3. A soma efetivamente aplicada nunca excede o saldo devido. Dinheiro pode exceder somente para cálculo de troco, e o excesso não vira receita.
4. Pix e transferência sem conciliação permanecem pendentes. Cartões só são liquidados com confirmação do terminal ou adquirente.
5. Crédito do cliente só pode ser consumido quando houver saldo disponível e gera movimento de razão.
6. Cada parcela do recebimento gera um `Payment`; cada aplicação gera um `PaymentAllocation`; o agrupador é um `PaymentReceipt`.
7. Pagamento parcial mantém conta e pedido parcialmente pagos. Quitação total fecha ambos.
8. Estorno nunca apaga pagamentos; cria evento inverso, devolve saldo quando aplicável e atualiza pedido/título.
9. Alterações de preço e estado de orçamento exigem motivo quando reduzirem valor, reabrirem, cancelarem ou substituírem versão aceita.
10. Fechamento de caixa usa exclusivamente movimentos confirmados em dinheiro; divergências exigem justificativa e aprovação independente quando necessário.
11. Documento fiscal só pode ser emitido a partir de venda consistente; a ausência do provedor de Porto Alegre mantém o documento em rascunho ou pronto para envio, nunca como emitido.
12. Secrets fiscais e certificados nunca são armazenados nos schemas ou no frontend.

## Arquitetura fiscal nesta etapa

A estrutura fiscal será independente do provedor. Um adaptador `poa_direct` ficará declarado, mas desabilitado até a homologação posterior. O domínio interno utilizará `FiscalDocument`, `FiscalEvent` e `FiscalProfile`. A futura integração municipal será responsável apenas por traduzir o contrato canônico, assinar e transmitir; nenhuma regra comercial ficará acoplada ao município.

## Compatibilidade

Os fluxos existentes continuam válidos. O endpoint legado de pagamento permanecerá como fachada para um único meio e delegará ao novo motor transacional. Registros antigos sem conta a receber, recibo ou versão de orçamento continuarão legíveis e poderão ser migrados progressivamente.
