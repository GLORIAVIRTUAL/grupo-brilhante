# Homologação Banco do Brasil

**Autor:** Manus AI

**Estado:** preparada, não ativada

**Data:** 9 de setembro de 2026

## Objetivo e limite operacional

O ERP contém contratos locais para boleto, Pix, webhooks e conciliação, mas inicia com `BB_ENVIRONMENT=disabled`, `BB_EXTERNAL_REQUESTS_ENABLED=false` e `BB_PRODUCTION_ENABLED=false`. Portanto, criar um rascunho ou enfileirar uma cobrança **não envia uma requisição ao banco** enquanto os gates permanecerem fechados.

A API Cobrança v2 do Banco do Brasil disponibiliza emissão, consulta e baixa de boletos e exige CNPJ, convênio de cobrança e cadastro no Portal Developers.[1] A API Pix v2 disponibiliza cobranças imediatas e com vencimento, consulta de recebimentos, devoluções, webhooks e locations de QR Code; seu uso requer cliente BB pessoa jurídica e chave Pix ativa.[2]

| Gate | Sandbox/homologação | Produção |
|---|---:|---:|
| Aplicação criada no Portal Developers | Obrigatório | Obrigatório |
| Convênio de cobrança contratado | Obrigatório para boleto | Obrigatório |
| Chave Pix ativa no BB | Obrigatório para Pix | Obrigatório |
| Certificados e credenciais armazenados no cofre Base44 | Obrigatório | Obrigatório |
| `BB_EXTERNAL_REQUESTS_ENABLED=true` | Obrigatório | Obrigatório |
| `BB_PRODUCTION_ENABLED=true` | Não permitido | Obrigatório |
| Testes de webhook, idempotência, cancelamento e conciliação | Obrigatório | Evidência aprovada |
| Aprovação formal e plano de rollback | Obrigatório | Obrigatório |

## Variáveis de ambiente

As variáveis aparecem vazias em `.env.example`. Os valores devem existir somente no cofre de segredos do ambiente. Os paths de API são configuráveis porque devem corresponder à versão e aos produtos efetivamente vinculados ao convênio no Portal Developers.

| Grupo | Variáveis |
|---|---|
| Gates | `BB_ENVIRONMENT`, `BB_EXTERNAL_REQUESTS_ENABLED`, `BB_PRODUCTION_ENABLED` |
| OAuth/API | `BB_API_BASE_URL`, `BB_OAUTH_URL`, `BB_DEVELOPER_APPLICATION_KEY`, `BB_CLIENT_ID`, `BB_CLIENT_SECRET` |
| Cobrança | `BB_BILLING_AGREEMENT_NUMBER`, `BB_WALLET_NUMBER`, `BB_WALLET_VARIATION`, `BB_CHARGE_CREATE_PATH`, `BB_CHARGE_CANCEL_PATH` |
| Pix | `BB_PIX_KEY`, `BB_PIX_CREATE_PATH`, `BB_PIX_CANCEL_PATH`, `BB_PIX_REFUND_PATH` |
| Webhook | `BB_WEBHOOK_TOKEN`, `BB_WEBHOOK_HMAC_SECRET` |
| Interno | `INTERNAL_FUNCTION_TOKEN` |

## Sequência segura de homologação

Primeiro, deve-se cadastrar uma conta Banco do Brasil no CNPJ correto e confirmar agência, conta, convênio, carteira, variação e chave Pix sem gravar client secret ou certificados na entidade. Em seguida, a aplicação deve ser criada no Portal Developers e associada às APIs Cobrança e Pix. O próprio BB descreve o processo como criação da aplicação, seleção de APIs, testes em sandbox e posterior envio à produção.[3]

Depois, deve-se configurar somente o ambiente sandbox/homologação, mantendo `BB_PRODUCTION_ENABLED=false`. A equipe cria cobranças de valor simbólico em dados de homologação, processa manualmente os jobs internos e verifica a idempotência de criação, consulta, baixa, expiração, webhook duplicado e devolução. Nenhum teste deve usar cliente, título ou conta de produção.

O webhook deve apontar para `bb_webhook_receiver`, enviar o token em cabeçalho e, quando suportado pelo cadastro do evento, uma assinatura HMAC SHA-256. O endpoint rejeita ausência de configuração, token inválido, assinatura inválida, corpo acima de 1 MB, evento duplicado com payload diferente e evento sem cobrança correspondente. Uma liquidação cria `BankTransaction` com estado `unmatched`; ela **não baixa automaticamente** contas a receber.

A conciliação importa OFX, CSV ou JSON normalizado e cria sugestões por valor, data e referência. O aceite exige `banking.reconcile`, MFA e justificativa; mesmo após o aceite, a baixa financeira permanece separada para evitar que um matching equivocado altere saldos. Para CNAB 240/400, o ERP exige um `BankFileLayoutProfile` homologado por convênio. O padrão Febraban 240 define header, lotes, registros detalhe e trailer e contempla cobrança, pagamentos e extratos de conciliação.[4]

## Critérios de aceite

| Cenário | Resultado esperado |
|---|---|
| Gates externos fechados | Gateway retorna indisponível sem chamar o BB |
| Retry do mesmo job | Não cria uma segunda cobrança |
| Evento de webhook repetido | Retorna idempotente, sem duplicar liquidação |
| Mesmo `event_key` com payload diferente | Rejeição por conflito |
| Liquidação parcial | Cobrança fica `partially_paid` |
| Liquidação integral | Cobrança fica `paid`, transação permanece `unmatched` |
| Falha após limite de tentativas | Job e cobrança entram em `repair_required` |
| Matching de baixa confiança | Requer administrador |
| CNAB sem perfil homologado | Arquivo não é interpretado por posições presumidas |
| Produção sem gate específico | Operação bloqueada |

## Rollback

Em incidente de homologação, devem ser fechados `BB_EXTERNAL_REQUESTS_ENABLED` e `BB_PRODUCTION_ENABLED`, interrompendo novas chamadas sem excluir dados. Jobs pendentes devem ser cancelados, cobranças em `repair_required` devem ser revisadas e webhooks devem permanecer recebendo apenas se a assinatura estiver válida. Registros bancários, eventos e logs não devem ser apagados; correções devem ser compensatórias e auditáveis.

## Referências

[1]: https://www.bb.com.br/site/developers/api-cobranca/ "API Cobrança v2 — Portal Developers BB"
[2]: https://www.bb.com.br/site/developers/api-pix/ "API Pix v2 — Portal Developers BB"
[3]: https://developers.bb.com.br/ "Portal Developers BB"
[4]: https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20padrao%20CNAB240%20V%2010%2011%20-%2021_08_2023.pdf "Padrão Febraban CNAB 240 — versão 10.11"
