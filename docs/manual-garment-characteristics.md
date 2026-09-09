# Características por peça no orçamento manual

O orçamento manual deve terminar no mesmo contrato de dados do orçamento por imagens. A unidade de edição é a **peça física**, não apenas uma linha agregada de produto. Ao adicionar quantidade maior que um, a interface cria peças individuais com valores inicialmente iguais; o usuário pode duplicar características entre elas e editar somente as exceções.

## Campos e comportamento

| Grupo | Campos | Comportamento |
|---|---|---|
| Identificação | Produto, nome da peça, sequência | Produto vem do catálogo; cada peça recebe `line_id` próprio. |
| Aparência | Cor, marca, estampa, tamanho, material | Sugestões rápidas e entrada livre para casos não cadastrados. |
| Dimensões | Largura e altura em centímetros | Opcionais; úteis para tapetes, cortinas, persianas e itens cobrados por área. |
| Estado de entrada | Avarias, riscos e observações | Avarias são marcadores rápidos e podem receber texto complementar. |
| Autorização | Ciência do cliente sobre riscos | Obrigatória quando houver avaria ou risco selecionado. |
| Serviço e preço | Serviço principal do catálogo e preço individual | O preço continua originado no produto e pode ser revisado pelo funcionário autorizado. |

## Regras de quantidade

Quando o carrinho passa de uma para duas unidades, a nova peça recebe somente uma cópia da identificação visual da última peça daquele produto. Avarias, riscos, observações e conferência nunca são copiados automaticamente, pois precisam refletir a inspeção física de cada unidade. Quando a quantidade é reduzida, somente as últimas peças ainda não persistidas são removidas. Cada peça é salva no orçamento com `qty: 1`, evitando que diferentes cores, marcas ou avarias sejam comprimidas em uma mesma linha.

## Fluxo da interface

Após selecionar os produtos, o botão de avanço abre a etapa **Características**. A coluna lateral lista todas as peças e mostra a completude de cada uma. O painel principal usa seleções rápidas para cor, estampa, tamanho, material, avarias e riscos, mantendo entrada livre para marca e observações. A ação **Aplicar identificação às peças iguais** copia somente cor, marca, tecido, estampa, tamanho, dimensões e detalhes da peça atual para as demais do mesmo produto, preservando os identificadores e exigindo uma conferência individual da condição de cada peça.

A etapa de revisão apresenta um resumo por peça e impede a conclusão quando existe avaria ou risco sem a confirmação de ciência do cliente. Campos vazios continuam permitidos para itens em que determinado atributo não se aplica.

## Contrato persistido

Cada peça manual é convertida em um item de `Quote.items` com `qty: 1`, `recognition_status: manual`, `confidence: 1`, `attributes`, `damages`, `risk_tags`, `notes`, `customer_authorized_risks` e `services`. A função `approve_quote` transfere esses valores para um `GarmentItem` individual e para seu estado inicial de condição.
