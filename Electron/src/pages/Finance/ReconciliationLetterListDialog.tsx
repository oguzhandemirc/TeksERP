// =============================================================================
// KESİLMİŞ MUTABAKAT MEKTUPLARI — belgeye DÖNÜŞ YOLU
// =============================================================================
// ⚠️ NEDEN VAR: mektup kesilebiliyor ama kesildikten sonra bir daha
// ULAŞILAMIYORDU — tek erişim, oluşturma diyaloğunun state'indeki `createdId`
// idi ve diyalog kapanınca ölüyordu. Sonuç: müşteri imzalı mektubun kopyasını
// isterse yeniden basılamıyor, yanlış kesilen mektup iptal edilemiyordu
// (backend `cancel` ucu yazılmış ve bekçilenmişti — hiçbir kullanıcı
// tetikleyemiyordu). Ayrıntılı gerekçe: `officialDocs.ts` başlığı.
//
// ⚠️ KAPSAM BU CARİDİR, tüm defter değil: liste, ekstre diyaloğunun içinden
// açılıyor ve kullanıcının sorusu "BU carinin mektupları" — global bir mektup
// sayfası ayrı bir karardır (menü + route + izin). Backend `cariId` süzgecini
// zaten taşıyor.
//
// ⚠️ İPTAL EDİLMİŞ SATIR GİZLENMEZ. Donmuş belge silinmez; iptal edilmiş mektup
// da "İPTAL" filigranıyla basılabilir olmalı (dosyaya bakan kişi onu arar).
// Rozet ikisini ayırır.
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
} from "./officialDocs";
import {
  cancelReconciliationLetter,
  listReconciliationLetters,
  type ReconciliationLetterRow,
} from "./service";

interface Props {
  cariId: string;
  cariName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const dt = (iso: string): string => new Date(iso).toLocaleDateString("tr-TR");

export function ReconciliationLetterListDialog({ cariId, cariName, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReconciliationLetterRow | null>(null);
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: ["finance", "reconciliation-letters", cariId],
    queryFn: () => listReconciliationLetters({ cariId, page: 1, pageSize: 50 }),
    enabled: open,
  });

  const cancelM = useMutation({
    mutationFn: (row: ReconciliationLetterRow) =>
      cancelReconciliationLetter(row.id, reason.trim() || undefined),
    onSuccess: (r) => {
      toast.success(r.message ?? "Mutabakat mektubu iptal edildi.");
      setCancelTarget(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["finance", "reconciliation-letters", cariId] });
      // Belge VOIDED'a çekildi → açık önizleme bayat kalmasın.
      void qc.invalidateQueries({ queryKey: ["printed-doc"] });
    },
  });

  // Belge önizlemesi ÜSTE açılır (liste arkada kalır): iptal ettikten sonra
  // kullanıcı listeye döner, tek belgelik bir çıkmaza girmez.
  if (openDocId) {
    return (
      <PrintedDocDialog
        docType="RECONCILIATION_LETTER"
        sourceId={openDocId}
        open
        onOpenChange={(o) => !o && setOpenDocId(null)}
        title="Cari Mutabakat Mektubu"
        description="Resmî belge — sürüm geçmişi ve revizyon burada. İptal edilmiş mektup “İPTAL” filigranıyla basılır."
        writePermission="finance:write"
      />
    );
  }

  const rows = q.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Mutabakat Mektupları</DialogTitle>
          <DialogDescription>
            {cariName} için kesilmiş resmî mektuplar. Satıra tıklayınca belge sürüm geçmişiyle
            açılır; yanlış kesilen bir mektup iptal edilebilir (kayıt silinmez).
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          // ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR: düşen bir isteği "mektup
          // yok" diye basmak, kullanıcıyı ikinci bir mektup kesmeye iter.
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-center text-sm">
            <p className="font-medium text-destructive">Mektup listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “kayıt yok” cevabı DEĞİLDİR. Yeni mektup kesmeden önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Bu cari için henüz mutabakat mektubu kesilmemiş.
          </p>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Belge No</th>
                  <th className="px-3 py-2 text-left">Kesit (itibarıyla)</th>
                  <th className="px-3 py-2 text-left">Düzenleme</th>
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
                      <td className="px-3 py-2">{dt(r.asOf)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{dt(r.createdAt)}</td>
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
                            // ⚠️ Kapalı düğmenin sebebi YAZILI: sessizce kapalı
                            // bir düğme "bozuk" diye okunur.
                            title={blocked ?? "Mektubu iptal et"}
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
            <p>{officialDocCancelSummary(cancelTarget.docNo, `kesit ${dt(cancelTarget.asOf)}`)}</p>
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
                {cancelM.isPending ? "İptal ediliyor…" : "Mektubu İptal Et"}
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
