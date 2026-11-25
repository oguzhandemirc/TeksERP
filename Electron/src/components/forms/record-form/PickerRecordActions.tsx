import { Copy, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecordFormHandle } from "./useRecordForm";

/** Seçici satırının sağındaki iki küçük eylem: kalem (Düzenle) + kopya (Örnek al). İzin yoksa çizilmez. */
export function PickerRowActions<T>({ handle, item, label }: { handle: RecordFormHandle<T>; item: T; label: string }) {
  if (!handle.canWrite) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        aria-label={`${label} — düzenle`}
        title="Düzenle"
        onClick={() => handle.openEdit(item)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        aria-label={`${label} — örnek al (yeni kayıt)`}
        title="Örnek al: bu kaydın değerleriyle YENİ kayıt aç (kaynak değişmez)"
        onClick={() => void handle.openTemplate(item)}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** Seçici başlığındaki "Yeni" düğmesi — seçiciden çıkmadan yeni kayıt; kaydedince seçili gelir. */
export function PickerNewButton<R>({ handle, entityName }: { handle: RecordFormHandle<R>; entityName: string }) {
  if (!handle.canWrite) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-9 shrink-0 gap-1.5"
      aria-label={`Yeni ${entityName} ekle`}
      title={`Yeni ${entityName} ekle`}
      onClick={handle.openCreate}
    >
      <Plus className="h-3.5 w-3.5" />Yeni
    </Button>
  );
}
