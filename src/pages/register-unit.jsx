import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Check, Loader2, ArrowLeft, Building2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function RegisterUnit() {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: "",
    subdomain: "",
    owner_email: "",
    contact_phone: ""
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
        await base44.functions.invoke('manage_unit', {
            action: 'create',
            name: formData.name,
            subdomain: formData.subdomain,
            owner_email: formData.owner_email,
            plan_price: 489,
            reason: 'Cadastro administrativo pelo painel',
        });

        toast.success("Unidade criada com sucesso!");
        setStep(2);
    } catch (error) {
        console.error("Error creating unit:", error);
        toast.error(error?.response?.data?.error || error?.message || "Erro ao criar unidade. Verifique sua permissão e o MFA.");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/admin">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white">
                <ArrowLeft className="h-4 w-4" />
            </Button>
        </Link>
        <div>
            <h1 className="text-2xl font-bold text-white">Nova Unidade</h1>
            <p className="text-gray-400 text-sm">Cadastre uma nova franquia no sistema.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
        >
            {step === 1 ? (
                <Card className="bg-white/5 backdrop-blur-xl border-white/10 text-white shadow-xl">
                    <CardHeader>
                        <div className="w-12 h-12 bg-[#FF6600]/20 rounded-lg flex items-center justify-center mb-4">
                            <Building2 className="w-6 h-6 text-[#FF6600]" />
                        </div>
                        <CardTitle>Dados da Unidade</CardTitle>
                        <CardDescription className="text-gray-400">Preencha as informações para configurar o ambiente.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="name">Nome da Unidade</Label>
                                <Input 
                                    id="name"
                                    placeholder="Ex: 5àsec Rio Branco"
                                    value={formData.name}
                                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                                    className="bg-black/20 border-white/10 text-white placeholder:text-gray-600 focus:border-[#FF6600]"
                                    required
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="subdomain">Subdomínio (URL)</Label>
                                <div className="flex items-center">
                                    <Input 
                                        id="subdomain"
                                        placeholder="riobranco"
                                        value={formData.subdomain}
                                        onChange={(e) => setFormData({...formData, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})}
                                        className="bg-black/20 border-white/10 text-white placeholder:text-gray-600 focus:border-[#FF6600] rounded-r-none"
                                        required
                                    />
                                    <div className="bg-white/10 border border-l-0 border-white/10 h-10 px-3 flex items-center text-sm text-gray-400 rounded-r-md whitespace-nowrap">
                                        .chat5asec.com.br
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">Este será o endereço de acesso do sistema da unidade.</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="email">Email do Proprietário</Label>
                                <Input 
                                    id="email"
                                    type="email"
                                    placeholder="seu@email.com"
                                    value={formData.owner_email}
                                    onChange={(e) => setFormData({...formData, owner_email: e.target.value})}
                                    className="bg-black/20 border-white/10 text-white placeholder:text-gray-600 focus:border-[#FF6600]"
                                    required
                                />
                            </div>

                            <div className="pt-4 flex gap-3">
                                <Link to="/admin" className="w-full">
                                    <Button variant="outline" type="button" className="w-full border-white/10 hover:bg-white/5 text-gray-300">
                                        Cancelar
                                    </Button>
                                </Link>
                                <Button type="submit" disabled={loading} className="w-full bg-[#FF6600] hover:bg-[#e55c00] text-white">
                                    {loading ? <Loader2 className="animate-spin mr-2" /> : "Criar Unidade"}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : (
                <Card className="bg-white/5 backdrop-blur-xl border-white/10 text-white shadow-xl text-center">
                    <CardContent className="pt-10 pb-10 space-y-6">
                        <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <Check className="w-10 h-10" />
                        </div>
                        <h2 className="text-2xl font-bold">Unidade Criada!</h2>
                        <p className="text-gray-300">
                            A unidade <strong className="text-white">{formData.name}</strong> foi configurada com sucesso.
                        </p>
                        
                        <div className="bg-black/30 p-4 rounded-lg border border-white/10 font-mono text-sm text-[#FF6600] break-all">
                            {`https://${formData.subdomain}.chat5asec.com.br`}
                        </div>

                        <p className="text-sm text-gray-500">
                            Unidade criada como pendente para revisão. O convite do proprietário deve ser realizado pela Governança.
                        </p>

                        <div className="pt-6 flex gap-3 justify-center">
                            <Button variant="outline" onClick={() => {
                                setStep(1);
                                setFormData({ name: "", subdomain: "", owner_email: "", contact_phone: "" });
                            }} className="border-white/20 hover:bg-white/5 text-white">
                                Cadastrar Outra
                            </Button>
                            <Link to="/admin">
                                <Button className="bg-[#FF6600] hover:bg-[#e55c00]">
                                    Voltar ao Painel ADM
                                </Button>
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            )}
        </motion.div>
      </div>
    </div>
  );
}