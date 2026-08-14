// =============================================================================
// DAĞITIM TASLAĞI — "hangi faturaya ne kadar yazıyorum"
// =============================================================================
// Ekranın tek yazılabilir durumu burada yaşar: `invoiceId → HAM METİN`. Metin
// olarak tutulur çünkü kullanıcı yazarken ara hâller geçerlidir ("1", "1.", "").
// Sayıya çevirme TEK NOKTADA (`toKurus`) yapılır — her kullanım yerinde ayrı
// `Number()` çağrısı, biri unutulduğunda sessizce `NaN` yayardı.
//
// ⚠️ FIFO ÖNERİSİ YALNIZ KAYNAK DEĞİŞTİĞİNDE TOHUMLANIR. Her veri tazelemesinde
// tohumlansaydı, kullanıcının elle düzelttiği satır arka planda gelen bir
// refetch ile sessizce eski hâline dönerdi — ve "elle düzeltme birinci sınıftır"
// ürün kararının pratikte en kolay kaybedilen ayağı tam olarak budur.
//
// ⚠️ Öneri GELMEDEN tohumlama yapılmaz (`rows` yoksa çık). Kaynak seçilince
// açık fatura sorgusu yeni bir anahtarla yeniden koşar ve o sırada veri
// `undefined`'dır; erken tohumlamak ESKİ kaynağın önerisini yeni kaynağa
// yapıştırırdı.
import { useEffect, useMemo, useRef, useState } from "react";
import { kurusToInput, toKurus } from "./allocationMath";
import type { OpenInvoiceRow } from "./service";
import type { SourceItem } from "./useAllocationSources";

export interface DraftItem {
  invoiceId: string;
  kurus: number;
}

interface Params {
  selected: SourceItem | null;
  openRows: OpenInvoiceRow[];
  /** Sorgu çözülmeden tohumlama yapılmasın diye ham veri referansı. */
  openDataReady: boolean;
}

export function useAllocationDraft({ selected, openRows, openDataReady }: Params) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const openKurusById = useMemo(
    () => new Map(openRows.map((r) => [r.id, toKurus(r.openTotal)])),
    [openRows],
  );

  // ⚠️ ANAHTARA `freeKurus` DA GİRER ve bu satır load-bearing. Kayıttan sonra
  // belgenin kalanı düşer → anahtar değişir → öneri TAZE veriyle yeniden kurulur.
  // Yalnız `kind:id` kullanılsaydı kaydettikten sonra taslak, henüz tazelenmemiş
  // ESKİ öneriyle (yani artık sığmayan tutarlarla) yeniden dolar ve kullanıcı
  // hiçbir şey yazmadan "kalanı aşıyor" uyarısı görürdü.
  const sourceKey = selected ? `${selected.kind}:${selected.id}:${selected.freeKurus}` : null;
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceKey) {
      seededRef.current = null;
      // Fonksiyonel set + boşluk kontrolü ZORUNLU: koşulsuz `setDrafts({})` her
      // render'da yeni bir nesne yazıp sonsuz döngü kurardı.
      setDrafts((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    if (seededRef.current === sourceKey || !openDataReady) return;
    seededRef.current = sourceKey;
    const next: Record<string, string> = {};
    for (const r of openRows) {
      const k = toKurus(r.suggested);
      if (k > 0) next[r.id] = kurusToInput(k);
    }
    setDrafts(next);
  }, [sourceKey, openDataReady, openRows]);

  const items: DraftItem[] = useMemo(
    () =>
      Object.entries(drafts)
        .map(([invoiceId, text]) => ({ invoiceId, kurus: toKurus(text) }))
        .filter((x) => x.kurus > 0),
    [drafts],
  );

  const distributedKurus = items.reduce((a, b) => a + b.kurus, 0);
  const overCount = items.filter((it) => it.kurus > (openKurusById.get(it.invoiceId) ?? 0)).length;

  const setDraft = (invoiceId: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [invoiceId]: value }));

  /**
   * "Tümü" — faturanın açığı ile belgenin O AN kalanından KÜÇÜK olanı yazar.
   * Kalan hesabı, aynı satıra daha önce yazılmış tutarı dışarıda bırakır; yoksa
   * ikinci basışta kendi tutarını kendinden düşüp sıfıra inerdi.
   */
  const fillMax = (invoiceId: string) => {
    const open = openKurusById.get(invoiceId) ?? 0;
    const free = selected?.freeKurus ?? 0;
    const others = distributedKurus - toKurus(drafts[invoiceId] ?? "");
    const value = Math.min(open, Math.max(0, free - others));
    setDraft(invoiceId, value > 0 ? kurusToInput(value) : "");
  };

  /**
   * Taslağı boşaltır — hem "Tutarları temizle" düğmesi hem kayıt sonrası.
   *
   * ⚠️ `seededRef` BİLEREK SIFIRLANMAZ. Sıfırlansaydı efekt aynı anda, henüz
   * tazelenmemiş ESKİ öneriyle tohumlamayı tekrarlar ve "temizle" düğmesi
   * hiçbir şey yapmamış gibi görünürdü. Yeniden tohumlamayı tetikleyen tek şey
   * anahtarın (kaynak ya da kalan tutar) değişmesidir.
   */
  const clear = () => setDrafts({});

  return { drafts, items, distributedKurus, overCount, setDraft, fillMax, clear };
}
