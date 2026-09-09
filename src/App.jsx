import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import DownloadReport from '@/pages/DownloadReport';
import Apresentacao from '@/pages/Apresentacao';
import Prospeccao from '@/pages/Prospeccao';
import { MachineProvider } from '@/components/dashboard/MachineContext';
import { hasPermission } from '@/lib/accessControl';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const PAGE_PERMISSION_OPTIONS = {
  Admin: ['users.manage', 'settings.manage'],
  Campanhas: ['settings.manage'],
  CampanhasRede: ['settings.manage'],
  Trafego: ['settings.manage'],
  trafegogoogle: ['settings.manage'],
  Chat: ['crm.manage', 'customers.manage', 'quotes.manage'],
  ChatCustomers: ['crm.manage', 'customers.manage'],
  Orders: ['orders.view', 'quotes.manage'],
  Dispatches: ['delivery.manage', 'pickups.manage', 'field_route.execute', 'fleet.manage'],
  'register-unit': ['settings.manage'],
  Settings: ['settings.manage', 'users.manage', 'prices.manage', 'catalogs.manage', 'loyalty.manage'],
  Reports: ['reports.view', 'reports.view_all', 'reports.finance', 'reports.stock'],
  Management: ['orders.view', 'quotes.manage', 'payments.receive', 'payments.confirm', 'cash.manage', 'production.manage', 'inventory.manage', 'finance.approve', 'billing.manage', 'fiscal.manage'],
  Customers: ['customers.manage', 'crm.manage'],
  Pickups: ['pickups.manage', 'delivery.manage', 'field_route.execute', 'fleet.manage'],
};

const PageAccessGuard = ({ pageName, user, children }) => {
  const required = PAGE_PERMISSION_OPTIONS[pageName];
  if (!required?.length || required.some((permission) => hasPermission(user, permission))) return children;
  return (
    <div className="mx-auto mt-20 max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">
      <h1 className="text-xl font-semibold">Acesso restrito</h1>
      <p className="mt-2 text-sm text-white/60">Seu perfil não possui permissão para acessar esta página.</p>
    </div>
  );
};

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, logout, checkAppState } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  if (authError?.type === 'access_unavailable') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#120a24] px-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-amber-400/20 bg-white/5 p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-semibold">Validação de acesso indisponível</h1>
          <p className="mt-3 text-sm text-white/70">{authError.message}</p>
          <button type="button" onClick={checkAppState} className="mt-6 rounded-lg bg-[#FF6600] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#e55c00]">
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (authError?.type === 'access_blocked') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#120a24] px-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-semibold">Acesso protegido</h1>
          <p className="mt-3 text-sm text-white/70">{authError.message}</p>
          <p className="mt-2 text-xs text-white/50">
            {authError.code === 'MFA_REQUIRED'
              ? 'Conclua a verificação multifator no provedor de identidade ou solicite suporte ao administrador.'
              : authError.code === 'SESSION_REVOKED'
                ? 'Sua sessão foi revogada. Encerre-a e entre novamente.'
                : 'Solicite ao administrador a revisão do seu acesso.'}
          </p>
          <button type="button" onClick={() => logout(true)} className="mt-6 rounded-lg bg-[#FF6600] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#e55c00]">
            Encerrar sessão
          </button>
        </div>
      </div>
    );
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <PageAccessGuard pageName={path} user={user}>
                <Page />
              </PageAccessGuard>
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/prospeccao" element={
        <LayoutWrapper currentPageName="Prospeccao">
          <Prospeccao />
        </LayoutWrapper>
      } />
      <Route path="/apresentacao" element={<Apresentacao />} />
      <Route path="/download-report" element={
        <LayoutWrapper currentPageName="download-report">
          <DownloadReport />
        </LayoutWrapper>
      } />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  useEffect(() => {
    document.documentElement.lang = 'pt-BR';
    document.documentElement.setAttribute('translate', 'no');
    document.body.setAttribute('translate', 'no');
    document.body.classList.add('notranslate');
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <MachineProvider>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </MachineProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App