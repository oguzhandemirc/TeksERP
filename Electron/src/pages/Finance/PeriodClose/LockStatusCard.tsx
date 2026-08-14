// =============================================================================
// KİLİT DURUMU KARTI — "bu cari bu para biriminde nereye kadar kapalı"
// =============================================================================
// ⚠️ Kart YALNIZ cari VE para birimi birlikte seçiliyken çizilir; bu bir
// eksiklik değil, kapanışın kimliğidir: mühür (cari, para birimi) çiftine
// aittir. Tek başına cari seçiliyken "kapalı/açık" demek, TRY kapalıyken USD'yi
// de kapalı göstermek olurdu.
//
// ⚠️ Kapanış YOKSA bu bir HATA DEĞİLDİR — kapanış opsiyoneldir ve kullanmayan
// kurulumda her dönem açıktır. Boş durumu "bulunamadı" diye basmak, kullanıcıyı
// olmayan bir sorunu aramaya iterdi.
//
// ⚠️ AMA "KAPANIŞ YOK" İLE "OKUYAMADIM" AYNI ŞEY DEĞİLDİR ve bu ekranda ikisini
// birbirine karıştırmak modülün en tehlikeli yalanıdır. İstek düşerse (sunucu
// kapalı, 500, yetki) kart HİÇ ÇİZİLMEZSE ekranda kilit rozeti olmayışı
// "dönem açık" diye okunur — kullanıcı mühürlü bir döneme kayıt girmeye gider
// ve 409'u ancak orada yer. Bu yüzden hata dalı AÇIKÇA basılır ve kart
// "açık olduğunu SÖYLEMİYORUM" der. (Aynı kural sayfa listesinde de geçerli.)
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Currency } from "../service";
import { formatDayKey, getPeriodStatus, moneyOf } from "./service";

interface Props {
  cariId: string;
  cariLabel: string;
  currency: Currency;
}

export function LockStatusCard({ cariId, cariLabel, currency }: Props) {
  const q = useQuery({
    queryKey: ["finance", "period-status", cariId, currency],
    queryFn: () => getPeriodStatus({ cariId, currency }),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Kilit durumu okunuyor…</p>;

  const s = q.data;
  // Sessiz `return null` YASAK — yukarıdaki nota bak: boş yer "açık" diye okunur.
  if (!s) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Kilit durumu okunamadı.</p>
          <p className="mt-0.5 text-xs">
            {cariLabel} · {currency} için kapanış bilgisi alınamadı. Bu kutu dönemin AÇIK olduğunu
            söylemiyor — bilinmiyor. Kayıt girmeden önce tekrar deneyin.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
            Tekrar dene
          </Button>
        </div>
      </div>
    );
  }

  const locked = Boolean(s.closedThrough);

  return (
    <div
      className={`flex items-start gap-3 rounded-md border p-4 text-sm ${
        locked ? "bg-amber-100/60 dark:bg-amber-950/40" : "bg-muted/30"
      }`}
    >
      {locked ? (
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
      ) : (
        <LockOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div>
        <p className="font-medium">
          {cariLabel} · {currency}
        </p>
        {locked ? (
          <p className="mt-0.5 text-muted-foreground">
            <span className="font-medium text-foreground">{formatDayKey(s.closedThrough)}</span> tarihine kadar
            (bu gün dahil) KAPALI — mühürlü bakiye{" "}
            <span className="font-medium text-foreground">{moneyOf(s.closingBalance, currency)}</span>. Bu tarihe
            ve öncesine düşen yeni fatura, tahsilat ve çek kaydı reddedilir.
          </p>
        ) : (
          <p className="mt-0.5 text-muted-foreground">
            Hiç kapanış yok — tüm dönemler açık. Kapanış zorunlu değildir; yalnız geçmişi mühürlemek
            isteyen kurulumlar kullanır.
          </p>
        )}
      </div>
    </div>
  );
}
