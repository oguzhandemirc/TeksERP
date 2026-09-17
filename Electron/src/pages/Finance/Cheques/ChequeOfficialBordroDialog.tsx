// =============================================================================
// RESMÎ TESLİM BORDROSU DİYALOĞU — kaydet, sonra donmuş belgeyi aç
// =============================================================================
// ⚠️ BU DİYALOG KAYIT OLUŞTURUR (`ChequeBordroDialog`in tersi). `BRD…` numaralı
// bir bordro doğar, belgesi AYNI transaction'da donar ve iptal edilene kadar
// defterde durur. Kullanıcı bunu bilmeli — "yanlışlıkla bastım" ile "yanlışlıkla
// belge kestim" aynı şey değildir; diyalog farkı açıkça yazar.
//
// ⚠️ ÇEKİN DURUMU DEĞİŞMEZ. Bordro kesmek "bankaya verdim"/"ciro ettim" DEMEK
// DEĞİLDİR (backend `cheque-delivery-note.service` v1 kararı: belge-only). Bu
// cümle ekranda durmazsa, portföyünde hâlâ PORTFOLIO görünen çek için kullanıcı
// "bordroyu bastım ama işlenmemiş" der.
//
// ⚠️ KAPI YÜKLEMİ ORTAK (`deliveryNoteBlockReason` → `bordroBlockReason`):
// anlık bordro ile resmî bordro AYNI seçim kurallarına uyar. Ekranın ikinci bir
// yorumunu yazmak, birinin kabul edip diğerinin reddettiği seçimler demekti.
//
// ⚠️ HEDEF v1'DE SERBEST METİNDİR. Backend yapılandırılmış hedefi de destekliyor
// (`bankAccountId` ⊻ `cariId`) ama panel ikisini de sormuyor: bordronun doğal
// hedefi YÖNE göre değişiyor (alınan → banka, verilen → cari) ve yalnız birini
// koymak diğer yönü ikinci sınıf yapardı. Serbest metin iki yönü de karşılar ve
// H6'nın anlık diyaloğu da zaten onu soruyor. Yapılandırılmış hedef gerektiğinde
// çözüm bu kutuyu bölmek değil, iki seçiciyi (banka/cari) XOR ile eklemektir.
// =============================================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import {
  buildDeliveryNoteBody,
  deliveryNoteBlockReason,
  duplicateNoteWarning,
  type DuplicateNoteWarning,
} from "./chequeDeliveryNote";
import { totalsByCurrency } from "./chequeBordro";
import { KIND_LABEL } from "./labels";
import { ymd } from "./dates";
import { createChequeDeliveryNote, type ChequeRow } from "./service";
import { money, type Currency } from "../service";
import { DatePickerInput } from "@/components/forms/DatePickerInput";

