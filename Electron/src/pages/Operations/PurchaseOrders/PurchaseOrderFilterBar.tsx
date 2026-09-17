// =============================================================================
// ALIŞ SİPARİŞİ FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ VARSAYILAN "AÇIK OLANLAR"dır, "tümü" değil. Satın alma ekranının tek
// sorusu "ne bekliyorum" — tamamlanmış ve iptal edilmiş yüzlerce sipariş listeyi
// doldurursa o soru cevapsız kalır. Geçmiş gizlenmiş DEĞİL, tek seçimle geri
// gelir ve seçim şeritte GÖRÜNÜR durur: kullanıcı dar bir listeye baktığını
// bilmeli (`ChequeFilterBar` emsali).
//
// ⚠️ Şerit `PageBody`'nin DIŞINDA ve `shrink-0` — içine konursa liste kaydıkça
// filtreler yukarı kaçar ve kullanıcı hangi daraltmaya baktığını göremez.
//
// ⚠️ "Filtreleri temizle" YALNIZ bir şey değiştiğinde çıkar; her zaman duran bir
// temizle düğmesi, hiçbir filtre yokken de "bir şey açık" izlenimi verir.
//
// ⚠️ DURUM SEÇİCİSİ BİR OKUMA FİLTRESİDİR, bir DURUM ATAMASI DEĞİL. Sipariş
// durumu mal kabulünden TÜRETİLİR; formda durum kutusu yoktur ve olmamalı.
//
// ⚠️⚠️ ÖLÜ FİLTRE ÇİZİLMEZ (`scope`). Şerit iki sekmenin de ÜSTÜNDE duruyor ama
// "Ne bekliyorum?" sekmesi KALEM ucundan besleniyor ve o uç yalnız tedarikçi +
// ürün + gecikme süzgeci tanıyor: arama, durum ve tarih kutuları o sekmede
// HİÇBİR ŞEY yapmaz. Çizili bırakmak, projede adı konmuş bir arıza sınıfıdır —
// kullanıcı yazar, bekler, liste değişmez ve "bozuk" der (mobil Personel çipi
// kararının aynısı: ölü filtre "bastım, olmadı" üretir). Bu yüzden o sekmede
// yalnız GERÇEKTEN ETKİ EDEN kutu çizilir; gizlenen filtrelerin nereye ait
// olduğu tek cümleyle söylenir, çünkü sessizce kaybolan bir kutu da kafa
// karıştırır.
// =============================================================================
import { RotateCcw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SupplierSelect } from "@/components/forms/SupplierSelect";
import type { SupplierParty } from "@/components/forms/supplierParty";
import { poFilterControls, type PoFilterScope } from "./filterScope";
import { DateRangeInput } from "@/components/forms/DateRangeInput";

/** Canlı kovalar — "işi bitmemiş" siparişler. Backend CSV'yi `IN`'e çevirir. */
export const LIVE_PO_STATUS = "OPEN,PARTIAL";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: LIVE_PO_STATUS, label: "Açık olanlar (bekleyen + kısmi)" },
  { value: "", label: "Tümü (tamamlanan + iptal dahil)" },
  { value: "OPEN", label: "Hiç gelmeyenler" },
  { value: "PARTIAL", label: "Kısmen gelenler" },
  { value: "CLOSED", label: "Tamamlananlar" },
  { value: "CANCELLED", label: "İptal edilenler" },
];

export interface PurchaseOrderFilterState {
  search: string;
  status: string;
  /** C4 — daraltma cari kart YA DA fason firma olabilir; sorgu anahtarını
   *  `supplierPartyQuery` seçer (yanlış bacağa yazmak boş liste demekti). */
  supplier: SupplierParty | null;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_PO_FILTERS: PurchaseOrderFilterState = {
  search: "",
  status: LIVE_PO_STATUS,
  supplier: null,
  dateFrom: "",
  dateTo: "",
};

export function isPoFilterDirty(f: PurchaseOrderFilterState): boolean {
  return f.status !== LIVE_PO_STATUS || Boolean(f.search || f.supplier || f.dateFrom || f.dateTo);
}

interface Props {
  value: PurchaseOrderFilterState;
  onChange: (next: PurchaseOrderFilterState) => void;
  /**
   * Hangi sekme için çiziliyor. Karar SAF fonksiyondadır (`filterScope.ts`) —
   * burada bir `&&` zinciri olarak durursa tersine çevrilmesi hiçbir testi
   * kırmaz.
   */
  scope?: PoFilterScope;
}

export function PurchaseOrderFilterBar({ value, onChange, scope = "orders" }: Props) {
  const set = <K extends keyof PurchaseOrderFilterState>(key: K, v: PurchaseOrderFilterState[K]) =>
    onChange({ ...value, [key]: v });

  const show = poFilterControls(scope);
  const orderScope = scope === "orders";
  // Açıklama cümlesi, GİZLENEN bir kutu olduğu için basılır — "hangi sekmedeyiz"
  // sorusuna değil, ekranın kendi durumuna bağlı.
  const hasHidden = !show.search || !show.status || !show.dateRange;
  // Temizle düğmesi yalnız GÖRÜNEN bir filtre açıkken çıkar: gizli bir kutu
  // yüzünden belirseydi kullanıcı neyi temizlediğini göremezdi.
  const showClear = orderScope ? isPoFilterDirty(value) : Boolean(value.supplier);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      {show.search && (
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Sipariş no / tedarikçi / not ara…"
            value={value.search}
            onChange={(e) => set("search", e.target.value)}
          />
        </div>
      )}

      {show.supplier && (
        <SupplierSelect
          className="w-60"
          value={value.supplier}
          onChange={(v) => set("supplier", v)}
          placeholder="Tüm tedarikçiler"
          nullable
          noneLabel="Tüm tedarikçiler"
          // ⚠️ FİLTRE BAĞLAMI: pasif tedarikçiler de listelenir. Sezon sonunda
          // kapatılan bir firmanın GEÇMİŞ siparişleri duruyor ve aranabilmeli;
          // aktif süzgeci burada satın almacıya "bu firmanın siparişi yok" yalanı
          // söyletirdi (formda tersi doğru — orada pasif kayıt zaten reddedilir).
          includeInactive
        />
      )}

      {show.status && (
        <>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={value.status}
            onChange={(e) => set("status", e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <span className="text-xs text-muted-foreground">Sipariş tarihi</span>
          <DateRangeInput
            from={value.dateFrom}
            to={value.dateTo}
            onFrom={(v) => set("dateFrom", v)}
            onTo={(v) => set("dateTo", v)}
            inputClassName="w-36"
            fromLabel="Sipariş tarihi başlangıcı"
            toLabel="Sipariş tarihi bitişi"
          />
        </>
      )}

      {hasHidden && (
        <span className="text-xs text-muted-foreground">
          Bu sekme her zaman AÇIK kalemleri gösterir; arama, durum ve tarih filtreleri “Siparişler”
          sekmesine aittir.
        </span>
      )}

      {showClear && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            // Kalem sekmesinde yalnız GÖRÜNEN filtre temizlenir — diğer
            // sekmenin daraltmasını haber vermeden sıfırlamak, kullanıcının
            // görmediği bir şeyi değiştirmek olurdu.
            onChange(orderScope ? EMPTY_PO_FILTERS : { ...value, supplier: null })
          }
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {orderScope ? "Filtreleri temizle" : "Tedarikçiyi temizle"}
        </Button>
      )}
    </div>
  );
}
