import { Navigate } from "react-router-dom";
import { useFeatureFlags, useKursunBypassEnabled } from "@/hooks/usePricingEnabled";
import { KursunQueuePage } from "./KursunQueuePage";

/**
 * Kurşun Sırası ROUTE KAPISI — bypass düzeni AÇIKKEN ekran YOKTUR.
 *
 * Karoyu gizlemek yetmez: komut paleti ve doğrudan adres (`#/operations/
 * kursun-queue`) route'u yine açardı. Kuyruk sıralamasının (drag-drop priority)
 * tek tüketicisi kurşun TABLETİYDİ; bypass rejiminde kurşunda tablet yok, yani
 * sırayı okuyan kimse kalmıyor. İzleme ve acil işaretleme aynı sıralamayla
 * Kurşun Dağıtım ekranında yapılır → oraya değil, Operasyon hub'ına yönlendiririz
 * (kullanıcının `workorder:distribute` izni olmayabilir; hub yetkiye göre
 * hangi ekranın açık olduğunu zaten gösterir).
 *
 * Bayrak YÜKLENENE KADAR hiçbir şey render edilmez: `useKursunBypassEnabled`
 * varsayılanı `false` olduğu için bypass açık kurulumda ekran bir an açılır,
 * kuyruk isteği atar, sonra yönlenirdi (yanıp sönme + boşuna istek).
 */
export function KursunQueueRouteGate() {
  const flags = useFeatureFlags();
  const bypassEnabled = useKursunBypassEnabled();

  if (flags.isLoading) return null;
  if (bypassEnabled) return <Navigate to="/operations" replace />;
  return <KursunQueuePage />;
}
