import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = [
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
const result = spawnSync('npm', ['run', 'typecheck'], { cwd: root, encoding: 'utf8', env: process.env });
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const errors = output.split(/\r?\n/).filter((line) => line.includes('error TS'));
const targetErrors = errors.filter((line) => targets.some((target) => line.startsWith(`${target}(`)));
if (targetErrors.length) {
  console.error('TYPECHECK DA ONDA 3 FALHOU');
  console.error(targetErrors.join('\n'));
  process.exit(1);
}
console.log(`TYPECHECK DIRECIONADO OK: 0 erros na Onda 3; ${errors.length} erros preexistentes permanecem fora do escopo.`);
