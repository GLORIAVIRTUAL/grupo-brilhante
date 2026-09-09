# Fontes oficiais — integração Banco do Brasil

**Data de consulta:** 9 de setembro de 2026.

A arquitetura bancária do ERP usa as APIs oficiais apenas como contratos de homologação; chamadas externas permanecem desativadas por padrão. Segundo o Portal Developers BB, a **API Cobrança v2** permite emitir, consultar e dar baixa em boletos, é exclusiva para CNPJ e requer convênio de cobrança e cadastro no portal.[1] A **API Pix v2** permite cobranças imediatas e com vencimento, consulta de Pix recebidos, devoluções, webhooks e gestão de locations/QR Code; requer cliente BB pessoa jurídica e chave Pix ativa.[2]

O portal também descreve o ciclo oficial de integração como criação de aplicação, seleção de APIs, testes em sandbox e posterior envio para produção, e lista APIs adicionais de extratos e pagamentos em lote.[3] A página de apoio ao webhook de Cobrança confirma a existência de cadastro de eventos e de orientações específicas de segurança/certificados e testes em sandbox, embora o conteúdo técnico detalhado seja carregado dinamicamente.[4]

## Referências

[1]: https://www.bb.com.br/site/developers/api-cobranca/ "API Cobrança v2 — Portal Developers BB"
[2]: https://www.bb.com.br/site/developers/api-pix/ "API Pix v2 — Portal Developers BB"
[3]: https://developers.bb.com.br/ "Portal Developers BB"
[4]: https://apoio.developers.bb.com.br/guias-e-tutoriais/webhook/apis-com-webhook/api-cobranca "Webhook API Cobrança — Portal de Apoio ao Desenvolvedor BB"

O padrão **CNAB 240** define arquivos com header, lotes de serviço, registros detalhe e trailer, incluindo fluxos de cobrança, pagamentos e extrato de conta para conciliação. O próprio padrão exige que a composição e os serviços utilizados sejam acordados entre banco e empresa, portanto o ERP registra `source_type`, hash do arquivo e versão/layout antes de habilitar parsing definitivo.[5] A página institucional do BB mantém uma área específica de leiautes de arquivos, que deverá ser usada na homologação do convênio para selecionar a versão exata aplicável ao Grupo Brilhante.[6]

[5]: https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20padrao%20CNAB240%20V%2010%2011%20-%2021_08_2023.pdf "Padrão Febraban CNAB 240 — versão 10.11"
[6]: https://bb.com.br/site/pro-seu-negocio/aplicativos-leiautes-de-arquivos/ "Aplicativos e leiautes de arquivos — Banco do Brasil"
