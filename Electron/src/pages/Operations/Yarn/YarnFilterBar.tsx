// =============================================================================
// İPLİK STOK FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ Şerit `PageBody`'nin DIŞINDA ve `shrink-0` — içine konursa liste kaydıkça
// filtreler yukarı kaçar ve kullanıcı hangi daraltmaya baktığını göremez.
//
// ⚠️ VARSAYILAN "YALNIZ BAKİYESİ OLANLAR"dır, "tümü" değil. Depo ekranının tek
// sorusu "elimde ne var"; bitmiş yüzlerce kalem listenin başına gelirse (liste
// BAKİYE sıralı) o soru cevapsız kalır. Sıfır bakiye gizlenmiş DEĞİL, tek
// tıkla geri gelir ve seçim şeritte GÖRÜNÜR durur — kullanıcı dar bir listeye
// baktığını bilmeli. ⚠️ EKSİ bakiye bu süzgeçle KAYBOLMAZ (backend `NOT
// balanceKg = 0` uyguluyor): eksi bakiye tam da görülmesi gereken şeydir.
//
// ⚠️ KUMAŞ DEĞİL İPLİK: kalem seçici `filter[itemType]=YARN` ile daraltılır.
// Daraltılmasaydı kullanıcı bir kumaş seçebilir, liste tanım gereği boş dönerdi
// ("stok yok" gibi görünen, aslında "yanlış soru" olan bir cevap).
//
// ⚠️ DEPO SEÇİCİ TEK DEPOLU KURULUMDA ÇİZİLMEZ (`useMultiWarehouse`): seçilecek
// ikinci depo yokken seçici yalnız gürültüdür. İkinci depo açıldığı gün
// kendiliğinden belirir.
// =============================================================================
import { RotateCcw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { useMultiWarehouse } from "@/hooks/useWarehouses";

export interface YarnFilterState {
  search: string;
  itemId: string | null;
  warehouseId: string;
  onlyNonZero: boolean;
}

export const EMPTY_YARN_FILTERS: YarnFilterState = {
  search: "",
  itemId: null,
  warehouseId: "",
  onlyNonZero: true,
};

export function isYarnFilterDirty(f: YarnFilterState): boolean {
  return Boolean(f.search || f.itemId || f.warehouseId) || f.onlyNonZero !== EMPTY_YARN_FILTERS.onlyNonZero;
}

/**
 * Liste BOŞ dönünce ne yazacağımız — saf kural, bileşen içi ternary DEĞİL.
 *
 * ⚠️ "HİÇ KAYIT YOK" CÜMLESİ YALNIZ SÜZGEÇSİZ SORGUDA KURULABİLİR. Varsayılan
 * filtre `onlyNonZero = true` olduğu için "boş liste" çoğu zaman *"bakiyesi
 * olan iplik yok"* demektir — deftere hiç yazılmadığı anlamına GELMEZ. İkisini
 * aynı cümleyle geçiştirmek, bu projenin defalarca ısırılmış hatası: kullanıcı
 * kaydın sistemde olmadığı sonucuna varır ve İKİNCİ KEZ girer. (Emsal: Çek
 * portföyünde varsayılan "canlı" süzgeci — oradaki boş mesaj da süzgeci ADIYLA
 * söyler.) Bu yüzden karar `isYarnFilterDirty` ile YETİNMEZ: o yüklem
 * varsayılanı "temiz" sayar, oysa varsayılanın kendisi bir daraltmadır.
 *
 * ⚠️ `isYarnFilterDirty` BURADA KULLANILAMAZ, ikinci bir sebeple daha: o yüklem
 * "durum varsayılandan farklı mı" diye sorar ve kutuyu KALDIRMAK da farktır —
 * oysa kutuyu kaldırmak listeyi GENİŞLETİR. O durumda "filtreleri temizleyin"
 * demek, kullanıcıyı listeyi yeniden DARALTMAYA yönlendirmek olurdu. Burada
 * sorulan soru başkadır: *sonucu kırpan bir daraltma var mı?*
 */
function hasNarrowingFilter(f: YarnFilterState): boolean {
  return Boolean(f.search || f.itemId || f.warehouseId);
}

export function yarnEmptyStateMessage(f: YarnFilterState): string {
  if (f.onlyNonZero) {
    return hasNarrowingFilter(f)
      ? "Bu filtreyle bakiyesi olan iplik yok. Sıfır bakiyeli kalemler gizli — “Yalnız bakiyesi olanlar” kutusunu kaldırın ya da diğer filtreleri temizleyin."
      : "Bakiyesi olan iplik yok. Sıfır bakiyeli kalemler gizli — hepsini görmek için “Yalnız bakiyesi olanlar” kutusunu kaldırın.";
  }
  return hasNarrowingFilter(f)
    ? "Bu filtreyle kayıt yok. Filtreleri temizleyip tekrar bakın."
    : "Henüz iplik stok hareketi yok. Mal kabul fişi girildiğinde bakiye kendiliğinden doğar; elle açılış için “Hareket Ekle” → “Giriş (+)”.";
}

/** Kalem seçicinin daraltması — kumaş/sarf malzemesi bu deftere yazılamaz. */
export const YARN_ITEM_FILTER = { itemType: "YARN" } as const;

interface Props {
  value: YarnFilterState;
  onChange: (next: YarnFilterState) => void;
}

export function YarnFilterBar({ value, onChange }: Props) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();

  const set = <K extends keyof YarnFilterState>(key: K, v: YarnFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      <div className="relative w-72">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="İplik adı / stok kodu ara…"
          value={value.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>

      <div className="w-64">
        <ReferenceSelect<Item>
          value={value.itemId}
          onChange={(v) => set("itemId", v)}
          service={itemService}
          queryKey="items-yarn"
          getLabel={(it) => `${it.code} — ${it.name}`}
          placeholder="Tüm iplikler"
          extraFilters={YARN_ITEM_FILTER}
          nullable
          noneLabel="Tüm iplikler"
        />
      </div>

      {multiWarehouse && (
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={value.warehouseId}
          onChange={(e) => set("warehouseId", e.target.value)}
        >
          <option value="">Tüm depolar</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="yarn-only-nonzero"
          checked={value.onlyNonZero}
          onCheckedChange={(c) => set("onlyNonZero", c === true)}
        />
        <Label htmlFor="yarn-only-nonzero" className="cursor-pointer text-sm font-normal">
          Yalnız bakiyesi olanlar
        </Label>
      </div>

      {isYarnFilterDirty(value) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_YARN_FILTERS)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
    </div>
  );
}
