# Onda 4 — Contrato de Governança, Analytics, CRM e Logística

## Objetivo

A Onda 4 completa sete blocos sem substituir as Ondas 1–3: governança de acesso, auditoria avançada, preços, catálogos operacionais, CRM/fidelidade, relatórios especializados e logística de campo.

## Princípios de compatibilidade

1. Nenhuma entidade ou campo existente será removido.
2. Funções sensíveis permanecem server-side, autenticadas, escopadas por unidade e auditadas.
3. A interface pode ocultar ações, mas o backend continua sendo a autoridade de autorização.
4. MFA nesta onda significa política, estado de conformidade e desafio obrigatório para operações críticas. A autenticação forte real depende da capacidade do provedor de identidade Base44; não serão criados segredos OTP no frontend.
5. Relatórios usam agregação server-side e retornam linhas e métricas limitadas por período e unidade, evitando carregar todas as entidades no navegador.
6. Fidelidade usa razão imutável. Pontos, vouchers e pacotes nunca são saldos editados diretamente.
7. Preço aplicado ao pedido continua sendo recalculado por `laundryPricing.js`; a administração apenas cria versões de regras.
8. Catálogos operacionais usam slugs normalizados, sinônimos e bloqueio de duplicidade.
9. A jornada de motorista não substitui a agenda de coletas nem o planejador existente; ela adiciona atribuição, estados de campo e evidências.
10. Nenhuma integração externa será ativada sem credenciais. Localização pode ser registrada pelo navegador somente após consentimento do operador.

## Bloco 1 — Governança e MFA

### Entidades

- `AccessPolicy`: política por papel, operações críticas, MFA e segregação.
- `UserSessionEvent`: eventos de sessão e autenticação reforçada sem armazenar token.
- Ampliação de `User`: versão de acesso, MFA inscrito/verificado, bloqueio e datas de revisão.

### Operações server-side

- listar catálogo de papéis e permissões;
- convidar/atualizar usuário, unidades e permissões;
- suspender/reativar usuário;
- marcar adesão e verificação de MFA conforme confirmação do provedor;
- registrar desafio reforçado e validar recência para ações críticas;
- registrar todas as mudanças em `AuditLog`.

### Invariantes

- usuário não pode elevar o próprio papel;
- somente `super_admin`/`admin` gerenciam papéis; gerente pode administrar escopo limitado quando autorizado;
- sempre deve restar pelo menos um administrador ativo;
- permissões extras são escolhidas de catálogo fechado;
- múltiplas unidades são validadas contra `Unit` existente.

## Bloco 2 — Auditoria avançada

### Ampliações

`AuditLog` receberá domínio, severidade, resultado, alvo, origem, retenção e campos de mascaramento. A consulta será feita por função autenticada com filtros, paginação e exportação auditada.

### Invariantes

- logs não são editados nem excluídos pela interface;
- exportação exige permissão específica e justificativa;
- dados pessoais e segredos são mascarados antes da resposta;
- consultas cross-unit exigem papel administrativo/auditor.

## Bloco 3 — Preços e alçadas

### Entidades

- `PriceRuleVersion`: snapshot imutável de cada versão.
- `CommercialApprovalPolicy`: limites de desconto, acréscimo e cortesia por unidade/papel.

### Operações

- criar rascunho, simular, ativar, encerrar e duplicar regra;
- impedir sobreposição ambígua de regras com mesma especificidade e período;
- simular preço usando o mesmo motor do orçamento;
- administrar alçadas sem alterar registros históricos.

## Bloco 4 — Catálogos operacionais

### Entidade

`OperationalCatalogEntry` com tipos `color`, `material`, `pattern`, `size`, `brand`, `damage`, `risk`, `garment_detail`, `pickup_failure_reason` e `delivery_failure_reason`.

### Invariantes

- unicidade por tipo, unidade e slug;
- sinônimos normalizados e pesquisáveis;
- itens usados não são apagados; ficam inativos;
- favoritos e ordem por unidade são configuráveis.

## Bloco 5 — CRM 360 e fidelidade

### Entidades

- `LoyaltyProgram`;
- `LoyaltyLedger`;
- `Voucher`;
- `CustomerPackage`;
- `CustomerPackageLedger`.

### Operações

- emitir, acumular, resgatar, expirar e reverter pontos;
- criar e resgatar voucher com idempotência;
- vender/conceder pacote e consumir unidades por serviço;
- produzir snapshot CRM server-side com consumo, recorrência, crédito, inadimplência, qualidade e relacionamento.

### Invariantes

- saldo é derivado do razão;
- resgate nunca deixa saldo negativo;
- voucher é de uso único ou limitado conforme regra;
- estornos restauram pontos/pacote sem apagar o evento original;
- ações promocionais exigem consentimento válido quando houver comunicação.

## Bloco 6 — Relatórios especializados

### Motor analítico

A função `generate_specialized_report` aceitará: `report_type`, `unit_ids`, `start_date`, `end_date`, filtros e paginação. Tipos:

- `production`;
- `delays`;
- `rework`;
- `third_parties`;
- `stock`;
- `consumption`;
- `service_margin`;
- `employee_productivity`;
- `cash`;
- `billing`;
- `fiscal`;
- `logistics`;
- `unit_profitability`.

O retorno terá `summary`, `series`, `breakdowns`, `rows`, `definitions`, `generated_at` e `data_quality`.

### Regras de cálculo

- margem = receita reconhecida − insumos − mão de obra − utilidades − terceiros − taxas atribuíveis;
- atrasos usam previsão/SLAs e estado ainda não concluído;
- produtividade separa volume, tempo, qualidade e retrabalho;
- rentabilidade por unidade não mistura transferências internas com receita externa;
- todo relatório apresenta definições e limitações dos dados.

## Bloco 7 — Logística de campo

### Entidades

- `Vehicle`;
- `FieldRoute`;
- `FieldRouteStop`;
- `DriverShift`;
- `FieldLocationEvent`.

### Operações

- cadastrar veículo;
- abrir turno do motorista;
- criar rota a partir das coletas existentes;
- atribuir motorista e veículo;
- iniciar rota, chegar, concluir, falhar e reagendar parada;
- anexar foto/assinatura/código de confirmação;
- registrar localização com precisão e consentimento;
- encerrar turno e resumir distância/tempo/tentativas.

### Invariantes

- uma coleta só pode pertencer a uma rota ativa por vez;
- motorista/veículo não podem ter turnos sobrepostos;
- conclusão exige evidência configurável;
- tentativa frustrada exige motivo e próxima ação;
- coordenadas não substituem endereço e têm retenção limitada.

## Navegação e experiência

- `Relatórios` terá item próprio na navegação.
- `Governança`, `Preços`, `Catálogos` e `Auditoria` ficarão em Configurações/Gestão conforme papel.
- `CRM 360` será aberto a partir da página de Clientes.
- `Fidelidade` será uma aba do CRM 360.
- `Operação de campo` será uma extensão da página Coletas, preservando agenda e planejador.

## Homologação

A ativação ocorrerá por unidade e por bloco. Cada bloco deverá ter dados de teste, critérios de aceite, possibilidade de desativação visual e nenhuma dependência de token externo para o caminho manual.
