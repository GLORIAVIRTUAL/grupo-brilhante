# Onda 2 — Financeiro, Fiscal e Fechamento Comercial

**Autor:** Manus AI  
**Situação:** implementação pronta para homologação  
**Transmissão NFS-e:** desativada por projeto

## Visão geral

A Onda 2 completa o ciclo comercial entre orçamento, pedido, recebimento, crédito, faturamento, caixa e preparação fiscal. A implementação evita baixa financeira baseada apenas no navegador: preços, saldos, limites, alocações, troco, estados e reversões são recalculados nas funções autenticadas do servidor. O contrato funcional e as invariantes estão registrados no [documento de desenho][4].

> A confirmação de um meio eletrônico não é sinônimo de apresentação do meio. Pix, transferência, boleto e cartão podem permanecer pendentes e somente reduzem o saldo após confirmação explícita ou conciliação.

| Módulo | Entrega operacional |
|---|---|
| Recebimentos | Múltiplos meios, pagamento parcial, troco apenas em dinheiro, confirmação posterior, alocação por pedido ou título e recibo composto. |
| Crédito do cliente | Razão imutável para concessão, consumo, devolução, expiração e ajuste, sempre com saldo posterior e justificativa. |
| Contas a receber | Baixa parcial, saldo em aberto, parcelamento, vencimento, cobrança e vínculo a pedidos, recibos, convênios e faturamentos. |
| Convênios | Limite de crédito, desconto, prazo, exigência de centro de custo/pedido de compra e autorização de pedidos faturados. |
| Faturados | Prévia, fechamento por período, demonstrativo, título consolidado, emissão e cancelamento auditado. |
| Orçamentos | Validade individual, versões imutáveis, recálculo server-side, envio, aceite, rejeição, reabertura, duplicação, cancelamento e conversão em pedido. |
| Caixa | Abertura por operador, posição por meio, suprimento, sangria, conferência, diferença, aprovação, fechamento imutável e reabertura como nova sessão. |
| Fiscal | Perfil por unidade, numeração de RPS, preparação local, validação, eventos e vínculo a pedidos/faturados; nenhuma transmissão nesta etapa. |

## Recebimentos e conciliação

A central **Gestão → Recebimentos e caixa** lista pedidos e contas a receber com saldo. O operador pode combinar dinheiro, Pix, cartão de crédito, débito, transferência, boleto, crédito do cliente e cortesia. Cada meio gera um registro de pagamento vinculado ao recibo composto; somente valores confirmados geram alocação e reduzem o saldo.

| Regra | Comportamento |
|---|---|
| Dinheiro | Exige caixa aberto. Pode gerar troco, que nunca é lançado como receita. |
| Pix, transferência e boleto | Podem permanecer `pending_confirmation`; a confirmação posterior exige referência. |
| Crédito e débito | Podem permanecer pendentes até confirmação do terminal. |
| Crédito do cliente | Exige saldo suficiente e gera débito no razão de crédito. |
| Cortesia | Exige justificativa e perfil autorizado. |
| Estorno | Gera pagamentos e alocações reversas; não apaga o histórico original. |

A interface mostra separadamente **saldo devido**, **valor apresentado**, **aplicação imediata** e **saldo restante ou troco**. Pagamentos pendentes aparecem em uma fila de confirmação na central financeira.

## Crédito, convênios e faturados

O saldo do cliente não é um número alterado isoladamente. A entidade `CustomerCreditLedger` registra cada movimento com valor assinado, origem, operador, idempotência e saldo posterior. A interface permite conceder ou ajustar crédito com justificativa e validade opcional.

Os convênios relacionam clientes a um responsável financeiro, limite, ciclo e prazo. Antes de autorizar um pedido faturado, o servidor recalcula a exposição com títulos abertos e pedidos ainda não fechados. Exigências de centro de custo e pedido de compra são aplicadas antes da autorização.

O fechamento periódico oferece uma prévia. A emissão cria um `BillingStatement`, uma conta a receber consolidada e vincula os pedidos de forma idempotente. O cancelamento preserva o demonstrativo e desfaz apenas os vínculos permitidos.

## Ciclo do orçamento

Cada alteração comercial cria uma versão imutável em `QuoteVersion`. Desconto e acréscimo são recalculados sobre os itens precificados no servidor. Alterações exigem motivo; desconto acima da alçada exige autorização específica. Um orçamento com pedido ativo não pode ser cancelado.

| Estado | Próximas ações esperadas |
|---|---|
| Rascunho ou revisão | Ajustar, enviar, duplicar ou cancelar. |
| Enviado | Aceitar, rejeitar, ajustar ou cancelar. |
| Aceito | Converter explicitamente em pedido. |
| Rejeitado, expirado ou cancelado | Reabrir com nova validade ou duplicar. |

A expiração automática passou a respeitar `valid_until` de cada orçamento, em vez de uma janela fixa.

## Caixa e posição do turno

