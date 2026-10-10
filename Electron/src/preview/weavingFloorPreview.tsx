// YALNIZ GELİŞTİRME önizlemesi: Tezgah Salonu'nu girişsiz açar (ekran görüntüsü ve
// tasarım incelemesi; `?kip=tv` TV kipi). `preview-weaving-floor.html` derleme girdisi değildir; üretimde atar.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { WeavingFloorView } from "@/pages/Operations/WeavingFloor/WeavingFloorView";
import { useLoomFloorMock } from "@/pages/Operations/WeavingFloor/mock/useLoomFloorMock";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "../index.css";

if (!import.meta.env.DEV) throw new Error("Önizleme yalnız geliştirme kipinde açılır.");

const params = new URLSearchParams(window.location.search);
const theme = params.get("tema") === "koyu" ? "dark" : "light";
// `?kip=tv` salon TV'si kipini açar (gerçekte ayrı bağlantı + TV hesabı — sonraki dilim).
const tv = params.get("kip") === "tv";
const routePath = "/operations/weaving-floor";

/** Örnek veri yalnız burada: uygulamadaki ekran `GET /api/loom-floor` okur. */
function MockFloor() {
  const { floor, now, sampleData } = useLoomFloorMock();
  return <WeavingFloorView floor={floor} now={now} sampleData={sampleData} tv={tv} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <PreferencesProvider>
          <MemoryRouter initialEntries={[routePath]}>
            <div className="h-screen">
              <Routes>
                <Route path={routePath} element={<MockFloor />} />
              </Routes>
            </div>
          </MemoryRouter>
        </PreferencesProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
