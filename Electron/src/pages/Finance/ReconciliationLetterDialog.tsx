// =============================================================================
// MUTABAKAT MEKTUBU DİYALOĞU — kesit tarihini sor, kes, donmuş belgeyi aç
// =============================================================================
// ⚠️ NEDEN EKSTRE DİYALOĞUNUN İÇİNDE (cari listesinde değil): mektubun tek
// gerçek girdisi BAKİYE KESİT TARİHİDİR ve o tarih ekstrede zaten seçili.
// Listeden açılsaydı kullanıcı hiçbir bağlam olmadan bir tarih uydurmak zorunda
// kalırdı; ekstreden açıldığında varsayılan, tam da EKRANDA BAKTIĞI dönemin
// bitişidir — yani kâğıt ekranın söylediğini söyler. Ekstre diyaloğu ayrıca
// carinin bakiyesiyle "resmî bir şey yapma" eylemlerinin (Devir Gir, Devri
// İptal Et, Excel/PDF) zaten toplandığı yüzeydir; liste bir GEZİNME yüzeyidir
// (Ekstre / Düzenle).
//
// ⚠️ MEKTUP TÜM PARA BİRİMLERİNİ BASAR, ekrandaki para birimi seçimi onu
// ETKİLEMEZ. Ekstre tek para biriminde yürür (iki para birimini tek yürüyen
// bakiyede toplamak anlamsız); mektup ise carinin bütün bakiyelerini ayrı
// satırlarda döker. Bu cümle ekranda durmazsa "USD satırı nereden çıktı"
// sorusu kâğıt karşı tarafa gittikten sonra gelir.
//
// ⚠️ DEFTERE HİÇBİR ŞEY YAZMAZ: bakiye OKUNUR ve donar. Bu yüzden başarıdan
// sonra sorgu tazelenmez (bkz. `service.createReconciliationLetter`) — tazelemek
// "bakiye değişti" sinyali verirdi.
// =============================================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import {
  buildReconciliationLetterBody,
  reconciliationBlockReason,
} from "./reconciliationLetter";
import { createReconciliationLetter, money, type CariRow } from "./service";
import { DatePickerInput } from "@/components/forms/DatePickerInput";

interface Props {
  cari: CariRow;
  /** Ekstrenin BİTİŞ günü (YYYY-MM-DD) — kesit tarihinin varsayılanı. */
  defaultAsOfYmd: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReconciliationLetterDialog({
  cari,
  defaultAsOfYmd,
  open,
  onOpenChange,
}: Props) {
  const [asOfYmd, setAsOfYmd] = useState(defaultAsOfYmd);
  const [notes, setNotes] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const draft = { cariId: cari.id, cariIsActive: cari.isActive, asOfYmd, notes };
  const blocked = reconciliationBlockReason(draft);

  const createM = useMutation({
    mutationFn: () => createReconciliationLetter(buildReconciliationLetterBody(draft)),
    onSuccess: (r) => {
      toast.success(r.message ?? "Mutabakat mektubu düzenlendi.");
      if (r.data?.id) setCreatedId(r.data.id);
    },
    // Hata toast'ı apiClient interceptor'ından gelir (ikinci toast basmayız).
  });

  if (createdId) {
    return (
      <PrintedDocDialog
        docType="RECONCILIATION_LETTER"
        sourceId={createdId}
        open
        onOpenChange={(o) => {
          if (!o) onOpenChange(false);
        }}
        title="Mutabakat Mektubu"
        description="Resmî belge — bakiye fotoğrafı düzenlendiği anda dondu. Sonradan geçmişe tarihli hareket girilirse ekrandaki bakiye ile bu kâğıt ayrışabilir; o fark bir hata değil, revizyon (Revize Et) sinyalidir."
        writePermission="finance:write"
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !createM.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mutabakat Mektubu — {cari.name}</DialogTitle>
          <DialogDescription>
            Belirtilen tarih itibarıyla bakiyeleri donduran, karşı tarafa imzalatılmak üzere
            düzenlenen <strong>resmî belgedir</strong>. Cari defteri, kasa/banka bakiyesi ve
            çek portföyü DEĞİŞMEZ.
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {blocked}
          </div>
        )}

        {/* Bugünkü bakiye — kesit tarihi geçmişe alınırsa mektup BUNDAN farklı
            çıkabilir ve bu bir hata değildir; sayıyı göstermek kullanıcıya
            "hangi rakamı bekliyorum" çıpası verir. */}
        <div className="rounded-md border px-3 py-2 text-xs">
          <p className="text-muted-foreground">Bugünkü bakiye (tüm para birimleri)</p>
          {cari.balances.length === 0 ? (
            <p className="mt-1">Kayıtlı hareket yok — sıfır mutabakatı da bir mutabakattır.</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {cari.balances.map((b) => (
                <span key={b.currency}>
                  <strong>{money(b.balance, b.currency)}</strong>{" "}
                  <span className="text-muted-foreground">
                    {b.balance > 0 ? "borçlu" : b.balance < 0 ? "alacaklı" : "kapalı"}
                  </span>
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-muted-foreground">
            Mektup TÜM para birimlerini ayrı satırlarda basar — ekstredeki para birimi seçimi
            mektubu etkilemez.
          </p>
        </div>

        <div>
          <Label>Bakiye tarihi (kesit)</Label>
          <DatePickerInput aria-label="Bakiye tarihi (kesit)" className="mt-1" value={asOfYmd} onChange={setAsOfYmd} />
          <p className="mt-1 text-xs text-muted-foreground">
            Seçilen GÜN DAHİLDİR: o günün hareketleri bakiyeye girer. Düzenleme tarihi ayrıca
            bugün olarak basılır.
          </p>
        </div>

        <div>
          <Label>Mektup notu (opsiyonel)</Label>
          <Textarea
            className="mt-1"
            rows={2}
            maxLength={500}
            placeholder="Örn. 2026 Temmuz dönemi mutabakatı"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={createM.isPending}
            onClick={() => onOpenChange(false)}
          >
            Vazgeç
          </Button>
          <Button
            disabled={blocked !== null || createM.isPending}
            onClick={() => createM.mutate()}
          >
            {createM.isPending ? "Düzenleniyor…" : "Mektubu Düzenle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
