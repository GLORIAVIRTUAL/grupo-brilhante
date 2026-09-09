import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = '/tmp/laundry-wave4-functions';
const frontend = [
  'src/Layout.jsx',
  'src/lib/accessControl.js',
  'src/pages/Customers.jsx',
  'src/pages/Pickups.jsx',
  'src/pages/Reports.jsx',
  'src/pages/Settings.jsx',
  'src/components/crm/ManualGarmentCharacteristics.jsx',
  'src/components/customers/Customer360Dialog.jsx',
  'src/components/management/AuditLogTable.jsx',
  'src/components/pickups/FleetManagementDialog.jsx',
  'src/components/pickups/LogisticsOperationsPanel.jsx',
  'src/components/reports/SpecializedReportsPanel.jsx',
  'src/components/settings/LoyaltyProgramManager.jsx',
  'src/components/settings/OperationalCatalogManager.jsx',
  'src/components/settings/PricingRulesManager.jsx',
  'src/components/settings/UnitAccessManager.jsx',
  'src/components/ui/ProductIcon.jsx',
  'src/components/ui/card.jsx',
  'src/components/ui/scroll-area.jsx',
  'src/components/ui/select.jsx',
  'src/components/ui/switch.jsx',
  'src/components/ui/table.jsx',
  'src/components/ui/textarea.jsx',
];
const functions = [
  'manage_access_control',
  'query_audit_log',
  'manage_pricing_rules',
  'manage_operational_catalog',
  'manage_loyalty_crm',
  'generate_specialized_report',
  'manage_fleet',
  'manage_delivery_route',
];

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
}

run('python3', ['scripts/validate-laundry-evolution.py']);
run('node', ['scripts/test-wave4-governance-analytics.mjs']);
run('npx', ['eslint', '--quiet', ...frontend]);
run('node', ['scripts/check-wave4-types.mjs']);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of functions) {
  run('npx', ['esbuild', `base44/functions/${name}/entry.ts`, '--bundle', '--platform=neutral', '--format=esm', '--external:npm:*', `--outfile=${output}/${name}.js`]);
}
run('npm', ['run', 'build']);
console.log('VALIDAÇÃO COMPLETA DA ONDA 4 APROVADA.');
