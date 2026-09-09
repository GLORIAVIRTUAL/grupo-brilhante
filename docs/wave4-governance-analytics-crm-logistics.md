# Onda 4 — Governança, Analytics, CRM e Logística

**Autor:** Manus AI  
**Data:** 04/09/2026

A Onda 4 conclui os sete blocos funcionais identificados após a implantação das ondas de balcão, financeiro e produção. Ela adiciona governança administrativa, auditoria completa, administração comercial, catálogos operacionais, CRM 360, relatórios especializados e logística de campo sem remover os fluxos anteriores.

> A autenticação multifator continua sendo executada pelo provedor de identidade. O sistema armazena somente políticas, exigência, estado verificável e eventos de auditoria; fatores, códigos e segredos nunca são persistidos pela aplicação.

## Escopo implantado

| Bloco | Recursos principais | Local de acesso |
|---|---|---|
| Governança | Papéis, permissões excepcionais, múltiplas unidades, suspensão, revisão periódica, exigência e estado de MFA | **Configurações → Governança** |
| Auditoria | Filtros por domínio, ação, severidade, resultado e período; comparação antes/depois; exportação justificada e mascarada | **Gestão → Auditoria** |
| Preços | Regras versionadas, rascunho, simulação pelo motor real, vigência, conflito, ativação, encerramento e alçadas | **Configurações → Preços** |
| Catálogos | Cores, materiais, estampas, tamanhos, marcas, avarias, riscos, detalhes e motivos logísticos | **Configurações → Catálogos** |
| CRM 360 | Consumo, recorrência, crédito, inadimplência, pontos, vouchers, pacotes, preferências e atividade recente | **Clientes → CRM 360** |
| Relatórios | Treze relatórios especializados, comparação de período, gráficos, dados detalhados e exportações | **Relatórios** no menu principal |
| Logística | Frota, rotas, motorista, capacidade, GPS, tentativas, foto, recebedor, odômetro e conclusão | **Coletas → Operação externa** |

## Governança e MFA

A central administrativa usa o catálogo canônico de papéis e permissões definido no servidor. O papel oferece uma base; permissões concedidas ou negadas individualmente são exceções explícitas e auditadas. O escopo de unidades determina onde o usuário pode consultar ou operar dados.

| Controle | Regra operacional |
|---|---|
| Suspensão | Impede novas operações e marca sessões para revogação lógica. Reativação exige justificativa. |
| MFA | Administradores, gerentes, financeiro e auditores podem ser obrigados por política. A verificação real permanece no provedor de identidade. |
| Revisão de acesso | Cada usuário pode ter responsável e data de próxima revisão. |
| Unidade principal | Define o contexto padrão. Unidades permitidas limitam consultas e operações. |
| Permissões excepcionais | Concessões e negações individuais são registradas separadamente do papel. |
| Sessões | Eventos de login, logout, MFA, bloqueio e revogação lógica formam histórico imutável. |

Antes de liberar a central em produção, o administrador deve revisar todos os usuários, substituir papéis antigos pelos papéis canônicos, definir unidades permitidas e habilitar MFA no provedor de identidade para os perfis sensíveis.

## Auditoria

A nova central consulta eventos de todos os domínios. Dados sensíveis são mascarados antes de serem entregues à interface ou exportados. A exportação exige justificativa e cria seu próprio evento de auditoria.

| Domínio | Exemplos de eventos |
|---|---|
| Segurança | Login, MFA, suspensão, alteração de papel e permissão |
| Comercial | Preço, orçamento, desconto, cortesia e convênio |
| Financeiro/fiscal | Recebimento, estorno, caixa, conciliação, faturamento e RPS |
| Estoque/produção | Movimento, inventário, consumo, lote, custo, perda e máquina |
| CRM/fidelidade | Pontos, voucher, pacote, crédito e consentimento |
| Logística | Frota, rota, parada, geolocalização, tentativa e prova |

A retenção e o acesso às exportações devem seguir a política interna da empresa e o princípio de menor privilégio.

## Preços e alçadas

Toda regra inicia como rascunho. A simulação executa o mesmo motor usado pelos orçamentos; portanto, a administração não mantém um cálculo paralelo. A ativação verifica conflitos de vigência e cria uma versão imutável.

| Estado | Significado |
|---|---|
| `draft` | Pode ser ajustada e simulada, mas não afeta novos orçamentos. |
| `active` | Participa do cálculo conforme prioridade, escopo e vigência. |
| `retired` | Mantida para histórico, sem efeito em novos cálculos. |

As alçadas controlam descontos, acréscimos e cortesias por papel e unidade. Um usuário não pode aprovar além de seu limite, e operações sensíveis podem exigir segregação entre solicitante e aprovador.

## Catálogos operacionais

Os catálogos substituem listas fixas espalhadas pela aplicação. Cada entrada possui rótulo normalizado, sinônimos, favorito, escopo de unidade, estado e contagem de uso. A deduplicação considera tipo, unidade, nome normalizado e sinônimos.

