import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Eye, FileText, Inbox, Truck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { type PrintedDocType } from "@/services/printedDocumentService";
import { workOrderService } from "./service";
import type { WorkOrderDocument } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** İş emri — belge listesi bundan çekilir. */
  workOrderId?: string;
  /** Refakat kartı yazdırma — zengin önizleme diyaloğunu açar (sayfa boyutu, yenile). */
  onPrintTravelerCard: () => void;
  /** Fason sevk irsaliyesi — zengin diyalog (versiyon geçmişi, revizyon, boya overlay'i). */
  onPrintDispatch: (dispatchId: string) => void;
}

/** Adım adından "(Fason)" ekini temizler — grup başlığı zaten adımın kendisidir. */
function stripFason(s: string): string {
  return s.replace(/\s*\(fason\)\s*$/i, "");
}

/**
 * İş emri belgeleri — TEK KAYNAK `GET /work-orders/:id/documents`.
 *
 * Eskiden bu diyalog listeyi KENDİSİ kuruyordu (`wo.steps[].dispatches`), bu yüzden
 * **fason kabul makbuzu** ve **fasondan doğrudan sevk irsaliyesi** hiç görünmüyordu —
 * belge vardı, kapısı yoktu. Ayrıca iptal edilmiş sevkleri gizliyordu; oysa donmuş
 * belge silinmez, İPTAL filigranıyla basılır ve dosyaya bakan onu isteyebilir.
 * Artık liste backend'den gelir → mobil ile Electron aynı belgeleri gösterir ve yeni
 * bir belge tipi eklendiğinde burada kod değişmez.
 *
 * HER SATIR ÖNİZLEME AÇAR — hiçbir satır tıklanır tıklanmaz yazıcıya gitmez.
 * Belge tipine göre hangi önizleme açılır:
 *   • Refakat kartı / fason sevk → kendi ZENGİN diyalogları (kart: sayfa boyutu +
 *     bayat rozeti; fason sevk: boya overlay'i). Bunları genelleştirmek özellik kaybı.
 *   • Diğerleri (kabul makbuzu, fasondan doğrudan sevk) → GENERİK `PrintedDocDialog`
 *     (önizleme + versiyon çubuğu + revizyon + baskı notu + PDF/Yazdır).
 *
 * ⚠️ VARSAYILAN DAL ÖNİZLEMEDİR, doğrudan baskı DEĞİL. Eskiden bu iki belge
 * `printHtmlString` ile anında yazıcı diyaloğunu açıyordu: kullanıcı ne bastığını
 * göremiyor, iptal edip bakma şansı olmuyordu — üstelik versiyon geçmişi ve revizyon
 * bu belgeler için ekranda hiç yoktu (uçlar vardı). `PrintedDocDialog` docType-agnostik
 * olduğu için backend listeye YENİ bir belge tipi eklediğinde burada kod değişmez ve
 * yeni tip de sessizce "önizlemesiz" doğmaz.
 */
export function WorkOrderDocumentsDialog({
  open,
  onOpenChange,
  workOrderId,
  onPrintTravelerCard,
  onPrintDispatch,
}: Props) {
  // Generik önizleme hedefi (kabul makbuzu / fasondan doğrudan sevk). Liste
  // diyaloğu kapanır, bu açılır — kart ve fason sevk dallarıyla aynı davranış.
  const [preview, setPreview] = useState<{
    docType: PrintedDocType;
    sourceId: string;
    title: string;
    subtitle: string;
  } | null>(null);

  const q = useQuery({
    queryKey: ["work-order-documents", workOrderId],
    queryFn: () => workOrderService.getDocuments(workOrderId!),
    enabled: open && Boolean(workOrderId),
    staleTime: 15_000,
  });

  const docs = q.data?.data?.documents ?? [];

  // Grupları veriden kur (backend sırasını KORU: kart önce, fason belgeleri tarih desc).
  const groups: [string, WorkOrderDocument[]][] = [];
  for (const d of docs) {
    const label = stripFason(d.group);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(d);
    else groups.push([label, [d]]);
  }

  const handleClick = (d: WorkOrderDocument) => {
    if (d.docType === "TRAVELER_CARD") {
      onOpenChange(false);
      onPrintTravelerCard();
      return;
    }
    if (d.docType === "SUBCONTRACTOR_DISPATCH") {
      onOpenChange(false);
      onPrintDispatch(d.sourceId);
      return;
    }
    // Kendi zengin diyaloğu olmayan belgeler — generik önizleme.
    onOpenChange(false);
    setPreview({
      docType: d.docType as PrintedDocType,
      sourceId: d.sourceId,
      title: d.title,
      subtitle: d.subtitle || d.documentNo,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>Belgeler</DialogTitle>
            <DialogDescription>
              İş emrinden çıkarılabilecek belgeler — satıra tıklayın, önizleme açılır.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
            {q.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : q.isError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                Belgeler yüklenemedi: {(q.error as Error)?.message}
              </div>
            ) : docs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox className="h-6 w-6 text-muted-foreground" />
                <div className="text-sm font-medium">Bu iş emrine ait belge yok</div>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Refakat kartı iş emri açılışında doğar; fason belgeleri sevk/kabul yapıldıkça listelenir.
                </p>
              </div>
            ) : (
              groups.map(([label, list]) => (
                <section key={label} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label} ({list.length})
                  </div>
                  <ul className="space-y-1.5">
                    {list.map((d) => (
                      <li key={`${d.docType}-${d.sourceId}`}>
                        <DocRow doc={d} onClick={() => handleClick(d)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Kendi diyaloğu olmayan belgeler için generik önizleme. Revizyon izni
        `workorder:write` — DOC_PERMISSIONS'ta bu iki belgenin write kümesiyle aynı;
        ayrışırsa "Revize Et" görünür ama uç 403 verir. */}
      <PrintedDocDialog
        docType={preview?.docType ?? "SUBCONTRACTOR_RECEIPT"}
        sourceId={preview?.sourceId ?? null}
        open={Boolean(preview)}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
        title={preview?.title ?? "Belge"}
        description={preview?.subtitle}
        writePermission="workorder:write"
      />
    </>
  );
}

/** Tek belge satırı — başlık + no + açıklama; sağda tarih ve önizleme ikonu. */
function DocRow({ doc, onClick }: { doc: WorkOrderDocument; onClick: () => void }) {
  const Icon = doc.docType === "TRAVELER_CARD" ? FileText : Truck;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 rounded-md border bg-background p-2.5 text-left hover:bg-muted/50 disabled:opacity-60 " +
        (doc.cancelled ? "opacity-60" : "")
      }
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{doc.title}</span>
          {doc.cancelled && (
            <span className="rounded border border-destructive/40 px-1 py-px text-[10px] font-semibold uppercase text-destructive">
              İptal
            </span>
          )}
          {/* ⚠️ "Güncel değil" rozeti KALDIRILDI (2026-08-06, kullanıcı kararı) —
              gerekçe TravelerCardPrintDialog başlığında. `contentDirty` yanıtta
              hâlâ dönüyor; rozeti geri koymadan önce oradaki notu oku. */}
        </div>
        <div className="font-mono text-xs text-muted-foreground">{doc.documentNo}</div>
        {doc.subtitle && <div className="truncate text-xs text-muted-foreground">{doc.subtitle}</div>}
      </div>
      <div className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
        {safeFormat(doc.date, "dd.MM.yyyy · HH:mm")}
      </div>
      {doc.cancelled ? (
        <CircleAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
