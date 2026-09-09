import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireInternalRequest, securityErrorResponse, SecurityError } from '../../shared/functionSecurity.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This function is intended to be called by Scheduled Automations
        // Payload should contain { type: 'SLA_CHECK' | 'DAILY_JOBS' | 'CSAT' }
        
        let payload = {};
        try {
            payload = await req.json();
        } catch (e) {
            // No body provided
        }

        requireInternalRequest(req, payload);
        const type = payload.type || 'SLA_CHECK';
        if (!['SLA_CHECK', 'DAILY_JOBS', 'CSAT'].includes(type)) {
            throw new SecurityError('Tipo de automação inválido.', 400, 'INVALID_AUTOMATION_TYPE');
        }

        console.log(`Running automation: ${type}`);

        if (type === 'SLA_CHECK') {
            // --- SLA CHECK ---
            // Find Quotes in HUMAN_REVIEW that are close to deadline
            const pendingQuotes = await base44.asServiceRole.entities.Quote.filter({
                status: 'HUMAN_REVIEW',
            }, '-created_date', 100); 

            const now = new Date();
            for (const quote of pendingQuotes) {
                if (quote.review_deadline_at) {
                    const deadline = new Date(quote.review_deadline_at);
                    const timeLeft = deadline - now;
                    
                    // If less than 15 mins left and positive
                    if (timeLeft < 15 * 60 * 1000 && timeLeft > 0) {
                        // Check if already notified? (Ideally check StaffNotification history)
                        // For MVP, create notification
                        await base44.asServiceRole.entities.StaffNotification.create({
                            type: 'SLA_BREACH',
                            target_team: 'managers',
                            payload: { quote_id: quote.id, time_left_mins: Math.floor(timeLeft/60000) },
                            sent_at: new Date().toISOString()
                        });
                        console.log(`SLA Breach warning for quote ${quote.id}`);
                    }
                }
            }
        } 
        
        else if (type === 'DAILY_JOBS') {
            const today = new Date();
            // Format MM-DD for string comparison
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const monthDay = `${month}-${day}`;
            
            // 1. Birthdays & Re-engagement
            // Fetch active customers. LIMITATION: If > 1000 customers, pagination needed.
            const customers = await base44.asServiceRole.entities.Customer.filter({ status: 'active' }, 1000);
            
            for (const customer of customers) {
                // Birthday Check
                if (customer.birthdate) {
                    // Extract MM-DD from YYYY-MM-DD
                    const birthParts = customer.birthdate.split('-');
                    if (birthParts.length === 3) {
                        const birthMonthDay = `${birthParts[1]}-${birthParts[2]}`;
                        if (birthMonthDay === monthDay) {
                            if (customer.opt_in_whatsapp && customer.phones?.length > 0) {
                                await base44.asServiceRole.functions.invoke('zapi_sender', {
                                    phone: customer.phones[0],
                                    message: `Parabéns ${customer.full_name}! 🎂\nA 5àsec deseja um feliz aniversário! Ganhe 10% de desconto hoje!`,
                                    conversation_id: null,
                                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                                });
                                console.log(`Birthday message sent to ${customer.email}`);
                            }
                        }
                    }
                }

                // Re-engagement Check (30 days inactivity)
                if (customer.last_inbound_at) {
                    const lastInbound = new Date(customer.last_inbound_at);
                    const diffTime = Math.abs(today - lastInbound);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    
                    if (diffDays === 30) {
                        if (customer.opt_in_whatsapp && customer.phones?.length > 0) {
                             await base44.asServiceRole.functions.invoke('zapi_sender', {
                                phone: customer.phones[0],
                                message: `Olá ${customer.full_name}, faz tempo que não te vemos! Que tal renovar suas roupas com a gente?`,
                                conversation_id: null,
                                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                            });
                            
                            // Create Re-engagement CRM Card if needed
                            // Check if card exists? For MVP just create.
                            const existingCards = await base44.asServiceRole.entities.CrmCard.filter({
                                customer_id: customer.id,
                                pipeline_type: 'NEW_CUSTOMER',
                                stage: 'Novo'
                            });

                            if (existingCards.length === 0) {
                                await base44.asServiceRole.entities.CrmCard.create({
                                    pipeline_type: 'NEW_CUSTOMER', 
                                    stage: 'Novo',
                                    priority: 'LOW',
                                    customer_id: customer.id,
                                    due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                                });
                                console.log(`Re-engagement message and card for ${customer.email}`);
                            }
                        }
                    }
                }
            }
        }

        else if (type === 'CSAT') {
            // CSAT logic: Orders finished 7 days ago
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const dateStr = sevenDaysAgo.toISOString().split('T')[0];

            // Filter orders closed on that specific day
            // Assuming we don't have exact filter for date range in SDK filter object easily without Mongo syntax
            // We fetch recent finished orders and filter in code.
            const orders = await base44.asServiceRole.entities.Order.filter({
                status: 'finished'
            }, '-closed_at', 200);

            for (const order of orders) {
                if (order.closed_at && order.closed_at.startsWith(dateStr)) {
                     const customer = await base44.asServiceRole.entities.Customer.get(order.customer_id);
                     if (customer && customer.opt_in_whatsapp && customer.phones?.length > 0) {
                         await base44.asServiceRole.functions.invoke('zapi_sender', {
                            phone: customer.phones[0],
                            message: `Olá! Como foi sua experiência com o pedido #${order.ticket_number || order.id}? Responda de 0 a 10.`,
                            conversation_id: null,
                            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                        });
                        console.log(`CSAT sent for order ${order.id}`);
                     }
                }
            }
        }

        return Response.json({ status: "success", type_ran: type });

    } catch (error) {
        console.error("Error in scheduled_automations:", error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});