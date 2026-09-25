import { useEffect } from "react";
import { FileSpreadsheet, Tags, Undo2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

// =============================================================================
// Sevk irsaliyesi diyaloğunun SLOT parçaları — jenerik PrintedDocDialog'a
// sayfa katmanından geçen, sevkiyata özgü kalemler.
// =============================================================================

const fmtM = (v: number) =>
  v.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * "Sevk sonrası iade" bandı — belge ile CANLI durumun neden ayrıştığını söyler.
 *
 * İrsaliye sevk anında DONAR ve iade onu değiştirmez (doğru davranış: müşteriye/
 * gümrüğe giden belge malın çıktığı anı gösterir, iade ayrı belgeyle kapanır).
 * Ama ekranda hiçbir işaret yoksa kullanıcı belgedeki metrajı listedeki/Excel'deki
 * canlı metrajla karşılaştırıp "hangisi doğru" diye takılıyor — üstelik versiyon
 * rozetindeki "Güncel" ifadesi "içerik güncel" diye okunuyor (aslında "en son
 * versiyon, hiç revize edilmedi" demek). Bant tam bu boşluğu kapatır.
 */
export function ReturnsNotice({ returns }: { returns: { count: number; meters: number } }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
      <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <div className="min-w-0">
        <span className="font-medium">
          Bu belge sevk anına aittir — sonrasında {returns.count} top ({fmtM(returns.meters)} m)
          iade alınmıştır.
        </span>{" "}
        <span className="text-muted-foreground">
          İade belgedeki rakamlardan düşülmez (fatura irsaliyeden kesilir, iade ayrı
          belgeyle kapanır). Dökümü sevkiyat detayındaki “İadeler” bölümünde.
        </span>
      </div>
    </div>
  );
}

/**
 * "İndir ▾" içindeki Excel kalemi. Menü AÇILDIĞINDA mount olur ve raporu ancak
 * o an ister — yapılandırılmış veri seti her belge açılışında değil, gerçekten
 * indirilecekse çekilir. Sayfa sayısı yazılmaz: Excel PDF'te basılan listeleri
 * taşır ve o sayı şablona/baskı seçeneğine göre değişir.
 */
export function DispatchExcelItem({
  ready,
  onNeedReport,
  onExport,
}: {
  ready: boolean;
  onNeedReport: () => void;
  onExport: () => void;
}) {
  useEffect(() => {
    onNeedReport();
  }, [onNeedReport]);

  return (
    <DropdownMenuItem disabled={!ready} onSelect={onExport} className="gap-2">
      <FileSpreadsheet className="h-4 w-4" />
      {ready ? "Excel" : "Excel (hazırlanıyor…)"}
    </DropdownMenuItem>
  );
}

/** "Yazdır ▾" içindeki toplu top etiketi kalemi — önizleme diyaloğunu açar. */
export function RollLabelItem({
  count,
  ready,
  onNeedReport,
  onOpen,
}: {
  count: number;
  ready: boolean;
  onNeedReport: () => void;
  onOpen: () => void;
}) {
  useEffect(() => {
    onNeedReport();
  }, [onNeedReport]);

  return (
    <DropdownMenuItem disabled={!ready || count === 0} onSelect={onOpen} className="gap-2">
      <Tags className="h-4 w-4" />
      {ready ? `Top etiketlerini bas (${count})` : "Top etiketleri (hazırlanıyor…)"}
    </DropdownMenuItem>
  );
}
