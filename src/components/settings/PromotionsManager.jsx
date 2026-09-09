import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Tag, Plus, Loader2, Pencil, Trash2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function PromotionsManager() {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', active: true, valid_until: '' });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Promotion.list('-created_date');
      setPromotions(list);
    } catch (err) {
      console.error("Error loading promotions:", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditing(null);
    setForm({ title: '', description: '', active: true, valid_until: '' });
  };

  const handleSave = async () => {
    if (!form.title || !form.description) {
      toast.error("Preencha o título e a descrição");
      return;
    }

    try {
      const payload = {
        title: form.title,
        description: form.description,
        active: form.active,
      };
      if (form.valid_until) payload.valid_until = form.valid_until;

      if (editing) {
        await base44.entities.Promotion.update(editing.id, payload);
        toast.success("Promoção atualizada");
      } else {
        await base44.entities.Promotion.create(payload);
        toast.success("Promoção criada");
      }
      setIsOpen(false);
      resetForm();
      load();
    } catch (err) {
      console.error("Error saving promotion:", err);
      toast.error("Erro ao salvar promoção");
    }
  };

  const handleEdit = (promo) => {
    setEditing(promo);
    setForm({
      title: promo.title,
      description: promo.description,
      active: promo.active !== false,
      valid_until: promo.valid_until || ''
    });
    setIsOpen(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Remover esta promoção?")) return;
    try {
      await base44.entities.Promotion.delete(id);
      toast.success("Promoção removida");
      load();
    } catch (err) {
      toast.error("Erro ao remover");
    }
  };

  const handleToggle = async (promo) => {
    try {
      await base44.entities.Promotion.update(promo.id, { active: !promo.active });
      load();
    } catch (err) {
      toast.error("Erro ao atualizar");
    }
  };

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-yellow-400" />
            Promoções Ativas
          </CardTitle>
          <CardDescription className="text-gray-400">
            Cadastre promoções que o chatbot consultará automaticamente quando o cliente perguntar (ex: "10% de desconto em 2 edredons").
          </CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-yellow-500 hover:bg-yellow-600 text-black">
              <Plus className="w-4 h-4 mr-2" /> Nova Promoção
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#1a0b36] border border-white/10 text-white">
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar Promoção' : 'Adicionar Promoção'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex: 10% OFF em 2 edredons"
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição / Regras (o chatbot vai ler isso)</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Ex: Cliente que lavar 2 ou mais edredons no mesmo pedido ganha 10% de desconto sobre o total dos edredons."
                  className="bg-white/5 border-white/10 min-h-[120px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Validade (opcional)</Label>
                <Input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="flex items-center justify-between bg-black/20 p-3 rounded-md border border-white/10">
                <Label className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                  Ativa
                </Label>
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </div>
              <Button onClick={handleSave} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black mt-2">
                Salvar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-yellow-400" /></div>
        ) : promotions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhuma promoção cadastrada ainda.</p>
            <p className="text-xs mt-1">Clique em "Nova Promoção" para começar.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {promotions.map((promo) => (
              <motion.div
                key={promo.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`p-4 rounded-xl border transition-colors ${promo.active ? 'bg-yellow-500/5 border-yellow-500/30' : 'bg-white/5 border-white/10 opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-white">{promo.title}</h4>
                      {promo.active ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">ATIVA</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">INATIVA</span>
                      )}
                      {promo.valid_until && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          até {new Date(promo.valid_until).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">{promo.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={!!promo.active} onCheckedChange={() => handleToggle(promo)} />
                    <Button size="icon" variant="ghost" onClick={() => handleEdit(promo)} className="h-8 w-8 text-blue-400 hover:bg-blue-500/10">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(promo.id)} className="h-8 w-8 text-red-400 hover:bg-red-500/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}