import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// Reaproveita dados já carregados por 2 min, evitando re-buscar tudo a cada navegação
			staleTime: 2 * 60 * 1000,
			// Mantém os dados em cache por 10 min mesmo sem componentes ativos
			gcTime: 10 * 60 * 1000,
		},
	},
});