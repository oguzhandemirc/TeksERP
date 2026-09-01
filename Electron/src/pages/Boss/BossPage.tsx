import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { bossService } from "@/services/bossService";
import {
  FasonCard,
  SevkiyatCard,
  SiparisCard,
  StokCard,
  UretimCard,
} from "./cards/BossCards";

/** Sevkiyat/fason gibi DÖNEMSEL bölümlerin aralığı. Stok ve sipariş anlık
 *  fotoğraftır ve aralıktan etkilenmez — bu yüzden seçici yalnız iki bölümü
 *  etkiler ve o kartların üstünde bağlam olarak yazılır. */
const RANGES = [
  { key: "7", label: "7 gün", days: 7 },
  { key: "30", label: "30 gün", days: 30 },
  { key: "90", label: "90 gün", days: 90 },
] as const;

/**
 * PATRON ÖZETİ — tek istek, beş bölüm.
 *
 * ⚠️ İZİNSİZ BÖLÜM ÇİZİLMEZ (boş kart değil, HİÇ kart). Sunucu o bölümü `null`
 * döndürür ve adını `denied`e yazar; boş bir kart göstermek "veri yok" yalanı
 * olurdu — patron stoğun sıfır olduğunu sanardı.
 */
export function BossPage() {
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("30");
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  const q = useQuery({
    queryKey: ["boss-overview", rangeKey],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - range.days * 86_400_000);
      return bossService.overview({ dateFrom: from.toISOString(), dateTo: to.toISOString() });
    },
    // Patron ekranı yenilenmeyi bekler; 5 dk'lık genel `staleTime` burada
    // "eski rakama bakıyorum" hissi verirdi.
    staleTime: 60_000,
  });

  const d = q.data?.data;
  const periodMeta = `son ${range.label}`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 p-3 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              type="button"
              size="sm"
              variant={r.key === rangeKey ? "default" : "ghost"}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          aria-label="Yenile"
        >
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {q.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      )}

      {q.isError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Veriler alınamadı</p>
            {/* ⚠️ "0" GÖSTERİLMEZ. Sunucuya ulaşılamadığında sıfır basmak,
                patronun "stok bitmiş" diye karar vermesine yol açardı. */}
            <p className="mt-0.5 text-muted-foreground">
              Fabrika sunucusuna ulaşılamıyor olabilir. Bağlantını kontrol edip
              tekrar dene.
            </p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        </div>
      )}

      {d && (
        <>
          {d.stock && <StokCard data={d.stock} />}
          {d.orders && <SiparisCard data={d.orders} />}
          {d.production && <UretimCard data={d.production} />}
          {d.shipping && <SevkiyatCard data={d.shipping} meta={periodMeta} />}
          {d.subcontract && <FasonCard data={d.subcontract} meta={periodMeta} />}

          {/* Hiçbir bölüm yoksa sebebini SÖYLE — boş ekran "sistem bozuk" gibi
              okunur, oysa sorun yetkidir ve çözümü yöneticidedir. */}
          {!d.stock && !d.orders && !d.production && !d.shipping && !d.subcontract && (
            <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm">
              <p className="font-medium">Gösterilecek bölüm yok</p>
              <p className="mt-1 text-muted-foreground">
                Hesabında bu ekranın bölümlerine yetki tanımlı değil. Sistem
                yöneticinden "Patron (Uzaktan Takip)" yetki paketini isteyebilirsin.
              </p>
            </div>
          )}

          <p className="pt-1 text-center text-[11px] text-muted-foreground">
            {new Date(d.generatedAt).toLocaleString("tr-TR")} itibarıyla
          </p>
        </>
      )}
    </div>
  );
}
