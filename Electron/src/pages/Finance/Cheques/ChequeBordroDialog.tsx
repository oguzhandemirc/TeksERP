// =============================================================================
// TESLİM BORDROSU DİYALOĞU — seç → Önizle (taslak) → Kaydet (BRD) → resmî belge
// =============================================================================
// TEK BELGE (K1, 2026-09-26): eski "anlık bordro" ile "resmî bordro" iki ayrı
// kâğıttı ve kolonları ayrışıyordu. Artık kâğıt tektir ve backend'de üretilir:
//   • Önizle — numarasız TASLAK (`/draft`): hiçbir şey yazmaz, okuma izniyle
//     açılır; PDF · Excel · Yazdır aynı çözücüden.
//   • Kaydet — `BRD…` numaralı kayıt doğar ve belgesi donar (`finance:write`);
//     ardından resmî belge (sürüm, revizyon, PDF, Excel) açılır.
//
// ⚠️ ÇEKİN DURUMU DEĞİŞMEZ ("belge-only", 2026-08-15 kararı yürürlükte): bordro
// kesmek "bankaya verdim" demek değildir; ekran bunu açıkça yazar.
//
// ⚠️ DENEME TOKEN'I diyalog başına bir kez üretilir ve yalnız sonucu belirsiz
// bırakan hatada korunur (`tokenAfterFailure`): zaman aşımından sonra ikinci
// "Kaydet" ikinci BRD açmaz.
// =============================================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, FileDown, FileSpreadsheet, Printer } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { printHtmlString } from "@/lib/print";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets, type DocTablesPayload } from "@/lib/doc-tables-export";
import {
  buildDeliveryNoteBody,
  buildDraftBody,
  deliveryNoteBlockReason,
  duplicateNoteWarning,
  tokenAfterFailure,
  type DuplicateNoteWarning,
} from "./chequeDeliveryNote";
import { totalsByCurrency } from "./chequeBordro";
import { KIND_LABEL } from "./labels";
import { ymd } from "./dates";
import { createChequeDeliveryNote, draftChequeDeliveryNote, type ChequeRow } from "./service";
import { money, type Currency } from "../service";
import { ChequeNoteDocDialog } from "./ChequeNoteDocDialog";

