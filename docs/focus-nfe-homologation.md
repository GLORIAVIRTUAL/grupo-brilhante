# Homologação Focus NFe — Grupo Brilhante

## Objetivo e limite operacional

A integração fiscal foi estruturada para operar por **empresa legal (CNPJ)**, com perfil fiscal, sequência de RPS, documentos, jobs, webhooks e eventos segregados. O código não deve produzir efeitos fiscais enquanto os gates do perfil e do ambiente permanecerem desativados.

> Em homologação, documentos não possuem validade fiscal. Em produção, emissões e cancelamentos geram efeitos fiscais e exigem autorização operacional explícita.

## Gates cumulativos

| Gate | Homologação | Produção |
|---|---:|---:|
| Perfil fiscal completo e validado | Obrigatório | Obrigatório |
| `external_requests_enabled` no perfil | Obrigatório | Obrigatório |
| `FOCUSNFE_EXTERNAL_REQUESTS_ENABLED=true` no ambiente | Obrigatório | Obrigatório |
| Token do ambiente no cofre | Obrigatório | Obrigatório |
| Webhook autenticado e testado | Obrigatório | Obrigatório |
| Homologação aprovada por administrador com MFA | Recomendado | Obrigatório |
| `production_enabled` no perfil | Não | Obrigatório |
| `FOCUSNFE_PRODUCTION_ENABLED=true` no ambiente | Não | Obrigatório |
| Confirmação formal de entrada em produção | Não | Obrigatório |

Os gates são cumulativos: configurar um token não habilita transmissão sozinho.

## Secrets e configurações

| Nome | Finalidade |
|---|---|
| `FOCUSNFE_HOMOLOGATION_TOKEN` | Token Basic Auth da empresa em homologação |
| `FOCUSNFE_PRODUCTION_TOKEN` | Token Basic Auth da empresa em produção |
| `FOCUSNFE_EXTERNAL_REQUESTS_ENABLED` | Gate global de chamadas externas |
| `FOCUSNFE_PRODUCTION_ENABLED` | Gate global adicional para produção |
| `FOCUSNFE_WEBHOOK_TOKEN` | Valor exclusivo enviado pela Focus no cabeçalho configurado |
| `FOCUSNFE_WEBHOOK_HEADER` | Nome do cabeçalho de autorização do webhook |
| `FOCUSNFE_WEBHOOK_ENVIRONMENT` | Ambiente fixo do endpoint de webhook |
| `INTERNAL_FUNCTION_TOKEN` | Autorização entre processador de jobs e gateway interno |

Nenhum valor deve ser persistido em código, entidades, logs, PRs ou documentação.

## Fluxo de emissão

1. O usuário autorizado seleciona o CNPJ e a unidade.
2. O sistema prepara o RPS localmente e reserva a sequência.
3. A validação estrutural não chama a Focus NFe.
4. O comando humano cria um `IntegrationJob`; não transmite diretamente.
5. Um processador interno autenticado chama `focus_nfe_gateway` com o ID do job.
6. O gateway aplica os gates, monta `POST /v2/nfse?ref=...`, usa timeout e salva apenas resposta sanitizada.
7. A emissão aceita segue como assíncrona; o documento permanece em processamento.
8. Consulta ou webhook atualiza autorização, rejeição ou cancelamento.
9. URLs de XML/PDF ficam pendentes de download seguro para `DocumentAsset`; a interface não constrói links autenticados do provedor.

## Webhook

O cadastro oficial da Focus NFe deve usar evento `nfse`, HTTPS e o cabeçalho definido em `FOCUSNFE_WEBHOOK_HEADER`, com valor de `FOCUSNFE_WEBHOOK_TOKEN`. O receptor rejeita ausência de token, JSON inválido, payload acima do limite, referência inválida e colisão de idempotência.

O ambiente do endpoint é fixado por `FOCUSNFE_WEBHOOK_ENVIRONMENT`. Homologação e produção devem preferencialmente utilizar endpoints/configurações separados, evitando que um evento seja processado no ambiente errado.

## Cancelamento

Cancelamento só pode ser enfileirado para documento autorizado e exige justificativa de 15 a 255 caracteres. A interface não marca a nota como cancelada no clique; o estado definitivo depende da resposta ou webhook do provedor. Como algumas prefeituras não permitem cancelamento por webservice, o roteiro de homologação deve testar o município e prever reparo manual.

## Cenários mínimos de homologação

| Cenário | Resultado esperado |
|---|---|
| Perfil incompleto | Bloqueio local, sem job externo |
| Gate global desligado | Gateway retorna indisponível, sem chamada externa |
| Token ausente | Falha fechada e job em retry/reparo |
| Emissão válida | Job concluído e documento em processamento/autorizado |
| Referência repetida | Idempotência, sem nova nota |
| Webhook repetido | Resposta 2xx idempotente, sem efeitos duplicados |
| Webhook com payload diferente e mesma chave | Conflito seguro |
| Rejeição municipal | Documento rejeitado, erro sanitizado e auditável |
| Consulta posterior | Estado atualizado sem duplicar eventos |
| Cancelamento sem justificativa | Bloqueio local |
| Cancelamento autorizado | Estado final somente após resposta confirmada |
| Produção sem gate duplo | Bloqueio absoluto |

## Rollback

1. Definir `FOCUSNFE_EXTERNAL_REQUESTS_ENABLED=false`.
2. Definir `FOCUSNFE_PRODUCTION_ENABLED=false`.
3. Suspender os perfis fiscais afetados.
4. Pausar o processador de `IntegrationJob` da Focus NFe.
5. Manter o webhook ativo apenas para receber confirmações de operações já enviadas, ou coordenar sua remoção após conciliação.
6. Não excluir documentos, eventos ou jobs; abrir `RepairTask` para inconsistências.
7. Conciliar manualmente cada referência transmitida antes do rollback.

## Condição atual

A implementação permanece **preparada, mas desativada**. Nenhum token foi configurado, nenhuma chamada externa foi executada e nenhuma NFS-e foi emitida ou cancelada durante o desenvolvimento.
