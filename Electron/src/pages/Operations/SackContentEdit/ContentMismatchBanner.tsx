import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

/**
 * ÇUVAL İÇERİĞİ UYUŞMAZLIK UYARILARI (2026-08-09)
 *
 * Saha isteği: *"çuvalın müşterisi ile içindeki topların müşterisi aynı değilse
 * uyar ama ENGEL OLMA."*
 *
 * ⚠️ DÜZ MÜŞTERİ KARŞILAŞTIRMASI YAPILMAZ. Kullanıcının ifadesiyle: *"X için
 * üretilmiş top Y'ye gönderilebilir; müşteriye özel etiketi olmadığı sürece
 * etiket bile değişmeden gönderilir."* Karar backend'de (tek kaynak:
 * `sack-content-mismatch.helper`); bu bileşen YALNIZ gösterir — kuralı burada
 * tekrar yazmak iki yüzeyin aynı çuval için farklı şey söylemesiyle biterdi.
 *
 * `StaleLabelsBanner` ile KARIŞTIRMA, ikisi FARKLI soruları yanıtlar:
 *   • StaleLabels → "çuvalın müşterisi DEĞİŞTİ, bu topların etiketi bayatladı"
 *     (backend `labelDirty` bayrağı, aksiyon: tek tuşla yeniden bas)
 *   • bu banner   → "içerideki toplar bu müşteriye UYUYOR MU" (etiket içeriği +
 *     2. kalite), aksiyon operatörün kararına bırakılır
 * Aynı çuvalda ikisi birden çıkabilir ve bu doğrudur.
 */
interface MismatchSignal {
  kind: "LABEL_DIFFERS" | "OTHER_CUSTOMER" | "SECOND_QUALITY";
  severity: "warning" | "info";
  rollId: string;
  barcode: string | null;
  message: string;
}

export function ContentMismatchBanner({
  sackId,
  rollCount,
}: {
  sackId: string | null;
  /** İçerik değişince yeniden sorulsun diye query anahtarına girer. */
  rollCount: number;
}) {
  const { data } = useQuery({
    queryKey: ["sack-mismatch", sackId, rollCount],
    queryFn: async () => {
      const res = await apiClient.post<ApiResponse<Record<string, MismatchSignal[]>>>(
        "/shipping/sacks/mismatch-check",
        { sackIds: [sackId] },
      );
      return res.data.data?.[sackId!] ?? [];
    },
    // Boş çuvalda uç çağrılmaz — hem gereksiz istek hem "0 uyarı" gürültüsü.
    enabled: !!sackId && rollCount > 0,
    staleTime: 30_000,
  });

  const signals: MismatchSignal[] = data ?? [];
  if (signals.length === 0) return null;

  const warnings = signals.filter((s) => s.severity === "warning");
  const infos = signals.filter((s) => s.severity === "info");

  return (
    <div className="space-y-2 px-6 py-2">
      {warnings.length > 0 && (
        <Callout tone="warning" icon={AlertTriangle}>
          <div className="space-y-1">
            <p className="font-semibold">
              {warnings.length} top bu müşteri için uygun olmayabilir
            </p>
            {/* Yıkıcı-işlem kuralının kardeşi: "N top uyumsuz" gibi SOYUT sayı
                yetmez — hangi top, neden, somut. */}
            <ul className="space-y-0.5 text-xs">
              {warnings.slice(0, 8).map((s) => (
                <li key={`${s.rollId}-${s.kind}`}>
                  <span className="font-mono">{s.barcode ?? s.rollId.slice(0, 8)}</span> —{" "}
                  {s.message}
                </li>
              ))}
              {warnings.length > 8 && (
                <li className="opacity-70">… ve {warnings.length - 8} top daha</li>
              )}
            </ul>
            <p className="text-xs opacity-80">
              Bu bir uyarıdır — sevki engellemez. Etiket yenilenmesi gerekiyorsa
              yukarıdaki yeniden basma tuşunu kullanın.
            </p>
          </div>
        </Callout>
      )}

      {/* GRİ BİLGİ ayrı kutuda: "başka müşteri için üretilmişti" bir SORUN
          DEĞİL (etiket geçerli). Uyarıyla aynı renge koymak, kırmızının anlamını
          aşındırır ve operatör ikisini de görmezden gelmeye başlar. */}
      {infos.length > 0 && (
        <Callout tone="info" icon={Info}>
          <p className="text-xs">
            {infos.length} top başka müşteri için üretilmişti — etiketleri bu
            müşteri için de geçerli, işlem gerekmiyor.
          </p>
        </Callout>
      )}
    </div>
  );
}

/**
 * SEVKİYAT KURMA özeti — çok çuvalı TEK istekte denetler.
 *
 * ⚠️ Çuval başına ayrı istek atmak yanlış olurdu: 50 çuvallık bir sevkiyatta 50
 * istek demekti. Uç zaten `sackIds[]` alıyor (tavan 200, `getPickList` ile aynı).
 *
 * Yalnız KIRMIZI gösterir: "başka müşteri için üretilmişti" bilgisi sevk kurma
 * anında gürültüdür — orada karar verilecek şey yoktur ve ekran zaten kalabalık.
 */
export function ShipmentMismatchSummary({ sackIds }: { sackIds: string[] }) {
  const key = sackIds.join(",");
  const { data } = useQuery({
    queryKey: ["sack-mismatch", "bulk", key],
    queryFn: async () => {
      const res = await apiClient.post<ApiResponse<Record<string, MismatchSignal[]>>>(
        "/shipping/sacks/mismatch-check",
        { sackIds },
      );
      return res.data.data ?? {};
    },
    enabled: sackIds.length > 0,
    staleTime: 30_000,
  });

  if (!data) return null;
  const rows = Object.entries(data)
    .map(([sackId, signals]) => ({
      sackId,
      warnings: (signals ?? []).filter((s) => s.severity === "warning"),
    }))
    .filter((r) => r.warnings.length > 0);
  if (rows.length === 0) return null;

  const total = rows.reduce((a, r) => a + r.warnings.length, 0);
  return (
    <Callout
      tone="warning"
      icon={AlertTriangle}
      title={`${rows.length} çuvalda ${total} top uygun olmayabilir`}
    >
      <ul className="mt-1 space-y-0.5 text-xs">
        {rows.slice(0, 6).flatMap((r) =>
          r.warnings.slice(0, 2).map((s) => (
            <li key={`${r.sackId}-${s.rollId}-${s.kind}`}>
              <span className="font-mono">{s.barcode ?? s.rollId.slice(0, 8)}</span>
              <span className="text-muted-foreground"> — {s.message}</span>
            </li>
          )),
        )}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        Sevki engellemez — kontrol edip devam edebilirsiniz.
      </p>
    </Callout>
  );
}
