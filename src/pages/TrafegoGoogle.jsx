import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sparkles, Send, BarChart3, Stethoscope, Clock } from 'lucide-react';
import GoogleAdsDiagnose from '@/components/google_ads/GoogleAdsDiagnose';
import GoogleAdsResearch from '@/components/google_ads/GoogleAdsResearch';
import GoogleAdsCampaignCreator from '@/components/google_ads/GoogleAdsCampaignCreator';
import GoogleAdsResults from '@/components/google_ads/GoogleAdsResults';
import GoogleAdsApprovalStatus from '@/components/google_ads/GoogleAdsApprovalStatus';
import usePersistentState from '@/lib/usePersistentState';

export default function TrafegoGoogle() {
  const [tab, setTab] = usePersistentState('gads_active_tab', 'status');
  const [prefill, setPrefill] = usePersistentState('gads_prefill', null);

  const handleUseRecommendation = (data) => {
    setPrefill(data);
    setTab('create');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm0 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-4.5 10-10 10zm-1-15h2v6h-2zm0 8h2v2h-2z"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Tráfego Google Ads</h1>
          <p className="text-sm text-gray-400">Criar, monitorar e otimizar campanhas no Google Ads com IA</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white/5 border border-white/10 flex-wrap h-auto">
          <TabsTrigger value="status" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white">
            <Clock className="w-4 h-4 mr-2" /> Status
          </TabsTrigger>
          <TabsTrigger value="diagnose" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white">
            <Stethoscope className="w-4 h-4 mr-2" /> Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="research" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white">
            <Sparkles className="w-4 h-4 mr-2" /> Pesquisa IA
          </TabsTrigger>
          <TabsTrigger value="create" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white">
            <Send className="w-4 h-4 mr-2" /> Criar Campanha
          </TabsTrigger>
          <TabsTrigger value="results" className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white">
            <BarChart3 className="w-4 h-4 mr-2" /> Resultados
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="mt-4">
          <GoogleAdsApprovalStatus />
        </TabsContent>
        <TabsContent value="diagnose" className="mt-4">
          <GoogleAdsDiagnose />
        </TabsContent>
        <TabsContent value="research" className="mt-4">
          <GoogleAdsResearch onUseRecommendation={handleUseRecommendation} />
        </TabsContent>
        <TabsContent value="create" className="mt-4">
          <GoogleAdsCampaignCreator prefill={prefill} />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <GoogleAdsResults />
        </TabsContent>
      </Tabs>
    </div>
  );
}