O caixa calcula sua posição a partir de movimentos e recebimentos vinculados. O resumo separa dinheiro, Pix, crédito, débito, transferência, crédito do cliente, faturado e outros. A contagem gera um snapshot imutável. Diferenças exigem justificativa e podem demandar aprovação gerencial.

Uma sessão fechada não é reaberta por alteração de estado. A função cria uma nova sessão ligada à anterior e registra motivo, operador e auditoria. Esse desenho preserva a confiabilidade do fechamento original.

## Estrutura fiscal e Porto Alegre

A Prefeitura de Porto Alegre informa que, desde **1º de novembro de 2025**, a emissão de NFS-e passou a ocorrer obrigatoriamente pelo **Emissor Nacional**.[1] O Sistema Nacional publica ambientes e APIs distintos para produção restrita e produção, incluindo emissão, consulta, eventos e parâmetros municipais.[2] O contrato utiliza DPS e eventos fiscais eletrônicos conforme o manual oficial.[3]

Por esse motivo, o perfil de Porto Alegre recomenda `national_nfse`, e não um webservice municipal legado. Nesta etapa:

| Disponível agora | Deliberadamente indisponível |
|---|---|
| Cadastro fiscal por unidade | Transmissão de DPS/NFS-e |
| Série e numeração sequencial do RPS | Uso de certificado digital |
| Preparação a partir de pedido ou faturado | Consulta aos endpoints nacionais |
| Validação de emitente, tomador, itens e valores | Cancelamento ou substituição externa |
| Eventos fiscais e auditoria | Armazenamento de senha ou certificado no banco |

A ação de transmissão retorna `fiscal_transmission_not_implemented` e grava um evento de bloqueio. Certificados e credenciais serão futuramente referenciados por identificador de cofre; seus valores não deverão ser enviados ao frontend nem salvos nas entidades.

### Etapa futura de integração

A ativação deverá ocorrer em branch separada, primeiro no ambiente de produção restrita. O adaptador deverá montar e assinar a DPS, consultar parâmetros do município, transmitir, interpretar rejeições, persistir XML/DANFSE, reconciliar eventos e somente depois permitir produção. A chave de ativação deve permanecer desligada até conclusão dos testes com certificado e dados fiscais reais.

## Permissões

| Perfil | Capacidades principais |
|---|---|
| Atendente | Orçamentos e recebimentos permitidos pela operação. |
| Caixa | Recebimentos, confirmação de meios, caixa e preparação fiscal. |
| Financeiro | Recebimentos, estornos, crédito, convênios, faturados, caixa e preparação fiscal. |
| Gerente/administrador | Alçadas comerciais, limites, aprovação de diferenças, reabertura, cancelamentos e configuração fiscal. |

Todas as funções verificam autenticação e unidade. A interface esconde áreas sem permissão, mas a autorização efetiva permanece no servidor.

## Homologação recomendada

A implantação deve ocorrer primeiro em uma aplicação Base44 de homologação. Os schemas devem ser aplicados antes das funções e do frontend. Em seguida, cadastre uma unidade, operadores, caixa, clientes, um convênio e um perfil fiscal com ambiente `disabled`.

| Teste | Critério de aceite |
|---|---|
| Pagamento misto | A soma dos valores confirmados não excede o saldo; troco somente é gerado em dinheiro. |
| Pagamento pendente | Não altera pedido/título até a confirmação. |
| Estorno | Cria reversões e restaura o saldo sem apagar registros. |
| Crédito do cliente | Consumo reduz o razão; ajuste exige motivo; saldo nunca fica negativo. |
| Convênio | Limite, centro de custo e pedido de compra são respeitados. |
| Faturado | Fechamento repetido com a mesma chave não duplica título nem demonstrativo. |
| Orçamento | Revisão cria nova versão e mantém o snapshot anterior. |
| Caixa | Diferença gera aprovação; sessão fechada permanece imutável. |
| Fiscal | RPS é preparado e validado, mas qualquer transmissão continua bloqueada. |

A inspeção visual dos módulos e os resultados estão registrados em [wave2-visual-validation.md][5]. A bateria oficial é executada com:

```bash
npm run validate:wave2
```

Ela valida schemas, autenticação, invariantes, cálculos determinísticos, lint direcionado, typecheck direcionado, sintaxe de nove funções server-side e build Vite. O repositório ainda possui débito global de typecheck anterior à Onda 2; a suíte falha se qualquer erro aparecer nos arquivos desta entrega.

## Referências

[1]: https://prefeitura.poa.br/smf/nota-legal/nota-fiscal-de-servicos-eletronica-nfse "Prefeitura de Porto Alegre — Nota Fiscal de Serviços Eletrônica"

[2]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao "Sistema Nacional NFS-e — APIs de produção restrita e produção"

[3]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf "Manual dos Contribuintes — APIs do Emissor Público Nacional"

[4]: wave2-design-contract.md "Contrato funcional da Onda 2"

[5]: wave2-visual-validation.md "Validação visual da Onda 2"
