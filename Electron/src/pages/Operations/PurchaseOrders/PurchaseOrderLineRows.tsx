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
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";

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
}

export function PurchaseOrderLineRows({ lines, onChange, disabled }: Props) {
  const patch = (key: string, p: Partial<PoDraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const cols = "grid-cols-[minmax(0,1fr)_110px_120px_minmax(0,220px)_76px]";
  const dupes = new Set(duplicateItemIds(lines));

  return (
    <div className="rounded-md border">
      <div
        className={`grid ${cols} gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground`}
      >
        <span>Ürün</span>
        <span>Miktar</span>
        <span>Birim Fiyat</span>
        <span>Not</span>
        <span />
      </div>

      <div className="max-h-[38vh] space-y-2 overflow-auto p-3">
        {lines.map((l, idx) => (
          <div key={l.key} className={`grid ${cols} items-center gap-2`}>
            <div className="min-w-0">
              <ReferenceSelect<Item>
                value={l.itemId || null}
                onChange={(v) => patch(l.key, { itemId: v ?? "" })}
                service={itemService}
                queryKey="items"
                getLabel={(it) => `${it.code} — ${it.name}`}
                placeholder="Ürün ara..."
                disabled={disabled}
              />
              {/* Sessiz kabul YOK: aynı ürün ikinci kez eklenince eşlemenin
                  varsayıma dönüştüğü SÖYLENİR — engellenmez, çünkü iki termin
                  meşru bir ticari kayıttır. */}
              {l.itemId && dupes.has(l.itemId) && (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">
                  Bu ürün birden fazla kalemde var — gelen mal üstteki kaleme önce yazılır.
                </p>
              )}
            </div>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              disabled={disabled}
              value={l.qty || ""}
              onChange={(e) => patch(l.key, { qty: Number(e.target.value) })}
            />
            <Input
              type="number"
              min={0}
              step="0.0001"
              placeholder="—"
              disabled={disabled}
              value={l.unitPrice ?? ""}
              onChange={(e) => patch(l.key, { unitPrice: e.target.value ? Number(e.target.value) : null })}
            />
            <Input
              maxLength={300}
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
        ))}
      </div>
    </div>
  );
}
