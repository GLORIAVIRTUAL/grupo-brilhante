# GL-RIA Laundry 5àSec

Aplicação de gestão de lavanderia construída sobre **React, Vite e Base44**, com CRM, atendimento, coletas, financeiro e operação multiunidade. Esta branch acrescenta uma central operacional moderna na página **Gestão**, mantendo os fluxos existentes e introduzindo rastreabilidade por peça, orçamento assistido por imagens, leitura de documentos, estoque, contas, caixa, qualidade, terceiros e revisão humana.

> A inteligência artificial prepara rascunhos e sugestões. Criação de pedido, movimentação de estoque, lançamento financeiro e confirmação de pagamento permanecem ações explícitas, autenticadas e auditadas.

## Recursos principais

| Área | Recursos implementados |
|---|---|
| Atendimento | Orçamento manual preservado e novo orçamento por múltiplas fotos, com correspondência ao catálogo e revisão por confiança. |
| Operação | Peça individual, código, atributos, avarias, fotos, estado, localização, SLA e histórico imutável de eventos. |
| Produção | Quadro por peça, lotes por capacidade, máquinas configuráveis, apontamento de operador, consumo automático, custos reais, qualidade, retrabalho e terceiros. |
| Compras e estoque | Fornecedores, insumos, lotes, validade, custo médio, disponibilidade, transferências, perdas, inventário cego, fichas técnicas e leitura de notas. |
| Financeiro | Contas a pagar e receber, recebimentos mistos/parciais, crédito do cliente, convênios, faturados, caixa por operador, alocações, conciliação e despesas recorrentes pendentes. |
| Comercial e fiscal | Ciclo versionado de orçamentos, validade, alçadas, fechamento periódico e preparação local de RPS/NFS-e com transmissão desativada. |
| Segurança e governança | Papéis, permissões, múltiplas unidades, suspensão, revisão de acesso, políticas de MFA, sessões, uploads validados, idempotência e auditoria completa. |
| Analytics e CRM | Treze relatórios especializados, comparação de período, CRM 360, fidelidade, vouchers, pacotes e catálogos operacionais pesquisáveis. |
| Logística de campo | Frota, capacidade, documentos, rotas, motorista, GPS, tentativas, provas de serviço, recebedor e odômetro. |
| Integrações | Configuração exclusivamente por ambiente e painel que informa apenas a presença dos segredos, nunca os seus valores. |

## Execução local

É necessário ter Node.js e npm disponíveis. Depois de clonar o repositório, execute:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Preencha somente as variáveis do ambiente de desenvolvimento autorizado. Os valores reais **não devem ser adicionados ao Git**. Sem `VITE_BASE44_APP_ID` e `VITE_BASE44_APP_BASE_URL`, o build pode ser validado, mas as rotas autenticadas não terão backend para carregar dados.

## Validação

O frontend pode ser compilado e os invariantes da evolução podem ser verificados com:

```bash
npm run build
python3 scripts/validate-laundry-evolution.py
```

O script valida schemas, entidades obrigatórias, autenticação explícita das funções novas, ausência de segredos no modelo de ambiente e controles críticos de orçamento, pagamentos, comprovantes, uploads e despesas recorrentes. Para validar também o núcleo operacional de balcão, execute:

```bash
npm run validate:counter-core
npm run validate:wave2
npm run validate:wave3
npm run validate:wave4
```

## Configuração e implantação

| Documento | Finalidade |
|---|---|
| [`docs/setup-integrations.md`](docs/setup-integrations.md) | Segredos, integrações, hosts permitidos e configuração por ambiente. |
| [`docs/operations-guide.md`](docs/operations-guide.md) | Uso dos novos fluxos de Gestão. |
| [`docs/manual-garment-characteristics.md`](docs/manual-garment-characteristics.md) | Características e conferência individual das peças no orçamento manual. |
| [`docs/operational-counter-core.md`](docs/operational-counter-core.md) | Serviços por peça, etiquetas, leitura, localização e entrega parcial. |
| [`docs/wave2-financial-fiscal.md`](docs/wave2-financial-fiscal.md) | Pagamentos mistos, crédito, convênios, faturados, orçamentos, caixa e preparação fiscal. |
| [`docs/wave3-stock-production.md`](docs/wave3-stock-production.md) | Estoque por lote, inventário, consumo, máquinas, produção, custos, perdas e alertas. |
| [`docs/wave4-governance-analytics-crm-logistics.md`](docs/wave4-governance-analytics-crm-logistics.md) | Governança, MFA, auditoria, preços, catálogos, CRM 360, fidelidade, relatórios e logística de campo. |
| [`docs/nfse-porto-alegre-research.md`](docs/nfse-porto-alegre-research.md) | Base oficial para a futura integração com o Emissor Nacional de NFS-e. |
| [`docs/migration-rollout.md`](docs/migration-rollout.md) | Sequência segura para homologação e ativação gradual. |
| [`docs/security-architecture.md`](docs/security-architecture.md) | Papéis, unidades, auditoria, documentos, pagamentos e revisão humana. |
| [`docs/validation-notes.md`](docs/validation-notes.md) | Testes executados e limitações atuais do repositório sem backend. |

Mudanças enviadas ao repositório podem ser refletidas no Base44 Builder. A publicação deve ser realizada em uma aplicação de **homologação**, seguida da execução da migração e dos testes de aceite antes da promoção para produção.

## Referências da plataforma

A documentação de integração do Base44 com GitHub está disponível em [docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub). O suporte da plataforma permanece acessível em [app.base44.com/support](https://app.base44.com/support).
