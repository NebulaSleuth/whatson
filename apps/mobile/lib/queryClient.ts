import { QueryClient } from '@tanstack/react-query';

/** App-wide react-query client (shared so helpers like forgetServer can reset it). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,       // Data is fresh for 2 minutes
      gcTime: 10 * 60 * 1000,          // Keep unused data for 10 minutes
      refetchOnWindowFocus: true,       // Refetch when app comes to foreground
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});