interface Props {
  /** SEÇİLİ satırlar — ekrandaki listeden gelir. */
  rows: ChequeRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChequeOfficialBordroDialog({ rows, open, onOpenChange }: Props) {
  const [dateYmd, setDateYmd] = useState(() => ymd(new Date()));
  const [targetLabel, setTargetLabel] = useState("");
  const [notes, setNotes] = useState("");
  // Kesilen bordronun id'si — dolunca form KAPANIR ve yerine donmuş belge açılır.
  const [createdId, setCreatedId] = useState<string | null>(null);
  // "Bu kıymetler zaten AKTİF bir bordroda" uyarısı (backend 409'u). ENGEL
  // DEĞİL: kullanıcı görür, onaylar ve aynı istek `confirmDuplicate` ile gider.
  const [dupWarning, setDupWarning] = useState<DuplicateNoteWarning | null>(null);

  const draft = { rows, dateYmd, targetLabel, notes };
  const blocked = deliveryNoteBlockReason(draft);
  const buckets = totalsByCurrency(rows);
  const kindLabel = rows[0] ? KIND_LABEL[rows[0].kind] : "";

  const createM = useMutation({
    // ⚠️ ONAY GÖVDEYE, YÜKLEM SAF KATMANA: `confirmDuplicate` bir `if` içinde
    // elle eklenmez — `buildDeliveryNoteBody` onu yalnız `true` iken yazar
    // (varsayılan `true` olsaydı uyarı hiç görünmez, tam da önlenmek istenen
    // sessiz ikinci belge geri gelirdi).
    mutationFn: (confirmDuplicate?: boolean) =>
      createChequeDeliveryNote(buildDeliveryNoteBody({ ...draft, confirmDuplicate })),
    onSuccess: (r) => {
      // Mesaj BACKEND'İN cümlesidir (belge numarasını o biliyor) — ezme.
      toast.success(r.message ?? "Teslim bordrosu düzenlendi.");
      if (r.data?.id) setCreatedId(r.data.id);
      // ⚠️ id gelmezse (beklenmedik yanıt şekli) form AÇIK kalır ve kullanıcı
      // belgeyi Belgeler yüzeyinden bulur; sessizce kapanmak "kaydolmadı"
      // izlenimi verirdi — oysa kayıt oluştu.
    },
    onError: (e) => {
      // ⚠️ UYARI ile GERÇEK HATA ayrı yollardır: yalnız `ALREADY_IN_ACTIVE_NOTE`
      // kodu onay bandına döner (`duplicateNoteWarning` başka her şeyde `null`).
      // Diğer hatalar interceptor toast'ıyla gider; burada ikinci toast basmak
      // aynı hatayı iki kez söylerdi.
      setDupWarning(duplicateNoteWarning(e));
    },
  });

  // Belge kesildi → aynı akış donmuş belgeyle devam eder (sürüm geçmişi,
  // revizyon, PDF, yazdır hepsi ORTAK bileşende).
  if (createdId) {
    return (
      <PrintedDocDialog
        docType="CHEQUE_DELIVERY_NOTE"
        sourceId={createdId}
        open
        onOpenChange={(o) => {
          if (!o) onOpenChange(false);
        }}
        title="Çek / Senet Teslim Bordrosu"
        description="Resmî bordro — belge numarası, sürümü ve revizyon geçmişi vardır. Çeklerin durumu bu belgeyle DEĞİŞMEZ."
        writePermission="finance:write"
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !createM.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Resmî Teslim Bordrosu</DialogTitle>
          <DialogDescription>
            {rows.length} kayıt seçili{kindLabel ? ` · ${kindLabel} çek/senet` : ""}. Bu işlem
            sisteme <strong>belge numaralı bir kayıt</strong> açar (anlık “Teslim Bordrosu”
            çıktısından farkı budur). Çeklerin durumu DEĞİŞMEZ: bankaya verdiyseniz ayrıca
            satır menüsünden “Bankaya Ver” işlemini yapın.
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
            <DatePickerInput aria-label="Teslim tarihi" className="mt-1" value={dateYmd} onChange={setDateYmd} />
            <p className="mt-1 text-xs text-muted-foreground">
              Belge numarasının günü de budur (BRD + gün + sıra).
            </p>
          </div>
          <div>
            <Label>Teslim edilen yer / firma (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={200}
              placeholder="Örn: Ziraat Bankası — Merkez Şubesi"
              value={targetLabel}
              onChange={(e) => setTargetLabel(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Serbest metindir. Boş bırakılırsa o satır hiç basılmaz.
            </p>
          </div>
        </div>

        <div>
          <Label>Bordro notu (opsiyonel)</Label>
          <Textarea
            className="mt-1"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* MÜKERRER TESLİM UYARISI — kullanıcı KARAR VERİR (engel değil).
            Aynı çek meşru olarak yeniden teslim edilebilir (tahsile ver →
            karşılıksız dön → ciro et); kapatılan şey SESSİZLİKTİR. Uyarı hangi
            bordro ve hangi kıymetler olduğunu SOMUT yazar — "bir sorun var"
            demek, kullanıcıyı karar veremez hâlde bırakırdı. */}
        {dupWarning && (
          <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">{dupWarning.message}</p>
            {dupWarning.noteDocNos.length > 0 && (
              <p className="mt-1">Aktif bordro: {dupWarning.noteDocNos.join(", ")}</p>
            )}
            {dupWarning.chequeDocNos.length > 0 && (
              <p>Kıymetler: {dupWarning.chequeDocNos.join(", ")}</p>
            )}
            <p className="mt-1">
              Yanlışlıkla ikinci kez kesiyorsanız <strong>Vazgeç</strong> deyip “Bordrolar”dan
              öncekini iptal edin. Gerçekten yeniden teslim ediyorsanız onaylayın.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={createM.isPending}
            onClick={() => onOpenChange(false)}
          >
            Vazgeç
          </Button>
          {dupWarning ? (
            // ⚠️ ONAY AYRI BİR DÜĞMEDİR ve adı ne yapacağını söyler. Aynı düğmeye
            // ikinci kez basmayı "onay" saymak, kullanıcının uyarıyı okumadan
            // refleksle ikinci belgeyi kesmesi demekti.
            <Button
              variant="destructive"
              disabled={createM.isPending}
              onClick={() => createM.mutate(true)}
            >
              {createM.isPending ? "Düzenleniyor…" : "Yine de Bordro Kes"}
            </Button>
          ) : (
            <Button
              disabled={blocked !== null || createM.isPending}
              onClick={() => createM.mutate(undefined)}
            >
              {createM.isPending ? "Düzenleniyor…" : "Bordroyu Düzenle"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
