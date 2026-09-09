import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function QuoteWidget({ unitId }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState('lead'); // lead | chat
  const [form, setForm] = useState({ name: '', phone: '', message: '' });
  const [honeypot, setHoneypot] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [since, setSince] = useState(null);
  const pollRef = useRef(null);
  const scrollRef = useRef(null);

  const scrollToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startConversation = async (e) => {
    e?.preventDefault();
    setError('');
    if (!form.name.trim() || form.name.trim().length < 2) return setError('Informe seu nome.');
    if (!form.phone.trim()) return setError('Informe seu telefone com DDD.');
    setLoading(true);
    try {
      const res = await base44.functions.invoke('landing_widget_start', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        unit_id: unitId || null,
        honeypot,
      });
      const data = res?.data || res;
      if (data?.error) return setError(data.error);
      setConversationId(data.conversation_id);
      setSince(new Date().toISOString());
      setMessages([{ id: 'welcome', direction: 'OUT', text: 'Olá! Sou a Glória, da 5àsec. Já recebi seu contato e vou montar seu orçamento. Pode me contar quais peças deseja orçar? 👗', created_date: new Date().toISOString() }]);
      setStage('chat');
    } catch (err) {
      setError('Não foi possível iniciar o chat. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const pollMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await base44.functions.invoke('landing_widget_messages', {
        conversation_id: conversationId,
        since,
      });
      const data = res?.data || res;
      if (data?.messages?.length) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const incoming = data.messages.filter((m) => !ids.has(m.id));
          return [...prev, ...incoming];
        });
        setSince(new Date().toISOString());
      }
    } catch (err) {
      /* polling silencioso */
    }
  }, [conversationId, since]);

  useEffect(() => {
    if (stage !== 'chat' || !conversationId) return;
    pollMessages();
    pollRef.current = setInterval(pollMessages, 3000);
    return () => clearInterval(pollRef.current);
  }, [stage, conversationId, pollMessages]);

  const sendMessage = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !conversationId) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, direction: 'IN', text, created_date: new Date().toISOString() }]);
    try {
      await base44.functions.invoke('landing_widget_send', { conversation_id: conversationId, text, honeypot });
    } catch (err) {
      setError('Não foi possível enviar. Tente novamente.');
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-4 md:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm bg-[#1a0b36] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col"
            style={{ maxHeight: '70vh' }}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#4C12A1] to-[#6a1cb3] p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FF6600] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Glória · 5àsec</p>
                  <p className="text-white/70 text-xs flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-400" /> Online 24/7
                  </p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Lead capture */}
            {stage === 'lead' && (
              <div className="p-5 overflow-y-auto">
                <p className="text-white text-sm mb-4">Faça seu orçamento de roupas em segundos. A Glória responde pelo chat e no seu WhatsApp.</p>
                <form onSubmit={startConversation} className="space-y-3">
                  <input value={honeypot} onChange={(e) => setHoneypot(e.target.value)} type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Nome</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Seu nome"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-white/30 focus:border-[#FF6600] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Telefone / WhatsApp</label>
                    <input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-white/30 focus:border-[#FF6600] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">O que deseja orçar? (opcional)</label>
                    <textarea
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="Ex: 2 camisas, 1 terno..."
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-white/30 focus:border-[#FF6600] focus:outline-none resize-none"
                    />
                  </div>
                  {error && <p className="text-red-400 text-xs">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#FF6600] hover:bg-[#e55c00] text-white font-semibold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {loading ? 'Iniciando...' : 'Iniciar orçamento'}
                  </button>
                </form>
              </div>
            )}

            {/* Chat */}
            {stage === 'chat' && (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#120a24]">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === 'IN' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                        m.direction === 'IN'
                          ? 'bg-[#FF6600] text-white rounded-br-md'
                          : 'bg-white/10 text-white rounded-bl-md'
                      }`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={sendMessage} className="p-3 border-t border-white/10 flex gap-2 bg-[#1a0b36]">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-white text-sm placeholder-white/30 focus:border-[#FF6600] focus:outline-none"
                  />
                  <button type="submit" disabled={!input.trim()} className="bg-[#FF6600] hover:bg-[#e55c00] text-white p-2.5 rounded-full disabled:opacity-50 transition-colors">
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-4 md:right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-[#FF6600] to-[#e55c00] shadow-lg shadow-orange-500/40 flex items-center justify-center"
      >
        {open ? <X className="w-6 h-6 text-white" /> : <MessageSquare className="w-6 h-6 text-white" />}
        {!open && <span className="absolute top-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-[#1a0b36] animate-pulse" />}
      </motion.button>
    </>
  );
}