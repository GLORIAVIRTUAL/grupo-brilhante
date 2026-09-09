// Gera a cobrança REAL no Asaas (Pix copia e cola ou link de cartão) para a IA enviar ao cliente.
// Retorna { content } pronto para virar mensagem 'tool' no orchestrator, ou null se não for essa ferramenta.

export async function handlePaymentChargeToolCall({ toolCall, base44, customer }) {
    if (toolCall.function.name !== 'generate_payment_charge') return null;

    const fail = (error) => ({ content: JSON.stringify({ error }) });

    try {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const billingType = args.billing_type === 'credit_card' ? 'credit_card' : 'pix';

        // Referência da cobrança: SEMPRE o orçamento aprovado mais recente (é o que o cliente
        // acabou de aceitar). Só cai para um pedido antigo em aberto se não houver orçamento aceito.
        let referenceKey = null;
        const quotes = await base44.asServiceRole.entities.Quote.filter(
            { customer_id: customer.id, status: 'ACCEPTED' }, '-created_date', 1
        );
        if (quotes[0]) {
            const linkedOrders = await base44.asServiceRole.entities.Order.filter(
                { customer_id: customer.id, source_quote_id: quotes[0].id }, '-created_date', 1
            );
            referenceKey = linkedOrders[0] ? { order_id: linkedOrders[0].id } : { quote_id: quotes[0].id };
        }
        if (!referenceKey) {
            const orders = await base44.asServiceRole.entities.Order.filter(
                { customer_id: customer.id, payment_status: 'unpaid' }, '-created_date', 1
            );
            if (orders[0]) referenceKey = { order_id: orders[0].id };
        }
        if (!referenceKey) {
            return fail('Não há pedido ou orçamento aprovado para cobrar. Aprove o orçamento (approve_quote) antes de gerar a cobrança.');
        }

        const r = await base44.asServiceRole.functions.invoke('generate_payment_link', {
            ...referenceKey,
            billing_type: billingType,
            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
        });
        const data = r?.data || {};

        if (data.error === 'customer_data_incomplete') {
            return fail(`Para emitir a cobrança faltam dados do cadastro: ${(data.missing_fields || []).join(', ')}. Peça esses dados ao cliente de forma natural e tente de novo depois.`);
        }
        if (data.status === 'pending_verification') {
            return fail('A cobrança pode já ter sido criada, mas o gateway não confirmou. NÃO gere outra: avise o cliente que está confirmando o pagamento e a equipe retorna em instantes.');
        }
        if (data.error || (!data.pix_copy_paste_key && !data.url)) {
            return fail('Não foi possível gerar a cobrança agora. Ofereça o pagamento na hora da coleta (dinheiro ou cartão com o entregador) e siga o atendimento.');
        }

        if (billingType === 'pix') {
            const code = data.pix_copy_paste_key;
            return {
                content: JSON.stringify({
                    success: true,
                    pix_copy_paste: code || null,
                    invoice_url: data.url || null,
                    instruction: code
                        ? `Cobrança Pix criada no Asaas. Envie ao cliente EXATAMENTE este código Pix copia e cola, sozinho, sem alterar nenhum caractere: ${code} — explique que é só copiar e colar no app do banco e que o pagamento é confirmado automaticamente. É PROIBIDO informar qualquer outra chave Pix. A mensagem deve tratar SOMENTE do pagamento: não pergunte nem mencione coleta, data, turno ou endereço agora — aguarde a confirmação do pagamento pelo webhook do Asaas.`
                        : `Cobrança Pix criada. Envie ao cliente este link de pagamento: ${data.url}. É PROIBIDO informar chave Pix manual.`
                })
            };
        }

        return {
            content: JSON.stringify({
                success: true,
                payment_url: data.url,
                instruction: `Cobrança no cartão criada no Asaas. Envie ao cliente EXATAMENTE este link de pagamento: ${data.url} — explique que ele pode pagar no cartão de crédito por esse link com segurança. A mensagem deve tratar SOMENTE do pagamento: não pergunte nem mencione coleta, data, turno ou endereço agora — aguarde a confirmação do pagamento pelo webhook do Asaas.`
            })
        };
    } catch (e) {
        console.error('generate_payment_charge failed', e);
        return fail('Erro interno ao gerar a cobrança. Ofereça o pagamento na hora da coleta com o entregador.');
    }
}