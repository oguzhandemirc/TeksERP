import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PrintedDocDialog, type PrintedDocView } from "@/components/print/PrintedDocDialog";
import { BulkRollLabelButton } from "@/components/print/BulkRollLabelButton";
import { saveWorkbook } from "@/lib/xlsx-export";
import { accountingDispatchService } from "../AccountingDispatch/service";
import { DispatchNoteEditor } from "./DispatchNoteEditor";
import {
  DispatchPrintOptionsContent,
  DEFAULT_DISPATCH_PRINT_OPTS,
  DISPATCH_LISTS,
  type DispatchPrintOpts,
} from "./DispatchPrintOptions";
import { DispatchExcelItem, ReturnsNotice, RollLabelItem } from "./shipmentDocSlots";
import { buildDispatchWorkbook } from "./shipmentDocExport";

// =============================================================================
// SEVK İRSALİYESİ — TEK BELGE YÜZEYİ (2026-09-10 birleştirme)
// =============================================================================
// Eskiden üç ayrı modal vardı: sevkiyat ekranının irsaliyesi, muhasebenin "Fiş"i
// ve muhasebenin "Belge"si. Üçü de AYNI HTML'i (`renderShipmentDispatchHtml`)
// gösteriyordu ama her biri diğerinin eksiğiydi — Excel bir yerde, sürüm çubuğu
// başka yerde, baskı seçenekleri üçüncüde. Artık tek yüzey var; sevkiyata özgü
// her şey jenerik `PrintedDocDialog`a SLOT olarak girer.
//
// Çuval sevkiyatı (SHIPMENT_DISPATCH) ile fasondan doğrudan sevk
// (SUBCONTRACTOR_DIRECT_SHIP) ikisi de buradan basılır; DIRECT'te çuval YOKTUR →
// liste seçimi, çuval notu/izi ve irsaliye açıklaması o dalda çizilmez.
// =============================================================================

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "DIRECT" → fasondan doğrudan sevk kaydı (çuval yok, ayrı belge + rapor ucu). */
  kind?: "SHIPMENT" | "DIRECT";
  /** Başlıkta gösterilecek sevkiyat numarası (varsa). */
  shipmentNo?: string | null;
  /** Sevkiyat durumu — DISPATCHED değilse canlı TASLAK önizlemesi istenir. */
  status?: string | null;
  /** Bu sevkiyattan sonra alınan (iptal edilmemiş) iadeler — çağıran zaten yüklü
   *  sevkiyat detayından geçirir (`summary.returnedCount/Meters`), ekstra istek yok.
   *  Verilmezse bant çıkmaz. */
  returns?: { count: number; meters: number };
}

