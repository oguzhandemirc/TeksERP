import type { ReactNode } from "react";
import { Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";

/**
 * Genel Ayarlar'ın TEK kaydetme standardı — her bölümde aynı çubuk.
 * Kontroller taslak tutulur; "Kaydet" o bölümdeki tüm değişiklikleri yazar, "Geri al" sunucu değerine döner.
 * Çubuk YALNIZ kaydedilmemiş değişiklik varken görünür ve kaydırıcının altına yapışır (opak): sayfa
 * ortasında içerikle kaymaz, altındaki bölümü örtmez (denetim O27). Sekme değişimi uyarısı [[settings-dirty]].
 */
export function SettingsSaveBar({
  dirty,
  saving,
  canSave = true,
  onSave,
  onReset,
  saveLabel = "Kaydet",
  note,
}: {
  dirty: boolean;
  saving: boolean;
  /** Doğrulama geçmezse Kaydet pasif (taslak yine "Geri al" ile atılabilir). */
  canSave?: boolean;
  onSave: () => void;
  onReset: () => void;
  saveLabel?: string;
  /** Kaydetmeyle ilgili bilgi — çubukta ⓘ baloncuğunda. */
  note?: ReactNode;
}) {
  if (!dirty && !saving) return null;
  return (
    <div
      className="sticky bottom-0 z-20 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3 shadow-card"
      data-settings-save-bar
    >
      <span className="text-xs font-medium text-warning">Kaydedilmemiş değişiklik</span>
      {note ? <InfoPopover desc={note} label="Kaydetme hakkında" /> : null}
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || saving}
          onClick={onReset}
          className="gap-1.5 text-muted-foreground"
        >
          <Undo2 className="h-3.5 w-3.5" /> Geri al
        </Button>
        <Button type="button" disabled={!dirty || !canSave || saving} onClick={onSave} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? "Kaydediliyor…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
