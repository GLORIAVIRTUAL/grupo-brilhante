import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode, RefreshCw, Wifi, WifiOff, LogOut, Loader2 } from 'lucide-react';

// Cartão de conexão de UMA instância Z-API. `store` = 'main' (rede) ou 'moinhos'.
export default function ZapiConnectionCard({ store = 'main', title, description, accent = 'green' }) {
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [checkingConnection, setCheckingConnection] = useState(false);

  const accentText = accent === 'blue' ? 'text-blue-400' : 'text-green-400';

  useEffect(() => {
    checkConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkConnection = async () => {
    setCheckingConnection(true);
    try {
      const { data } = await base44.functions.invoke('zapi_connection', { action: 'status', store });
      setConnectionStatus(data);
      if (!data.connected) {
        refreshQrCode();
      }
    } catch (error) {
      console.error("Connection check failed", error);
      setConnectionStatus({ connected: false });
    } finally {
      setCheckingConnection(false);
    }
  };

  const refreshQrCode = async () => {
    try {
      const { data } = await base44.functions.invoke('zapi_connection', { action: 'qrcode', store });
      if (data.value) setQrCode(data.value);
    } catch (error) {
      console.error("QR Code fetch failed", error);
    }
  };

  const handleRestart = async () => {
    if (!confirm("Reiniciar a instância pode demorar alguns segundos. Continuar?")) return;
    setCheckingConnection(true);
    try {
      await base44.functions.invoke('zapi_connection', { action: 'restart', store });
      setTimeout(checkConnection, 5000);
    } catch (error) {
      console.error("Restart failed", error);
      setCheckingConnection(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Desconectar o WhatsApp? Você precisará ler o QR Code novamente.")) return;
    setCheckingConnection(true);
    try {
      await base44.functions.invoke('zapi_connection', { action: 'disconnect', store });
      setConnectionStatus({ connected: false });
      refreshQrCode();
    } catch (error) {
      console.error("Disconnect failed", error);
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleSetWebhook = async () => {
    try {
      await base44.functions.invoke('zapi_connection', { action: 'set_webhook', store });
      alert('Webhook configurado com sucesso!');
    } catch (e) {
      alert('Erro ao configurar webhook');
    }
  };

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className={`w-5 h-5 ${accentText}`} />
          {title}
        </CardTitle>
        <CardDescription className="text-gray-400">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-black/20 border border-white/10">
              {checkingConnection ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : connectionStatus?.connected ? (
                <Wifi className="w-6 h-6 text-green-500" />
              ) : (
                <WifiOff className="w-6 h-6 text-red-500" />
              )}
              <div>
                <div className="font-medium">Status da Conexão</div>
                <div className={`text-sm ${connectionStatus?.connected ? 'text-green-400' : 'text-red-400'}`}>
                  {checkingConnection ? 'Verificando...' : connectionStatus?.connected ? 'Conectado e Operante' : 'Desconectado'}
                </div>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={checkConnection} disabled={checkingConnection} className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <RefreshCw className={`w-4 h-4 mr-2 ${checkingConnection ? 'animate-spin' : ''}`} />
                Atualizar Status
              </Button>
              <Button variant="outline" onClick={handleRestart} disabled={checkingConnection} className="border-white/10 hover:bg-white/5 text-yellow-500 hover:text-yellow-400">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reiniciar Instância
              </Button>
              {connectionStatus?.connected && (
                <Button variant="outline" onClick={handleDisconnect} disabled={checkingConnection} className="border-white/10 hover:bg-white/5 text-red-500 hover:text-red-400">
                  <LogOut className="w-4 h-4 mr-2" />
                  Desconectar
                </Button>
              )}
            </div>

            <div className="pt-4 border-t border-white/10">
              <Button variant="outline" onClick={handleSetWebhook} className="border-white/10 hover:bg-white/5 text-blue-400">
                <RefreshCw className="w-4 h-4 mr-2" />
                Configurar Webhook (Receber Mensagens)
              </Button>
              <p className="text-xs text-gray-500 mt-2">
                Clique aqui se o chatbot parar de receber mensagens. Isso irá reconfigurar a URL de recebimento na Z-API.
              </p>
            </div>

            {connectionStatus && (
              <div className="text-xs text-gray-500 font-mono mt-4 p-2 bg-black/30 rounded">
                Phone: {connectionStatus.phone || 'N/A'}
              </div>
            )}
          </div>

          {!connectionStatus?.connected && qrCode && (
            <div className="bg-white p-4 rounded-xl shadow-lg shadow-white/5">
              <img src={qrCode} alt="QR Code WhatsApp" className="w-48 h-48 md:w-64 md:h-64 object-contain" />
              <p className="text-center text-gray-900 font-medium mt-2 text-sm">Escaneie para conectar</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}