import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { useTabsStore } from "@/store/tabs";
import { getTabRouter } from "./tab-routers";

/**
 * Tek bir sekmenin izole memory router'ını mount eder. Router örneği store'da
 * (openTab) kurulduğu için burada aynı önbelleğe alınmış örnek alınır — sekme
 * gizliyken bile mount kalır, böylece konum/scroll/sayfa durumu korunur.
 *
 * Ayrıca sekmenin KENDİ gezinmelerini (geri oku, breadcrumb, sayfa içi
 * `navigate()`) sekme defterine yansıtır: bunlar `navigateActive`'ten geçmediği
 * için eskiden sekme başlığı ile kenar menüsü eşleşmesi bayat kalıyordu (aynı
 * sekmede sipariş detayından listeye dönünce şerit hâlâ detayın adını yazıyordu).
 */
export function TabRouter({ id, path }: { id: string; path: string }) {
  const router = getTabRouter(id, path);
  const syncTabLocation = useTabsStore((s) => s.syncTabLocation);
  useEffect(
    () => router.subscribe((state) => syncTabLocation(id, state.location.pathname)),
    [router, id, syncTabLocation],
  );
  return <RouterProvider router={router} />;
}
