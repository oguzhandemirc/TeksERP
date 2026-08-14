// =============================================================================
// CARİ KART DÜZENLEME — vade · risk limiti · vergi dairesi · para birimi · aktiflik
// =============================================================================
// K1'in cari yarısı: backend PATCH ucu 2026-08-14'ten beri hazırdı ama panelde
// hiçbir yerden çağrılmıyordu — yani `paymentTermDays` sisteme HİÇ girilemiyordu
// ve yaşlandırma raporundaki her fatura "Vadesiz" kovasına düşüyordu.
//
// ── VADE GÜNÜNÜN GERÇEK TÜKETİCİSİ ───────────────────────────────────────────
// `finance-aging.report.ts:496-501` efektif vadeyi şu SIRAYLA çözer:
//   1) `Invoice.dueDate` (belgede yazan vade)      → dueSource DOCUMENT
//   2) `issueDate + CariAccount.paymentTermDays`   → dueSource PAYMENT_TERM
//   3) ikisi de yoksa satır "Vadesiz" kovasına düşer → dueSource NONE
// Yani buradaki gün sayısı, faturada vade boş bırakıldığında raporun TEK
// dayanağıdır. Diyalogdaki açıklama cümlesi bu zinciri anlatır — süs değil.
//
// ── BOŞ ≠ SIFIR (bu ekranın en kolay bozulan kuralı) ─────────────────────────
// Boş vade = "vade kararlaştırılmadı" (null → rapor Vadesiz kovası).
// 0 gün      = "peşin" (fatura günü vadeli → ertesi gün GECİKMİŞ sayılır).
// İkisini tek değere indiren her sadeleştirme, hiç kararlaştırılmamış bir vadeyi
// rapora gerçekmiş gibi bastırır. Kural saf katmanda yaşar (`parseTermDays` +
// `buildCariUpdatePayload`) ki bir `if`in tersine çevrilmesi bekçiyi kırsın.
//
// ── NOT ALANI ────────────────────────────────────────────────────────────────
// İlk teslimde BİLEREK yoktu: `CariAccount.notes` yazılabiliyor ama list/findById
// yanıtları döndürmüyordu — boş Not kutusu mevcut notu görülmeden ezerdi
// (okunamayan alan yazdırılmaz). Okuma yolu 2026-08-14 dikişiyle açıldı
// (`cari.service.ts` map'leri `notes` taşır), alan o gün eklendi.
//
// ── RİSK LİMİTİ: BİNLİK AYRACI REDDEDİLİR ────────────────────────────────────
// "50.000" hem elli bin (tr-TR binlik) hem elli (JS ondalık) okunabilir; sessiz
// 1000× sapma yerine görünür bir hata mesajı tercih edildi. Kabul edilen tek
// yazım: rakamlar + en fazla bir ondalık ayraç (`,` ya da `.`) + en fazla 2 hane
// — `Decimal(14,2)` kolonunun aynısı.
// =============================================================================

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateCari, type CariRow, type CariUpdateInput, type Currency } from "./service";

export const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

/** Kolon tavanı `Decimal(14,2)` → tam kısım en fazla 12 hane. */
const RISK_LIMIT_INT_DIGITS = 12;

export interface CariEditForm {
  taxOffice: string;
  defaultCurrency: Currency;
  /** HAM METİN. "" = vadesiz (null) · "0" = peşin. İkisi AYRI şeydir. */
  paymentTermDays: string;
  /** HAM METİN. "" = limitsiz (null). */
  riskLimit: string;
  /** Serbest not — "" kaydedilirse `null` gider (notu temizler). */
  notes: string;
  isActive: boolean;
}

export interface CariEditErrors {
  paymentTermDays?: string;
  riskLimit?: string;
}

/**
 * "" → `null` (vadesiz) · "0" → `0` (peşin) · geçersiz → `undefined`.
 *
 * ⚠️ Üç durumlu dönüş bilinçli: `null` "temizle" komutudur ve backend'de gerçek
 * bir yazımdır; `undefined` ise "bu değer kabul edilemez" demektir ve isteği
 * hiç yollamamamız gerekir. İkisini tek `null`a indirmek, geçersiz girdiyi
 * sessizce "vadesiz"e çevirirdi.
 */
export function parseTermDays(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  // Yalnız rakam: "-5" · "3,5" · "1e3" · " 7 gün" hepsi elenir. `Number()` tek
  // başına bunların bir kısmını sessizce kabul ederdi.
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 3650) return undefined;
  return n;
}

