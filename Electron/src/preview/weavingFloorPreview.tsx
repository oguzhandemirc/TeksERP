// YALNIZ GELİŞTİRME önizlemesi: Tezgah Salonu'nu girişsiz açar (ekran görüntüsü ve
// tasarım incelemesi; `?kip=tv` TV kipi). `preview-weaving-floor.html` derleme girdisi değildir; üretimde atar.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { WeavingFloorPage } from "@/pages/Operations/WeavingFloor/WeavingFloorPage";
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
const routePath = "/operations/weaving-orders/salon";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <PreferencesProvider>
          <MemoryRouter initialEntries={[routePath]}>
            <div className="h-screen">
              <Routes>
                <Route path={routePath} element={<WeavingFloorPage tv={tv} />} />
              </Routes>
            </div>
          </MemoryRouter>
        </PreferencesProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
