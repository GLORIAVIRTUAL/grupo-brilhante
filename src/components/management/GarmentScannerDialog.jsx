import { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, Loader2, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function normalizeGarmentScan(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.startsWith('GLORIA|GARMENT|')) return value.slice('GLORIA|GARMENT|'.length).trim();
  try {
    const url = new URL(value);
    return url.searchParams.get('garment') || url.searchParams.get('code') || value;
  } catch (_) {
    return value;
  }
}

export default function GarmentScannerDialog({ open, onOpenChange, onScan, title = 'Ler etiqueta da peça', description = 'Use a câmera, um leitor USB ou digite o código.' }) {
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const lastValueRef = useRef('');

  const stopCamera = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setStartingCamera(false);
  };

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!open) {
      stopCamera();
      setManualCode('');
      lastValueRef.current = '';
    }
  }, [open]);

  const submit = (rawValue) => {
    const code = normalizeGarmentScan(rawValue);
    if (!code) return toast.error('Informe ou leia um código válido.');
    if (lastValueRef.current === code) return;
    lastValueRef.current = code;
    stopCamera();
    onScan?.(code);
  };

  const startCamera = async () => {
    const BarcodeDetectorApi = /** @type {any} */ (window).BarcodeDetector;
    if (!BarcodeDetectorApi) {
      toast.error('A leitura por câmera não é compatível com este navegador. Use o leitor USB ou digite o código.');
      return;
    }
    setStartingCamera(true);
    try {
      const supported = await BarcodeDetectorApi.getSupportedFormats?.();
      const preferred = ['qr_code', 'code_128', 'code_39', 'data_matrix'];
      const formats = supported?.length ? preferred.filter((format) => supported.includes(format)) : preferred;
      const detector = new BarcodeDetectorApi({ formats: formats.length ? formats : ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('video_not_ready');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
      setStartingCamera(false);

      const detect = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          const rawValue = results?.[0]?.rawValue;
          if (rawValue) return submit(rawValue);
        } catch (_) {
          // Quadros sem código são esperados; a leitura continua.
        }
        timerRef.current = window.setTimeout(detect, 250);
      };
      detect();
    } catch (error) {
      console.error(error);
      stopCamera();
      toast.error(error?.name === 'NotAllowedError' ? 'Permita o uso da câmera ou utilize o leitor USB.' : 'Não foi possível iniciar a câmera.');
    }
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) stopCamera();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl border-white/10 bg-[#170c2b] text-white">
        <DialogHeader><div className="flex items-center gap-3"><div className="rounded-2xl bg-cyan-500/15 p-2.5 text-cyan-300"><ScanLine className="h-5 w-5" /></div><div><DialogTitle>{title}</DialogTitle><DialogDescription className="text-white/50">{description}</DialogDescription></div></div></DialogHeader>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
            <div className="relative flex aspect-video items-center justify-center">
              <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`} />
              {!cameraActive && <div className="text-center"><Camera className="mx-auto h-10 w-10 text-white/20" /><p className="mt-3 text-sm text-white/40">A câmera somente é ativada quando você solicitar.</p><Button type="button" onClick={startCamera} disabled={startingCamera} className="mt-4 bg-cyan-500 text-slate-950 hover:bg-cyan-400">{startingCamera ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}Usar câmera</Button></div>}
              {cameraActive && <><div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-cyan-300/80 shadow-[0_0_0_999px_rgba(0,0,0,.28)]" /><button type="button" onClick={stopCamera} className="absolute right-3 top-3 rounded-full bg-black/60 p-2 hover:bg-black/80" aria-label="Desligar câmera"><X className="h-4 w-4" /></button></>}
            </div>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); submit(manualCode); }} className="space-y-3">
            <Label className="flex items-center gap-2"><Keyboard className="h-4 w-4 text-violet-300" />Código manual ou leitor USB</Label>
            <div className="flex gap-2"><Input autoFocus value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Ex.: P-ABC12345-001" className="border-white/10 bg-black/20 font-mono uppercase" /><Button type="submit" className="bg-violet-500 hover:bg-violet-400">Localizar</Button></div>
            <p className="text-xs text-white/35">Leitores USB funcionam como teclado: aponte para a etiqueta e pressione o gatilho.</p>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
