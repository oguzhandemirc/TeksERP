// =============================================================================
// KG BAKİYE LİSTESİ (kalem × depo)
// =============================================================================
// ⚠️ EKSİ BAKİYE HATA GİBİ GÖSTERİLMEZ. Sayım/açılış girilmeden çıkış
// yazıldıysa defter GERÇEKTEN eksidir ve bu meşrudur; kırmızı "hata" rozeti
// operatörü olmayan bir arızayı aramaya gönderirdi. Ama gizlenmez ve sıfıra da
// kırpılmaz — nötr bir uyarı işareti (amber üçgen + "eksi bakiye" ibaresi) ile
// GÖRÜNÜR yapılır. ⚠️ Renk tek başına bilgi taşımaz (renk körlüğü + eldivenli
// hızlı bakış): ibare her zaman METİN olarak da basılır.
//
// ⚠️ SATIRIN TIKLANMASI HAREKET DÖKÜMÜNÜ AÇAR, bir şey DEĞİŞTİRMEZ. Bu ekranda
// tek yıkıcı olmayan-geri-alınamaz eylem hareket yazmaktır ve o, kendi
// düğmesinin arkasındadır (`yarn:write`).
//
// ⚠️ DEPO SÜTUNU tek depolu kurulumda çizilmez — "sıfır görünür fark" kuralının
// sütun ayağı (`useMultiWarehouse` tek kaynak; burada YENİDEN hesaplanmaz).
// =============================================================================
import { AlertTriangle, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { formatInstant, type YarnStockRow } from "./service";
import { isNegative, kg } from "./qty";

interface Props {
  rows: YarnStockRow[];
  showWarehouse: boolean;
  onOpenMovements: (row: YarnStockRow) => void;
  onAddMovement: (row: YarnStockRow) => void;
}

export function YarnStockTable({ rows, showWarehouse, onOpenMovements, onAddMovement }: Props) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Stok Kodu</th>
            <th className="px-3 py-2 text-left">İplik</th>
            {showWarehouse && <th className="px-3 py-2 text-left">Depo</th>}
            <th className="px-3 py-2 text-right">Bakiye</th>
            <th className="px-3 py-2 text-left">Son Hareket</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const negative = isNegative(r.balanceKg);
            return (
              <tr
                key={r.id}
                className="cursor-pointer border-t hover:bg-muted/40"
                onClick={() => onOpenMovements(r)}
              >
                <td className="px-3 py-2 font-mono text-xs">{r.item.code}</td>
                <td className="px-3 py-2 font-medium">{r.item.name}</td>
                {showWarehouse && <td className="px-3 py-2 text-muted-foreground">{r.warehouse.name}</td>}
                <td className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      negative && "text-amber-700 dark:text-amber-500",
                    )}
                  >
                    {kg(r.balanceKg)}
                  </span>
                  {negative && (
                    <div className="flex items-center justify-end gap-1 text-[11px] text-amber-700 dark:text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      eksi bakiye
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {formatInstant(r.updatedAt)}
                </td>
                <td className="px-3 py-2">
                  {/* Satır tıklaması dökümü zaten açıyor; düğmeler o davranışı
                      GÖRÜNÜR kılar ve klavye ile erişilebilir tutar.
                      `stopPropagation` olmadan "Hareket Ekle" aynı anda dökümü
                      de açar ve diyalog panelin altında kalırdı. */}
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      title="Hareket dökümü"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenMovements(r);
                      }}
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    <PermissionGate permission="yarn:write">
                      <Button
                        variant="outline"
                        size="icon"
                        title="Bu iplik için hareket ekle"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddMovement(r);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </PermissionGate>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