No orçamento manual, os novos catálogos complementam os atalhos existentes. Avarias, riscos e confirmações continuam individuais por peça e nunca são copiadas automaticamente.

## CRM 360, fidelidade, vouchers e pacotes

O CRM 360 monta um retrato do cliente a partir de pedidos, orçamentos, contas, coletas, entregas, conversas, fidelidade, vouchers e pacotes. Pontos e unidades de pacote não são saldos editáveis: são derivados de razões imutáveis.

| Recurso | Garantia |
|---|---|
| Pontos | Acúmulo, resgate, expiração, estorno e ajuste preservam saldo não negativo. |
| Voucher | Código único, validade, cliente, unidade, tipo, valor/percentual e estado. |
| Pacote | Saldo por serviço, compra, consumo, reversão, validade e histórico. |
| Segmentação | Classificação baseada em consumo e relacionamento, sem apagar a classificação administrativa. |
| Crédito | Continua separado dos pontos e pacotes; não há conversão implícita entre saldos. |

Antes da ativação, cadastre um programa em rascunho, valide acúmulo e resgate com clientes de teste e só então publique a versão ativa.

## Relatórios especializados

A central oferece treze visões calculadas no servidor, sempre com escopo de unidade e período. Cada relatório retorna resumo, série temporal quando aplicável, distribuições, linhas detalhadas, definições e limitações de qualidade.

| Relatório | Indicadores centrais |
|---|---|
| Produção | Lotes, peças, peso, capacidade, duração e custo |
| Atrasos | Pedidos e peças fora do prazo, tempo e etapa responsável |
| Retrabalho | Casos, causas, responsabilidade, custo e SLA |
| Terceiros | Ordens, prazos, custo, qualidade e retorno |
| Estoque | Saldo, disponibilidade, lote, validade, mínimo e valor |
| Consumo | Previsto, realizado, desvio, custo e perda |
| Margem por serviço | Receita, custo operacional e margem absoluta/percentual |
| Produtividade | Lotes, peças, horas, custo e produção por funcionário |
| Caixa | Aberturas, movimentos, meios, diferenças e aprovações |
| Faturados | Demonstrativos, títulos, vencimentos, pagamentos e inadimplência |
| Fiscal | RPS preparados, autorizados, rejeitados, cancelados e valores |
| Coletas/logística | Rotas, paradas, tentativas, conclusão, distância e SLA |
| Rentabilidade por unidade | Receita, custos, despesas, margem e comparação entre unidades |

A comparação usa um período anterior de duração equivalente. CSV e JSON respeitam o mesmo escopo e devem ser exportados apenas por usuários autorizados.

## Frota e jornada de campo

O gestor cadastra veículos, documentos, capacidade, odômetro, custos, disponibilidade e manutenção. Uma rota vincula unidade, motorista, veículo e paradas ordenadas. O motorista inicia a rota, registra localização, chegada, atendimento, conclusão ou falha e encerra com odômetro final.

| Evento de parada | Dados mínimos |
|---|---|
| Chegada | Localização e horário |
| Início | Responsável e horário |
| Conclusão | Recebedor, últimos dígitos do documento, horário e prova opcional |
| Tentativa frustrada | Motivo, descrição, horário, localização e prova opcional |

Fotos são processadas pelo fluxo de upload seguro e permanecem privadas. O documento do recebedor é reduzido aos últimos dígitos necessários para a evidência operacional.

## Sequência de homologação

| Etapa | Ação | Critério de aceite |
|---:|---|---|
| 1 | Aplicar schemas e funções em homologação | Entidades e endpoints disponíveis sem erro |
| 2 | Configurar usuários, papéis e unidades | Cada perfil enxerga somente o escopo autorizado |
| 3 | Configurar MFA no provedor | Perfis sensíveis bloqueados sem MFA verificado |
| 4 | Cadastrar alçadas e regras em rascunho | Simulações iguais ao orçamento real |
| 5 | Importar e revisar catálogos | Sem duplicidades e com sinônimos pesquisáveis |
| 6 | Criar programa de fidelidade de teste | Acúmulo, resgate e estorno reconciliados |
| 7 | Validar os 13 relatórios | Totais reconciliados com amostras operacionais |
| 8 | Cadastrar um veículo e uma rota piloto | Jornada completa com tentativa e prova |
| 9 | Revisar auditoria e exportação | Eventos antes/depois, mascaramento e justificativa presentes |
| 10 | Piloto em uma unidade | Cinco dias úteis sem divergência crítica |

## Comandos de validação

```bash
npm run test:wave4
npm run validate:wave4
```

A validação integral confere schemas, invariantes, autorização, idempotência, mascaramento, cálculos, lint direcionado, typecheck direcionado, compilação das funções server-side e build de produção.

## Limites intencionais

A Onda 4 não armazena segredos de MFA, não substitui o provedor de identidade, não transmite NFS-e, não executa rastreamento contínuo em segundo plano sem consentimento do dispositivo e não altera automaticamente preços, pontos, pacotes ou rotas sem operação autenticada.
