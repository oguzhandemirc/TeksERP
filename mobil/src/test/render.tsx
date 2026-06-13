import type { ReactElement, ReactNode } from "react";
import { PaperProvider } from "react-native-paper";
import { render } from "@testing-library/react-native";

// Mobil bileşen testleri için sarmalayıcı — react-native-paper bileşenleri
// (IconButton/Text/TouchableRipple) PaperProvider tema bağlamı ister.
export function renderWithPaper(ui: ReactElement) {
  const Wrapper = ({ children }: { children: ReactNode }) => <PaperProvider>{children}</PaperProvider>;
  return render(ui, { wrapper: Wrapper });
}