export function ShipmentDocDialog({
  shipmentId,
  open,
  onOpenChange,
  kind = "SHIPMENT",
  shipmentNo,
  status,
  returns,
}: Props) {
  const qc = useQueryClient();
  const isDirect = kind === "DIRECT";
  const docType = isDirect ? "SUBCONTRACTOR_DIRECT_SHIP" : "SHIPMENT_DISPATCH";
  const title = `${isDirect ? "Fasondan Sevk İrsaliyesi" : "Sevk İrsaliyesi"}${shipmentNo ? ` — ${shipmentNo}` : ""}`;

  // Tek seferlik baskı seçenekleri (liste seçimi + sayfa birleştirme + çuval
  // notu/izi). Hiçbiri kalıcı ayara ya da donmuş snapshot'a YAZILMAZ ve yeni
  // belge versiyonu doğurmaz; diyalog kapanınca sıfırlanır.
  const [printOpts, setPrintOpts] = useState<DispatchPrintOpts>(DEFAULT_DISPATCH_PRINT_OPTS);
  const { sections, merge, rowNotes, rowTags } = printOpts;
  // Üçü de seçiliyse "seçim yok" demektir → backend kalıcı ayarı uygular.
  const sectionParam = sections.length === DISPATCH_LISTS.length ? undefined : sections;

  // Excel + toplu etiket veri seti — YALNIZ istendiğinde çekilir (menü açılınca
  // slot mount olur). Eskiden her fiş açılışında koşuyordu; belgeyi görmek için
  // açan kullanıcı bu isteği hiç kullanmıyordu.
  const [reportWanted, setReportWanted] = useState(false);
  const needReport = useCallback(() => setReportWanted(true), []);
  const reportQ = useQuery({
    queryKey: ["dispatch-report", isDirect ? "direct" : "shipment", shipmentId],
    queryFn: () =>
      isDirect
        ? accountingDispatchService.getDirectReport(shipmentId!)
        : accountingDispatchService.getReport(shipmentId!),
    enabled: open && reportWanted && Boolean(shipmentId),
    staleTime: 60_000,
  });
  const report = reportQ.data?.data;
  const rollIds = (report?.cekiRows ?? []).map((c) => c.rollId).filter(Boolean);

  const [labelOpen, setLabelOpen] = useState(false);

  // Excel = önizlemedeki PDF: aynı belge ucu, aynı tek seferlik seçimler (liste ·
  // not · iz) ve taslakta aynı TASLAK. Kolonlar burada seçilmez.
  const exportExcel = async (view: PrintedDocView) => {
    if (!report || !shipmentId) return;
    try {
      const blob = await buildDispatchWorkbook(
        { id: shipmentId, shipmentNo: report.header.shipmentNo, isDirect },
        isDirect
          ? undefined
          : {
              version: view.version,
              currentTemplate: view.currentTemplate,
              draft: status !== "DISPATCHED",
              sections: sectionParam,
              rowNotes,
              rowTags,
            },
        report,
      );
      if (!blob) throw new Error("fiş verisi yok");
      await saveWorkbook(blob, `Sevk_Fisi_${report.header.shipmentNo}`);
    } catch {
      toast.error("Excel oluşturulamadı");
    }
  };

  return (
    <>
      <PrintedDocDialog
        docType={docType}
        sourceId={shipmentId}
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        writePermission="shipping:write"
        /* Sevk edilmemiş kayıtta donmuş belge yoktur → canlı TASLAK önizlemesi.
           Sabitlenmez: DISPATCHED'ta taslağa hiç düşülmemeli. */
        allowDraft={status !== "DISPATCHED"}
        /* Sevk irsaliyesi içeriği sevk anında donar; sonradan düzenlenemez →
           normal revize aynı içeriği tekrar dondururdu. Tuş yalnız geriye-dönük
           belgede ya da şablon gerçekten değiştiyse görünür. */
        reissueOnlyWhenReconstructed
        printParams={
          isDirect ? undefined : { sections: sectionParam, merge, rowNotes, rowTags }
        }
        optionsExtras={
          isDirect ? undefined : (
            <DispatchPrintOptionsContent
              value={printOpts}
              onChange={setPrintOpts}
              /* Çuval notu/izi tiki yalnız çuval listesi basılacaksa anlamlı. */
              showRowNotes={sections.includes("cuval")}
              showRowTags={sections.includes("cuval")}
            />
          )
        }
        toolbarPrintMenu={
          <RollLabelItem
            count={rollIds.length}
            ready={Boolean(report)}
            onNeedReport={needReport}
            onOpen={() => setLabelOpen(true)}
          />
        }
        toolbarDownloads={(view) => (
          <DispatchExcelItem
            ready={Boolean(report)}
            onNeedReport={needReport}
            onExport={() => void exportExcel(view)}
          />
        )}
        infoBar={
          <>
            {!isDirect && returns && returns.count > 0 && <ReturnsNotice returns={returns} />}
            {!isDirect && shipmentId && (
              <DispatchNoteEditor
                shipmentId={shipmentId}
                onSaved={() =>
                  void qc.invalidateQueries({ queryKey: ["printed-doc-html", docType, shipmentId] })
                }
              />
            )}
          </>
        }
      />

      {/* Toplu etiket önizlemesi — menü kaleminden açılır, bu yüzden diyalogların
          DIŞINDA yaşar (menü kapanırken sökülmesin). */}
      <BulkRollLabelButton rollIds={rollIds} open={labelOpen} onOpenChange={setLabelOpen} />
    </>
  );
}
