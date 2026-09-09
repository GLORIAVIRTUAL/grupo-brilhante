# Núcleo operacional de balcão

O núcleo operacional conecta o orçamento detalhado ao percurso físico da roupa. Ele adiciona **múltiplos serviços por peça**, precificação central, etiqueta QR, leitura por câmera ou scanner USB, localização física, busca multicritério e entrega total ou parcial com comprovante. Os módulos anteriores permanecem disponíveis e o preço legado do `Product` continua sendo utilizado quando a peça não possui serviços estruturados.[1] [2]

## Arquitetura funcional

| Capacidade | Interface | Operação server-side | Persistência |
|---|---|---|---|
| Serviços por peça | `ManualGarmentCharacteristics` | `price_garment_services` e `approve_quote` | `LaundryService`, `PriceRule`, `Quote`, `GarmentItem` |
| Etiquetas | `GarmentLabelPrintDialog` | `register_label_print` | `GarmentItem`, `AuditLog` |
| Leitura | `GarmentScannerDialog` | Consulta local do conjunto autorizado | Código `garment_code` |
| Localização | `GarmentLocationPanel` | `manage_location` e `move_garments` | `Location`, `GarmentItem`, `GarmentEvent` |
| Entrega parcial | `GarmentDeliveryDialog` | `complete_garment_delivery` | `DeliveryReceipt`, `GarmentItem`, `Order`, `GarmentEvent` |

## Preparação do catálogo de serviços

O orçamento continua funcionando com o catálogo antigo, mas a composição moderna exige registros ativos em `LaundryService`. Cada serviço deve ter código estável, nome, categoria, preço-base, duração aproximada e etapas de produção. O campo `compatible_product_ids` pode restringir o serviço a determinados tipos de peça. Quando estiver vazio, o serviço é considerado global.[1]

As regras de `PriceRule` podem especializar o preço por unidade, produto, serviço, grupo do cliente e prioridade. A função server-side escolhe a regra válida mais específica e ignora valores manipulados pelo navegador. Se nenhum serviço for selecionado, ela recupera o preço do `Product`, preservando compatibilidade com o atendimento existente.[2]

| Cadastro mínimo sugerido | Exemplo |
|---|---|
| Limpeza | Lavagem, lavagem a seco e higienização especial |
| Acabamento | Passadoria e embalagem especial |
| Tratamento | Impermeabilização e remoção técnica de manchas |
| Reparo | Pequena costura, troca de botão e ajuste |
| Terceiro | Tingimento ou serviço especializado externo |

## Etiquetas e leitura

A Gestão passa a ter a aba **Etiquetas e entrega**. O operador pesquisa ou seleciona peças, registra a impressão e recebe um documento térmico no formato **62 × 40 mm**. A etiqueta contém QR, código legível, ticket, peça, características e serviços, mas não exibe nome, telefone ou documento do cliente.[3]

A primeira impressão não exige justificativa. Toda reimpressão exige motivo e aumenta `label_print_count`, registrando usuário, unidade, data e alteração na auditoria. O leitor aceita QR por câmera quando o navegador oferece `BarcodeDetector`; em qualquer navegador, o código pode ser digitado ou lido por scanner USB que funcione como teclado.[3] [4]

## Localização física

Somente gestores ou usuários com permissão específica podem cadastrar posições. Códigos são únicos dentro da unidade e podem representar recepção, produção, máquina, arara, prateleira, locker, expedição, terceiro ou outra área. Uma posição pode ter capacidade limitada ou ilimitada.[5]

A movimentação aceita várias peças da mesma unidade, valida capacidade e impede mover peças entregues ou canceladas. Cada mudança atualiza a peça, gera `GarmentEvent`, recalcula ocupação e grava `AuditLog`. A idempotência protege contra repetição de cliques ou reenvio da mesma operação.[6]

## Retirada e entrega parcial

A entrega permite selecionar somente peças com estado `ready` ou `out_for_delivery`, desde que pertençam ao mesmo cliente e à mesma unidade. O operador informa quem recebeu, relação com o cliente, últimos quatro dígitos opcionais do documento, tipo de entrega, observação e foto opcional.[7]

Se os pedidos envolvidos tiverem saldo em aberto, a operação é bloqueada. Uma liberação excepcional exige perfil gerencial ou permissão dedicada, além de justificativa detalhada. Quando autorizada, essa condição aparece no comprovante e na auditoria. A entrega atualiza somente as peças selecionadas; o pedido torna-se `partially_delivered` enquanto houver outras peças abertas e é encerrado apenas quando todas as peças ativas forem entregues.[7]

| Cenário | Resultado esperado |
|---|---|
| Todas as peças prontas e pagas | Entrega total e encerramento do pedido |
| Parte das peças pronta e paga | Entrega parcial; peças restantes continuam abertas |
| Peça ainda em produção | Entrega bloqueada |
| Saldo em aberto | Entrega bloqueada até pagamento ou liberação gerencial |
| Clientes ou unidades diferentes na seleção | Operação bloqueada |
| Clique repetido | Mesmo comprovante retornado pela idempotência |

## Segurança e privacidade

Todos os endpoints novos exigem usuário autenticado, papel ou permissão adequada e acesso à unidade da peça. A precificação é refeita no servidor. Movimentações e entregas usam chaves de idempotência, e as ações críticas geram auditoria. Fotos de prova reutilizam a política de upload privado, validação de tipo e tamanho, hash SHA-256 e detecção de duplicidade.[2] [6] [7]

O comprovante mostra apenas os quatro últimos dígitos do documento quando informados. A etiqueta evita dados pessoais e utiliza o código da peça como ponte para o registro protegido no sistema.

## Homologação

A homologação deve começar com uma unidade e um catálogo pequeno. Cadastre ao menos duas peças, três serviços, uma regra específica e três posições físicas. Gere um orçamento com dois serviços na mesma peça, aprove-o, imprima a etiqueta, leia o QR, mova a peça, passe-a para `ready` e realize uma entrega parcial.

| Teste | Critério de aceite |
|---|---|
| Precificação | Soma server-side coincide com os serviços e a regra específica |
| Compatibilidade | Serviço incompatível retorna erro e não altera o orçamento |
| Reimpressão | Exige motivo e incrementa o contador |
| Capacidade | Posição cheia bloqueia nova entrada |
| Busca | Encontra por código, ticket, cliente, cor, marca, tamanho, serviço e posição |
| Entrega parcial | Atualiza somente as peças escolhidas e mantém o ticket aberto |
| Saldo | Bloqueia entrega sem pagamento ou autorização gerencial |
| Comprovante | Mostra peças entregues, recebedor, valor e indicação parcial/total |

O comando de validação local é:

```bash
npm run validate:counter-core
```

Ele verifica schemas, autenticação, invariantes críticos, precificação, lint dos arquivos modificados e build do frontend. O `typecheck` global e o `lint` global do legado ainda possuem falhas anteriores a esta entrega e devem ser tratados em uma iniciativa separada; os arquivos deste núcleo passam no lint direcionado e no build.

## Referências

[1]: ../base44/entities/LaundryService.jsonc "Catálogo de serviços"
[2]: ../base44/shared/laundryPricing.js "Precificação central de serviços"
[3]: ../src/lib/garmentLabels.js "Documento térmico de etiquetas"
[4]: ../src/components/management/GarmentScannerDialog.jsx "Leitor de etiquetas"
[5]: ../base44/functions/manage_location/entry.ts "Gestão de posições"
[6]: ../base44/functions/move_garments/entry.ts "Movimentação física"
[7]: ../base44/functions/complete_garment_delivery/entry.ts "Entrega transacional"
