// Kullanıcı Tercihleri → "Bildirim tercihleri" kartı (N4-PANEL). Yalnız F4 sunucusunda görünür: katalog
// `hucreler` taşımıyorsa (eski backend) ya da bayrak kapalıysa kart çizilmez — ölü bağlantı yok.
import { BellRing, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNotificationCatalog, useNotificationInboxFlag } from "@/lib/bildirim/hooks";
import { useTabsStore } from "@/store/tabs";

export const NOTIFICATION_SETTINGS_PATH = "/settings/notifications";

export function useNotificationSettingsAvailable(): boolean {
  const { acik } = useNotificationInboxFlag();
  const katalog = useNotificationCatalog(acik);
  return acik && Array.isArray(katalog.data?.hucreler);
}

export function BildirimTercihKarti() {
  const gorunur = useNotificationSettingsAvailable();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  if (!gorunur) return null;
  return (
    <Card data-testid="bildirim-tercih-karti">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" /> Bildirim tercihleri
        </CardTitle>
        <CardDescription>Hangi bildirimlerin anlık, gün özetinde ya da hiç gelmeyeceği; masaüstü, tablet sesi, sessiz saat.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigateActive(NOTIFICATION_SETTINGS_PATH)}>
          Bildirim tercihlerini aç <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
