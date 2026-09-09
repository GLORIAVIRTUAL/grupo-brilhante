# Plano de ondas do ERP Grupo Brilhante

## Estratégia

Cada onda será desenvolvida em branch isolada, validada localmente e revisada antes de merge. Código preparado para integrações externas não significa ativação. Banco, fiscal, mensageria, folha e migração final permanecem bloqueados até configuração e confirmação explícitas.

| Onda | Escopo | Critérios mínimos de aceite |
|---:|---|---|
| 1 | Fundação multiempresa, segurança, auditoria, documentos e saneamento de resíduos | Schemas válidos; criação server-side; escopo empresa/unidade; MFA por política; widgets públicos protegidos; nenhum fallback para app antigo; build e testes |
| 2 | Cadastro unificado, CRM B2B, contratos e OS | Pessoa multipapel; contatos/endereços; oportunidade e próxima ação; contrato versionado; OS com checklist, materiais e assinatura; alçadas |
| 3 | Financeiro multiempresa e migração Conta Azul | Empresa/centro/competência em contas; períodos; intercompany; lote de migração; deduplicação; dry-run; conciliação e relatório de divergência |
| 4 | Banco do Brasil | Contrato do adaptador; cobrança idempotente; Pix/boleto; webhook; retorno; reconciliação; sandbox apenas |
| 5 | Fiscal e Focus NFe | Perfis por empresa; regras; emissão/consulta/cancelamento; lote; painel de erro; homologação apenas |
| 6 | Compras e estoque corporativo | Solicitação, cotação, pedido, recebimento parcial, estoque por depósito e custo; integração com contas a pagar |
| 7 | Lavanderia hospitalar e enxovais | Pesagem, lotes, conferência, medição, faturamento; patrimônio, movimento, inventário e perdas |
| 8 | Limpeza e terceirização | Locais, postos, escalas, checklist, inspeção, medição e adaptador de DP desativado |
| 9 | Atendimento, automações, site e BI | Widget seguro, omnichannel, SLA, base de conhecimento, templates, site B2B e relatórios industriais agendáveis |
| 10 | Migração ensaiada, hardening e homologação | Testes integrados, carga de ensaio, reparos, backup/rollback, piloto por CNPJ e documentação operacional |

## Critério de pronto por função

Uma função server-side está pronta quando rejeita método incorreto, autentica o ator ou provedor, valida empresa/unidade, normaliza o payload, aplica permissão, protege idempotência, audita o resultado e retorna erro seguro. Funções de integração devem ter timeout, limite de tamanho, ambiente, allowlist quando aplicável e falha segura sem secret.

## Critério de pronto por interface

Uma interface está pronta quando respeita permissões efetivas, não executa mutação crítica diretamente em entidade, apresenta estados de carregamento/erro/vazio, confirma ações irreversíveis, não simula sucesso de integração e mantém acessibilidade e responsividade.

## Bateria cumulativa

| Verificação | Frequência |
|---|---|
| Validação de schemas e contratos | Toda mudança de domínio |
| Empacotamento de funções | Toda onda |
| Testes determinísticos de regras | Todo commit relevante |
| Lint direcionado | Todo arquivo alterado |
| Build completo | Antes de commit e PR |
| Typecheck global comparado à base | Antes de PR |
| Auditoria de dependências | Antes de PR |
| Varredura de secrets e resíduos | Antes de commit e publicação |
| Smoke test não destrutivo | Após merge e após publicação |

## Restrições operacionais

Não serão executados pagamento, emissão fiscal, cobrança bancária, WhatsApp, Instagram, Facebook, migração de dados reais ou alteração de registros de produção sem autorização específica. O código deve retornar `integration_not_configured`, `homologation_required` ou equivalente enquanto o ambiente não estiver aprovado.
