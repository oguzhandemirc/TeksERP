import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import apiClient from "@/services/apiClient";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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

  return (
    // Canlı bölge HEP bağlı (yeni eklenen düğümdeki aria-live duyurulmaz) ama
    // `contents` kutu üretmez: sonuç yokken formda tek piksel yer kaplamaz.
    // Liste satır içinde değil açılır katmanda — form düzeni kaymasın diye.
    <div role="status" aria-live="polite" className="contents">
      {rows.length > 0 && <SimilarNamesPopover rows={rows} />}
    </div>
  );
}

function SimilarNamesPopover({ rows }: { rows: SimilarName[] }) {
  // Birebir aynı ad ayrı vurgulanır: o "benzer" DEĞİL, KESİN mükerrerdir ve
  // kaydet'e basılırsa sunucu 409 döndürür. Bu yüzden rengi de ayrı: sarı
  // "dikkat et", kırmızı "bu hâliyle kaydedilemez" demek.
  const exact = useMemo(() => rows.filter((r) => r.score >= 0.999), [rows]);
  const blocked = exact.length > 0;

  // Birebir olanlar önce — operatörün ilk gördüğü satır en sert olanı olmalı.
  const ordered = useMemo(() => [...rows].sort((a, b) => b.score - a.score), [rows]);

  // Katman sonuç kaybolunca bileşenle birlikte söner; tekrar kendiliğinden açılmaz.
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // `contain: inline-size`: uzun ad listesi ızgara kolonunu GENİŞLETMESİN
            // (nowrap metnin min-content'i `1fr` kolonu itip formu bozuyordu).
            "group flex w-full min-w-0 items-start gap-1.5 rounded-sm text-left text-xs [contain:inline-size]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            blocked
              ? "font-medium text-red-600 dark:text-red-400"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <AlertTriangle
            aria-hidden
            className={cn("mt-px h-3.5 w-3.5 shrink-0", !blocked && "text-warning")}
          />
          {blocked ? (
            // Kesin mükerrer kırpılmaz: dar kolonda iki satıra iner ama "kaydedilemez" okunur.
            <span className="min-w-0">Bu ad zaten kayıtlı, bu hâliyle kaydedilemez</span>
          ) : (
            <span className="flex min-w-0 items-baseline gap-1">
              <span className="shrink-0">Benzer kayıtlar var ({rows.length}):</span>
              <span className="truncate text-foreground/80">{ordered.map((r) => r.name).join(", ")}</span>
            </span>
          )}
          <ChevronDown
            aria-hidden
            className="mt-px ml-auto h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Benzer kayıtlar"
        className="pointer-events-auto w-[min(24rem,var(--radix-popover-content-available-width))] p-0"
        // Dialog içindeki portal katmanda tekerlek kaydırması dialog'a kaçmasın.
        onWheel={(e) => e.stopPropagation()}
      >
        <ul className="max-h-48 overflow-y-auto py-1">
          {ordered.map((r) => (
            <SimilarRow key={r.id} row={r} />
          ))}
        </ul>
        <p
          className={cn(
            "border-t px-3 py-2 text-xs",
            blocked ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
          )}
        >
          {blocked
            ? "Aynı ad ikinci kez açılamaz. Farklı bir ad yazın ya da mevcut kaydı düzenleyin."
            : "Aynı kaydı ikinci kez açmıyorsanız devam edebilirsiniz."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SimilarRow({ row: r }: { row: SimilarName }) {
  const isExact = r.score >= 0.999;
  return (
    <li
      className={cn("flex items-center gap-2 px-3 py-1.5", isExact && "bg-red-500/[0.07] dark:bg-red-500/10")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={r.name}>
          {r.name}
        </span>
        {/* Tombstone: bu ad ARTIK BAŞKA BİR KAYIT. Yeniden yazmak, temizlenen
            mükerreri geri getirir — en değerli satır budur. */}
        {r.mergedIntoName && (
          <span className="block truncate text-xs text-muted-foreground">
            → “{r.mergedIntoName}” altına birleştirilmiş
          </span>
        )}
      </span>
      {!r.isActive && !r.mergedIntoName && (
        <span className="shrink-0 text-[11px] text-muted-foreground">pasif</span>
      )}
      {r.code && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.code}</span>}
      {!r.mergedIntoName && (
        <span
          className={cn(
            "min-w-[5.5rem] shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums",
            isExact
              ? "bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {isExact ? "aynı ad" : `%${Math.round(r.score * 100)} benzer`}
        </span>
      )}
    </li>
  );
}
