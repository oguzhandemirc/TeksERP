import type { ReactElement, ReactNode } from "react";
import { PaperProvider } from "react-native-paper";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import { SimplePortalHost } from "../components/SimplePortal";

// Mobil bileşen testleri için sarmalayıcı — react-native-paper bileşenleri
// (IconButton/Text/TouchableRipple) PaperProvider tema bağlamı ister.
//
// `SimplePortalHost` App.tsx'teki kök yerleşimin testteki karşılığı: AppModal
// içeriğini SimplePortal ile host'a TAŞIR, host yoksa hiçbir yerde çizilmez
// (modal testleri sessizce boşa düşerdi). Kayıt yokken host hiçbir şey render
// etmez → modal kullanmayan testlerin ağacı (ör. "null dönmeli" kontrolleri)
// değişmez.
// `QueryClientProvider` de aynı gerekçeyle burada: App.tsx kökünde var ve
// bileşenler (ör. RollCancelModal → useReasonPresets) veri çekmeye başladığında
// provider'sız ağaç "No QueryClient set" ile patlar. Her testte elle sarmak,
// unutulduğu ilk yerde testi bileşenin DAVRANIŞIYLA ilgisiz bir sebeple
// kırmızıya düşürürdü. `retry: false` + sessiz logger: ağ hatası bekleyen
// testler saniyelerce yeniden denemesin.
export function renderWithPaper(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PaperProvider>
        {children}
        <SimplePortalHost />
      </PaperProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
