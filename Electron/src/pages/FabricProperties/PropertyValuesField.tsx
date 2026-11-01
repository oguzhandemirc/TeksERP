import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServiceItemPickerField } from "./ServiceItemPickerField";
import { resolveServiceHint, serviceHintText, type ServiceItemOption } from "./serviceMapping";
import type { FabricProperty } from "./types";

export interface PropertyValueRow {
  code: string;
  name: string;
  isActive: boolean;
  serviceItemId?: string | null;
  stitchCount?: number | null;
}

/** Hizmet kalemi eşlemesi (H6b) — verilmezse satırlar bugünkü gibi çizilir. */
export interface ValueServiceContext {
  items: readonly ServiceItemOption[];
  /** Formdaki özellik düzeyi eşleme (henüz kaydedilmemiş seçim dahil). */
  propertyServiceItemId: string | null;
  /** "Şunun çeşidi" ana bayrağı (çözücünün 3. basamağı). */
  parent: Pick<FabricProperty, "name" | "serviceItemId"> | null;
}

interface Props {
  value: PropertyValueRow[];
  onChange: (rows: PropertyValueRow[]) => void;
  /** Düzenlenen kayıtta zaten VAR OLAN kodlar — silinemez, yalnız pasifleşir. */
  existingCodes: string[];
  service?: ValueServiceContext;
  /** Desen başına vuruş sayısı kutusu (bayrak çeşidi — brode deseni). */
  showStitch?: boolean;
}

/**
 * SEÇİM tipli özelliğin değer listesi editörü (kat: 2-KAT / 4-KAT / TUP …).
 *
 * ⚠️ KAYITLI DEĞER SİLİNMEZ, PASİFLEŞİR. O kod geçmiş kayıtlarda metin olarak
 * duruyor (`Roll.foldType = "TUP"`); satırı yok etmek, o kaydı "katalogda
 * karşılığı olmayan" hale getirir ve düzenlenmesini imkânsızlaştırır. Backend
 * de aynı şeyi yapar (listede olmayan kod `isActive=false`) — buradaki kilit
 * kullanıcının niyetiyle sonucu HİZALAR: sil tuşu görünmez, "Pasif" görünür.
 * Henüz kaydedilmemiş (yeni eklenen) satır serbestçe silinebilir.
 */
export function PropertyValuesField({ value, onChange, existingCodes, service, showStitch }: Props) {
  const saved = new Set(existingCodes.map((c) => c.toUpperCase()));

  const patch = (i: number, next: Partial<PropertyValueRow>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...next } : r)));

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Henüz değer yok. Kat için örnek: <span className="font-mono">2-KAT</span>,{" "}
          <span className="font-mono">4-KAT</span>, <span className="font-mono">TUP</span>
        </p>
      )}

      {value.map((row, i) => {
        const isSaved = saved.has(row.code.trim().toUpperCase());
        return (
          <div key={i} className="space-y-1">
            {/* Dar ekranda (390 px) kod kutusu sabit genişlikte kalır; Aktif/sil alt satıra iner. */}
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <Input
                className="w-28 shrink-0 font-mono uppercase sm:w-36"
                placeholder="6-KAT"
                value={row.code}
                // Kod KİMLİK: her zaman büyük harf saklanır ki "6-kat" ile "6-KAT"
                // iki ayrı satır doğurmasın (backend de upper'lar).
                onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })}
                disabled={isSaved}
                title={
                  isSaved
                    ? "Kayıtlı değerin kodu değiştirilemez — geçmiş kayıtlar bu koda bakıyor"
                    : undefined
                }
              />
              <Input
                className="min-w-[6rem] flex-1"
                placeholder="6 Kat"
                value={row.name}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
              {showStitch && (
                <Input
                  className="w-24 shrink-0"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="Vuruş"
                  aria-label={`${row.code || "Yeni değer"} vuruş sayısı`}
                  title="Bir adetteki vuruş (dikiş) sayısı — brode vuruşla fiyatlanırken kullanılır"
                  value={row.stitchCount ?? ""}
                  onChange={(e) => patch(i, { stitchCount: e.target.value === "" ? null : Math.trunc(Number(e.target.value)) })}
                />
              )}
              <label className="flex shrink-0 items-center gap-1 text-xs sm:w-20">
                <input
                  type="checkbox"
                  checked={row.isActive}
                  onChange={(e) => patch(i, { isActive: e.target.checked })}
                />
                Aktif
              </label>
              {isSaved ? (
                <span className="w-8 shrink-0 text-center text-[10px] leading-tight text-muted-foreground">
                  kalıcı
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                  title="Satırı kaldır"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {service && (
              <ValueServiceRow row={row} service={service} onPick={(id) => patch(i, { serviceItemId: id })} />
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { code: "", name: "", isActive: true, serviceItemId: null, stitchCount: null }])}
      >
        <Plus className="mr-1 h-4 w-4" /> Değer Ekle
      </Button>
    </div>
  );
}

/** Değer satırının hizmet kalemi seçicisi + "bu gramaj X olarak faturalanır" ipucu (yalnız gösterir). */
function ValueServiceRow({
  row,
  service,
  onPick,
}: {
  row: PropertyValueRow;
  service: ValueServiceContext;
  onPick: (id: string | null) => void;
}) {
  const hint = resolveServiceHint(row.serviceItemId, service.propertyServiceItemId, service.parent);
  return (
    <div className="flex flex-col gap-1 pl-0 sm:flex-row sm:items-center sm:gap-2 sm:pl-2">
      <ServiceItemPickerField
        value={row.serviceItemId ?? null}
        onChange={onPick}
        items={service.items}
        noneLabel="Özelliğin kalemine düşer"
        ariaLabel={`${row.code || "Yeni değer"} hizmet kalemi`}
        className="w-full sm:w-64 sm:shrink-0"
      />
      <p className="min-w-0 text-xs text-muted-foreground" data-testid="service-hint">
        {serviceHintText(hint, service.items)}
      </p>
    </div>
  );
}
