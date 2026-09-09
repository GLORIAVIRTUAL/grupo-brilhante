import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = [
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
];

const result = spawnSync('npm', ['run', 'typecheck'], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 20 * 1024 * 1024,
});
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const errors = output.split(/\r?\n/).filter((line) => line.includes('error TS'));
const targetErrors = errors.filter((line) => targets.some((target) => line.startsWith(`${target}(`)));

if (targetErrors.length) {
  console.error('TYPECHECK DA ONDA 4 FALHOU');
  console.error(targetErrors.join('\n'));
  process.exit(1);
}

console.log(`TYPECHECK DIRECIONADO OK: 0 erros na Onda 4; ${errors.length} erros preexistentes permanecem fora do escopo.`);
