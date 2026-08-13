import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PropertyValueRow {
  code: string;
  name: string;
  isActive: boolean;
}

interface Props {
  value: PropertyValueRow[];
  onChange: (rows: PropertyValueRow[]) => void;
  /** Düzenlenen kayıtta zaten VAR OLAN kodlar — silinemez, yalnız pasifleşir. */
  existingCodes: string[];
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
export function PropertyValuesField({ value, onChange, existingCodes }: Props) {
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
          <div key={i} className="flex items-center gap-2">
            <Input
              className="w-36 font-mono uppercase"
              placeholder="6-KAT"
              value={row.code}
              // Kod KİMLİK: her zaman büyük harf saklanır ki "6-kat" ile "6-KAT"
              // iki ayrı satır doğurmasın (backend de upper'lar).
              onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })}
              disabled={isSaved}
              title={isSaved ? "Kayıtlı değerin kodu değiştirilemez — geçmiş kayıtlar bu koda bakıyor" : undefined}
            />
            <Input
              className="flex-1"
              placeholder="6 Kat"
              value={row.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <label className="flex w-20 shrink-0 items-center gap-1 text-xs">
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
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { code: "", name: "", isActive: true }])}
      >
        <Plus className="mr-1 h-4 w-4" /> Değer Ekle
      </Button>
    </div>
  );
}
