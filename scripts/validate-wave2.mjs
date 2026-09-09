import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = '/tmp/laundry-wave2-functions';
const frontend = [
  'src/components/management/CustomerCreditDialog.jsx',
  'src/components/management/PaymentReceiptDialog.jsx',
  'src/components/management/FinancialOperationsPanel.jsx',
  'src/components/management/BillingAgreementsPanel.jsx',
  'src/components/management/QuoteLifecyclePanel.jsx',
  'src/components/management/CashSessionModal.jsx',
  'src/components/management/FiscalReadinessPanel.jsx',
  'src/components/management/ManagementCommandCenter.jsx',
  'src/components/ui/badge.jsx',
  'src/components/ui/button.jsx',
  'src/components/ui/dialog.jsx',
  'src/components/ui/input.jsx',
  'src/components/ui/label.jsx',
  'src/components/ui/tabs.jsx',
  'src/lib/accessControl.js',
];
const functions = [
  'manage_payment_receipt', 'confirm_payment_tender', 'manage_customer_credit', 'manage_billing_agreement',
  'close_billing_period', 'manage_quote_lifecycle', 'manage_cash_session', 'manage_fiscal_document', 'checkExpiredQuotes',
];

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
}

run('python3', ['scripts/validate-laundry-evolution.py']);
run('node', ['scripts/test-wave2-finance.mjs']);
run('npx', ['eslint', '--quiet', ...frontend]);
run('node', ['scripts/check-wave2-types.mjs']);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of functions) {
  run('npx', ['esbuild', `base44/functions/${name}/entry.ts`, '--bundle', '--platform=neutral', '--format=esm', '--external:npm:*', `--outfile=${output}/${name}.js`]);
}
run('npm', ['run', 'build']);
console.log('VALIDAÇÃO COMPLETA DA ONDA 2 APROVADA.');
