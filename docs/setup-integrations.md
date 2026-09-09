# Configuração segura de integrações

Este projeto não contém tokens, chaves privadas ou segredos. O arquivo `.env.example` declara somente os **nomes** esperados. Valores reais devem permanecer no gerenciador de segredos do ambiente Base44 e, para desenvolvimento local, em `.env.local`, que está ignorado pelo Git.

## Matriz de configuração

| Recurso | Variáveis | Comportamento sem segredo |
|---|---|---|
| Backend Base44 | `VITE_BASE44_APP_ID`, `VITE_BASE44_APP_BASE_URL`, `BASE44_APP_ID` | O build conclui, mas dados autenticados e funções não podem ser carregados. |
| IA para peças, notas e contas | `GEMINI_API_KEY` | Arquivos são registrados e encaminhados para revisão humana; nenhum resultado fictício é retornado. |
| Imagens remotas | `AI_IMAGE_ALLOWED_HOSTS` | Somente origens seguras já aceitas pela função são processadas; recomenda-se declarar os hosts oficiais de armazenamento. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Links de checkout não são criados e webhooks não confirmam pagamentos. |
| Origens de retorno do pagamento | `PAYMENT_ALLOWED_ORIGINS` | A função usa somente origens explicitamente autorizadas; não deve ser configurada com curingas. |
| Automação interna | `AUTOMATION_INTERNAL_TOKEN` | A execução sem usuário das despesas recorrentes é negada. A execução manual administrativa continua disponível. |
| Diagnóstico interno | `ENABLE_INTERNAL_DEBUG_ENDPOINTS=false` | Endpoints de depuração e listagem de arquivos permanecem bloqueados. |
| WhatsApp e demais canais | Variáveis Z-API e WhatsApp declaradas em `.env.example` | O CRM continua disponível, mas envio e recebimento pelo canal não são executados. |
| Mapas e marketing | Variáveis Google Maps, Meta Ads e Google Ads | Os módulos correspondentes continuam sem conexão externa. |

## Sequência recomendada

A aplicação deve ser conectada primeiro a um backend de **homologação**. Em seguida, os schemas e funções da branch devem ser aplicados, um administrador deve receber o papel `super_admin` ou `admin`, e as unidades permitidas devem ser configuradas. Somente depois disso devem ser adicionados os segredos de IA, pagamentos e mensageria.

Os segredos devem ser configurados individualmente e testados pelo painel de prontidão da página **Gestão**. Esse painel retorna somente `configurado` ou `não configurado`; ele nunca transmite o valor do segredo ao frontend.

## Regras de produção

| Regra | Aplicação |
|---|---|
| Menor privilégio | Atendentes operam orçamentos; produção movimenta peças; estoque aprova compras; financeiro aprova e liquida contas; administradores gerenciam configurações. |
| Segregação | Quem cria uma obrigação financeira não deve ser seu único aprovador quando o processo exigir aprovação. |
| Revisão humana | IA não aprova pedido, não movimenta estoque, não paga conta e não confirma comprovante. |
| Idempotência | Webhooks, aprovação de orçamento, notas, contas e pagamentos usam chaves de evento para impedir duplicidade. |
| Upload seguro | Tipo, tamanho, extensão, hash e duplicidade são verificados antes do processamento. |
| Diagnóstico | `ENABLE_INTERNAL_DEBUG_ENDPOINTS` deve permanecer `false` em produção. |
| Rotação | Tokens devem ser rotacionados no provedor e no gerenciador de segredos, nunca substituídos em commits. |

## Variáveis locais

Copie o modelo e preencha apenas o necessário para o ambiente autorizado:

```bash
cp .env.example .env.local
```

Nunca envie `.env.local`, capturas contendo tokens, payloads de webhook completos ou arquivos de clientes para issues e pull requests.
