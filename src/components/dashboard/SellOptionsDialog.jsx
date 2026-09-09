import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, Plus } from 'lucide-react';

export default function SellOptionsDialog({ open, onOpenChange, onPhotoQuote, onManualQuote }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-[#1a0b36] text-white">
        <DialogHeader>
          <DialogTitle>Como deseja vender?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Button
            onClick={onPhotoQuote}
            className="justify-start gap-3 bg-gradient-to-r from-violet-500 to-fuchsia-500 py-6 text-base font-bold"
          >
            <Camera className="h-5 w-5" /> Orçamento por fotos
          </Button>
          <Button
            variant="outline"
            onClick={onManualQuote}
            className="justify-start gap-3 border-white/15 bg-white/5 py-6 text-base font-bold text-white hover:bg-white/10"
          >
            <Plus className="h-5 w-5" /> Orçamento manual
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}