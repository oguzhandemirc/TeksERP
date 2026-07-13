import type { ReactNode } from "react";
import { Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Genel Ayarlar'ın TEK kaydetme standardı — her sekmenin altında aynı çubuk.
 * Kontroller taslak tutulur; "Kaydet" o sekmedeki tüm değişiklikleri yazar,
 * "Geri al" sunucu değerine döner. "Kaydedilmemiş değişiklik" rozeti + sekme
 * değişiminde uyarı ([[settings-dirty]]) ile birlikte tutarlı davranış sağlar.
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
  note?: ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
      <Button
        type="button"
        disabled={!dirty || !canSave || saving}
        onClick={onSave}
        className="gap-1.5"
      >
        <Save className="h-4 w-4" />
        {saving ? "Kaydediliyor…" : saveLabel}
      </Button>
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
      {dirty && (
        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
          • Kaydedilmemiş değişiklik
        </span>
      )}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
