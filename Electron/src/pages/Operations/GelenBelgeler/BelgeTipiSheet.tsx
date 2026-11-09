// Belge tipi detay paneli — satıra tıklayınca açılır; eski liste kartının tamamını (kural özeti, gönderen cari, varsayılan
// sahip, parti no alanı, Düzenle/Fotoğrafla/Sıfırla) taşır. Satır güncel listeden okunur: PATCH sonrası panel bayat kalmaz.
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { SenderTemplatePatch, SenderTemplateView } from "./types";
import type { TemplateJson } from "./tanit/types";
import { TemplateCard, UnusedRow } from "./BelgeTipiKarti";
import { isInUse } from "./belgeTipiColumns";

interface Props {
  row: SenderTemplateView | null;
  template: TemplateJson | null;
  busy: boolean;
  onPatch: (patch: SenderTemplatePatch) => void;
  onReset: () => void;
  onClose: () => void;
}

export function BelgeTipiSheet({ row, template, busy, onPatch, onReset, onClose }: Props) {
  return (
    <Sheet open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>{row.name}</SheetTitle>
              <SheetDescription>Gönderen cari, varsayılan sahip ve parti no alanı burada bağlanır; değişiklik hemen kaydedilir.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-3">
              {isInUse(row) ? (
                <TemplateCard row={row} busy={busy} onPatch={onPatch} template={template} onReset={onReset} />
              ) : (
                <div className="rounded-lg border">
                  <p className="px-3 py-2 text-xs text-muted-foreground">Bu tip belge tanımaz. Eski belgeler ve okumalar etkilenmez; "Geri al" tipi yeniden kullanıma açar.</p>
                  <UnusedRow row={row} busy={busy} onPatch={onPatch} />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
