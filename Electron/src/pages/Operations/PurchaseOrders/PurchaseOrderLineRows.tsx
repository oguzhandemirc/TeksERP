// =============================================================================
// ALIŞ SİPARİŞİ KALEM EDİTÖRÜ
// =============================================================================
// ⚠️ MAL KABUL SATIR EDİTÖRÜNDEN FARKI: orada "Adet" bir giriş kolaylığıdır ve
// N ayrı TOP doğurur; burada MİKTAR bir TAAHHÜTTÜR ve hiçbir şey doğurmaz.
// Siparişte "20 top" diye bir şey yoktur — tedarikçinin kaç parça hâlinde
// göndereceği sipariş anında bilinmez ve bilinmesi de gerekmez. Bu yüzden bu
// formda ADET SÜTUNU YOKTUR; koyulsaydı fiş formundakiyle aynı sanılır ve
// sipariş miktarı sessizce 20 katına çıkardı.
//
// ⚠️ AYNI ÜRÜNDEN BİRDEN FAZLA KALEM MEŞRUDUR (farklı termin/fiyat) ve backend
// bunu yasaklamaz. Bedeli şudur: gelen mal kalemlere sırayla (FIFO) dağıtılır,
// yani "hangi terminin malı geldi" bir VARSAYIMDIR. Editör bunu engellemez ama
// SÖYLER — sessizce ikinci bir kalem eklemek, kullanıcının bilmediği bir
// varsayımı onun adına kabul etmek olurdu.
//
// ⚠️ BİRİM SÜTUNU YOK: birim ürünün kendi özelliğidir (metre/kg/adet) ve satır
// başına ayrıca sorulması, ürünle çelişebilen ikinci bir gerçek yaratırdı.
// Miktarın hangi birimde olduğu ürün seçilince kataloğa bakılarak bilinir;
// sipariş DETAYINDA birimle birlikte basılır (backend `item.unit` döner).
// =============================================================================
import { useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { itemService } from "@/pages/Items/service";
import { cn } from "@/lib/utils";
import { useItemPriceSuggestion, describeSuggestion } from "@/hooks/useItemPriceSuggestion";
import type { SupplierParty } from "@/components/forms/supplierParty";

export interface PoDraftLine {
  key: string;
  itemId: string;
  /** TAAHHÜT edilen toplam miktar — parça sayısı DEĞİL. */
  qty: number;
  /** Anlaşılan birim fiyat (siparişin para biriminde) — opsiyonel. */
  unitPrice: number | null;
  /** Satır notu (ör. "2. termin, 15 Eylül") — opsiyonel, en fazla 300 karakter. */
  notes: string;
}

export function emptyPoLine(): PoDraftLine {
  return { key: crypto.randomUUID(), itemId: "", qty: 0, unitPrice: null, notes: "" };
}

export function duplicatePoLine(l: PoDraftLine): PoDraftLine {
  return { ...l, key: crypto.randomUUID() };
}

/** Backend sözleşmesine çevirir; eksik/geçersiz satırlar DÜŞER. */
export function toLineInputs(lines: PoDraftLine[]) {
  return lines
    .filter((l) => l.itemId && l.qty > 0)
    .map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      notes: l.notes.trim() || null,
    }));
}

/** Formun canlı özeti — kaç kalem, ne kadar tutar. */
export function poTotals(lines: PoDraftLine[]): { lineCount: number; amount: number; priced: number } {
  const valid = lines.filter((l) => l.itemId && l.qty > 0);
  return {
    lineCount: valid.length,
    amount: valid.reduce((s, l) => s + (l.unitPrice ?? 0) * l.qty, 0),
    priced: valid.filter((l) => l.unitPrice != null && l.unitPrice > 0).length,
  };
}