/**
 * "" → `null` (limitsiz) · "50000" → "50000" · "50000,50" → "50000.50" ·
 * belirsiz/geçersiz → `undefined`.
 *
 * ⚠️ Binlik ayracı KABUL EDİLMEZ (dosya başlığı): "50.000" iki farklı sayıdır ve
 * hangisini kastettiğini yalnız kullanıcı bilir.
 */
export function parseRiskLimit(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const intPart = m[1] as string;
  if (intPart.length > RISK_LIMIT_INT_DIGITS) return undefined;
  // Backend `decimalString` hem sayı hem string kabul eder; STRING gönderilir
  // ki JS float yuvarlaması (0.1+0.2 sınıfı) tutara hiç bulaşmasın.
  return m[2] ? `${intPart}.${m[2]}` : intPart;
}

/** Satırdan (liste yanıtı) forma — diyalog her açılışta bundan doğar. */
export function formFromCari(c: CariRow): CariEditForm {
  return {
    taxOffice: c.taxOffice ?? "",
    defaultCurrency: c.defaultCurrency,
    // `0` ile `null` ayrımı BURADA da korunur: `c.paymentTermDays || ""` yazmak
    // 0 günlük (peşin) vadeyi boş kutuya çevirip kaydedince vadesiz yapardı.
    paymentTermDays: c.paymentTermDays == null ? "" : String(c.paymentTermDays),
    riskLimit: c.riskLimit == null ? "" : String(c.riskLimit),
    notes: c.notes ?? "",
    isActive: c.isActive,
  };
}

/**
 * Form → PATCH gövdesi. Geçersizse istek KURULMAZ.
 *
 * Tüm alanlar gönderilir (backend tam gövde kabul ediyor); değişmeyen alanı
 * göndermek no-op'tur. `notes` dahil (okuma yolu 2026-08-14 dikişiyle açıldı — dosya başı).
 */
export function buildCariUpdatePayload(
  form: CariEditForm,
): { ok: true; body: CariUpdateInput } | { ok: false; errors: CariEditErrors } {
  const errors: CariEditErrors = {};
  const term = parseTermDays(form.paymentTermDays);
  if (term === undefined) {
    errors.paymentTermDays = "0 ile 3650 arasında tam gün sayısı girin, ya da vadesiz için boş bırakın.";
  }
  const risk = parseRiskLimit(form.riskLimit);
  if (risk === undefined) {
    errors.riskLimit = "Binlik ayracı kullanmayın — örn. 50000 ya da 50000,50.";
  }
  if (errors.paymentTermDays !== undefined || errors.riskLimit !== undefined) {
    return { ok: false, errors };
  }
  const taxOffice = form.taxOffice.trim();
  const notes = form.notes.trim();
  return {
    ok: true,
    body: {
      taxOffice: taxOffice === "" ? null : taxOffice,
      defaultCurrency: form.defaultCurrency,
      paymentTermDays: term as number | null,
      riskLimit: risk as string | null,
      notes: notes === "" ? null : notes,
      isActive: form.isActive,
    },
  };
}

