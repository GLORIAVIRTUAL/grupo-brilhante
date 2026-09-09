import fs from 'node:fs';
import path from 'node:path';
const directory = path.join(process.cwd(), 'base44', 'entities');
const files = fs.readdirSync(directory).filter((name) => name.endsWith('.jsonc')).sort();
const errors = [];
for (const file of files) {
  try { JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')); }
  catch (error) { errors.push(`${file}: ${error.message}`); }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${files.length} schemas JSON válidos.`);
