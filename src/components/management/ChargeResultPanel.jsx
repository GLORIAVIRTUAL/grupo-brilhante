import { useEffect, useRef } from 'react';
import { Copy, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

function CodeRow({ label, value, copiedMessage }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-white/60">{label}</div>
      <code className="block max-h-28 overflow-y-auto rounded-lg bg-black/40 px-3 py-2 text-xs text-emerald-200 break-all">{value}</code>
      <Button
        size="sm"
        className="w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400"
        onClick={() => { navigator.clipboard.writeText(value); toast.success(copiedMessage); }}
      >
        <Copy className="mr-2 h-4 w-4" /> Copiar
      </Button>
    </div>
  );
}

export default function ChargeResultPanel({ result }) {
  const ref = useRef(null);

  useEffect(() => {
    if (result) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [result]);

  if (!result) return null;

  return (
    <div ref={ref} className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-4 text-left">
      <div className="mb-3 flex items-center gap-2 font-semibold text-emerald-200">
        <QrCode className="h-4 w-4" /> Cobrança gerada no Banco do Brasil
      </div>
      <div className="space-y-4">
        {result.qr_code_text && (
          <CodeRow label="Pix copia e cola" value={result.qr_code_text} copiedMessage="Código Pix copiado!" />
        )}
        {result.digitable_line && (
          <CodeRow
            label={`Linha digitável do boleto (vence ${result.due_date || '-'})`}
            value={result.digitable_line}
            copiedMessage="Linha digitável copiada!"
          />
        )}
        {!result.qr_code_text && !result.digitable_line && (
          <p className="text-sm text-amber-200">
            O banco confirmou a cobrança, mas não retornou o código. Consulte a cobrança em Banco do Brasil.
          </p>
        )}
      </div>
    </div>
  );
}