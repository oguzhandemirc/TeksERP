import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import apiClient from "@/services/apiClient";

// =============================================================================
// BENZER KAYIT UYARISI — mükerreri REDDETMEK yerine ÖNLEMEK (2026-08-19)
// =============================================================================
// Mükerrer ad kontrolü bugüne kadar yalnız KAYDET'e basınca çarpıyordu ve yalnız
// katlanmış ad BİREBİR aynıysa. Sahadaki mükerrerlerin çoğu ise birebir aynı
// değil YAKIN: canlı veride "Moda Tekstil" ve "MODA TEKSTİL" İKİSİ DE AKTİF
// müşteri olarak duruyor. Bu bileşen kullanıcı adı YAZARKEN "şunlar zaten var"
// diye gösterir — sektörde standart olan yol (SAP BP, CRM'ler).
//
// ⚠️ ENGEL DEĞİLDİR ve öyle yapılmamalı: aynı grubun iki şirketi meşru olarak
// benzer adlıdır. Kullanıcı listeyi görür, kararı kendisi verir.
//
// ⚠️ Sunucu tarafı da OKUR-YAZMAZ: `GET /api/<varlık>/similar-names`. Uç yalnız
// yazma izniyle korunuyor (var olan adları listeliyor, kayıt açacak kişiye lazım).
// =============================================================================

export interface SimilarName {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  score: number;
  /**
   * Dolu ise bu satır bir TOMBSTONE: "→ <ad> altına birleşti". Sunucu bunu
   * BİLEREK döndürür (bkz. `BaseService.findSimilarNames`) — az önce
   * birleştirilmiş bir adı yeniden yazmak, temizlenen mükerreri DİRİLTİR.
   * ⚠️ Gösterilmezse satır canlı bir kayıt gibi okunur; 2026-08-22'ye kadar
   * alan istemcide düşürülüyordu, yani uyarının en değerli hâli görünmüyordu.
   */
  mergedIntoName?: string | null;
}

interface Props {
  /** API yolu: "customers", "items", "colors", "stations"… */
  entity: string;
  /** Formda o an yazılı olan ad. */
  name: string;
  /** Düzenlemede kaydın kendisi "benzer" diye gösterilmesin. */
  excludeId?: string;
  /** Kapsamlı tekillikte (makine → istasyon) aramayı daraltır. */
  scope?: string;
}

export function SimilarNamesWarning({ entity, name, excludeId, scope }: Props) {
  const [rows, setRows] = useState<SimilarName[]>([]);
  const trimmed = name.trim();

  useEffect(() => {
    // 3 harften kısa terimde her şey "benzer" çıkar; sunucu da boş döner ama
    // isteği hiç göndermemek daha ucuz.
    if (trimmed.length < 3) {
      setRows([]);
      return;
    }
    let alive = true;
    // Yazarken her tuşta sorgu atmamak için gecikme. 400 ms: kullanıcı kelimeyi
    // bitirsin ama kaydet'e basmadan uyarıyı görsün.
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ name: trimmed });
      if (excludeId) qs.set("excludeId", excludeId);
      if (scope) qs.set("scope", scope);
      apiClient
        .get<{ data: SimilarName[] }>(`/api/${entity}/similar-names?${qs.toString()}`)
        .then((r) => {
          if (alive) setRows(r.data?.data ?? []);
        })
        // ⚠️ SESSİZ YUT: bu bir YARDIMCI uyarıdır. Uç 403/404 dönse bile form
        // çalışmaya devam etmeli — kullanıcıyı yazamaz hâle getirmek, önlemeye
        // çalıştığımız sorundan büyük zarar olurdu.
        .catch(() => {
          if (alive) setRows([]);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [entity, trimmed, excludeId, scope]);

  // Birebir aynı ad ayrı vurgulanır: o "benzer" DEĞİL, KESİN mükerrerdir ve
  // kaydet'e basılırsa sunucu 409 döndürür. Bu yüzden rengi de ayrı: sarı
  // "dikkat et", kırmızı "bu hâliyle kaydedilemez" demek.
  const exact = useMemo(() => rows.filter((r) => r.score >= 0.999), [rows]);
  const blocked = exact.length > 0;

  // Birebir olanlar önce — operatörün ilk gördüğü satır en sert olanı olmalı.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => b.score - a.score),
    [rows],
  );

  if (rows.length === 0) return null;

  const tone = blocked
    ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/50"
    : "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/50";
  const headText = blocked
    ? "text-red-900 dark:text-red-100"
    : "text-amber-900 dark:text-amber-100";
  const bodyText = blocked
    ? "text-red-900/90 dark:text-red-100/90"
    : "text-amber-900/90 dark:text-amber-100/90";

  return (
    // `border-l-4` + `text-sm`: eski hâli `text-xs` idi ve formun içinde
    // kayboluyordu (kullanıcı: "daha net ve göz önünde olsun"). Uyarı
    // görülmüyorsa yok demektir.
    <div
      role="status"
      aria-live="polite"
      className={`rounded-md border border-l-4 p-3 text-sm ${tone}`}
    >
      <div className={`flex items-center gap-2 font-semibold ${headText}`}>
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {blocked
            ? "Bu ad zaten kayıtlı — bu hâliyle kaydedilemez"
            : `Benzer kayıtlar var (${rows.length})`}
        </span>
      </div>

      <ul className={`mt-2 space-y-1.5 ${bodyText}`}>
        {ordered.map((r) => {
          const isExact = r.score >= 0.999;
          return (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">{r.name}</span>
              {r.code && <span className="font-mono text-xs opacity-70">{r.code}</span>}
              {!r.isActive && !r.mergedIntoName && (
                <span className="text-xs opacity-70">(pasif)</span>
              )}
              {/* Tombstone: bu ad ARTIK BAŞKA BİR KAYIT. Yeniden yazmak,
                  temizlenen mükerreri geri getirir — en değerli satır budur. */}
              {r.mergedIntoName ? (
                <span className="text-xs font-medium opacity-90">
                  → “{r.mergedIntoName}” altına birleştirilmiş
                </span>
              ) : (
                <span className="ml-auto shrink-0 text-xs font-medium">
                  {isExact ? "aynı ad" : `%${Math.round(r.score * 100)} benzer`}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className={`mt-2 text-xs ${bodyText}`}>
        {blocked
          ? "Aynı ad ikinci kez açılamaz. Farklı bir ad yazın ya da mevcut kaydı düzenleyin."
          : "Aynı kaydı ikinci kez açmıyorsanız devam edebilirsiniz."}
      </div>
    </div>
  );
}
