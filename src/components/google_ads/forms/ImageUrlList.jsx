import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, X, Upload, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ImageUrlList({ label, hint, urls, onChange }) {
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);

  const add = () => {
    if (!draft.trim()) return;
    onChange([...urls, draft.trim()]);
    setDraft('');
  };

  const remove = (i) => onChange(urls.filter((_, idx) => idx !== i));

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange([...urls, file_url]);
      toast.success('Imagem enviada');
    } catch (err) {
      toast.error('Falha no upload');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div>
      <Label className="text-gray-300">{label}</Label>
      {hint && <p className="text-xs text-gray-500 mb-1">{hint}</p>}
      <div className="flex gap-2 mb-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="https://...jpg"
          className="bg-white/5 border-white/10 text-white text-sm"
        />
        <Button onClick={add} type="button" variant="outline" className="border-white/10 shrink-0">
          <Plus className="w-4 h-4" />
        </Button>
        <label className="cursor-pointer">
          <Button asChild type="button" variant="outline" className="border-white/10 shrink-0">
            <span>{uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}</span>
          </Button>
          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" disabled={uploading} />
        </label>
      </div>
      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((u, i) => (
            <div key={i} className="relative group rounded-lg overflow-hidden border border-white/10">
              <img src={u} alt={`img-${i}`} className="w-full h-20 object-cover" />
              <button
                onClick={() => remove(i)}
                type="button"
                className="absolute top-1 right-1 p-0.5 bg-red-500/80 rounded hover:bg-red-500"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}