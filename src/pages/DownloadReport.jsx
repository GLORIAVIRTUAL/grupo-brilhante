import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2 } from 'lucide-react';

export default function DownloadReport() {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('generateReport', {});
      const fileUrl = response.data.file_url;
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = 'Relatorio_Chatbot_Gloria_08a17Abr2026.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error downloading:", error);
      alert("Erro ao gerar relatório. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a0b36] p-6">
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-10 text-center max-w-md w-full">
        <div className="w-20 h-20 bg-[#FF6600]/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <FileText className="w-10 h-10 text-[#FF6600]" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Relatório do Chatbot</h1>
        <p className="text-gray-400 mb-8">
          Relatório completo de desempenho do Chatbot Glória<br />
          Período: 08/Abr - 17/Abr 2026
        </p>
        <Button 
          onClick={handleDownload} 
          disabled={loading}
          className="bg-[#FF6600] hover:bg-[#e55c00] text-white px-8 py-3 text-lg gap-3 w-full"
        >
          {loading ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Gerando...</>
          ) : (
            <><Download className="w-5 h-5" /> Baixar Relatório (.docx)</>
          )}
        </Button>
      </div>
    </div>
  );
}