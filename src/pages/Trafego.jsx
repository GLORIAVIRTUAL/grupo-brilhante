import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Megaphone, Lightbulb, Rocket, BarChart3 } from 'lucide-react';
import CampaignResearch from '@/components/trafego/CampaignResearch';
import CampaignCreator from '@/components/trafego/CampaignCreator';
import CampaignResults from '@/components/trafego/CampaignResults';
import usePersistentState from '@/lib/usePersistentState';

export default function Trafego() {
  const [activeTab, setActiveTab] = usePersistentState('trafego_active_tab', 'research');
  const [prefill, setPrefill] = useState(null);

  const handleUseRecommendation = (data) => {
    setPrefill(data);
    setActiveTab('create');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
            <Megaphone className="w-8 h-8 text-[#FF6600]" />
            Tráfego Pago
          </h1>
          <p className="mt-1 text-gray-400">Pesquise a estratégia ideal, crie campanhas na Meta e acompanhe resultados com gráficos.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white/5 border border-white/10 p-1">
          <TabsTrigger value="research" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white gap-2">
            <Lightbulb className="w-4 h-4" /> Pesquisar
          </TabsTrigger>
          <TabsTrigger value="create" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white gap-2">
            <Rocket className="w-4 h-4" /> Criar & Programar
          </TabsTrigger>
          <TabsTrigger value="results" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white gap-2">
            <BarChart3 className="w-4 h-4" /> Resultados
          </TabsTrigger>
        </TabsList>

        <TabsContent value="research" className="mt-6">
          <CampaignResearch onUseRecommendation={handleUseRecommendation} />
        </TabsContent>

        <TabsContent value="create" className="mt-6">
          <CampaignCreator prefill={prefill} />
        </TabsContent>

        <TabsContent value="results" className="mt-6">
          <CampaignResults />
        </TabsContent>
      </Tabs>
    </div>
  );
}