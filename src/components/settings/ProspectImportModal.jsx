import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from "sonner";

// Conserta encoding errado (latin1 lido como utf8): "SÃ³cio" -> "Sócio"
const fixEncoding = (str) => {
  if (!str) return str;
  try {
    // Só tenta corrigir se houver sinais típicos de mojibake
    if (/Ã|Â|â€/.test(str)) {
      return decodeURIComponent(escape(str));
    }
  } catch {
    return str;
  }
  return str;
};

// Parser de CSV que respeita aspas e detecta separador (, ou ;)
const parseCSV = (text) => {
  // Remove BOM
  text = text.replace(/^\uFEFF/, '');
  const lines = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  // Detecta separador a partir do cabeçalho (fora de aspas)
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === delimiter) { current.push(field); field = ''; }
      else if (char === '\n') { current.push(field); lines.push(current); current = []; field = ''; }
      else if (char === '\r') { /* ignore */ }
      else { field += char; }
    }
  }
  if (field.length > 0 || current.length > 0) { current.push(field); lines.push(current); }
  return lines.filter(row => row.some(c => c.trim() !== ''));
};

// Parse "5199986-8274; 3332-0314" -> ["5199986-8274", "3332-0314"]
const parsePhones = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split(/[;/|\n]+/)
    .map(p => p.trim())
    .filter(Boolean);
};

// Parse "JOSE (Sócio-Administrador desde ...); MARIA (Sócio desde ...)"
// -> [{ name: "JOSE", role: "Sócio-Administrador desde ..." }, ...]
const parsePartners = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split(/;|\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/^(.*?)\s*\((.*)\)\s*$/);
      if (match) {
        return { name: match[1].trim(), role: match[2].trim() };
      }
      return { name: part, role: '' };
    });
};

export default function ProspectImportModal({ open, onOpenChange, onImported }) {
  const [parsed, setParsed] = useState([]);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const mapRows = (rows) =>
    rows
      .filter(r => r.company_name)
      .map(r => {
        const phones = parsePhones(r.phones);
        return {
          company_name: fixEncoding(String(r.company_name).trim()),
          phone: phones[0] || '',
          phones,
          partners: parsePartners(r.partners).map(s => ({ name: fixEncoding(s.name), role: fixEncoding(s.role) })),
          status: 'novo'
        };
      });

  const handleCSV = async (file) => {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return [];
    // Primeira linha = cabeçalho: Nome da Empresa, Telefones, Nomes dos Sócios
    const body = rows.slice(1);
    const objs = body.map(cols => ({
      company_name: (cols[0] || '').trim(),
      phones: (cols[1] || '').trim(),
      partners: (cols[2] || '').trim()
    }));
    return mapRows(objs);
  };

  const handleXLSX = async (file) => {
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                company_name: { type: "string", description: "Nome da Empresa" },
                phones: { type: "string", description: "Telefones (coluna Telefones)" },
                partners: { type: "string", description: "Nomes dos Sócios (coluna completa, com cargos)" }
              }
            }
          }
        }
      }
    });
    return mapRows(result?.output?.rows || []);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReading(true);
    setFileName(file.name);
    try {
      const isCSV = /\.csv$/i.test(file.name) || file.type === 'text/csv';
      const mapped = isCSV ? await handleCSV(file) : await handleXLSX(file);

      if (mapped.length === 0) {
        toast.error("Nenhuma empresa encontrada na planilha.");
      }
      setParsed(mapped);
    } catch (err) {
      toast.error("Erro ao ler planilha: " + (err?.message || ''));
    } finally {
      setReading(false);
      e.target.value = '';
    }
  };

  const handleImport = async () => {
    const valid = parsed.filter(p => p.company_name && p.phone);
    if (valid.length === 0) {
      toast.error("Nenhuma empresa válida (precisa de nome e telefone).");
      return;
    }
    setSaving(true);
    try {
      await base44.entities.Prospect.bulkCreate(valid);
      toast.success(`${valid.length} empresa(s) importada(s)!`);
      setParsed([]);
      setFileName('');
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Erro ao importar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const validCount = parsed.filter(p => p.company_name && p.phone).length;
  const invalidCount = parsed.length - validCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a0b36] border-white/10 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileSpreadsheet className="w-5 h-5 text-[#FF6600]" />
            Importar Planilha de Empresas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            Colunas aceitas: <strong>Nome da Empresa</strong>, <strong>Telefones</strong> (separados por <code className="bg-white/10 px-1 rounded">;</code>) e <strong>Nomes dos Sócios</strong> (cargo entre parênteses). Aceita .xlsx e .csv.
          </div>

          <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/15 bg-white/5 p-8 cursor-pointer hover:border-[#FF6600]/40 transition-colors">
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            {reading ? (
              <><Loader2 className="w-8 h-8 animate-spin text-[#FF6600]" /><span className="text-sm text-gray-300">Lendo {fileName}...</span></>
            ) : (
              <><Upload className="w-8 h-8 text-[#FF6600]" /><span className="text-sm text-gray-300">{fileName || 'Clique para selecionar a planilha'}</span></>
            )}
          </label>

          {fileName && !reading && parsed.length === 0 && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Nenhuma empresa foi encontrada na planilha. Verifique se as colunas estão corretas e tente outro arquivo.
            </div>
          )}

          {parsed.length > 0 && (
            <>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-400"><CheckCircle2 className="w-4 h-4" /> {validCount} válidas</span>
                {invalidCount > 0 && <span className="flex items-center gap-1 text-yellow-400"><AlertTriangle className="w-4 h-4" /> {invalidCount} sem telefone (serão ignoradas)</span>}
              </div>

              <div className="rounded-xl border border-white/10 overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/10 sticky top-0">
                    <tr className="text-left text-gray-300">
                      <th className="p-2 font-medium">Empresa</th>
                      <th className="p-2 font-medium">Telefone</th>
                      <th className="p-2 font-medium">Sócios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p, i) => (
                      <tr key={i} className={`border-t border-white/5 ${!p.phone ? 'opacity-50' : ''}`}>
                        <td className="p-2 text-white">{p.company_name}</td>
                        <td className="p-2 text-gray-300">{p.phone || '—'}</td>
                        <td className="p-2 text-gray-400 text-xs">
                          {p.partners.map(s => s.name + (s.role ? ` (${s.role.split(' ')[0]})` : '')).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </>
          )}

          <div className="flex gap-3 pt-2 border-t border-white/10">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 h-12"
            >
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={saving || validCount === 0} className="flex-1 bg-[#FF6600] hover:bg-[#e55c00] h-12 text-lg gap-2">
              {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Salvando...</> : <><CheckCircle2 className="w-5 h-5" /> Salvar {validCount > 0 ? `(${validCount})` : ''}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}