interface Props {
  /** SEÇİLİ satırlar — ekrandaki listeden gelir. */
  rows: ChequeRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DRAFT_FILE = "Teslim Bordrosu TASLAK";

export function ChequeBordroDialog({ rows, open, onOpenChange }: Props) {
  const [dateYmd, setDateYmd] = useState(() => ymd(new Date()));
  const [targetLabel, setTargetLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<{ html: string; tables: DocTablesPayload } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<DuplicateNoteWarning | null>(null);
  const [clientToken, setClientToken] = useState<string>(() => crypto.randomUUID());

  const draft = { rows, dateYmd, targetLabel, notes };
  const blocked = deliveryNoteBlockReason(draft);
  const buckets = totalsByCurrency(rows);
  const kindLabel = rows[0] ? KIND_LABEL[rows[0].kind] : "";

  // Form değişince eski önizleme bayatlar — başka bir kâğıdı "önizlenmiş" göstermek yanıltırdı.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
    setDupWarning(null);
  };

  const draftM = useMutation({
    mutationFn: () => draftChequeDeliveryNote(buildDraftBody(draft)),
    onSuccess: (d) => setPreview(d),
  });

  const createM = useMutation({
    mutationFn: (confirmDuplicate?: boolean) =>
      createChequeDeliveryNote(buildDeliveryNoteBody({ ...draft, confirmDuplicate, clientToken })),
    onSuccess: (r) => {
      // Mesaj BACKEND'İN cümlesidir (belge numarasını o biliyor) — ezme.
      toast.success(r.message ?? "Teslim bordrosu düzenlendi.");
      if (r.data?.id) setCreatedId(r.data.id);
    },
    onError: (e) => {
      setClientToken((t) => tokenAfterFailure(t, e));
      // Yalnız `ALREADY_IN_ACTIVE_NOTE` onay bandına döner; diğer hatalar interceptor toast'ıyla gider.
      setDupWarning(duplicateNoteWarning(e));
    },
  });

  const savePdf = async () => {
    if (!preview) return;
    const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
    if (!pdfApi) {
      toast.error("PDF desteği yok (masaüstü uygulaması gerekli) — Yazdır ile PDF'e basabilirsiniz.");
      return;
    }
    const res = await pdfApi.save({ html: preview.html, suggestedName: DRAFT_FILE });
    if (res.error) toast.error(res.error);
  };

  const saveExcel = async () => {
    if (!preview) return;
    try {
      await saveWorkbook(await buildWorkbook(docTablesToSheets(preview.tables)), DRAFT_FILE);
    } catch (e) {
      toast.error(`Excel üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (createdId) {
    return (
      <ChequeNoteDocDialog
        noteId={createdId}
        onClose={() => onOpenChange(false)}
        description="Resmî bordro — belge numarası, sürümü ve revizyon geçmişi vardır. Çeklerin durumu bu belgeyle DEĞİŞMEZ."
      />
    );
  }

  const busy = draftM.isPending || createM.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !createM.isPending && onOpenChange(false)}>
      <DialogContent className={preview ? "flex h-[92vh] max-h-[92vh] max-w-4xl flex-col gap-3" : "max-w-xl"}>
        <DialogHeader>
          <DialogTitle>Teslim Bordrosu</DialogTitle>
          <DialogDescription>
            {rows.length} kayıt seçili{kindLabel ? ` · ${kindLabel} çek/senet` : ""}. Önizleme
            numarasız bir TASLAKTIR ve hiçbir kayıt açmaz; “Kaydet” belge numaralı (BRD…) resmî
            bordroyu düzenler. Çeklerin durumu DEĞİŞMEZ: bankaya verdiyseniz ayrıca satır
            menüsünden “Bankaya Ver” işlemini yapın.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {blocked}
          </div>
        ) : (
          <div className="rounded-md border px-3 py-2 text-xs">
            {buckets.map((b) => (
              <div key={b.currency}>
                <span className="text-muted-foreground">{b.currency}</span>{" "}
                <strong>{money(b.total, b.currency as Currency)}</strong>{" "}
                <span className="text-muted-foreground">({b.count} adet)</span>
              </div>
            ))}
            {buckets.length > 1 && (
              <p className="mt-1 text-muted-foreground">
                Farklı para birimleri toplanmaz — belgede tek toplam yerine para birimi bazlı
                toplamlar basılır.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Teslim tarihi</Label>
            <DatePickerInput aria-label="Teslim tarihi" className="mt-1" value={dateYmd} onChange={edit(setDateYmd)} />
            <p className="mt-1 text-xs text-muted-foreground">
              Kaydedilirse belge numarasının günü de budur (BRD + gün + sıra).
            </p>
          </div>
          <div>
            <Label>Teslim edilen yer / firma (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={200}
              placeholder="Örn: Ziraat Bankası — Merkez Şubesi"
              value={targetLabel}
              onChange={(e) => edit(setTargetLabel)(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Serbest metindir. Boş bırakılırsa o satır hiç basılmaz.
            </p>
          </div>
        </div>

        {!preview && (
          <div>
            <Label>Bordro notu (opsiyonel)</Label>
            <Textarea
              className="mt-1"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => edit(setNotes)(e.target.value)}
            />
          </div>
        )}

        {preview && (
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
            <iframe title="Teslim Bordrosu Taslağı" srcDoc={preview.html} className="h-full w-full border-0 bg-white" />
          </div>
        )}

        {/* MÜKERRER TESLİM UYARISI — kullanıcı KARAR VERİR (engel değil): aynı çek
            meşru olarak yeniden teslim edilebilir; kapatılan şey SESSİZLİKTİR. */}
        {dupWarning && (
          <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">{dupWarning.message}</p>
            {dupWarning.noteDocNos.length > 0 && (
              <p className="mt-1">Aktif bordro: {dupWarning.noteDocNos.join(", ")}</p>
            )}
            {dupWarning.chequeDocNos.length > 0 && <p>Kıymetler: {dupWarning.chequeDocNos.join(", ")}</p>}
            <p className="mt-1">
              Yanlışlıkla ikinci kez kesiyorsanız <strong>Vazgeç</strong> deyip “Bordrolar”dan
              öncekini iptal edin. Gerçekten yeniden teslim ediyorsanız onaylayın.
            </p>
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex gap-2">
            {preview ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                  Düzenle
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => printHtmlString(preview.html)}>
                  <Printer className="h-4 w-4" /> Yazdır
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => void savePdf()}>
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => void saveExcel()}>
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                className="gap-1"
                disabled={blocked !== null || busy}
                onClick={() => draftM.mutate()}
              >
                <Eye className="h-4 w-4" />
                {draftM.isPending ? "Hazırlanıyor…" : "Önizle"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={createM.isPending} onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <PermissionGate permission="finance:write">
              {dupWarning ? (
                // ⚠️ ONAY AYRI BİR DÜĞMEDİR ve adı ne yapacağını söyler — aynı düğmeye
                // ikinci basışı "onay" saymak, uyarıyı okumadan ikinci belgeyi kestirirdi.
                <Button variant="destructive" disabled={busy} onClick={() => createM.mutate(true)}>
                  {createM.isPending ? "Düzenleniyor…" : "Yine de Bordro Kes"}
                </Button>
              ) : (
                <Button disabled={blocked !== null || busy} onClick={() => createM.mutate(undefined)}>
                  {createM.isPending ? "Düzenleniyor…" : "Kaydet (BRD)"}
                </Button>
              )}
            </PermissionGate>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
