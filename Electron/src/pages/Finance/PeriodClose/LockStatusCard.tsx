// =============================================================================
// KİLİT DURUMU KARTI — "bu kapsam nereye kadar kapalı"
// =============================================================================
// İKİ TÜKETİCİ, TEK GÖVDE (2026-08-14): cari kapanışı (cari × para birimi) ve
// kasa/banka kapanışı (hesap) aynı `PeriodStatus` yanıtını okur; kart
// parametrize edildi, KOPYALANMADI. Kapsama özgü olan yalnız üç şey prop'tur:
// başlık etiketi, mühürün reddettiği kayıt cümlesi ve para basımı.
//
// ⚠️ Kart YALNIZ kapsam tam seçiliyken çizilir; bu bir eksiklik değil,
// kapanışın kimliğidir: cari mührü (cari, para birimi) çiftine, kasa mührü
// hesaba aittir. Eksik kapsamla "kapalı/açık" demek TRY kapalıyken USD'yi de
// kapalı göstermek olurdu.
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
import { formatDayKey, getPeriodStatus, moneyOf, type Decimalish, type PeriodStatus } from "./service";

interface BaseProps {
  /** Kapsamın görünen adı — "MÜŞTERİ01 — Ak Tekstil · TRY" ya da "KS01 — Merkez Kasa (Kasa)". */
  label: string;
  /** Mühür ne tür kayıtları reddediyor — modüle göre cümle ("yeni fatura, tahsilat ve çek kaydı"). */
  sealedRecordsHint: string;
  fmtMoney: (v: Decimalish | null | undefined) => string;
  queryKey: readonly unknown[];
  fetchStatus: () => Promise<PeriodStatus>;
}

export function PeriodLockStatusCardBase({ label, sealedRecordsHint, fmtMoney, queryKey, fetchStatus }: BaseProps) {
  const q = useQuery({
    queryKey: [...queryKey],
    queryFn: fetchStatus,
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
            {label} için kapanış bilgisi alınamadı. Bu kutu dönemin AÇIK olduğunu söylemiyor —
            bilinmiyor. Kayıt girmeden önce tekrar deneyin.
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
        <p className="font-medium">{label}</p>
        {locked ? (
          <p className="mt-0.5 text-muted-foreground">
            <span className="font-medium text-foreground">{formatDayKey(s.closedThrough)}</span> tarihine kadar
            (bu gün dahil) KAPALI — mühürlü bakiye{" "}
            <span className="font-medium text-foreground">{fmtMoney(s.closingBalance)}</span>. Bu tarihe ve
            öncesine düşen {sealedRecordsHint} reddedilir.
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

interface Props {
  cariId: string;
  cariLabel: string;
  currency: Currency;
}

/** Cari sarmalayıcı — davranış ve metinler 2026-08-14 öncesiyle birebir. */
export function LockStatusCard({ cariId, cariLabel, currency }: Props) {
  return (
    <PeriodLockStatusCardBase
      label={`${cariLabel} · ${currency}`}
      sealedRecordsHint="yeni fatura, tahsilat ve çek kaydı"
      fmtMoney={(v) => moneyOf(v, currency)}
      queryKey={["finance", "period-status", cariId, currency]}
      fetchStatus={() => getPeriodStatus({ cariId, currency })}
    />
  );
}
