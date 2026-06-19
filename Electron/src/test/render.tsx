import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";

// Bileşen testleri için provider sarmalayıcı — react-query'li bileşenleri
// (mutation/query) izole bir QueryClient ile render eder (retry kapalı → testte
// hata anında bekleme yok). Üretimde her sayfa bir router (sekme memory-router)
// içinde yaşar; bileşenler router hook'larını (useLocation/useSearchParams,
// useScanSeed) güvenle çağırabilsin diye MemoryRouter ile de sarılır.
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
