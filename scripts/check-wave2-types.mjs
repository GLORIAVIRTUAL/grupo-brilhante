import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = [
  'src/components/management/BillingAgreementsPanel.jsx',
  'src/components/management/CashSessionModal.jsx',
  'src/components/management/CustomerCreditDialog.jsx',
  'src/components/management/FinancialOperationsPanel.jsx',
  'src/components/management/FiscalReadinessPanel.jsx',
  'src/components/management/ManagementCommandCenter.jsx',
  'src/components/management/PaymentReceiptDialog.jsx',
  'src/components/management/QuoteLifecyclePanel.jsx',
  'src/components/ui/badge.jsx',
  'src/components/ui/button.jsx',
  'src/components/ui/dialog.jsx',
  'src/components/ui/input.jsx',
  'src/components/ui/label.jsx',
  'src/components/ui/tabs.jsx',
  'src/lib/accessControl.js',
];
const result = spawnSync('npm', ['run', 'typecheck'], { cwd: root, encoding: 'utf8', env: process.env });
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const errors = output.split(/\r?\n/).filter((line) => line.includes('error TS'));
const targetErrors = errors.filter((line) => targets.some((target) => line.startsWith(`${target}(`)));
if (targetErrors.length) {
  console.error('TYPECHECK DA ONDA 2 FALHOU');
  console.error(targetErrors.join('\n'));
  process.exit(1);
}
console.log(`TYPECHECK DIRECIONADO OK: 0 erros na Onda 2; ${errors.length} erros preexistentes permanecem fora do escopo.`);