interface Props {
  cari: CariRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CariEditDialog({ cari, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  // Diyalog çağıran tarafta KOŞULLU mount edilir (StatementDialog emsali), yani
  // her açılış taze state demektir — başka bir cariye geçince eski değerler
  // taşınmaz.
  const [form, setForm] = useState<CariEditForm>(() => formFromCari(cari));
  const [errors, setErrors] = useState<CariEditErrors>({});

  const saveM = useMutation({
    mutationFn: (body: CariUpdateInput) => updateCari(cari.id, body),
    onSuccess: (r) => {
      toast.success(r.message ?? "Cari hesap güncellendi.");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    // onError YOK ve bu bilinçli: 409 ("bakiyesi sıfırlanmadan pasifleştirilemez")
    // interceptor toast'ıyla aynen gösterilir ve diyalog AÇIK kalır — kullanıcı
    // aynı ekranda düzeltir.
  });

  const patch = (p: Partial<CariEditForm>) => {
    setForm((f) => ({ ...f, ...p }));
    setErrors({});
  };

  const submit = () => {
    const result = buildCariUpdatePayload(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    saveM.mutate(result.body);
  };

  const termPreview = parseTermDays(form.paymentTermDays);
  const willDeactivate = cari.isActive && !form.isActive;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && saveM.isPending) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cari Kartı Düzenle</DialogTitle>
          <DialogDescription>
            Muhasebe alanları burada tutulur — müşteri/fason kartına dokunulmaz. Ünvan ve kod ilgili
            tanım ekranından değişir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{cari.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {cari.code} · {cari.kind === "CUSTOMER" ? "Müşteri" : "Fason firma"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs" htmlFor="cari-term">
              Vade günü
            </Label>
            <Input
              id="cari-term"
              className="mt-1"
              inputMode="numeric"
              autoFocus
              placeholder="Boş = vadesiz"
              value={form.paymentTermDays}
              onChange={(e) => patch({ paymentTermDays: e.target.value })}
            />
            {/* Vade gününün NE İŞE YARADIĞI — dosya başındaki zincirin tek cümlesi. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Faturada vade boş bırakılırsa vade bu gün sayısından türetilir (fatura tarihi + N gün);
              yaşlandırma raporu bu vadeyi okur.
            </p>
            {errors.paymentTermDays ? (
              <p className="mt-1 text-xs font-medium text-destructive">{errors.paymentTermDays}</p>
            ) : termPreview === null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Boş bırakıldı — faturalar “vadesiz” sayılır ve yaşlandırmada ayrı kovada görünür.
              </p>
            ) : termPreview === 0 ? (
              // 0'ın boştan FARKI burada açıkça söylenir; aksi halde "sıfır yazdım,
              // vadesiz oldu sandım" hatası sessiz kalırdı.
              <p className="mt-1 text-xs text-muted-foreground">
                0 gün = <span className="font-medium text-foreground">peşin</span> — fatura günü
                vadelidir, ertesi gün gecikmiş sayılır.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Fatura tarihinden {termPreview} gün sonra vadesi dolar.
              </p>
            )}
          </div>

          <div className="col-span-2">
            <Label className="text-xs" htmlFor="cari-risk">
              Risk limiti
            </Label>
            <Input
              id="cari-risk"
              className="mt-1"
              inputMode="decimal"
              placeholder="Boş = limitsiz"
              value={form.riskLimit}
              onChange={(e) => patch({ riskLimit: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Risk limiti <span className="font-medium text-foreground">UYARIDIR, satışı bloklamaz</span>{" "}
              — durdurma kararı ticaridir ve yazılım onu vardiya ortasında sessizce veremez.
            </p>
            {errors.riskLimit && (
              <p className="mt-1 text-xs font-medium text-destructive">{errors.riskLimit}</p>
            )}
          </div>

          <div>
            <Label className="text-xs" htmlFor="cari-tax-office">
              Vergi dairesi
            </Label>
            <Input
              id="cari-tax-office"
              className="mt-1"
              maxLength={100}
              placeholder="Örn. Bursa Yıldırım"
              value={form.taxOffice}
              onChange={(e) => patch({ taxOffice: e.target.value })}
            />
          </div>

          <div>
            <Label className="text-xs" htmlFor="cari-currency">
              Varsayılan para birimi
            </Label>
            <select
              id="cari-currency"
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={form.defaultCurrency}
              onChange={(e) => patch({ defaultCurrency: e.target.value as Currency })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Fatura/tahsilat formlarını ön-doldurur; kayıt sırasında değiştirilebilir.
            </p>
          </div>

          <div className="col-span-2">
            <Label className="text-xs" htmlFor="cari-notes">
              Not (opsiyonel)
            </Label>
            <Textarea
              id="cari-notes"
              className="mt-1"
              rows={2}
              maxLength={500}
              placeholder="Örn. mutabakat her ay sonu; irtibat: Ali Bey"
              value={form.notes}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </div>

          <div className="col-span-2 flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="cari-active"
              className="mt-0.5"
              checked={form.isActive}
              onCheckedChange={(v) => patch({ isActive: v === true })}
            />
            <div className="space-y-0.5">
              <Label htmlFor="cari-active" className="text-sm font-medium">
                Hesap aktif
              </Label>
              <p className="text-xs text-muted-foreground">
                Pasif cariye yeni fatura, tahsilat ve devir kaydedilemez. Geçmiş kayıtlar ve ekstre
                durur; buradan tekrar aktifleştirilebilir.
              </p>
            </div>
          </div>
        </div>

        {/* Yıkıcı-işlem kuralı: etkilenen kayıt SOMUT olarak adlandırılır. */}
        {willDeactivate && (
          <Callout tone="warning" title="Bu hesap pasifleştirilecek">
            <span className="font-medium">{cari.name}</span> ({cari.code}) için bundan sonra fatura,
            tahsilat ve devir kaydedilemez. Bakiyesi sıfır değilse sunucu işlemi reddeder — açık
            bakiyeyi gizlememek için.
          </Callout>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={saveM.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={saveM.isPending} onClick={submit}>
            {saveM.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
