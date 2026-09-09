import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { 
  LayoutDashboard, 
  MessageSquare, 
  ShoppingBag, 
  Users, 
  Settings, 
  LogOut,
  Globe,
  HelpCircle,
  Send,
  Truck,
  Volume2,
  VolumeX,
  PieChart,
  Banknote,
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  Network,
  Megaphone,
  Building2,
  ChevronDown,
  TrendingUp
} from 'lucide-react';
import NotificationsMenu from '@/components/layout/NotificationsMenu';
import { hasPermission } from '@/lib/accessControl';
import { useAuth } from '@/lib/AuthContext';
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('soundEnabled');
    return saved !== null ? saved === 'true' : true;
  });
  const soundEnabledRef = React.useRef(soundEnabled);
  const marketingPaths = ['/campanhas', '/campanhasrede', '/trafego', '/trafegogoogle', '/prospeccao'];
  const [marketingOpen, setMarketingOpen] = useState(() => marketingPaths.includes(location.pathname));
  
  // Using reliable notification sounds
  const audioRef = React.useRef(new Audio("https://cdnjs.cloudflare.com/ajax/libs/ion-sound/3.0.7/sounds/glass.mp3"));
  const successAudioRef = React.useRef(new Audio("https://actions.google.com/sounds/v1/cartoon/magic_chime.ogg"));
  const alertAudioRef = React.useRef(new Audio("https://cdnjs.cloudflare.com/ajax/libs/ion-sound/3.0.7/sounds/computer_error.mp3"));

  useEffect(() => {
    document.documentElement.lang = 'pt-BR';
    document.documentElement.setAttribute('translate', 'no');
    document.body.setAttribute('translate', 'no');
    document.body.classList.add('notranslate');
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const toggleSound = () => {
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    localStorage.setItem('soundEnabled', String(newVal));
    if (newVal) {
      audioRef.current.volume = 0;
      audioRef.current.play().then(() => {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.volume = 1;
      }).catch(e => console.warn("Audio play blocked", e));
    }
  };

  useEffect(() => {
    // Subscribe to new messages for notifications
    const unsubMessages = base44.entities.Message.subscribe((event) => {
        if (event.type === 'create' && event.data.direction === 'IN') {
            // Play sound
            if (soundEnabledRef.current) {
                audioRef.current.play().catch(e => console.warn("Audio play blocked", e));
            }
            
            // Show notification
            toast("Nova mensagem recebida", {
                description: event.data.text || "Mídia recebida",
                action: {
                    label: "Ver Chat",
                    onClick: () => navigate('/chat')
                },
                duration: 5000,
                className: "bg-[#4C12A1] border-white/10 text-white shadow-lg shadow-purple-900/50",
                descriptionClassName: "text-gray-300",
                actionButtonStyle: { background: "#FF6600", color: "white" },
                icon: <MessageSquare className="w-5 h-5 text-[#FF6600]" />,
            });

            // Update badge if not currently on chat page
            if (location.pathname !== '/chat') {
                setUnreadCount(prev => prev + 1);
            }
        }
    });

    // Subscribe to quotes that need human review and approved quotes
    const unsubQuotes = base44.entities.Quote.subscribe((event) => {
        if ((event.type === 'create' && event.data.status === 'HUMAN_REVIEW') || 
            (event.type === 'update' && event.data.status === 'HUMAN_REVIEW' && (/** @type {any} */ (event)).old_data?.status !== 'HUMAN_REVIEW')) {
            
            // Play sound
            if (soundEnabledRef.current) {
                audioRef.current.play().catch(e => console.warn("Audio play blocked", e));
            }
            
            // Show notification
            toast.warning("Revisão de Orçamento", {
                description: "Um novo orçamento precisa da sua revisão.",
                action: {
                    label: "Ver Pedidos",
                    onClick: () => navigate('/orders')
                },
                duration: 8000,
            });
        }

        if (event.type === 'update' && event.data.status === 'ACCEPTED' && (/** @type {any} */ (event)).old_data?.status !== 'ACCEPTED') {
            // Play success sound
            if (soundEnabledRef.current) {
                successAudioRef.current.play().catch(e => console.warn("Audio play blocked", e));
            }
            
            // Show notification
            toast.success("Orçamento Aprovado! 🎉", {
                description: "Um cliente acabou de aprovar um orçamento.",
                action: {
                    label: "Ver Pedidos",
                    onClick: () => navigate('/orders')
                },
                duration: 10000,
            });
        }
    });

    // Subscribe to confirmed payments (new sales)
    const unsubPayments = base44.entities.Payment.subscribe((event) => {
        const becameSucceeded =
            (event.type === 'create' && event.data.status === 'succeeded') ||
            (event.type === 'update' && event.data.status === 'succeeded' && (/** @type {any} */ (event)).old_data?.status !== 'succeeded');

        if (becameSucceeded) {
            // Play success sound
            if (soundEnabledRef.current) {
                successAudioRef.current.play().catch(e => console.warn("Audio play blocked", e));
            }

            // Show notification
            toast.success("Nova Venda! 🎉", {
                description: `Venda confirmada no valor de R$ ${Number(event.data.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
                action: {
                    label: "Ver Gestão",
                    onClick: () => navigate('/Management')
                },
                duration: 10000,
                className: "bg-green-600 border-green-500 text-white shadow-lg shadow-green-900/50",
                descriptionClassName: "text-green-100",
                actionButtonStyle: { background: "white", color: "#16a34a" },
                icon: <TrendingUp className="w-5 h-5 text-white" />
            });
        }
    });

    // Subscribe to staff notifications for complaints
    const unsubNotifications = base44.entities.StaffNotification.subscribe((event) => {
        if (event.type === 'create' && event.data.type === 'COMPLAINT') {
            // Play alert sound
            if (soundEnabledRef.current) {
                alertAudioRef.current.play().catch(e => console.warn("Audio play blocked", e));
            }
            
            // Show notification
            toast("Nova Reclamação 🚨", {
                description: `Cliente: ${event.data.payload?.customer_name || 'Desconhecido'} relatou um problema.`,
                action: {
                    label: "Ver Reclamação",
                    onClick: () => navigate('/orders')
                },
                duration: 15000,
                className: "bg-red-600 border-red-500 text-white shadow-lg shadow-red-900/50",
                descriptionClassName: "text-red-100",
                actionButtonStyle: { background: "white", color: "red" },
                icon: <AlertCircle className="w-5 h-5 text-white" />
            });
        }

        if (event.type === 'create' && event.data.type === 'NEW_IMAGES') {
            // Play sound
            if (soundEnabledRef.current) {
                audioRef.current.play().catch(e => console.warn("Audio play blocked", e));
            }
            
            // Show notification
            toast("Novas Imagens para Análise 📸", {
                description: `Cliente: ${event.data.payload?.customer_name || 'Desconhecido'} enviou ${event.data.payload?.image_count || 'novas'} peça(s).`,
                action: {
                    label: "Ver Chat",
                    onClick: () => navigate('/chat')
                },
                duration: 10000,
                className: "bg-[#4C12A1] border-white/10 text-white shadow-lg shadow-purple-900/50",
                descriptionClassName: "text-gray-300",
                actionButtonStyle: { background: "#FF6600", color: "white" },
                icon: <ImageIcon className="w-5 h-5 text-[#FF6600]" />
            });
        }
    });

    return () => {
        unsubMessages();
        unsubQuotes();
        unsubPayments();
        unsubNotifications();
    };
  }, [location.pathname, navigate]);

  // Reset unread count when visiting chat
  useEffect(() => {
    if (location.pathname === '/chat') {
        setUnreadCount(0);
    }
  }, [location.pathname]);

  useEffect(() => {
    const hostname = window.location.hostname;
    const isMainDomain = hostname === 'chat5asec.com.br' || hostname === 'www.chat5asec.com.br';
    if (location.pathname === '/') {
      navigate(isMainDomain ? '/landing' : ['entregador', 'coletas', 'driver'].includes(user?.role) ? '/pickups' : '/dashboard');
      return;
    }
    const publicRoutes = ['/landing', '/landing-page', '/login', '/register-unit', '/PaymentSuccess'];
    const isPublic = publicRoutes.some((route) => location.pathname.startsWith(route));
    if (!isPublic && ['entregador', 'coletas', 'driver'].includes(user?.role) && location.pathname !== '/pickups' && location.pathname !== '/customers') {
      navigate('/pickups');
    }
  }, [location.pathname, navigate, user?.role]);

  // Check for Public Pages (Landing, Register) and Admin Pages (Full Screen)
  // Added /login to this list
  const isPublicOrAdminPage = ['/landing', '/landing-page', '/admin', '/register-unit', '/login', '/PaymentSuccess'].some(route => location.pathname.startsWith(route)) || location.pathname === '/';
  
  if (isPublicOrAdminPage) {
    return <main>{children}</main>;
  }

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', roles: ['admin', 'user', 'super_admin', 'manager', 'attendant', 'cashier', 'production', 'inventory', 'finance', 'auditor'] },
    { icon: MessageSquare, label: 'Chat IA & Humano', path: '/chat', roles: ['admin', 'user', 'super_admin', 'manager', 'attendant'], permissions: ['crm.manage', 'customers.manage', 'quotes.manage'] },
    { icon: ShoppingBag, label: 'Pedidos (CRM)', path: '/orders', roles: ['admin', 'user', 'super_admin', 'manager', 'attendant', 'cashier', 'production', 'driver', 'inventory', 'finance', 'auditor'], permissions: ['orders.view', 'quotes.manage'] },
    { icon: Users, label: 'Clientes', path: '/customers', roles: ['admin', 'user', 'super_admin', 'manager', 'attendant'], permissions: ['crm.manage', 'customers.manage'] },
    { icon: Truck, label: 'Coletas', path: '/pickups', roles: ['admin', 'user', 'super_admin', 'manager', 'attendant', 'driver', 'entregador', 'coletas'], permissions: ['pickups.manage', 'delivery.manage', 'field_route.execute', 'fleet.manage'] },
    { icon: Banknote, label: 'Gestão', path: '/Management', roles: ['admin', 'user', 'super_admin', 'manager', 'attendant', 'cashier', 'production', 'inventory', 'finance', 'auditor'], permissions: ['orders.view', 'quotes.manage', 'payments.receive', 'payments.confirm', 'cash.manage', 'production.manage', 'inventory.manage', 'finance.approve', 'billing.manage', 'fiscal.manage'] },
    { icon: PieChart, label: 'Relatórios', path: '/reports', roles: ['admin', 'super_admin', 'manager', 'finance', 'auditor', 'inventory'], permissions: ['reports.view', 'reports.view_all', 'reports.finance', 'reports.stock'] },
    { icon: Settings, label: 'Configurações', path: '/settings', roles: ['admin', 'user', 'super_admin', 'manager'], permissions: ['settings.manage', 'users.manage', 'prices.manage', 'catalogs.manage', 'loyalty.manage'] },
  ].filter((item) => item.permissions?.length
    ? item.permissions.some((permission) => hasPermission(user, permission))
    : item.roles.includes(user?.role || ''));

  const marketingItems = [
    { icon: Sparkles, label: 'Campanhas', path: '/campanhas' },
    { icon: Network, label: 'Campanhas da Rede', path: '/campanhasrede' },
    { icon: Megaphone, label: 'Tráfego Meta', path: '/trafego' },
    { icon: Megaphone, label: 'Tráfego Google', path: '/trafegogoogle' },
    { icon: Building2, label: 'Prospecção', path: '/prospeccao' },
  ];
  const showMarketing = ['super_admin', 'admin'].includes(user?.role || '');

  const publicLinks = [
     { icon: Globe, label: 'Ver Site Público', path: '/landing' },
  ];

  return (
    <div className="min-h-screen bg-[#1a0b36] text-white font-sans selection:bg-[#FF6600] selection:text-white overflow-x-hidden relative">
      {/* Background Elements for depth */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#4C12A1] blur-[150px] opacity-40 pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[#FF6600] blur-[150px] opacity-20 pointer-events-none" />

      <div className="flex min-h-screen relative z-10">
        {/* Sidebar */}
        <aside className="w-20 lg:w-72 min-h-screen bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col transition-all duration-300">
          <div className="px-3 py-4 flex items-center justify-center lg:justify-start gap-3">
            <img 
              src="https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/250769bd5_ChatGPTImage3desetde202619_33_19.png"
              alt="GLÓRIA LAUNDRY 5àSec"
              className="h-32 w-full max-w-[260px] object-contain"
            />
          </div>

          <nav className="flex-1 mt-8 px-3 space-y-2">
            {menuItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group relative
                    ${isActive 
                      ? 'bg-gradient-to-r from-[#4C12A1] to-[#6a1cb3] shadow-lg shadow-purple-900/30 border border-white/10' 
                      : 'hover:bg-white/5 text-gray-400 hover:text-white'
                    }`}
                >
                  <div className="relative">
                      <item.icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-[#FF6600] transition-colors'}`} />
                      {item.path === '/chat' && unreadCount > 0 && (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border border-[#1a0b36]" />
                      )}
                  </div>
                  <span className="hidden lg:block font-medium flex-1">
                      {item.label}
                      {item.path === '/chat' && unreadCount > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 bg-red-500 text-white text-[10px] rounded-full font-bold">
                              {unreadCount}
                          </span>
                      )}
                  </span>
                  {isActive && (
                    <motion.div 
                      layoutId="activeIndicator"
                      className="absolute left-0 w-1 h-8 bg-[#FF6600] rounded-r-full hidden lg:block" 
                    />
                  )}
                </Link>
              );
            })}

            {(!user || ['super_admin', 'admin', 'manager', 'user'].includes(user?.role || 'user')) && (
              <Link
                to="/dispatches"
                className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group relative border
                  ${location.pathname === '/dispatches'
                    ? 'bg-gradient-to-r from-[#4C12A1] to-[#6a1cb3] shadow-lg shadow-purple-900/30 border-white/10'
                    : 'bg-[#FF6600]/15 border-[#FF6600]/30 text-gray-200 hover:bg-[#FF6600]/25 hover:text-white'
                  }`}
              >
                <Send className={`w-5 h-5 ${location.pathname === '/dispatches' ? 'text-white' : 'text-[#FF6600]'}`} />
                <span className="hidden lg:block font-medium flex-1">Disparos</span>
              </Link>
            )}

            {showMarketing && (
              <div>
                <button
                  onClick={() => setMarketingOpen(prev => !prev)}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group relative w-full border
                    ${marketingPaths.includes(location.pathname)
                      ? 'bg-gradient-to-r from-[#4C12A1] to-[#6a1cb3] shadow-lg shadow-purple-900/30 border-white/10'
                      : 'bg-green-400/15 border-green-400/30 hover:bg-green-400/25 text-gray-200 hover:text-white'
                    }`}
                >
                  <Megaphone className={`w-5 h-5 ${marketingPaths.includes(location.pathname) ? 'text-white' : 'text-green-400 transition-colors'}`} />
                  <span className="hidden lg:block font-medium flex-1 text-left">Marketing</span>
                  <ChevronDown className={`w-4 h-4 hidden lg:block transition-transform ${marketingOpen ? 'rotate-180' : ''}`} />
                </button>

                {marketingOpen && (
                  <div className="mt-1 lg:ml-3 lg:pl-3 lg:border-l border-white/10 space-y-1">
                    {marketingItems.map((sub) => {
                      const isActive = location.pathname === sub.path;
                      return (
                        <Link
                          key={sub.path}
                          to={sub.path}
                          className={`flex items-center gap-3 p-2.5 rounded-xl transition-all duration-200 group
                            ${isActive
                              ? 'bg-white/10 text-white'
                              : 'hover:bg-white/5 text-gray-400 hover:text-white'
                            }`}
                        >
                          <sub.icon className={`w-4 h-4 ${isActive ? 'text-[#FF6600]' : 'text-gray-400 group-hover:text-[#FF6600] transition-colors'}`} />
                          <span className="hidden lg:block font-medium text-sm">{sub.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

             <div className="pt-4 mt-4 border-t border-white/10">
                 <p className="px-3 text-xs font-semibold text-gray-500 uppercase mb-2 hidden lg:block">Links Públicos</p>
                 {publicLinks.map((item) => (
                    <Link
                        key={item.path}
                        to={item.path}
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white transition-all duration-200 group"
                    >
                        <item.icon className="w-5 h-5 text-gray-400 group-hover:text-[#FF6600] transition-colors" />
                        <span className="hidden lg:block font-medium">{item.label}</span>
                    </Link>
                 ))}
             </div>
          </nav>

          <div className="p-4 border-t border-white/10 space-y-1">
            <a 
              href="https://wa.me/5587988020504" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-[#25D366]/10 text-gray-400 hover:text-[#25D366] transition-all group"
            >
              <HelpCircle className="w-5 h-5 group-hover:text-[#25D366]" />
              <span className="hidden lg:block">Suporte</span>
            </a>
            
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem('cachedUser');
                } catch {
                  // O SDK ainda encerra a sessão mesmo se o storage estiver indisponível.
                }
                logout(true);
              }}
              className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white transition-all"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden lg:block">Sair</span>
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-h-screen overflow-y-auto overflow-x-hidden relative flex flex-col">
        {/* Top Header */}
        <header className="h-16 px-8 flex items-center justify-end border-b border-white/5 bg-white/5 backdrop-blur-xl sticky top-0 z-20">
            <div className="flex items-center gap-4">
                <button 
                    onClick={toggleSound}
                    className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    title={soundEnabled ? "Desativar notificações sonoras" : "Ativar notificações sonoras"}
                >
                    {soundEnabled ? <Volume2 className="w-5 h-5 text-[#FF6600]" /> : <VolumeX className="w-5 h-5" />}
                </button>
                <NotificationsMenu />
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#FF6600] to-yellow-500 flex items-center justify-center text-xs font-bold shadow-lg shadow-orange-500/20">
                    AD
                </div>
            </div>
        </header>

        <div className="p-4 md:p-8 max-w-7xl mx-auto w-full flex-1">
          {children}
          <Toaster position="top-right" theme="dark" richColors />
        </div>

          <footer className="py-6 text-center text-xs text-gray-500 border-t border-white/5 bg-black/20">
            Desenvolvido por <a href="https://gloriavirtual.com" target="_blank" rel="noopener noreferrer" className="text-[#FF6600] hover:underline">gloriavirtual.com</a>
          </footer>
          </main>
      </div>
    </div>
  );
}