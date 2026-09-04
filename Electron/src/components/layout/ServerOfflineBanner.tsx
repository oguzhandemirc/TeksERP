import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Radar, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useServerStatusStore } from "@/store/serverStatus";
import { useServerDiscovery } from "@/hooks/useServerDiscovery";
import { getActiveApiBaseUrl } from "@/lib/api-config";
import { connectToDiscoveredServer } from "@/lib/server-identity";
import { Button } from "@/components/ui/button";
import { ApiEndpointDialog } from "@/components/settings/ApiEndpointDialog";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * "Sunucuya ulaşılamıyor" şeridi + KENDİ KENDİNİ ONARMA.
 *
 * Bu bileşenin asıl değeri sarı bir uyarı göstermek değil: sunucunun adresi
 * değiştiyse (yeni IP, taşınan makine) **aynı kurulumu yeni adreste bulup
 * bağlantıyı geri getirmek**. Vardiyayı durduran bir kesinti böylece birkaç
 * saniyede kendini onarır ve kimse IP yazmaz.
 *
 * ⚠️ MODAL DEĞİL, ŞERİT. Kullanıcı yarım doldurulmuş bir formun başında olabilir;
 * ekranı kilitlemek girdisini kaybettirir.
 *
 * ⚠️ 20 SANİYE GECİKME bilinçli: tek bir başarısız istek (uçuşta kesilen bir
 * sorgu, uyanan bilgisayar) şerit basmamalı. Şerit "gerçekten kesildi" demek.
 *
 * ⚠️ OTOMATİK UYGULAMA YALNIZ KİMLİK TUTUYORSA. Uyuşmayan bir sunucuya sessizce
 * bağlanmak, operatörün yanlış fabrikanın verisine kayıt girmesi demektir.
 */
const OFFLINE_GRACE_MS = 20_000;

export function ServerOfflineBanner() {
  const status = useServerStatusStore((s) => s.status);
  const [visible, setVisible] = useState(false);
  const [searching, setSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const discovery = useServerDiscovery();

  useEffect(() => {
    if (status !== "offline") {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), OFFLINE_GRACE_MS);
    return () => clearTimeout(t);
  }, [status]);

  if (!visible) return null;

  const handleSearch = async (): Promise<void> => {
    setSearching(true);
    try {
      const state = await discovery.start(12000);
      const pinned = state?.pinnedInstallationId ?? null;
      const current = getActiveApiBaseUrl();
      const match = state?.candidates.find(
        (c) => c.matchesPinned === "match" && c.baseUrl !== current,
      );
      if (match && pinned) {
        await connectToDiscoveredServer(match);
        toast.success("Sunucu yeni adreste bulundu, bağlantı geri geldi.", {
          description: match.baseUrl,
        });
        setVisible(false);
        return;
      }
      const usable = state?.candidates.filter((c) => c.matchesPinned !== "mismatch") ?? [];
      if (usable.length > 0) {
        // Kimlik doğrulanamadı ya da birden çok aday var → KARAR KULLANICININ.
        setDialogOpen(true);
        return;
      }
      toast.error("Ağda sunucu bulunamadı.", {
        description: "Sunucu bilgisayarı kapalı olabilir ya da bu bilgisayar farklı bir ağda olabilir.",
      });
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1">
          {IS_ELECTRON
            ? "Sunucuya ulaşılamıyor. Kayıtlar gönderilemiyor."
            : "Fabrika sunucusuna ulaşılamıyor. Bağlantı geri gelince sayfa kendiliğinden çalışır."}
        </span>
        {/*
          ⚠️ İKİ DÜĞME DE YALNIZ MASAÜSTÜNDE (2026-09-04, ölçüldü). Tarayıcıda
          (uzaktan erişim / `dist-web`) ikisi de ZARARLI:
           • "Sunucuyu Ara" mDNS/alt ağ taramasıdır ve `window.api` olmadan HİÇ
             çalışmaz — her tıkta "Ağda sunucu bulunamadı" + *"bu bilgisayar farklı
             bir ağda olabilir"* der. Telefonda, tünelin arkasındaki birine
             verilen bu tavsiye yalnızca yanlış değil, teşhisi de saptırır.
           • "Adresi Değiştir" API adresini `localStorage`a yazar; web'de API
             zaten sayfanın origin'idir. Yanlış bir adres yazan uzak kullanıcı
             KENDİ PANELİNİ kilitler ve bir daha açamaz (`runtime-env.ts`te
             yazılı tuzak) — üstelik tam da bir şeylerin bozuk olduğu anda.
          `LoginPage` bu kapıyı zaten uyguluyordu; şerit atlanmıştı.
        */}
        {IS_ELECTRON && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleSearch()}
              disabled={searching}
            >
              {searching ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Radar className="mr-2 h-3.5 w-3.5" />
              )}
              {searching ? "Aranıyor…" : "Sunucuyu Ara"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
              <Settings2 className="mr-2 h-3.5 w-3.5" />
              Adresi Değiştir
            </Button>
          </>
        )}
      </div>
      {IS_ELECTRON && <ApiEndpointDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </>
  );
}
