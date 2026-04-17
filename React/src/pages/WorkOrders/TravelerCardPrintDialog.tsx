import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { workOrderService } from "@/services/workOrderService";
import type { TravelerCard } from "@/types/models";

interface Props {
  card: TravelerCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Refakat kartı için yazdırılabilir etiket.
 * JsBarcode CDN'den dinamik yükleyip SVG olarak çizer.
 */
export default function TravelerCardPrintDialog({
  card,
  open,
  onOpenChange,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const { data: woData } = useQuery({
    queryKey: ["workorder-detail", card.workOrderId],
    queryFn: () => workOrderService.getById(card.workOrderId),
    enabled: open,
  });
  const wo = woData?.data;

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const w = window.open("", "_blank");
    if (!w) return;

    // Bar code for thermal printer — yazıcının barcode font'una güvenebiliriz,
    // ama görsel olması için Code128-benzeri CSS bar çizimi yerine standart
    // monospace + büyük barkod metni kullanıyoruz. İsteğe göre JsBarcode eklenebilir.
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Refakat Kartı - ${card.cardNumber}</title>
          <style>
            @page { size: A5; margin: 10mm; }
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 8px;
              color: #000;
            }
            .card {
              border: 2px solid #000;
              padding: 12px;
              max-width: 520px;
              margin: 0 auto;
            }
            .title {
              text-align: center;
              font-size: 16px;
              font-weight: bold;
              border-bottom: 1px solid #000;
              padding-bottom: 6px;
              margin-bottom: 10px;
              letter-spacing: 1px;
            }
            .row { display: flex; justify-content: space-between; margin: 4px 0; font-size: 12px; }
            .row b { font-weight: 600; }
            .barcode-area {
              text-align: center;
              margin: 12px 0;
              padding: 8px;
              background: #f5f5f5;
            }
            .barcode-human {
              font-family: 'Courier New', monospace;
              font-size: 20px;
              font-weight: bold;
              letter-spacing: 2px;
            }
            .barcode-label {
              font-size: 10px;
              color: #666;
              margin-top: 4px;
            }
            .route {
              margin-top: 12px;
              border-top: 1px solid #000;
              padding-top: 6px;
            }
            .route-step {
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 4px 0;
              font-size: 11px;
              border-bottom: 1px dashed #ccc;
            }
            .route-step .seq {
              width: 22px;
              height: 22px;
              border-radius: 50%;
              border: 1px solid #000;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              flex-shrink: 0;
            }
            .route-step .sign {
              margin-left: auto;
              border-bottom: 1px solid #000;
              min-width: 100px;
              height: 18px;
            }
            .footer {
              margin-top: 12px;
              font-size: 9px;
              color: #666;
              text-align: center;
            }
          </style>
        </head>
        <body>${content.innerHTML}</body>
      </html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 300);
  };

  const steps = (wo?.steps ?? []).slice().sort(
    (a, b) => a.stepSequence - b.stepSequence,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Refakat Kartı — {card.cardNumber}
          </DialogTitle>
        </DialogHeader>

        <div
          ref={printRef}
          className="bg-white text-black border rounded p-3"
        >
          <div className="card">
            <div className="title">REFAKAT KARTI / TRAVELER CARD</div>

            <div className="row">
              <span><b>Kart No:</b> {card.cardNumber}</span>
              <span><b>Versiyon:</b> v{card.version}</span>
            </div>

            <div className="row">
              <span><b>Parti No:</b> {wo?.batchNumber ?? "—"}</span>
              <span>
                <b>Basım:</b>{" "}
                {new Date(card.printedAt).toLocaleString("tr-TR")}
              </span>
            </div>

            <div className="row">
              <span><b>Tür:</b> {wo?.type ?? "—"}</span>
              {wo?.width && <span><b>En:</b> {wo.width} cm</span>}
              {wo?.recipeNo && <span><b>Reçete:</b> {wo.recipeNo}</span>}
            </div>

            {wo?.targetQuantity && (
              <div className="row">
                <span><b>Hedef Metraj:</b> {wo.targetQuantity} mt</span>
              </div>
            )}

            {wo?.dyehouseCompany && (
              <div className="row">
                <span>
                  <b>Hedef Boyahane/Fason:</b>{" "}
                  {wo.dyehouseCompany.code} - {wo.dyehouseCompany.name}
                </span>
              </div>
            )}

            <div className="barcode-area">
              <div className="barcode-human">*{card.barcode}*</div>
              <div className="barcode-label">
                Bu alanı el terminali ile okutunuz
              </div>
            </div>

            {steps.length > 0 && (
              <div className="route">
                <div style={{ fontWeight: "bold", marginBottom: 6, fontSize: 12 }}>
                  ROTA / İSTASYONLAR
                </div>
                {steps.map((s) => (
                  <div key={s.id} className="route-step">
                    <span className="seq">{s.stepSequence}</span>
                    <span>
                      {s.station?.code} — {s.station?.name}
                      {s.notes && (
                        <span style={{ color: "#555", marginLeft: 8 }}>
                          ({s.notes})
                        </span>
                      )}
                    </span>
                    <span className="sign"></span>
                  </div>
                ))}
              </div>
            )}

            <div className="footer">
              TeksERP · Kart ID: {card.id}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            Kapat
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