/** Aynı ürünü birden fazla kez taşıyan kalemlerin ürün id'leri. */
export function duplicateItemIds(lines: PoDraftLine[]): string[] {
  const seen = new Map<string, number>();
  for (const l of lines) {
    if (!l.itemId) continue;
    seen.set(l.itemId, (seen.get(l.itemId) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

interface Props {
  lines: PoDraftLine[];
  onChange: (lines: PoDraftLine[]) => void;
  /**
   * Salt-okunur mod — mal görmüş (`OPEN` olmayan) siparişi düzenlerken.
   *
   * ⚠️ ZORUNLU, "süs" DEĞİL: diyalogdaki diğer TÜM alanlar bu durumda kapanıyor
   * ama kalem satırları açık kalırsa kullanıcı beş kalemi yeniden yazar, ürün
   * değiştirir, satır siler — sonra "Değişiklikleri kaydet" düğmesini kapalı
   * bulur ve emeğini nereye kaybettiğini hiçbir yerde okuyamaz. Kapalı alan
   * "buraya dokunma" der; açık alan çalışmayı davet eder.
   */
  disabled?: boolean;
  /**
   * ALIŞ fiyat önerisi bağlamı (D2/F2): tedarikçi + siparişin para birimi.
   * İkisi de verilmezse öneri isteği HİÇ atılmaz — form bugünkü gibi elle
   * çalışır (form diyaloğu bu prop'ları geçirene kadar davranış birebir aynı).
   *
   * ⚠️⚠️ FASON TEDARİKÇİDE CARİ-ÖZEL FİYAT ARANMAZ ve bu bir eksik değil,
   * modelin kendisidir: `ItemPrice.customerId` FK'sı `Customer`a bakıyor —
   * fason firmanın id'sini oraya göndermek BAŞKA BİR TABLONUN id'siyle sorgu
   * atmaktır. Bugün sonuç boş döner (kart varsayılanına düşülür, doğru davranış)
   * ama iki tablonun id uzayı bir gün kesişirse SESSİZCE YANLIŞ fiyat önerilir.
   * Bu yüzden zincir, taraf fason olduğunda müşteri istisnasını hiç sormaz.
   */
  supplier?: SupplierParty | null;
  currency?: string;
  /** ④ Bu satırın "önce ürün seçin" uyarısı yanıyor mu (formun geçici bayrağı, 3 s). */
  warnLineKey?: string | null;
  /** Ürünsüz satırda fiyat/miktar alanına odak → formu uyar. */
  onWarnLine?: (key: string) => void;
}

export const PO_ITEM_WARNING_TEXT = "Önce ürün seçin";

/** Grid şablonu — başlık satırı ve her kalem satırı AYNI şablonu okur; ≤ lg iki sütuna sarar (01'in `lineGridCols` deseni). */
export const PO_LINE_GRID = "grid grid-cols-2 gap-2 lg:grid-cols-[2rem_minmax(0,2fr)_10rem_8.5rem_minmax(0,1.4fr)_4.5rem]";
export const PO_LINE_HEADERS = ["#", "Ürün", "Miktar", "Birim Fiyat", "Not", ""] as const;

/** Miktarın birimi — ÜRÜN KARTINDAN (`Item.unit`), salt gösterge: PO satırı birim TAŞIMAZ (kullanıcı kanaati: birim fişte
 *  değiştirilmez). Önbellek anahtarı `ItemSelect`/`ReferenceSelect`/`useItemTypes` ile aynı — aynı ürün ikinci kez sorulmaz. */
function useItemUnits(itemIds: Array<string | null | undefined>): Map<string, string> {
  const ids = [...new Set(itemIds.filter((x): x is string => Boolean(x)))].sort();
  const queries = useQueries({
    queries: ids.map((id) => ({ queryKey: ["items", "ref-select-by-id", id], queryFn: () => itemService.getById(id), staleTime: 5 * 60_000 })),
  });
  const map = new Map<string, string>();
  queries.forEach((q, i) => {
    const u = q.data?.data?.unit;
    const id = ids[i];
    if (u && id) map.set(id, u);
  });
  return map;
}

/**
 * Birim fiyat hücresi — ürün seçilince tedarikçiye göre ALIŞ fiyatı önerisi.
 *
 * Ayrı bileşen: öneri kancası satır başınadır, `map` içinde kanca çağrılamaz.
 * Yazma kuralı ortak saf yüklemde (`shouldApplySuggestion`): boşken doldur ·
 * kullanıcının yazdığını ASLA ezme · kaynak değişince yalnız bizim yazdığımız
 * değeri tazele. `financeEnabled` kapısı kancanın içindedir. Salt-okunur modda
 * (`disabled`) öneri de KAPALIDIR — okunur forma yazmak, kaydedilemeyecek bir
 * değişikliği sessizce üretmekti.
 */
function PoLinePriceField({
  line, priceCustomerId, currency, disabled, onPatch,
}: {
  line: PoDraftLine;
  /** Yalnız MÜŞTERİ-TİPLİ cari tedarikçide dolu (bkz. Props yorumu). */
  priceCustomerId: string | null;
  currency: string | null;
  disabled?: boolean;
  onPatch: (p: Partial<PoDraftLine>) => void;
}) {
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const suggestion = useItemPriceSuggestion({
    itemId: line.itemId || null,
    kind: "PURCHASE",
    currency,
    customerId: priceCustomerId,
    enabled: !disabled,
    current: line.unitPrice,
    onApply: (p) => patchRef.current({ unitPrice: p }),
  });
  const helper = describeSuggestion({
    price: suggestion.price,
    source: suggestion.source,
    message: suggestion.message,
    current: line.unitPrice,
  });

  return (
    <div className="min-w-0">
      <Input
        type="number"
        min={0}
        step="0.0001"
        placeholder="—"
        disabled={disabled}
        value={line.unitPrice ?? ""}
        onChange={(e) => onPatch({ unitPrice: e.target.value ? Number(e.target.value) : null })}
      />
      {helper && <p className="mt-1 text-[10px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

export function PurchaseOrderLineRows({ lines, onChange, disabled, supplier, currency, warnLineKey = null, onWarnLine }: Props) {
  // Fason tarafta müşteri istisnası HİÇ sorulmaz → kart varsayılanı önerilir.
  const priceCustomerId = supplier?.kind === "CUSTOMER" ? supplier.id : null;
  const patch = (key: string, p: Partial<PoDraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const units = useItemUnits(lines.map((l) => l.itemId));
  const dupes = new Set(duplicateItemIds(lines));
  // ④ Ürünsüz satırda miktar/fiyat alanına odak → geçici uyarı (kalıcı metin yok).
  const guard = (l: PoDraftLine) => {
    if (!l.itemId) onWarnLine?.(l.key);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-md border" data-testid="po-lines">
      <div className={cn(PO_LINE_GRID, "border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground")} data-testid="po-line-headers">
        {PO_LINE_HEADERS.map((h, i) => (
          <span key={i} className={i === 0 ? "hidden lg:block" : undefined}>{h}</span>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {lines.map((l, idx) => {
          const warn = warnLineKey === l.key;
          const unit = l.itemId ? units.get(l.itemId) : undefined;
          return (
          <div key={l.key} className={cn(PO_LINE_GRID, "items-center")} data-testid="po-line">
            <Badge variant="muted" className="hidden h-6 w-6 justify-center font-mono lg:flex">
              {idx + 1}
            </Badge>
            <div className="min-w-0">
              {/* Ürün seçici MODAL (2026-09-17): kutuya tıkla → tam liste + tür/renk/özellik süzgeci; satıra
                  yazılan alan değişmedi (yalnız itemId). */}
              <ItemSelect
                value={l.itemId || null}
                onChange={(v) => patch(l.key, { itemId: v ?? "" })}
                placeholder="Ürün ara..."
                disabled={disabled}
                triggerClassName={warn ? "ring-2 ring-amber-500 ring-offset-1" : undefined}
              />
              {/* ④ Geçici uyarı: yanınca görünür, 3 s sonra söner (01'in sipariş formu ③ deseni). */}
              <p role="status" aria-live="polite" className={cn("text-xs text-amber-700 transition-opacity duration-300 dark:text-amber-400", warn ? "mt-1 opacity-100" : "sr-only opacity-0")}>
                {warn ? PO_ITEM_WARNING_TEXT : ""}
              </p>
              {/* Sessiz kabul YOK: aynı ürün ikinci kez eklenince eşlemenin
                  varsayıma dönüştüğü SÖYLENİR — engellenmez, çünkü iki termin
                  meşru bir ticari kayıttır. */}
              {l.itemId && dupes.has(l.itemId) && (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">
                  Bu ürün birden fazla kalemde var — gelen mal üstteki kaleme önce yazılır.
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                aria-label="Miktar"
                disabled={disabled}
                value={l.qty || ""}
                onFocus={() => guard(l)}
                onChange={(e) => patch(l.key, { qty: Number(e.target.value) })}
              />
              {/* Birim ürün kartından, SALT GÖSTERGE — PO satırı birim taşımaz. */}
              {unit && <Badge variant="outline" className="shrink-0 font-mono text-[10px]" title="Birim ürün kartından gelir; siparişte değiştirilmez">{unit}</Badge>}
            </div>
            <div onFocusCapture={() => guard(l)}>
              <PoLinePriceField
                line={l}
                priceCustomerId={priceCustomerId}
                currency={currency ?? null}
                disabled={disabled}
                onPatch={(p) => patch(l.key, p)}
              />
            </div>
            <Input
              maxLength={300}
              aria-label="Not"
              placeholder={idx === 0 ? "Örn. 2. termin, 15 Eylül" : "—"}
              disabled={disabled}
              value={l.notes}
              onChange={(e) => patch(l.key, { notes: e.target.value })}
            />
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="Kalemi kopyala"
                disabled={disabled}
                onClick={() => onChange([...lines, duplicatePoLine(l)])}
              >
                <Copy className="h-4 w-4" />
              </Button>
              {/* Silme yıkıcı — kırmızı zemin (saha isteği: "tehlikeli olduğu
                  belli olsun"). Tek kalem kalınca kapalı: backend en az bir kalem
                  istiyor ve boş formu kaydettirmek 400'e yürütmek olurdu. */}
              <Button
                size="icon"
                title="Kalemi sil"
                className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-40"
                disabled={disabled || lines.length === 1}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
