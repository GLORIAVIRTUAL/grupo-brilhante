import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = '/tmp/laundry-wave3-functions';
const frontend = [
  'src/components/management/BatchExecutionDialog.jsx',
  'src/components/management/ConsumptionRecipesPanel.jsx',
  'src/components/management/InventoryCountPanel.jsx',
  'src/components/management/InventoryPanel.jsx',
  'src/components/management/MachineManagementDialog.jsx',
  'src/components/management/ManagementCommandCenter.jsx',
  'src/components/management/OperationsInsightsPanel.jsx',
  'src/components/management/ProductionBatchDialog.jsx',
  'src/components/management/ProductionCostProfileDialog.jsx',
  'src/components/management/ProductionOperationsPanel.jsx',
  'src/components/management/StockOperationDialog.jsx',
  'src/lib/accessControl.js',
];
const functions = [
  'approve_purchase_document', 'manage_stock_operation', 'manage_inventory_count', 'manage_consumption_recipe',
  'post_production_consumption', 'manage_machine', 'manage_production_batch', 'manage_labor_entry',
  'manage_production_cost_profile', 'manage_operational_alerts',
];

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
}

run('python3', ['scripts/validate-laundry-evolution.py']);
run('node', ['scripts/test-wave3-production.mjs']);
run('npx', ['eslint', '--quiet', ...frontend]);
run('node', ['scripts/check-wave3-types.mjs']);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of functions) {
  run('npx', ['esbuild', `base44/functions/${name}/entry.ts`, '--bundle', '--platform=neutral', '--format=esm', '--external:npm:*', `--outfile=${output}/${name}.js`]);
}
run('npm', ['run', 'build']);
console.log('VALIDAÇÃO COMPLETA DA ONDA 3 APROVADA.');
