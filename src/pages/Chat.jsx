import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { 
  Search, 
  Filter, 
  Send, 
  Paperclip, 
  User, 
  Check, 
  CheckCheck,
  Phone,
  Bot,
  TestTube,
  Mic,
  Smile,
  Zap,
  X,
  StopCircle,
  Plus,
  Download,
  Forward,
  UserCog,
  ChevronsLeft,
  ChevronsRight,
  CreditCard
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import AdvancedQuoteModal from '@/components/crm/AdvancedQuoteModal';
import PaymentLinkDialog from '@/components/chat/PaymentLinkDialog';
import EditCustomerModal from '@/components/chat/EditCustomerModal';
import DeleteConversationButton from '@/components/chat/DeleteConversationButton';
import ConversationListItem from '@/components/chat/ConversationListItem';
import ChannelFilter from '@/components/chat/ChannelFilter';
import ReactMarkdown from 'react-markdown';
import useUnitAccess from '@/components/units/useUnitAccess';

export default function Chat() {
  const { defaultUnitId, accessibleUnits } = useUnitAccess();
  const [selectedUnitFilter, setSelectedUnitFilter] = useState('');

  // Initialize unit filter with default unit when available
  useEffect(() => {
    if (defaultUnitId && !selectedUnitFilter) {
      setSelectedUnitFilter(defaultUnitId);
    }
  }, [defaultUnitId]);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [customers, setCustomers] = useState({});
  const [units, setUnits] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [conversationView, setConversationView] = useState('all');
  // Filtro por canal de origem (todos / WhatsApp / Instagram / Messenger)
  const [channelFilter, setChannelFilter] = useState('all');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Marcadores de "cliente respondeu": contador de novas mensagens + prévia do texto
  const [unreadMap, setUnreadMap] = useState({});
  const [previews, setPreviews] = useState({});
  // Momento da última mensagem recebida em tempo real (por conversa) — usado para
  // subir a conversa no topo mesmo que o registro da conversa ainda não tenha sido atualizado.
  const [lastActivity, setLastActivity] = useState({});
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [searchParams] = useSearchParams();
  // Nome do atendente logado — usado para identificar quem enviou cada mensagem
  const [currentUserName, setCurrentUserName] = useState("");

  useEffect(() => {
    base44.auth.me()
      .then(u => setCurrentUserName(u?.full_name || u?.email || "Atendente"))
      .catch(() => setCurrentUserName("Atendente"));
  }, []);

  useEffect(() => {
      const customerId = searchParams.get('customer_id');
      if (customerId) {
          initChatWithCustomer(customerId);
      }
  }, [searchParams]);

  const initChatWithCustomer = async (customerId) => {
      try {
          // 1. Check if conversation exists
          const existing = await base44.entities.Conversation.filter({ customer_id: customerId });
          let targetConv = existing[0];
          
          if (!targetConv) {
              // Create new if not exists
              targetConv = await base44.entities.Conversation.create({
                  customer_id: customerId,
                  channel: 'WHATSAPP',
                  status: 'OPEN'
              });
              // Refresh list
              loadConversations();
          }
          
          // 2. Ensure customer data is available
          if (!customers[customerId]) {
               const cust = await base44.entities.Customer.get(customerId);
               setCustomers(prev => ({ ...prev, [customerId]: cust }));
          }
          
          setActiveConversation(targetConv);
      } catch (err) {
          console.error("Error init chat:", err);
          toast.error("Erro ao abrir conversa.");
      }
  };

  // Parser consistente: o backend grava created_date SEM o sufixo "Z" (UTC).
  // Sem ele, new Date() interpreta como horário LOCAL e a ordenação fica errada
  // (frases fora de ordem no chat). Sempre normalizamos para UTC antes de ordenar.
  // Normaliza formatos vindos do banco/tempo real: "2026-09-05 23:24:06.545000",
  // com "T", com ou sem "Z". Sem isso, uma data não reconhecida virava 0 e a
  // mensagem ia para o topo do chat (ordem errada).
  const toUtcDate = (dateStr) => {
    if (typeof dateStr !== 'string') return new Date(dateStr);
    let s = dateStr.trim().replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
    return new Date(s);
  };

  const parseDate = (dateStr) => {
    if (!dateStr) return 0;
    const t = toUtcDate(dateStr).getTime();
    return isNaN(t) ? 0 : t;
  };

  const formatTime = (dateStr) => {
    try {
        if (!dateStr) return '';
        const d = toUtcDate(dateStr);
        if (isNaN(d.getTime())) return '';
        
        if (isToday(d)) {
            return format(d, 'HH:mm', { locale: ptBR });
        } else if (isYesterday(d)) {
            return 'Ontem';
        } else {
            return format(d, 'dd/MM/yyyy', { locale: ptBR });
        }
    } catch { return ''; }
  };

  // Mostra data + hora completas (usado nas bolhas de mensagem para auditoria)
  const formatDateTime = (dateStr) => {
    try {
        if (!dateStr) return '';
        const d = toUtcDate(dateStr);
        if (isNaN(d.getTime())) return '';
        return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    } catch { return ''; }
  };

  // Test Modal State
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  
  // New Features State
  const [isRecording, setIsRecording] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const [newQuickReply, setNewQuickReply] = useState("");
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [forwardSearchTerm, setForwardSearchTerm] = useState("");
  const [selectedForwardCustomerId, setSelectedForwardCustomerId] = useState("");
  const [forwardText, setForwardText] = useState("");
  const [forwardImageUrl, setForwardImageUrl] = useState("");
  const [forwardingMessage, setForwardingMessage] = useState(false);
  
  // Quote Modal State
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const [initialQuoteData, setInitialQuoteData] = useState(null);
  const [isPaymentLinkOpen, setIsPaymentLinkOpen] = useState(false);

  // Edit Customer Modal State
  const [isEditCustomerOpen, setIsEditCustomerOpen] = useState(false);

  // Mantém uma referência dos clientes carregados para buscar novos sob demanda
  const customersRef = useRef({});
  useEffect(() => { customersRef.current = customers; }, [customers]);

  const isPlaceholderName = (n) => {
    const name = (n || '').trim().toLowerCase();
    return !name || name === 'cliente' || name === 'novo cliente';
  };

  // Garante que o cliente de uma conversa nova (criada após o carregamento da página)
  // seja buscado no banco — senão a UI mostra "Cliente Desconhecido"/"Novo Cliente"
  // mesmo com o nome do WhatsApp já salvo corretamente.
  const ensureCustomerLoaded = async (customerId) => {
    if (!customerId) return;
    const cached = customersRef.current[customerId];
    if (cached && !isPlaceholderName(cached.full_name)) return;
    try {
      const cust = await base44.entities.Customer.get(customerId);
      if (cust) setCustomers(prev => ({ ...prev, [customerId]: cust }));
    } catch (err) { /* próximo ciclo tenta de novo */ }
  };

  // Load Conversations
  useEffect(() => {
    loadConversations();
    loadQuickReplies();
    loadUnits();
    
    const unsub = base44.entities.Conversation.subscribe((event) => {
       if (event.type !== 'create' && event.type !== 'update') return;

       // Cliente novo pode não estar no mapa carregado — busca o nome real do WhatsApp
       ensureCustomerLoaded(event.data.customer_id);

       setConversations(prev => {
         // Find by direct id OR by related_conv_ids (unified contact)
         const existingIndex = prev.findIndex(conv =>
           conv.id === event.data.id || (conv.related_conv_ids || []).includes(event.data.id)
         );

         if (existingIndex >= 0) {
           const existing = prev[existingIndex];
           const oldTime = parseDate(existing.last_message_at || existing.created_date);
           const newTime = parseDate(event.data.last_message_at || event.data.created_date);
           // Preserve related_conv_ids that we computed in loadConversations
           const merged = { ...existing, ...event.data, related_conv_ids: existing.related_conv_ids, id: existing.id };
           // Only re-sort the list if the timestamp actually changed (avoids flicker on handoff toggles)
           if (newTime !== oldTime) {
             const updated = [...prev];
             updated[existingIndex] = merged;
             return updated.sort((a, b) => parseDate(b.last_message_at || b.created_date) - parseDate(a.last_message_at || a.created_date));
           }
           // Same timestamp → just patch in place, no re-sort
           const updated = [...prev];
           updated[existingIndex] = merged;
           return updated;
         }

         // Brand new conversation → prepend (it's the most recent)
         return [{ ...event.data, related_conv_ids: [event.data.id] }, ...prev];
       });
    });
    return () => unsub();
  }, []);

  // Track which conversation ID we're viewing to avoid reloading messages on handoff toggle
  const activeConvIdRef = useRef(null);
  const relatedConvIdsRef = useRef([]);

  // Load Messages when Active Conversation changes (by ID only)
  useEffect(() => {
    if (!activeConversation) {
        activeConvIdRef.current = null;
        relatedConvIdsRef.current = [];
        return;
    }

    const convIds = activeConversation.related_conv_ids || [activeConversation.id];
    relatedConvIdsRef.current = convIds;

    // Only reload messages if the conversation actually changed (not just handoff toggle)
    if (activeConvIdRef.current !== activeConversation.id) {
        activeConvIdRef.current = activeConversation.id;
        loadMessages(activeConversation);
    }
  }, [activeConversation?.id]);

  // GLOBAL Message subscription — mounted ONCE, never torn down.
  // This guarantees no incoming message is missed during conversation switches or handoff toggles.
  useEffect(() => {
    const unsub = base44.entities.Message.subscribe((event) => {
        if (!event.data) return;
        const convId = event.data.conversation_id;

        // If message belongs to the currently open conversation → append to messages list
        if (relatedConvIdsRef.current.includes(convId)) {
            setMessages(prev => {
                const existing = prev.find(m => m.id === event.data.id);
                if (existing) return prev.map(m => m.id === event.data.id ? event.data : m);
                const newMsgs = [...prev, event.data];
                return newMsgs.sort((a, b) => parseDate(a.created_date) - parseDate(b.created_date));
            });
            scrollToBottom();
        }

        // Always bump the conversation in the sidebar so the user sees it move to top instantly
        if (event.type === 'create' && event.data.direction === 'IN') {
            const previewText = event.data.text?.trim() || (event.data.type === 'IMAGE' ? '📷 Foto' : event.data.type === 'AUDIO' ? '🎤 Áudio' : '📎 Anexo');
            setPreviews(prev => ({ ...prev, [convId]: previewText }));
            setLastActivity(prev => ({ ...prev, [convId]: new Date().toISOString() }));
            if (!relatedConvIdsRef.current.includes(convId)) {
                setUnreadMap(prev => ({ ...prev, [convId]: (prev[convId] || 0) + 1 }));
            }
            setConversations(prev => {
                const idx = prev.findIndex(c => (c.related_conv_ids || [c.id]).includes(convId));
                if (idx < 0) return prev;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], last_message_at: event.data.created_date };
                return updated.sort((a, b) => parseDate(b.last_message_at || b.created_date) - parseDate(a.last_message_at || a.created_date));
            });
        }
    });
    return () => unsub();
  }, []);

  // FALLBACK DE ATUALIZAÇÃO: além do realtime, a cada 7s buscamos novidades.
  // Garante que o chat atualize mesmo se a conexão em tempo real falhar/cair.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // 1) Atualiza mensagens da conversa aberta
        const convIds = relatedConvIdsRef.current;
        if (convIds.length > 0) {
          const results = await Promise.all(
            convIds.map(id => base44.entities.Message.filter({ conversation_id: id }, '-created_date', 50))
          );
          const fetched = results.flat();
          setMessages(prev => {
            const known = new Set(prev.map(m => m.id));
            const news = fetched.filter(m => !known.has(m.id));
            if (news.length === 0) return prev;
            const merged = [...prev, ...news].sort((a, b) => parseDate(a.created_date) - parseDate(b.created_date));
            scrollToBottom();
            return merged;
          });
        }

        // 2) Atualiza timestamps das conversas mais recentes na sidebar
        const recent = await base44.entities.Conversation.list('-last_message_at', 30);
        setConversations(prev => {
          let changed = false;
          const updated = prev.map(c => {
            const ids = c.related_conv_ids || [c.id];
            const match = recent.find(r => ids.includes(r.id));
            if (match && parseDate(match.last_message_at) > parseDate(c.last_message_at)) {
              changed = true;
              if (!relatedConvIdsRef.current.includes(match.id)) {
                setUnreadMap(u => ({ ...u, [match.id]: (u[match.id] || 0) + 1 }));
              }
              return { ...c, last_message_at: match.last_message_at, handoff_required: match.id === c.id ? match.handoff_required : c.handoff_required };
            }
            return c;
          });
          // Conversas novas que ainda não estão na lista
          const knownIds = new Set(prev.flatMap(c => c.related_conv_ids || [c.id]));
          const brandNew = recent.filter(r => !knownIds.has(r.id));
          // Busca os dados (nome do WhatsApp) dos clientes das conversas novas
          brandNew.forEach(r => ensureCustomerLoaded(r.customer_id));
          if (brandNew.length === 0 && !changed) return prev;
          const withNew = [...brandNew.map(r => ({ ...r, related_conv_ids: [r.id] })), ...updated];
          return withNew.sort((a, b) => parseDate(b.last_message_at || b.created_date) - parseDate(a.last_message_at || a.created_date));
        });
      } catch (err) {
        // silencioso — próximo ciclo tenta de novo
      }
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  const loadUnits = async () => {
      try {
          const list = await base44.entities.Unit.list('name', 50);
          const unitMap = {};
          list.forEach((unit) => {
              unitMap[unit.id] = unit;
          });
          setUnits(unitMap);
      } catch (err) {
          console.error("Error loading units:", err);
      }
  };

  const getCustomerUnitLabel = (customer) => {
      if (!customer) return '';
      return customer.preferred_unit_name || units[customer.unit_id]?.name || '';
  };

  const loadQuickReplies = async () => {
      try {
          const replies = await base44.entities.QuickReply.list();
          if (replies.length === 0) {
              const defaults = [
                "Olá! Como posso ajudar?",
                "Seu pedido está pronto para retirada.",
                "Obrigado pela preferência!",
                "Poderia me enviar uma foto da peça?",
                "Qual o melhor horário para entrega?",
                "Aguarde um momento, vou verificar."
              ];
              setQuickReplies(defaults.map(text => ({ text })));
              base44.entities.QuickReply.bulkCreate(defaults.map(text => ({ text })));
          } else {
              setQuickReplies(replies);
          }
      } catch (err) {
          console.error("Error loading quick replies:", err);
      }
  };

  const handleAddQuickReply = async () => {
      if (!newQuickReply.trim()) return;
      try {
          const added = await base44.entities.QuickReply.create({ text: newQuickReply });
          setQuickReplies(prev => [...prev, added]);
          setNewQuickReply("");
      } catch (err) {
          toast.error("Erro ao adicionar resposta.");
      }
  };

  const loadConversations = async () => {
    setLoadingConversations(true);
    try {
        // Carregamento inicial RÁPIDO: traz só as conversas mais recentes (atendimento ativo)
        // e os clientes mais recentes. Evita paginar dezenas de milhares de registros antes
        // de exibir a lista — que era a causa da demora para os contatos aparecerem.
        const RECENT_CONVS = 3000;
        const RECENT_CUSTOMERS = 3000;
        const [allConvs, allCustomers] = await Promise.all([
            base44.entities.Conversation.list('-last_message_at', RECENT_CONVS),
            base44.entities.Customer.list('-created_date', RECENT_CUSTOMERS)
        ]);

        const custMap = {};
        allCustomers.forEach(c => { custMap[c.id] = c; });
        setCustomers(prev => ({ ...prev, ...custMap }));

        // Unify conversations by phone OR by normalized name (handles LID + real number for same person)
        const getKey = (customer, fallbackId) => {
            const realPhone = customer?.phones?.find(p => p && !p.includes('@') && p.replace(/\D/g, '').length >= 10);
            if (realPhone) {
                const digits = realPhone.replace(/\D/g, '');
                return `phone:${digits.slice(-10)}`;
            }
            const name = (customer?.full_name || '').trim().toLowerCase();
            if (name && name !== 'cliente' && name !== 'novo cliente') {
                return `name:${name}`;
            }
            return `id:${fallbackId}`;
        };

        // Pre-compute keys ONCE per conversation (avoids the previous O(N²) filter)
        const convKeys = new Map();
        const keyToConvIds = new Map();
        for (const conv of allConvs) {
            const key = getKey(custMap[conv.customer_id], conv.customer_id);
            convKeys.set(conv.id, key);
            if (!keyToConvIds.has(key)) keyToConvIds.set(key, []);
            keyToConvIds.get(key).push(conv.id);
        }

        const uniqueConvs = [];
        const seenKeys = new Set();
        for (const conv of allConvs) {
            const key = convKeys.get(conv.id);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                conv.related_conv_ids = keyToConvIds.get(key) || [conv.id];
                uniqueConvs.push(conv);
            }
        }

        setConversations(uniqueConvs);

        // Prévia da última mensagem na lista (antes só aparecia via tempo real,
        // deixando "Toque para ver as mensagens" em todas as conversas).
        loadPreviews(uniqueConvs.slice(0, 30));

        // After the list loads, try to recover real names for customers stuck as "Novo Cliente"
        // — runs in background, does not block the UI.
        refreshUnknownCustomerNames(allCustomers);
    } catch (err) {
        console.error("Error loading conversations:", err);
    } finally {
        setLoadingConversations(false);
    }
  };

  // Busca a última mensagem de cada conversa para exibir a prévia na lista.
  const loadPreviews = async (convs) => {
    try {
      const entries = await Promise.all(convs.map(async (conv) => {
        const last = await base44.entities.Message.filter({ conversation_id: conv.id }, '-created_date', 1);
        const msg = last[0];
        if (!msg) return null;
        const text = msg.text?.trim() ||
          (msg.type === 'IMAGE' ? '📷 Foto' : msg.type === 'AUDIO' ? '🎤 Áudio' : '📎 Anexo');
        return [conv.id, text];
      }));
      const map = {};
      entries.filter(Boolean).forEach(([id, text]) => { map[id] = text; });
      setPreviews(prev => ({ ...map, ...prev }));
    } catch (err) { /* prévia é opcional */ }
  };

  // Background task: fetch real WhatsApp names for ALL "Novo Cliente" / "Cliente" customers.
  // Runs in batches of 50 until every candidate is processed.
  const refreshUnknownCustomerNames = async (allCustomers) => {
    try {
        const candidates = allCustomers.filter(c => {
            const name = (c.full_name || '').trim().toLowerCase();
            const hasRealPhone = c.phones?.some(p => p && !p.includes('@') && p.replace(/\D/g, '').length >= 10);
            return hasRealPhone && (name === '' || name === 'cliente' || name === 'novo cliente');
        });
        if (candidates.length === 0) return;

        const BATCH_SIZE = 50;
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
            const batchIds = candidates.slice(i, i + BATCH_SIZE).map(c => c.id);
            try {
                const res = await base44.functions.invoke('refreshCustomerNames', {
                    customer_ids: batchIds
                });
                const updated = res?.data?.updated || [];
                if (updated.length > 0) {
                    setCustomers(prev => {
                        const next = { ...prev };
                        for (const u of updated) {
                            if (next[u.id]) next[u.id] = { ...next[u.id], full_name: u.full_name };
                        }
                        return next;
                    });
                }
            } catch (batchErr) {
                console.warn(`Batch ${i / BATCH_SIZE + 1} failed:`, batchErr);
            }
        }
    } catch (err) {
        console.warn("Background name refresh skipped:", err);
    }
  };

  // Busca no banco TODAS as conversas do mesmo cliente e as une às já conhecidas.
  // Sem isso, clientes novos (cuja conversa nasceu depois do carregamento da página)
  // ficavam com as mensagens divididas em registros separados — a resposta da Glória
  // era gravada em um deles e não aparecia na tela.
  const resolveConvIds = async (targetConv) => {
    const known = new Set(getConversationIdsForHistory(targetConv));
    if (targetConv.customer_id) {
      try {
        const sameCustomer = await base44.entities.Conversation.filter({ customer_id: targetConv.customer_id }, '-last_message_at', 50);
        sameCustomer.forEach(c => known.add(c.id));
      } catch (err) { /* mantém os ids já conhecidos */ }
    }
    return Array.from(known);
  };

  const loadMessages = async (targetConv) => {
    try {
        const convIds = await resolveConvIds(targetConv);
        relatedConvIdsRef.current = convIds;
        const msgPromises = convIds.map(id => 
            base44.entities.Message.filter({ conversation_id: id }, 'created_date', 1000)
        );
        const msgResults = await Promise.all(msgPromises);
        const uniqueMessages = new Map();
        msgResults.flat().forEach((msg) => uniqueMessages.set(msg.id, msg));
        const allMsgs = Array.from(uniqueMessages.values()).sort((a, b) => parseDate(a.created_date) - parseDate(b.created_date));
        
        setMessages(allMsgs);
        setActiveConversation(prev => prev?.id === targetConv.id ? { ...prev, related_conv_ids: convIds } : prev);
        scrollToBottom();
    } catch (err) {
        console.error("Error loading messages:", err);
    }
  };

  // Rola o próprio container até o fim — mais confiável que scrollIntoView,
  // que às vezes parava antes da última mensagem (respostas da IA "escondidas").
  const scrollToBottom = (smooth = true) => {
    const doScroll = () => {
      const el = messagesContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      } else {
        messagesEndRef.current?.scrollIntoView({ block: "end" });
      }
    };
    doScroll();
    setTimeout(doScroll, 150);
    setTimeout(doScroll, 600);
  };

  const handleSendMessage = async (overrideText = null, type = 'TEXT', mediaUrl = null) => {
    const textToSend = overrideText !== null ? overrideText : inputText;
    
    if ((!textToSend?.trim() && !mediaUrl) || !activeConversation) return;

    const previousInput = inputText;
    if (!overrideText && !mediaUrl) setInputText("");

    try {
        const customer = customers[activeConversation.customer_id];

        // Conversas do Instagram (DM) são respondidas pela API do Instagram, não pelo WhatsApp.
        if (activeConversation.channel === 'INSTAGRAM') {
            await base44.functions.invoke('instagramSender', {
                conversation_id: activeConversation.id,
                message: textToSend,
                mediaUrl: mediaUrl,
                sent_by: currentUserName || "Atendente"
            });
            scrollToBottom();
            return;
        }

        if (!customer || !customer.phones || customer.phones.length === 0) {
            toast.error("Cliente sem telefone cadastrado.");
            return;
        }

        // Conversas que chegaram pela conexão da loja Moinhos devem ser respondidas
        // pelo sender dedicado (zapi_moinhos_sender) — senão a mensagem sai pelo
        // número principal e NÃO chega ao cliente pela conversa correta.
        // Conversas sem origem registrada (criadas pelo painel) de clientes da unidade
        // Moinhos também devem sair pelo número da Moinhos.
        const convSource = (activeConversation.metadata || {}).source;
        const isMoinhos = convSource === 'zapi_moinhos' ||
            (!convSource && moinhosUnitId && customer.unit_id === moinhosUnitId);
        const senderFn = isMoinhos ? 'zapi_moinhos_sender' : 'zapi_sender';

        const response = await base44.functions.invoke(senderFn, {
            phone: customer.phones[0],
            message: textToSend,
            conversation_id: activeConversation.id,
            type: type,
            mediaUrl: mediaUrl,
            sent_by: currentUserName || "Atendente"
        });

        const sentMessageId = response?.data?.id || response?.data?.messageId;
        if (!sentMessageId) {
            const optimisticMessage = {
                id: `temp-${Date.now()}`,
                conversation_id: activeConversation.id,
                direction: 'OUT',
                type: ['BUTTONS', 'OPTION_LIST'].includes(type) ? 'TEXT' : type,
                text: textToSend || (type === 'IMAGE' ? 'Imagem enviada' : type === 'AUDIO' ? 'Áudio enviado' : 'Arquivo enviado'),
                media_file_id: mediaUrl || null,
                created_date: new Date().toISOString(),
                sent_by: currentUserName || "Atendente",
                status: 'SENT'
            };

            setMessages(prev => {
                if (prev.some(msg => msg.id === optimisticMessage.id)) return prev;
                return [...prev, optimisticMessage].sort((a, b) => parseDate(a.created_date) - parseDate(b.created_date));
            });
            scrollToBottom();
        }
        
    } catch (err) {
        if (!overrideText && !mediaUrl) setInputText(previousInput);
        console.error("Error sending message:", err);
        toast.error("Erro ao enviar mensagem.");
    }
  };

  // --- File Upload ---
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading("Enviando arquivo...");
    try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        
        let type = 'DOC';
        if (file.type.startsWith('image/')) type = 'IMAGE';
        if (file.type.startsWith('audio/')) type = 'AUDIO';

        await handleSendMessage(file.name, type, file_url);
        toast.dismiss(toastId);
        toast.success("Arquivo enviado!");
    } catch (err) {
        console.error(err);
        toast.dismiss(toastId);
        toast.error("Erro no upload.");
    }
  };

  // --- Audio Recording ---
  const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        
        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(chunks, { type: 'audio/webm' });
            // Upload blob
            const file = new File([audioBlob], "audio_msg.webm", { type: 'audio/webm' });
            
            const toastId = toast.loading("Enviando áudio...");
            try {
                // We need to convert File to base64 or send as is? 
                // UploadFile expects binary. base44 SDK handles File object usually? 
                // Actually the integration expects "file" which is "format: binary".
                // In React/JS SDK, we usually pass the File object.
                
                // Let's create a proper file object
                const { file_url } = await base44.integrations.Core.UploadFile({ file });
                await handleSendMessage("", 'AUDIO', file_url);
                toast.dismiss(toastId);
            } catch (err) {
                console.error(err);
                toast.dismiss(toastId);
                toast.error("Erro ao enviar áudio.");
            }
            
            // Stop tracks
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
    } catch (err) {
        console.error("Microphone error:", err);
        toast.error("Erro ao acessar microfone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
    }
  };

  // --- Emojis & Quick Replies ---
  const emojis = ["👍", "👋", "😊", "✅", "❌", "📅", "📍", "🎉", "🔥", "❤️", "🤔", "😅"];

  const addEmoji = (emoji) => setInputText(prev => prev + emoji);
  const sendQuickReply = (text) => {
      setInputText(text);
      setShowQuickReplies(false);
  };

  const getCustomerName = (conv) => {
      return customers[conv.customer_id]?.full_name || "Cliente Desconhecido";
  };

  const getConversationIdsForHistory = (targetConv) => {
      // related_conv_ids is computed in loadConversations using ALL conversations (not the filtered list)
      return targetConv.related_conv_ids || [targetConv.id];
  };

  const normalizePhone = (phone = '') => phone.replace(/\D/g, '');
  const isValidPhone = (phone = '') => {
      const digits = normalizePhone(phone);
      return digits.length >= 10 && !phone.includes('@');
  };

  const resetForwardModal = () => {
      setForwardSearchTerm("");
      setSelectedForwardCustomerId("");
      setForwardText("");
      setForwardImageUrl("");
      setForwardingMessage(false);
  };

  const handleForwardMessage = async () => {
      const targetCustomer = conversations
          .map((conv) => customers[conv.customer_id])
          .find((customer) => customer?.id === selectedForwardCustomerId);

      if (!targetCustomer?.phones?.[0]) {
          toast.error("Selecione um cliente com telefone cadastrado.");
          return;
      }

      if (!forwardText.trim() && !forwardImageUrl) {
          toast.error("Digite uma mensagem ou selecione uma imagem.");
          return;
      }

      setForwardingMessage(true);
      try {
          await base44.functions.invoke('zapi_sender', {
              phone: targetCustomer.phones[0],
              message: forwardText,
              type: forwardImageUrl ? 'IMAGE' : 'TEXT',
              mediaUrl: forwardImageUrl || null,
              customer_id: targetCustomer.id,
              unit_id: targetCustomer.unit_id,
          });
          toast.success("Encaminhamento enviado!");
          setIsForwardModalOpen(false);
          resetForwardModal();
      } catch (err) {
          console.error("Error forwarding message:", err);
          const code = err.response?.data?.code;
          toast.error(['ZAPI_NOT_CONFIGURED', 'INTERNAL_TOKEN_NOT_CONFIGURED'].includes(code)
              ? 'WhatsApp indisponível até a configuração da integração.'
              : 'Erro ao encaminhar mensagem.');
      } finally {
          setForwardingMessage(false);
      }
  };

  const handleFinishConversation = async () => {
    if (!activeConversation) return;
    if (!window.confirm("Deseja finalizar este atendimento e enviar a mensagem de encerramento?")) return;

    const toastId = toast.loading("Finalizando...");
    try {
        // 1. Send Goodbye Message
        await handleSendMessage("Atendimento finalizado. Agradecemos o contato! Se precisar de algo mais, estamos à disposição. 👋");
        
        // 2. Close Conversation in DB
        // Ao finalizar, devolvemos o controle para a Glória: a mensagem de
        // encerramento (humana) não pode silenciar a IA no próximo contato.
        await base44.entities.Conversation.update(activeConversation.id, {
            status: 'CLOSED',
            handoff_required: false,
            metadata: { ...(activeConversation.metadata || {}), ai_resumed_at: new Date().toISOString() }
        });
        
        toast.dismiss(toastId);
        toast.success("Conversa finalizada!");
        setActiveConversation(null); // Close panel
        loadConversations(); // Refresh list
    } catch (err) {
        toast.dismiss(toastId);
        console.error("Error finishing:", err);
        toast.error("Erro ao finalizar.");
    }
  };

  const handleDeleteConversation = async () => {
    if (!activeConversation || deletingConversation) return;
    const conversationIds = getConversationIdsForHistory(activeConversation);
    const toastId = toast.loading("Excluindo conversa...");
    setDeletingConversation(true);
    try {
        await Promise.all(conversationIds.map((id) =>
            base44.entities.Message.deleteMany({ conversation_id: id })
        ));
        await Promise.all(conversationIds.map((id) =>
            base44.entities.Conversation.delete(id)
        ));
        setConversations((prev) => prev.filter((conv) =>
            !(conv.related_conv_ids || [conv.id]).some((id) => conversationIds.includes(id))
        ));
        setActiveConversation(null);
        setMessages([]);
        toast.dismiss(toastId);
        toast.success("Conversa e mensagens excluídas.");
    } catch (err) {
        toast.dismiss(toastId);
        console.error("Error deleting conversation:", err);
        toast.error("Erro ao excluir conversa.");
    } finally {
        setDeletingConversation(false);
    }
  };

  const handleSimulateIncoming = async () => {
    if (!testPhone || !testMessage) return alert("Preencha telefone e mensagem");
    
    try {
        const payload = {
            phone: testPhone.replace(/\D/g, ''),
            messageId: `test-${Date.now()}`,
            text: { message: testMessage },
            senderName: "Teste Manual"
        };
        
        await base44.functions.invoke('zapi_webhook_receiver', payload);
        alert("Disparo de teste enviado! Verifique se a conversa foi criada/atualizada.");
        setIsTestModalOpen(false);
        setTestMessage("");
        loadConversations();
    } catch (error) {
        console.error("Test failed details:", error.response?.data || error);
        alert(`Erro ao disparar teste: ${error.response?.data?.error || error.message}`);
    }
  };

  const filteredForwardCustomers = Object.values(
    conversations.reduce((acc, conv) => {
      const customer = customers[conv.customer_id];
      const phone = customer?.phones?.[0] || '';
      if (!customer?.id || !isValidPhone(phone)) return acc;

      const personKey = (customer.full_name || '').trim().toLowerCase();
      const existing = acc[personKey];
      const currentDigits = normalizePhone(phone);

      if (!existing) {
        acc[personKey] = customer;
        return acc;
      }

      const existingDigits = normalizePhone(existing.phones?.[0] || '');
      if (currentDigits.length > existingDigits.length) {
        acc[personKey] = customer;
      }

      return acc;
    }, {})
  )
    .filter((customer) => {
      const term = forwardSearchTerm.toLowerCase();
      if (!term) return true;
      return (
        customer?.full_name?.toLowerCase().includes(term) ||
        customer?.phones?.some((phone) => phone.includes(term))
      );
    })
    .slice(0, 30);

  // Detecta se a conversa veio pela conexão Z-API da loja Moinhos (2ª instância)
  const isMoinhosConversation = (conv) => (conv?.metadata || {}).source === 'zapi_moinhos';
  // Descobre o id da unidade Moinhos (subdomain 'moinhos-shopping') para tratar o filtro dela por origem
  const moinhosUnitId = Object.values(units).find(
    (u) => (u.subdomain || '').toLowerCase() === 'moinhos-shopping'
  )?.id;

  // Ordena SEMPRE na renderização: garante que quem respondeu por último apareça no topo,
  // independente de qual atualização (tempo real ou fallback) trouxe a novidade.
  const activityTime = (conv) => {
    const ids = getConversationIdsForHistory(conv);
    const live = Math.max(...ids.map(id => parseDate(lastActivity[id])), 0);
    // Alguns registros antigos têm horário salvo "adiantado" (no futuro),
    // o que os mantinha presos no topo. Limitamos ao momento atual.
    const stored = Math.min(parseDate(conv.last_message_at || conv.created_date), Date.now());
    return Math.max(live, stored);
  };
  const sortByRecent = (a, b) => activityTime(b) - activityTime(a);

  // Conversas finalizadas (status CLOSED) ficam em uma aba separada — assim a lista
  // principal mostra apenas atendimentos ativos e a IA não é confundida com contexto antigo.
  const isClosedConv = (conv) => conv.status === 'CLOSED';
  const activeConvsCount = conversations.filter(c => !isClosedConv(c)).length;
  const closedConvsCount = conversations.filter(isClosedConv).length;

  // Canal da conversa: registros antigos sem campo são do WhatsApp
  const convChannel = (conv) => conv.channel || 'WHATSAPP';
  const channelCounts = {
    all: conversations.length,
    WHATSAPP: conversations.filter(c => convChannel(c) === 'WHATSAPP').length,
    INSTAGRAM: conversations.filter(c => convChannel(c) === 'INSTAGRAM').length,
    MESSENGER: conversations.filter(c => convChannel(c) === 'MESSENGER').length,
  };

  const filteredConversations = conversations.filter((conv) => {
    const customer = customers[conv.customer_id];

    if (channelFilter !== 'all' && convChannel(conv) !== channelFilter) return false;

    if (conversationView === 'closed') {
      if (!isClosedConv(conv)) return false;
    } else if (isClosedConv(conv)) {
      return false;
    }

    if (conversationView === 'unit' && selectedUnitFilter) {
      // Para a loja Moinhos, filtra pela ORIGEM da conversa (conexão Z-API dedicada),
      // não pela unidade do cliente — assim só aparecem as conversas que chegaram por Moinhos.
      if (moinhosUnitId && selectedUnitFilter === moinhosUnitId) {
        // Conversas com origem Moinhos OU (sem origem registrada + cliente da unidade Moinhos,
        // ex: conversas iniciadas manualmente pelo painel)
        const noSource = !(conv.metadata || {}).source;
        if (!isMoinhosConversation(conv) && !(noSource && customer?.unit_id === moinhosUnitId)) return false;
      } else {
        // Demais unidades: mantém o filtro por unidade do cliente,
        // e nunca mistura conversas que vieram pela conexão Moinhos.
        if (isMoinhosConversation(conv)) return false;
        if (!customer?.unit_id || customer.unit_id !== selectedUnitFilter) return false;
      }
    }

    if (!searchTerm) return true;
    if (!customer) return true;

    const term = searchTerm.toLowerCase();
    return (
      (customer.full_name && customer.full_name.toLowerCase().includes(term)) ||
      (customer.phones && customer.phones.some((phone) => phone.includes(term)))
    );
  }).sort(sortByRecent);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const elem = document.getElementById('chat-container');
      if (!document.fullscreenElement && elem) {
        elem.classList.remove('bg-[#1a0b36]', 'p-4');
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div className="h-[calc(100vh-100px)] flex gap-6" id="chat-container">
      {/* Sidebar List */}
      <div className={`${sidebarCollapsed ? 'hidden' : 'w-1/3'} bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-4 flex flex-col`}>
        <div className="flex items-center justify-between mb-6 px-2">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6998e8554cc6b3863e37588a/705b3f6b8_Untitleddesign14.png" 
            alt="GLÓRIA" 
            className="h-12 w-auto object-contain"
          />
          <div className="flex gap-1">
             <button 
                onClick={() => setIsTestModalOpen(true)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-[#FF6600]"
                title="Ferramentas de Teste"
             >
                <TestTube className="w-5 h-5" />
             </button>
             <button className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                <Filter className="w-5 h-5 text-gray-400" />
             </button>
          </div>
        </div>

        <ChannelFilter value={channelFilter} onChange={setChannelFilter} counts={channelCounts} />

        <div className="mb-4 flex gap-2 px-2">
          <button
            onClick={() => setConversationView('all')}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              conversationView === 'all'
                ? 'border-[#FF6600]/40 bg-[#FF6600]/15 text-[#FF6600]'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            Ativas ({activeConvsCount})
          </button>
          <button
            onClick={() => setConversationView('unit')}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              conversationView === 'unit'
                ? 'border-[#FF6600]/40 bg-[#FF6600]/15 text-[#FF6600]'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            Só da unidade ({conversations.filter(c => {
              if (!selectedUnitFilter) return false;
              const moinhosId = Object.values(units).find(u => (u.subdomain || '').toLowerCase() === 'moinhos-shopping')?.id;
              if (moinhosId && selectedUnitFilter === moinhosId) {
                const custM = customers[c.customer_id];
                return (c.metadata || {}).source === 'zapi_moinhos' ||
                  (!(c.metadata || {}).source && custM?.unit_id === moinhosId);
              }
              const cust = customers[c.customer_id];
              return (c.metadata || {}).source !== 'zapi_moinhos' && cust?.unit_id === selectedUnitFilter;
            }).length})
          </button>
          <button
            onClick={() => setConversationView('closed')}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              conversationView === 'closed'
                ? 'border-green-400/40 bg-green-400/15 text-green-300'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
            title="Ver conversas já finalizadas"
          >
            Finalizadas ({closedConvsCount})
          </button>
        </div>

        {conversationView === 'unit' && (
          <div className="mb-4 px-2">
            <select
              value={selectedUnitFilter}
              onChange={(e) => setSelectedUnitFilter(e.target.value)}
              className="w-full rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/10 px-3 py-2 text-xs font-medium text-[#FF6600] focus:outline-none focus:border-[#FF6600]/60"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" disabled>Selecione uma unidade...</option>
              {accessibleUnits.map((unit) => (
                <option key={unit.id} value={unit.id} className="bg-[#1a0b36] text-white">
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="relative mb-6 px-2">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input 
            type="text" 
            placeholder="Buscar cliente..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-[#FF6600]/50 transition-colors placeholder:text-gray-600 text-white"
          />
        </div>

        <div className="space-y-2 overflow-y-auto flex-1 pr-2 custom-scrollbar" data-sort="activity">
          {filteredConversations.map((conv) => {
            const isActive = activeConversation?.id === conv.id;
            const customer = customers[conv.customer_id];
            const convIds = getConversationIdsForHistory(conv);
            const unreadCount = convIds.reduce((sum, id) => sum + (unreadMap[id] || 0), 0);
            const preview = convIds.map(id => previews[id]).find(Boolean);
            const liveStamp = convIds.map(id => lastActivity[id]).filter(Boolean).sort().pop();

            return (
              <ConversationListItem
                key={conv.id}
                conversation={liveStamp ? { ...conv, last_message_at: liveStamp } : conv}
                customer={customer}
                unitLabel={getCustomerUnitLabel(customer)}
                isActive={isActive}
                unreadCount={unreadCount}
                preview={preview}
                formatTime={formatTime}
                onSelect={() => {
                  setUnreadMap(prev => {
                    const next = { ...prev };
                    convIds.forEach(id => { delete next[id]; });
                    return next;
                  });
                  setActiveConversation({ ...conv, related_conv_ids: convIds });
                }}
              />
            );
          })}
          
          {filteredConversations.length === 0 && (
              <div className="text-center text-gray-500 mt-10">Nenhuma conversa encontrada nesse filtro</div>
          )}
        </div>
      </div>

      <EditCustomerModal
        isOpen={isEditCustomerOpen}
        onClose={() => setIsEditCustomerOpen(false)}
        customer={customers[activeConversation?.customer_id]}
        onSaved={(updated) => {
            setCustomers(prev => ({ ...prev, [updated.id]: updated }));
        }}
      />

      <AdvancedQuoteModal 
        isOpen={isQuoteModalOpen}
        onClose={() => setIsQuoteModalOpen(false)}
        pipeline="QUOTE"
        stage="Em negociação"
        unitId={customers[activeConversation?.customer_id]?.unit_id || ''}
        onSuccess={() => {
            toast.success("Orçamento gerado com sucesso!");
        }}
      />

      <PaymentLinkDialog
        isOpen={isPaymentLinkOpen}
        onClose={() => setIsPaymentLinkOpen(false)}
        customer={customers[activeConversation?.customer_id]}
        onSendLink={(message) => handleSendMessage(message)}
      />

      <Dialog open={isForwardModalOpen} onOpenChange={(open) => {
        setIsForwardModalOpen(open);
        if (!open) resetForwardModal();
      }}>
        <DialogContent className="bg-[#1a0b36] border border-white/10 text-white sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Encaminhar mensagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-300">Buscar cliente</label>
              <input
                value={forwardSearchTerm}
                onChange={(e) => setForwardSearchTerm(e.target.value)}
                placeholder="Nome ou telefone"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/20">
                {filteredForwardCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => setSelectedForwardCustomerId(customer.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/10 ${selectedForwardCustomerId === customer.id ? 'bg-[#FF6600]/20 text-white' : 'text-gray-200'}`}
                  >
                    <span>{customer.full_name || customer.phones?.[0]}</span>
                    <span className="text-xs text-gray-400">{customer.phones?.[0]}</span>
                  </button>
                ))}
                {filteredForwardCustomers.length === 0 && (
                  <div className="px-3 py-4 text-sm text-gray-400">Nenhum contato válido encontrado.</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300">Texto</label>
              <textarea
                value={forwardText}
                onChange={(e) => setForwardText(e.target.value)}
                placeholder="Digite a mensagem para encaminhar"
                className="h-24 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300">Imagem da conversa atual</label>
              <select
                value={forwardImageUrl}
                onChange={(e) => setForwardImageUrl(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#2a164d] px-3 py-2 text-sm text-white"
                style={{ colorScheme: 'dark' }}
              >
                <option value="">Sem imagem</option>
                {messages.filter((msg) => msg.type === 'IMAGE' && msg.media_file_id).map((msg) => (
                  <option key={msg.id} value={msg.media_file_id}>
                    {`Imagem ${formatTime(msg.created_date) || msg.id}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsForwardModalOpen(false)} className="text-white hover:bg-white/10">
                Cancelar
              </Button>
              <Button type="button" onClick={handleForwardMessage} disabled={forwardingMessage} className="bg-[#FF6600] hover:bg-[#e55c00] text-white">
                {forwardingMessage ? 'Enviando...' : 'Encaminhar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Modal */}
      {isTestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1a0b36] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Bot className="w-5 h-5 text-[#FF6600]" />
                        Simular Cliente (Teste)
                    </h3>
                    <button onClick={() => setIsTestModalOpen(false)} className="text-gray-400 hover:text-white">✕</button>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-gray-400 mb-1 block">Telefone do Cliente</label>
                        <input 
                            value={testPhone}
                            onChange={e => setTestPhone(e.target.value)}
                            placeholder="5511999999999"
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-[#FF6600]"
                        />
                    </div>
                    <div>
                        <label className="text-sm text-gray-400 mb-1 block">Mensagem Recebida</label>
                        <textarea 
                            value={testMessage}
                            onChange={e => setTestMessage(e.target.value)}
                            placeholder="Ex: Olá, gostaria de um orçamento"
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:border-[#FF6600] h-24 resize-none"
                        />
                    </div>
                    
                    <button 
                        onClick={handleSimulateIncoming}
                        className="w-full bg-[#FF6600] hover:bg-[#e55c00] text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        <Bot className="w-4 h-4" />
                        Disparar como se fosse Cliente
                    </button>
                    
                    <p className="text-xs text-gray-500 text-center mt-2">
                        Isso simulará uma mensagem chegando no webhook e acionará a IA.
                    </p>
                </div>
            </div>
        </div>
      )}

      {/* Main Chat Area */}
      {activeConversation ? (
          <div className="flex-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl flex flex-col relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20 gap-4 flex-wrap">
               <div className="flex items-center gap-3 min-w-0">
                 <button
                     onClick={() => setSidebarCollapsed(prev => !prev)}
                     className="h-10 w-10 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white shrink-0"
                     title={sidebarCollapsed ? "Mostrar lista de conversas" : "Expandir chat"}
                 >
                     {sidebarCollapsed ? <ChevronsRight className="w-5 h-5" /> : <ChevronsLeft className="w-5 h-5" />}
                 </button>
                 <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#FF6600] to-yellow-500 flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {getCustomerName(activeConversation).charAt(0)}
                 </div>
                 <div className="min-w-0">
                   <h3 className="font-bold text-lg text-white truncate">{getCustomerName(activeConversation)}</h3>
                   <div className="flex items-center gap-2 text-xs flex-wrap">
                        {activeConversation.handoff_required ? (
                            <span className="text-[#FF6600] flex items-center gap-1 bg-[#FF6600]/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                                <User className="w-3 h-3" /> Solicita Atendente
                            </span>
                        ) : (
                            <span className="text-green-500 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> IA Ativa
                            </span>
                        )}
                        {customers[activeConversation.customer_id]?.phones?.[0] && (
                            <span className="text-gray-400 flex items-center gap-1 whitespace-nowrap">
                                <Phone className="w-3 h-3" /> {customers[activeConversation.customer_id].phones[0]}
                            </span>
                        )}
                        {getCustomerUnitLabel(customers[activeConversation.customer_id]) && (
                            <span className="text-[#FF6600] flex items-center gap-1 whitespace-nowrap bg-[#FF6600]/10 px-2 py-0.5 rounded-full">
                                {getCustomerUnitLabel(customers[activeConversation.customer_id])}
                            </span>
                        )}
                   </div>
                 </div>
               </div>
               
               <div className="flex items-center gap-2 flex-wrap justify-end">
                   <button 
                       onClick={() => setIsEditCustomerOpen(true)}
                       className="h-10 px-3 bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 rounded-lg text-xs font-medium transition-colors border border-purple-600/30 flex items-center gap-1.5 whitespace-nowrap"
                       title="Cadastrar / Editar Cliente"
                   >
                       <UserCog className="w-3.5 h-3.5" /> Cadastrar
                   </button>

                   <button 
                       onClick={() => {
                           const customer = customers[activeConversation.customer_id];
                           setInitialQuoteData({
                               id: customer?.id,
                               name: customer?.full_name,
                               phone: customer?.phones?.[0]
                           });
                           
                           window.initialQuoteData = {
                               id: customer?.id,
                               name: customer?.full_name,
                               phone: customer?.phones?.[0]
                           };
                           setIsQuoteModalOpen(true);
                       }}
                       className="h-10 px-3 bg-[#FF6600]/10 text-[#FF6600] hover:bg-[#FF6600]/20 rounded-lg text-xs font-medium transition-colors border border-[#FF6600]/20 flex items-center gap-1.5 whitespace-nowrap"
                   >
                       <Zap className="w-3.5 h-3.5" /> Orçamento
                       </button>

                       <button
                       onClick={() => setIsPaymentLinkOpen(true)}
                       className="h-10 px-3 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-lg text-xs font-medium transition-colors border border-green-600/30 flex items-center gap-1.5 whitespace-nowrap"
                       title="Gerar link de pagamento Asaas"
                       >
                       <CreditCard className="w-3.5 h-3.5" /> Pagamento
                       </button>

                  {activeConversation.handoff_required ? (
                     <button 
                         onClick={async () => {
                             // Marca o momento da devolução para a IA: mensagens humanas
                             // anteriores param de silenciar a Glória.
                             const metadata = { ...(activeConversation.metadata || {}), ai_resumed_at: new Date().toISOString() };
                             await base44.entities.Conversation.update(activeConversation.id, { handoff_required: false, metadata });
                             setActiveConversation(prev => ({ ...prev, handoff_required: false, metadata }));
                         }}
                         className="h-10 px-3 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-lg text-xs font-medium transition-colors border border-green-600/30 flex items-center gap-1.5 whitespace-nowrap"
                         title="Devolver o atendimento para a Glória (IA)"
                     >
                         <Bot className="w-3.5 h-3.5" /> Voltar p/ IA
                     </button>
                  ) : (
                     <button 
                         onClick={async () => {
                             const metadata = { ...(activeConversation.metadata || {}), handoff_source: 'human' };
                             await base44.entities.Conversation.update(activeConversation.id, { handoff_required: true, metadata });
                             setActiveConversation(prev => ({ ...prev, handoff_required: true, metadata }));
                         }}
                         className="h-10 px-3 bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 rounded-lg text-xs font-medium transition-colors border border-orange-600/30 flex items-center gap-1.5 whitespace-nowrap"
                     >
                         <User className="w-3.5 h-3.5" /> Transferir
                     </button>
                  )}

                  <button 
                      onClick={() => setIsForwardModalOpen(true)}
                      className="h-10 px-3 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-xs font-medium transition-colors border border-blue-600/30 flex items-center gap-1.5 whitespace-nowrap"
                      title="Encaminhar"
                  >
                      <Forward className="w-3.5 h-3.5" /> Encaminhar
                  </button>

                  <button 
                      onClick={handleFinishConversation}
                      className="h-10 px-3 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg text-xs font-medium transition-colors border border-red-600/30 flex items-center gap-1.5 whitespace-nowrap"
                      title="Finalizar Conversa"
                  >
                      <X className="w-3.5 h-3.5" /> Finalizar
                  </button>

                  <DeleteConversationButton
                      onConfirm={handleDeleteConversation}
                      deleting={deletingConversation}
                  />

                  <button 
                      onClick={() => {
                          const elem = document.getElementById('chat-container');
                          if (!document.fullscreenElement) {
                              elem.requestFullscreen().then(() => {
                                  elem.classList.add('bg-[#1a0b36]', 'p-4');
                              }).catch(err => {
                                  console.log(`Error attempting to enable fullscreen: ${err.message}`);
                              });
                          } else {
                              document.exitFullscreen();
                          }
                      }}
                      className="h-10 w-10 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors"
                      title="Tela Cheia"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                          <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
                          <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                          <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
                          <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                      </svg>
                  </button>
               </div>
            </div>
    
            {/* Messages List */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-opacity-5 bg-repeat">
               {messages.map((msg) => {
                   const isMe = msg.direction === 'OUT';
                   return (
                       <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] relative group`}>
                          {isMe && (
                            <div className="flex justify-end mb-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                msg.sent_by
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                                  : 'bg-green-500/20 text-green-300 border border-green-400/30'
                              }`}>
                                {msg.sent_by
                                  ? <><User className="w-2.5 h-2.5" /> {msg.sent_by}</>
                                  : <><Bot className="w-2.5 h-2.5" /> Glória (IA)</>}
                              </span>
                            </div>
                          )}
                          <div className={`p-3 rounded-2xl shadow-sm text-sm leading-relaxed
                             ${isMe 
                               ? 'bg-[#E2FFC7] text-gray-900 rounded-tr-none' 
                               : 'bg-white text-gray-900 rounded-tl-none'
                             }`}>
                             {msg.media_file_id ? (
                                 <div className="mb-2">
                                     {msg.type === 'IMAGE' ? (
                                         <div className="space-y-2">
                                             <img src={msg.media_file_id} alt="Media" className="rounded-lg max-w-full h-auto border border-white/20" />
                                             <div className="flex justify-end">
                                                 <a
                                                     href={msg.media_file_id}
                                                     download
                                                     target="_blank"
                                                     rel="noopener noreferrer"
                                                     className="inline-flex items-center gap-1 rounded-md bg-black/10 px-2 py-1 text-xs text-gray-700 hover:bg-black/20"
                                                 >
                                                     <Download className="w-3 h-3" /> Salvar imagem
                                                 </a>
                                             </div>
                                         </div>
                                     ) : msg.type === 'AUDIO' ? (
                                         <audio controls className="w-full min-w-[200px] h-10 rounded">
                                             <source src={msg.media_file_id} type="audio/ogg" />
                                             <source src={msg.media_file_id} type="audio/mpeg" />
                                             <source src={msg.media_file_id} type="audio/webm" />
                                         </audio>
                                     ) : (
                                         <div className="flex items-center gap-2 bg-black/5 p-2 rounded-lg">
                                             <Paperclip className="w-4 h-4" />
                                             <span>Arquivo de mídia ({msg.type})</span>
                                             <a href={msg.media_file_id} target="_blank" className="underline text-xs opacity-70 hover:text-blue-600">Abrir</a>
                                         </div>
                                     )}
                                     {msg.text && (
                                     <div className="mt-2">
                                         <ReactMarkdown
                                             components={{
                                                 a: ({node, ...props}) => (
                                                     <a 
                                                         {...props} 
                                                         target="_blank" 
                                                         rel="noopener noreferrer" 
                                                         className="font-bold hover:underline text-blue-600"
                                                         style={{wordBreak: 'break-all'}}
                                                     />
                                                 ),
                                                 p: ({node, ...props}) => <p {...props} className="mb-1 last:mb-0" />
                                             }}
                                         >
                                             {msg.text}
                                         </ReactMarkdown>
                                     </div>
                                 )}
                                 </div>
                             ) : (
                                 <div>
                                     {msg.text ? (
                                         <ReactMarkdown
                                             components={{
                                                 a: ({node, ...props}) => (
                                                     <a 
                                                         {...props} 
                                                         target="_blank" 
                                                         rel="noopener noreferrer" 
                                                         className="font-bold hover:underline text-blue-600"
                                                         style={{wordBreak: 'break-all'}}
                                                     />
                                                 ),
                                                 p: ({node, ...props}) => <p {...props} className="mb-1 last:mb-0" />
                                             }}
                                         >
                                             {msg.text}
                                         </ReactMarkdown>
                                     ) : (
                                         <details className="text-xs">
                                             <summary className="cursor-pointer italic text-gray-500 select-none">
                                                 ⚠️ Mensagem sem conteúdo de texto — clique para ver o payload bruto da Z-API
                                             </summary>
                                             <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-2 text-[10px] text-gray-700">
                                                 {msg.raw_payload ? JSON.stringify(msg.raw_payload, null, 2) : '(sem raw_payload)'}
                                             </pre>
                                         </details>
                                     )}
                                 </div>
                             )}
                           </div>
                           <div className={`text-[10px] text-gray-400 mt-1 flex items-center gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                               {formatDateTime(msg.created_date)}
                               {isMe && (
                                   msg.status === 'READ' ? <CheckCheck className="w-3 h-3 text-blue-400" /> : <Check className="w-3 h-3" />
                               )}
                           </div>
                         </div>
                       </div>
                   );
               })}
               <div ref={messagesEndRef} />
            </div>
    
            {/* Input Area */}
            <div className="p-4 bg-black/20 border-t border-white/10 relative">
               {!activeConversation.handoff_required && (
                 <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <p className="text-white text-sm font-medium mb-2 flex items-center gap-2">
                        <Bot className="w-4 h-4 text-green-500" /> A IA está no controle deste atendimento
                    </p>
                    <button 
                         onClick={async () => {
                             const metadata = { ...(activeConversation.metadata || {}), handoff_source: 'human' };
                             await base44.entities.Conversation.update(activeConversation.id, { handoff_required: true, metadata });
                             setActiveConversation(prev => ({ ...prev, handoff_required: true, metadata }));
                         }}
                         className="px-4 py-2 bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 rounded-lg text-sm font-medium transition-colors border border-orange-600/30 flex items-center gap-2"
                     >
                         <User className="w-4 h-4" /> Assumir Conversa para Responder
                    </button>
                 </div>
               )}
               {/* Quick Replies & Features Bar */}
               <div className="flex gap-2 mb-3 overflow-x-auto pb-1 custom-scrollbar">
                   <Popover open={showQuickReplies} onOpenChange={setShowQuickReplies}>
                       <PopoverTrigger asChild>
                           <button className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs text-gray-300 border border-white/10 transition-colors whitespace-nowrap">
                               <Zap className="w-3 h-3 text-yellow-400" /> Respostas Rápidas
                           </button>
                       </PopoverTrigger>
                       <PopoverContent className="w-72 p-2 bg-[#1a0b36] border-white/10 text-white mb-2">
                           <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                               {quickReplies.map((reply, i) => (
                                   <div key={i} className="flex items-center gap-1 group">
                                       <button 
                                           onClick={() => sendQuickReply(reply.text)}
                                           className="flex-1 text-left p-2 hover:bg-white/10 rounded text-sm text-gray-200"
                                       >
                                           {reply.text}
                                       </button>
                                       {reply.id && (
                                           <button 
                                               onClick={async (e) => {
                                                   e.stopPropagation();
                                                   try {
                                                       await base44.entities.QuickReply.delete(reply.id);
                                                       setQuickReplies(prev => prev.filter(r => r.id !== reply.id));
                                                   } catch (err) {}
                                               }}
                                               className="opacity-0 group-hover:opacity-100 p-2 text-gray-500 hover:text-red-400 transition-opacity rounded hover:bg-white/10 shrink-0"
                                               title="Excluir resposta"
                                           >
                                               <X className="w-3 h-3" />
                                           </button>
                                       )}
                                   </div>
                               ))}
                           </div>
                           <div className="mt-2 pt-2 border-t border-white/10 flex gap-2">
                               <input 
                                   value={newQuickReply}
                                   onChange={(e) => setNewQuickReply(e.target.value)}
                                   onKeyDown={(e) => {
                                       if (e.key === 'Enter') handleAddQuickReply();
                                   }}
                                   placeholder="Nova resposta rápida..."
                                   className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#FF6600]/50"
                               />
                               <button 
                                   onClick={handleAddQuickReply}
                                   disabled={!newQuickReply.trim()}
                                   className="bg-[#FF6600] text-white p-1.5 rounded-lg hover:bg-[#ff7b24] disabled:opacity-50 transition-colors flex items-center justify-center shrink-0"
                               >
                                   <Plus className="w-4 h-4" />
                               </button>
                           </div>
                       </PopoverContent>
                   </Popover>
               </div>

               <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-2xl p-2 focus-within:border-[#FF6600]/50 focus-within:bg-white/10 transition-all relative">
                  <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      onChange={handleFileUpload} 
                  />
                  
                  <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3 text-gray-400 hover:text-white transition-colors rounded-xl hover:bg-white/10"
                      title="Enviar Arquivo"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>

                  <Popover open={showEmojis} onOpenChange={setShowEmojis}>
                      <PopoverTrigger asChild>
                          <button className="p-3 text-gray-400 hover:text-white transition-colors rounded-xl hover:bg-white/10">
                            <Smile className="w-5 h-5" />
                          </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2 bg-[#1a0b36] border-white/10 text-white" align="start" side="top">
                          <div className="grid grid-cols-6 gap-2">
                              {emojis.map(emoji => (
                                  <button 
                                      key={emoji} 
                                      onClick={() => addEmoji(emoji)}
                                      className="text-xl p-1 hover:bg-white/10 rounded"
                                  >
                                      {emoji}
                                  </button>
                              ))}
                          </div>
                      </PopoverContent>
                  </Popover>

                  <textarea 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                        }
                    }}
                    placeholder="Digite sua mensagem..." 
                    className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder:text-gray-500 resize-none max-h-32 py-3 min-h-[48px]"
                    rows={1}
                  />

                  {inputText.trim() ? (
                      <button 
                        onClick={() => handleSendMessage()}
                        className="p-3 bg-[#FF6600] hover:bg-[#ff7b24] text-white rounded-xl shadow-lg shadow-orange-500/20 transition-all"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                  ) : (
                      <button 
                        onClick={isRecording ? stopRecording : startRecording}
                        className={`p-3 rounded-xl transition-all ${
                            isRecording 
                            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' 
                            : 'text-gray-400 hover:text-white hover:bg-white/10'
                        }`}
                        title={isRecording ? "Parar Gravação" : "Gravar Áudio"}
                      >
                        {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      </button>
                  )}
               </div>
               <div className="text-center mt-2 text-xs text-gray-500">
                  {isRecording ? "Gravando... Clique para parar e enviar" : "Enter para enviar • Shift + Enter para quebra de linha"}
               </div>
            </div>
          </div>
      ) : (
          <div className="flex-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl flex flex-col items-center justify-center text-center p-8">
              <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 animate-pulse">
                  <div className="w-16 h-16 bg-[#FF6600]/20 rounded-full flex items-center justify-center">
                      <Send className="w-8 h-8 text-[#FF6600]" />
                  </div>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Selecione uma conversa</h3>
              <p className="text-gray-400 max-w-sm">
                  Escolha um cliente na lista ao lado para visualizar o histórico e enviar mensagens.
              </p>
          </div>
      )}
    </div>
  );
}