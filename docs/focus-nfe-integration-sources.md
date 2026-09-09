# Fontes oficiais — integração Focus NFe

**Data de consulta:** 9 de setembro de 2026.

A documentação oficial informa que a Focus NFe recebe documentos fiscais em JSON e cuida da assinatura digital e da comunicação com SEFAZ, prefeituras e outros autorizadores. A integração deve observar páginas próprias de **ambiente**, **autenticação** e **referência (`ref`)**.[1]

A documentação lista NFSe e NFSe nacional entre os documentos disponíveis. O portal recomenda webhooks para acompanhar autorização e erros, evitando consultas repetitivas, e dispõe de API de empresas para cenários com vários CNPJs.[1] O site institucional apresenta um exemplo de payload NFSe com `data_emissao`, `prestador`, `tomador` e `servico`, compatível com o adaptador já existente no ERP.[2]

O índice oficial expõe páginas em Markdown e informa que documentos fiscais assíncronos devem ser acompanhados por consulta ou webhook; por isso o ERP usa referência idempotente, job de integração, webhook e reparo, sem interpretar a aceitação inicial como autorização fiscal.[3]

## Referências

[1]: https://doc.focusnfe.com.br/ "Documentação API Focus NFe — Introdução"
[2]: https://focusnfe.com.br/ "Focus NFe — exemplos e produtos fiscais"
[3]: https://doc.focusnfe.com.br/llms.txt "Índice completo da documentação Focus NFe"

A Focus NFe mantém ambientes separados de homologação e produção. Documentos da homologação não possuem validade fiscal, enquanto a produção gera efeitos fiscais e tributários; as URLs base são `https://homologacao.focusnfe.com.br` e `https://api.focusnfe.com.br`, com prefixo REST `/v2`.[4]

A autenticação oficial usa HTTP Basic: o token da empresa é o usuário e a senha permanece vazia, ou seja, Base64 de `token:`. O mesmo mecanismo vale para os dois ambientes, mas cada ambiente deve usar o token correto.[5]

A referência `ref` deve ser alfanumérica, sem caracteres especiais e única no escopo do token. Uma referência rejeitada pode ser reutilizada após correção, mas uma referência já autorizada, mesmo posteriormente cancelada, não pode identificar uma nova emissão.[6]

A emissão de NFS-e usa `POST /v2/nfse?ref=...`. A pré-validação é síncrona, mas uma nota aceita segue para processamento assíncrono e precisa ser acompanhada por consulta ou webhook. O contrato oficial inclui `prestador`, `tomador` e `servico`, e destaca que municípios podem exigir campos específicos.[7]

A consulta usa `GET /v2/nfse/{referencia}` e pode retornar estados de processamento, autorização, cancelamento ou erro, além de número, código de verificação e caminhos de artefatos.[8] O cancelamento usa `DELETE /v2/nfse/{referencia}`, só é permitido para nota autorizada, é definitivo, exige justificativa de 15 a 255 caracteres e pode não ser aceito por todas as prefeituras.[9]

[4]: https://doc.focusnfe.com.br/reference/ambiente.md "Ambientes da API Focus NFe"
[5]: https://doc.focusnfe.com.br/reference/autenticacao.md "Autenticação HTTP Basic — Focus NFe"
[6]: https://doc.focusnfe.com.br/reference/referencia.md "Referência única — Focus NFe"
[7]: https://doc.focusnfe.com.br/reference/emitir_nfse.md "Emitir NFS-e — Focus NFe"
[8]: https://doc.focusnfe.com.br/reference/consultar_nfse.md "Consultar NFS-e — Focus NFe"
[9]: https://doc.focusnfe.com.br/reference/cancelar_nfse.md "Cancelar NFS-e — Focus NFe"

Os webhooks Focus NFe enviam via POST, em JSON, dados de um único documento por acionamento. Quando a entrega falha ou a resposta não é 2xx, a Focus realiza novas tentativas em 1 minuto, 30 minutos, 1 hora, 3 horas e 24 horas; depois da última tentativa, o evento não é disparado novamente automaticamente.[10]

O cadastro de webhook usa `POST /v2/hooks` e permite informar o CNPJ, o evento `nfse`, a URL e um valor de autorização acompanhado do nome do cabeçalho. Isso permite configurar um token dedicado no cabeçalho do receptor, sem segredo em query string.[11] A API também oferece `POST /v2/nfse/{referencia}/hook` para solicitar reenvio de notificação em testes ou recuperação controlada.[12]

[10]: https://doc.focusnfe.com.br/reference/webhooks.md "Webhooks e retentativas — Focus NFe"
[11]: https://doc.focusnfe.com.br/reference/criar_webhook.md "Criar webhook — Focus NFe"
[12]: https://doc.focusnfe.com.br/reference/reenviar_hook_nfse.md "Reenviar notificação de NFSe — Focus NFe"
