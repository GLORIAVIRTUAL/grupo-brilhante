import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          // Sem token não há sessão: tenta recuperá-la via me() e, se falhar, manda para o login.
          await checkUserAuth();
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      // Now check if the user is authenticated
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      let access = {};
      try {
        const accessResponse = await base44.functions.invoke('check_access_session', {});
        access = accessResponse?.data || {};
      } catch (accessError) {
        const accessCode = accessError?.response?.data?.code || accessError?.data?.code;
        // Bloqueios reais de segurança continuam interrompendo o acesso.
        if (['ACCOUNT_BLOCKED', 'MFA_REQUIRED', 'SESSION_REVOKED'].includes(accessCode)) throw accessError;
        console.warn('Falha ao validar política de acesso; usando papel do usuário.', accessCode);
        access = {};
      }
      setUser({
        ...currentUser,
        effective_permissions: access.permissions || currentUser.permissions || [],
        effective_unit_ids: access.unit_ids || [],
        access_revision: access.access_revision || currentUser.access_revision || 1,
      });
      setAuthError(null);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);

      // Transient errors (rate limit, network, server errors) must NOT log the user out.
      // Only real auth errors (401/403) should clear the session.
      const status = error?.status || error?.response?.status;
      const accessCode = error?.response?.data?.code || error?.data?.code;
      if (['ACCOUNT_BLOCKED', 'MFA_REQUIRED', 'SESSION_REVOKED'].includes(accessCode)) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({
          type: 'access_blocked',
          code: accessCode,
          message: error?.response?.data?.error || 'Acesso bloqueado pela política de segurança.',
        });
        return;
      }
      const isTransient = status === 429 || status === 0 || status >= 500 || !status;

      if (isTransient) {
        console.warn('Transient access-policy error — blocking protected routes and retrying soon.', status);
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({
          type: 'access_unavailable',
          message: 'Não foi possível validar sua política de acesso neste momento. Tentaremos novamente automaticamente.',
        });
        setTimeout(() => { checkUserAuth(); }, 3000);
        return;
      }

      setIsAuthenticated(false);
      setUser(null);
      if (status === 401 || status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      } else {
        // Qualquer outra falha precisa ser visível em vez de renderizar o app sem usuário.
        setAuthError({
          type: 'access_unavailable',
          message: `Não foi possível carregar seu perfil (${status || 'sem status'}): ${error?.message || 'erro desconhecido'}`,
        });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};