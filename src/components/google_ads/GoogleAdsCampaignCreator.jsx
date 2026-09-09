import React, { useState, useEffect } from 'react';
import CampaignTypeSelector from './CampaignTypeSelector';
import SearchCampaignForm from './forms/SearchCampaignForm';
import DisplayCampaignForm from './forms/DisplayCampaignForm';
import PerformanceMaxCampaignForm from './forms/PerformanceMaxCampaignForm';
import VideoCampaignForm from './forms/VideoCampaignForm';
import usePersistentState from '@/lib/usePersistentState';

export default function GoogleAdsCampaignCreator({ prefill }) {
  const [type, setType] = usePersistentState('gads_campaign_type', 'search');

  // Quando vem prefill da Pesquisa IA, força tipo "search"
  useEffect(() => {
    if (prefill) setType('search');
  }, [prefill]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3 text-white">Escolha o tipo de campanha</h3>
        <CampaignTypeSelector selected={type} onSelect={setType} />
      </div>

      {type === 'search' && <SearchCampaignForm prefill={prefill} />}
      {type === 'display' && <DisplayCampaignForm />}
      {type === 'pmax' && <PerformanceMaxCampaignForm />}
      {type === 'video' && <VideoCampaignForm />}
    </div>
  );
}