import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (!['POST', 'GET'].includes(req.method)) {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const principal = await authorizeUserOrInternal(base44, req, body, { source: 'generateRecurringExpenses' });
    if (principal.kind === 'user' && !['super_admin', 'admin', 'manager', 'finance'].includes(principal.role)) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }
    const execution = { scheduled: principal.kind === 'internal', user: principal.user };

    const now = new Date();
    const sp = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const year = sp.getUTCFullYear();
    const month = sp.getUTCMonth() + 1;
    const today = sp.getUTCDate();
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const currentDate = `${monthKey}-${String(today).padStart(2, '0')}`;
    const daysInMonth = new Date(year, month, 0).getDate();

    const expenses = await base44.asServiceRole.entities.RecurringExpense.list('-created_date', 1000);
    const created = [];

    for (const expense of expenses) {
      if (expense.active === false) continue;

      let dueDate = null;
      if (expense.kind === 'recurring') {
        const targetDay = Math.min(expense.day_of_month || 1, daysInMonth);
        if (today >= targetDay && expense.last_generated_month !== monthKey) {
          dueDate = `${monthKey}-${String(targetDay).padStart(2, '0')}T12:00:00.000Z`;
        }
      } else if (expense.kind === 'one_time' && expense.due_date && expense.due_date <= currentDate && !expense.last_generated_month) {
        dueDate = `${expense.due_date}T12:00:00.000Z`;
      }
      if (!dueDate) continue;

      const eventKey = `recurring_expense:${expense.id}:${monthKey}`;
      const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
      if (events.some((event: any) => event.status === 'completed')) continue;

      const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
        event_key: eventKey,
        event_type: 'generate_recurring_expense',
        source: execution.scheduled ? 'scheduled_job' : 'user_command',
        status: 'processing',
        payload_hash: `${expense.id}:${monthKey}:${expense.amount}`,
        attempts: 1,
        started_at: new Date().toISOString(),
        unit_id: expense.unit_id,
      });

      const payable = await base44.asServiceRole.entities.AccountsPayable.create({
        unit_id: expense.unit_id,
        supplier_name: expense.supplier_name,
        description: expense.description,
        category: expense.category,
        cost_center: expense.cost_center || 'Operação',
        competence_date: dueDate,
        issue_date: new Date().toISOString(),
        due_date: dueDate,
        original_amount: Number(expense.amount || 0),
        open_amount: Number(expense.amount || 0),
        paid_amount: 0,
        status: 'pending_approval',
        approval_status: 'pending',
        payment_method: expense.payment_method || 'boleto',
        notes: expense.notes || (expense.kind === 'recurring' ? 'Despesa recorrente' : 'Despesa avulsa'),
        metadata: { recurring_expense_id: expense.id, month_key: monthKey, request_id: requestId },
      });

      await base44.asServiceRole.entities.RecurringExpense.update(expense.id, { last_generated_month: monthKey });
      await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
        status: 'completed',
        entity_type: 'accounts_payable',
        entity_id: payable.id,
        result: { accounts_payable_id: payable.id },
        completed_at: new Date().toISOString(),
      });

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'create',
        entity_type: 'accounts_payable',
        entity_id: payable.id,
        item_label: expense.description,
        amount: Number(expense.amount || 0),
        reason: expense.kind === 'recurring' ? 'recurring_expense_generated' : 'one_time_expense_generated',
        user_email: execution.user?.email,
        user_name: execution.user?.full_name || execution.user?.display_name || 'Automação',
        user_role: execution.user?.role || 'automation',
        unit_id: expense.unit_id,
        request_id: requestId,
        success: true,
      });

      created.push({ recurring_expense_id: expense.id, accounts_payable_id: payable.id, description: expense.description, due_date: dueDate });
    }

    return Response.json({ ok: true, scheduled: execution.scheduled, month_key: monthKey, created_count: created.length, created, request_id: requestId });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[generateRecurringExpenses:${requestId}]`, error);
    return Response.json({ error: 'recurring_expense_generation_failed', request_id: requestId }, { status: 500 });
  }
});
