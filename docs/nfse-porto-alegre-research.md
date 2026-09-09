# NFS-e de Porto Alegre — base oficial para a integração futura

**Data da consulta:** 4 de setembro de 2026.

## Decisão arquitetural

A integração futura não deve nascer como um webservice municipal legado. A Prefeitura de Porto Alegre informa que, desde **1º de novembro de 2025**, a emissão de NFS-e passou a ser obrigatória por meio do **Emissor Nacional**; o sistema Nota Legal municipal permanece para consulta e cancelamento dentro das regras aplicáveis.[1]

Portanto, a estrutura desta etapa manterá adaptadores desacoplados, mas adotará `national_nfse` como destino recomendado para novas emissões de Porto Alegre. O identificador `poa_direct` será preservado somente para compatibilidade ou operações legadas que ainda dependam do ambiente municipal.

## Contrato técnico confirmado

O portal oficial do Sistema Nacional publica URLs distintas para **produção restrita** e **produção**, incluindo APIs de parâmetros municipais, ADN, DANFSE e SEFIN Nacional.[2] O manual oficial descreve:

| Operação futura | Contrato oficial |
|---|---|
| Consultar parâmetros municipais | Endpoints de parâmetros por código IBGE, serviço e contribuinte |
| Emitir NFS-e | Envio síncrono de uma DPS por `POST /nfse` |
| Consultar NFS-e | Consulta pela chave de acesso |
| Localizar documento pela DPS | Consulta por identificador da DPS |
| Cancelar ou registrar outros fatos | API de eventos vinculada à chave de acesso |
| Homologar | Produção restrita antes de produção |

A DPS e os eventos utilizam documento fiscal eletrônico em XML e assinatura digital; as mensagens de integração seguem o contrato publicado pelo Sistema Nacional.[3] Certificados, senhas e chaves não devem ser armazenados no banco nem enviados ao frontend. Nesta Onda 2, a emissão permanecerá desativada e somente a preparação, validação e fila segura serão implementadas.

## Referências

[1]: https://prefeitura.poa.br/smf/nota-legal/nota-fiscal-de-servicos-eletronica-nfse "Prefeitura de Porto Alegre — Nota Fiscal de Serviços Eletrônica"

[2]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao "Sistema Nacional NFS-e — APIs de produção restrita e produção"

[3]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf "Manual dos Contribuintes — APIs do Emissor Público Nacional"
