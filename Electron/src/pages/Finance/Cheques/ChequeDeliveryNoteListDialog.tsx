// =============================================================================
// KESİLMİŞ RESMÎ TESLİM BORDROLARI — belgeye DÖNÜŞ YOLU
// =============================================================================
// ⚠️ NEDEN VAR: bordro kesilebiliyor ama kesildikten sonra bir daha
// ULAŞILAMIYORDU — tek erişim, oluşturma diyaloğunun state'indeki `createdId`
// idi ve diyalog kapanınca ölüyordu. Yanlış teslim tarihiyle (ya da yanlış çek
// kümesiyle) kesilen `BRD…` sonsuza dek ACTIVE kalıyor, backend'in `cancel` ucu
// yazılmış ve bekçilenmiş olduğu hâlde hiçbir kullanıcı tetikleyemiyordu.
// Ayrıntılı gerekçe: `../officialDocs.ts` başlığı.
//
// ⚠️ BU LİSTE TÜM BORDROLARI GÖSTERİR (çek portföyünün süzgeçlerinden bağımsız):
// aranan şey bir BELGEDİR, bir kıymet değil. Portföy filtresine bağlansaydı,
// "canlı olanlar" varsayılanı yüzünden tahsil edilmiş çeklerin bordroları
// görünmez olurdu — oysa aranan tam da geçmiş bir tutanaktır.
//
// ⚠️ İPTAL EDİLMİŞ SATIR GİZLENMEZ (donmuş belge kuralı) — rozet ayırır.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import {
  OFFICIAL_DOC_STATUS_LABEL,
  officialDocCancelBlockReason,
  officialDocCancelSummary,
} from "../officialDocs";
import { KIND_LABEL } from "./labels";
import {
  cancelChequeDeliveryNote,
  listChequeDeliveryNotes,
  type DeliveryNoteRow,
} from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const dt = (iso: string): string => new Date(iso).toLocaleDateString("tr-TR");

const targetOf = (r: DeliveryNoteRow): string => {
  const party = r.cari?.customer?.name ?? r.cari?.subcontractor?.name ?? null;
  return [r.bankAccount?.name ?? party, r.targetLabel].filter(Boolean).join(" — ") || "—";
};

export function ChequeDeliveryNoteListDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeliveryNoteRow | null>(null);
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: ["finance", "cheque-delivery-notes"],
    queryFn: () => listChequeDeliveryNotes({ page: 1, pageSize: 50 }),
    enabled: open,
  });

  const cancelM = useMutation({
    mutationFn: (row: DeliveryNoteRow) =>
      cancelChequeDeliveryNote(row.id, reason.trim() || undefined),
    onSuccess: (r) => {
      toast.success(r.message ?? "Teslim bordrosu iptal edildi.");
      setCancelTarget(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["finance", "cheque-delivery-notes"] });
      void qc.invalidateQueries({ queryKey: ["printed-doc"] });
    },
  });

  // Belge önizlemesi ÜSTE açılır; kapanınca listeye dönülür (tek belgelik
  // çıkmaz yok — bu ekranın var oluş sebebi tam olarak o çıkmazdı).
  if (openDocId) {
    return (
      <PrintedDocDialog
        docType="CHEQUE_DELIVERY_NOTE"
        sourceId={openDocId}
        open
        onOpenChange={(o) => !o && setOpenDocId(null)}
        title="Çek / Senet Teslim Bordrosu"
        description="Resmî bordro — sürüm geçmişi ve revizyon burada. İptal edilmiş bordro “İPTAL” filigranıyla basılır; çeklerin durumu bu belgeyle DEĞİŞMEZ."
        writePermission="finance:write"
      />
    );
  }

  const rows = q.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Resmî Teslim Bordroları</DialogTitle>
          <DialogDescription>
            Kesilmiş `BRD…` numaralı bordrolar (en yeniden eskiye). Satıra tıklayınca belge sürüm
            geçmişiyle açılır; yanlış kesilen bordro iptal edilebilir — kayıt silinmez, çeklerin
            durumu zaten hiç değişmemişti.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-center text-sm">
            <p className="font-medium text-destructive">Bordro listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “kayıt yok” cevabı DEĞİLDİR. Yeni bordro kesmeden önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Henüz resmî teslim bordrosu kesilmemiş. Portföyden kıymet seçip “Resmî Bordro” ile
            kesebilirsiniz.
          </p>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Belge No</th>
                  <th className="px-3 py-2 text-left">Teslim</th>
                  <th className="px-3 py-2 text-left">Yön</th>
                  <th className="px-3 py-2 text-left">Teslim Edilen</th>
                  <th className="px-3 py-2 text-right">Adet</th>
                  <th className="px-3 py-2 text-left">Durum</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const blocked = officialDocCancelBlockReason(r);
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => setOpenDocId(r.id)}
                        >
                          {r.docNo}
                        </button>
                      </td>
                      <td className="px-3 py-2">{dt(r.deliveryDate)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{KIND_LABEL[r.kind]}</td>
                      <td className="px-3 py-2">{targetOf(r)}</td>
                      <td className="px-3 py-2 text-right">{r._count.items}</td>
                      <td className="px-3 py-2">
                        <Badge variant={r.status === "ACTIVE" ? "secondary" : "destructive"}>
                          {OFFICIAL_DOC_STATUS_LABEL[r.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setOpenDocId(r.id)}>
                          Aç
                        </Button>
                        <PermissionGate permission="finance:write">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={blocked !== null}
                            title={blocked ?? "Bordroyu iptal et"}
                            onClick={() => {
                              setCancelTarget(r);
                              setReason("");
                            }}
                          >
                            İptal
                          </Button>
                        </PermissionGate>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* YIKICI İŞLEM ONAYI — etkilenen kayıt SOMUT olarak yazılır. */}
        {cancelTarget && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p>
              {officialDocCancelSummary(
                cancelTarget.docNo,
                `${cancelTarget._count.items} kıymet · ${dt(cancelTarget.deliveryDate)}`,
              )}
            </p>
            <Textarea
              className="mt-2"
              rows={2}
              maxLength={300}
              placeholder="İptal sebebi (opsiyonel — belgede ve denetim kaydında görünür)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCancelTarget(null)}>
                Vazgeç
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={cancelM.isPending}
                onClick={() => cancelM.mutate(cancelTarget)}
              >
                {cancelM.isPending ? "İptal ediliyor…" : "Bordroyu İptal Et"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
