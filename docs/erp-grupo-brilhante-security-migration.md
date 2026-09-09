# Segurança, migração e ativação do ERP Grupo Brilhante

## Estado inicial

O aplicativo Base44 é `6aa0eab298ecefdbd48dda38` e o repositório vinculado é `GLORIAVIRTUAL/grupo-brilhante`. A base foi clonada do sistema Glória Laundry e ainda contém identificadores, textos e defaults do aplicativo anterior. Esses resíduos não podem ser usados como fallback no ERP industrial.

## Bloqueadores P0 antes da primeira publicação

| Bloqueador | Correção obrigatória |
|---|---|
| Widget público autoriza por `conversation_id` | Sessão curta assinada, token aleatório com hash persistido, expiração, vínculo à conversa e rate limit |
| Workflow de IA aceita `message_id` sem prova de origem | Token interno obrigatório ou segredo específico do workflow |
| Webhook Asaas aceita segredo na query | Apenas cabeçalho, comparação em tempo constante e rotação documentada |
| Fallback para app id antigo | Remover todos os IDs hardcoded e usar contexto/ambiente do aplicativo atual |
| Origem de pagamento aponta para URL antiga | Configuração por ambiente e allowlist de redirect |
| Marca e município antigos em documentos/prompts | Branding, cidade, contatos e defaults por empresa legal/unidade |
| MFA não obrigatório por papel | Política empresarial server-side com MFA para ações críticas, sem depender de menu/frontend |
| Acesso global de `admin` no frontend | Escopo explícito `companies.view_all`/`units.view_all`, validado no servidor |

## Sessão pública do widget

O início do widget cria um `PublicConversationSession` contendo apenas hash do token, conversa, cliente, empresa/unidade, expiração, contador e status. O token bruto é devolvido uma vez ao navegador e enviado em cabeçalho nas ações subsequentes. Mensagens só podem ser lidas/escritas dentro da conversa vinculada.

A criação valida origem permitida, honeypot, tamanho, telefone normalizado e limite por IP/hash de agente. O endpoint não lista clientes em lote para deduplicar; usa lookup canônico server-side e não revela se um telefone já existe.

## Segregação empresarial

Toda função crítica recebe ou resolve `legal_entity_id` a partir da entidade-alvo. O cliente não pode trocar o escopo apenas enviando outro identificador. A função compara o escopo com concessões efetivas do usuário e registra negações. `super_admin` não substitui a necessidade de trilha de auditoria; operações de alto risco ainda exigem motivo e MFA quando a política estiver ativa.

## Migração Conta Azul

| Etapa | Resultado persistido |
|---|---|
| Inventário | Arquivos, período, entidades, campos, quantidade e hash |
| Staging | Dados normalizados sem mutar o domínio oficial |
| Validação | CNPJ, duplicidade, referências, saldos, datas e categorias |
| Dry-run | Plano de criação/atualização, conflitos e totais |
| Importação | `MigrationBatch` e `MigrationRecord` com checkpoints |
| Reconciliação | Totais por conta, status, período, CNPJ e diferença |
| Aceite | Aprovação por responsável e bloqueio contra reexecução |

A importação final não será executada nesta fase. O código trabalhará com arquivos de ensaio anonimizados até autorização específica.

## Integrações

| Integração | Estado inicial | Condição para homologação | Condição para produção |
|---|---|---|---|
| Banco do Brasil | `disabled` | Convênio, certificado, credenciais sandbox e cenários aprovados | Aprovação financeira e rollback testado |
| Focus NFe | `disabled` por empresa | Token sandbox, certificado, matriz fiscal e município | Aprovação contábil/fiscal por CNPJ |
| Sistema de DP | `disabled` | Contrato de API, dados de teste e mapeamento | Aprovação de RH/DP e reconciliação |
| WhatsApp/Meta | `disabled` por finalidade | Templates, consentimento e conta de teste | Aprovação de comunicação e secrets corretos |
| Asaas/Stripe | Legado, sem uso obrigatório no novo ERP | Testes isolados e escopo por empresa | Decisão explícita de manutenção ou aposentadoria |

## Backup, restauração e rollback

Antes do piloto, devem existir exportação versionada dos dados críticos, teste de restauração, registro de versão do código, snapshot de configurações sem secrets e plano de retorno ao processo anterior. Cada onda de schema deve ser aditiva até o aceite; remoções e renomeações destrutivas ficam para uma migração posterior.

## Confirmações obrigatórias

Exigem confirmação específica: publicar no Base44, ativar webhook, cadastrar secret, transmitir documento fiscal, criar cobrança, processar pagamento, enviar mensagem real, importar dados reais, alterar registros produtivos, promover integração para `production` ou executar corte de CNPJ.
