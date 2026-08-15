import type { ReactElement, ReactNode } from "react";
import { PaperProvider } from "react-native-paper";
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
export function renderWithPaper(ui: ReactElement) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <PaperProvider>
      {children}
      <SimplePortalHost />
    </PaperProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
