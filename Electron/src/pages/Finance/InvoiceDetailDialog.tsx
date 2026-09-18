// =============================================================================
// FATURA DETAYI — satırlar · kapama · belge
// =============================================================================
// ⚠️ SALT OKUNUR. Buradan onay/iptal/silme YAPILMAZ; o düğmeler liste satırında
// TEK yerde durur (ChequeDetailDialog ile aynı karar). İki ayrı yerden aynı
// geçişi tetiklemek, hangisinin güncel veriye baktığı belirsiz iki yol demekti.
//
// ⚠️ DIALOG, AYRI ROUTE DEĞİL. Emsal aynı domende: `ChequeDetailDialog` (liste →
// göz düğmesi → salt-okunur diyalog). Ayrı bir route açmak yeni bir `content-routes`
// + izin dikişi ister ve rejim kapısını (`financeEnabled`) ikinci kez kurmayı
// gerektirirdi; diyalog zaten kapıdan geçmiş sayfanın İÇİNDE yaşar.
//
// ⚠️ İKİ KAYNAK, TEK CÜMLE: fatura detayı (`/invoices/:id`) ile kapama satırları
// (`/allocations?invoiceId=`) AYRI uçlardır. Kapanan tutarı satırlardan yeniden
// toplayıp "kapandı" demek İKİNCİ bir doğruluk kaynağı yaratırdı; durum daima
// `settlementOf` (yani `paidTotal`) üzerinden okunur, satırlar ise o rakamın
// KARŞILIĞIDIR. Aralarında fark varsa gizlenmez (`paidDriftK`).
//
// ⚠️ BELGE YÜZEYİ YENİDEN YAZILMAZ: "Belgeyi aç" düğmesi detayı KAPATIR ve
// sayfanın kendi `PrintedDocDialog`'unu açar (üst üste iki diyalog, odak tuzağı
// ve iki ayrı ESC katmanı demekti). Taslakta düğme HİÇ çizilmez — belge onayda
// donar, taslağın resmi kaydı yoktur ve düğme "yok" bir şeyi vaat ederdi.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { InvoiceReceiptMatchBand } from "./InvoiceReceiptMatchBand";
import { receiptLabel } from "./invoiceReceipts";
import { Pencil, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import {
  INVOICE_STATUS_BADGE,
  INVOICE_TYPE_LABEL,
  SETTLEMENT_BADGE,
  SETTLEMENT_LABEL,
  getInvoice,
  money,
  partyName,
  settlementOf,
} from "./service";
import type { Currency, InvoiceDetail } from "./service";
import { fromKurus } from "./Allocations/allocationMath";
import { listAllocations } from "./Allocations/service";
import { allocationSourceOf, paidDriftK, sumAllocationsK } from "./invoiceDetail";
// Tarih biçimi TEK yerden: üçüncü bir `toLocaleDateString` kopyası, bir gün
// birinin "saat de yazalım" demesiyle ekranlar arası ayrışmaya döner.
import { fmtDate } from "./Cheques/dates";

interface Props {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Belge önizlemesini açan sayfa geri çağrısı; verilmezse düğme çizilmez. */
  onShowDocument?: (inv: InvoiceDetail) => void;
  /**
   * TASLAĞI DÜZENLE — verilmezse düğme çizilmez.
   *
   * ⚠️ Bu, dosya başlığındaki "salt okunur" kuralının İSTİSNASI DEĞİL: diyalog
   * yine hiçbir mutasyon çalıştırmaz, yalnız sayfanın form diyaloğunu açar
   * (durum geçişleri — onay/iptal/sil — hâlâ TEK yerde, liste satırında).
   * Gerekçe: 0 fiyatlı otomatik taslağı inceleyen kullanıcı hatayı tam BURADA
   * görür; düzeltmek için diyaloğu kapatıp listede satırı yeniden bulması
   * gereksiz bir tur attırırdı.
   */
  onEditDraft?: (inv: InvoiceDetail) => void;
  /** Kaynak MAL KABUL fişini açar (verilmezse satır düz metin kalır). */
  onOpenGoodsReceipt?: (id: string) => void;
  /** Kaynak SEVKİYATI açar — çuval sevkiyatı ve fasondan doğrudan sevk ayrı. */
  onOpenShipment?: (target: { id: string; kind: "SHIPMENT" | "DIRECT" }) => void;
}

/**
 * Bilgi satırı — boş değer daima "—", boş string değil.
 *
 * ⚠️ `onClick` OPSİYONEL ve verilmezse satır BUGÜNKÜYLE BİREBİR düz metindir:
 * tıklanabilir görünüp hiçbir yere gitmeyen bir bağ, olmayan bir yolu vaat eder
 * (kaynak id'leri backend'den 2026-08-15'te gelmeye başladı; eski yanıtta yok).
 */
function Field({
  label,
  value,
  onClick,
  title,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      {onClick ? (
        <button
          type="button"
          className="text-left text-sm text-primary underline-offset-2 hover:underline"
          title={title}
          onClick={onClick}
        >
          {value || "—"}
        </button>
      ) : (
        <div className="text-sm">{value || "—"}</div>
      )}
    </div>
  );
}

/** Toplam satırı — ara toplam/KDV/genel aynı hizada okunur. */
function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-6 ${strong ? "text-sm font-semibold" : "text-sm"}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Oran hücresi — %0 da bir orandır, "—" ile karıştırılmaz. */
function pct(v: number): string {
  return `%${Number(v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

export function InvoiceDetailDialog({
  invoiceId,
  open,
  onOpenChange,
  onShowDocument,
  onEditDraft,
  onOpenGoodsReceipt,
  onOpenShipment,
}: Props) {
  const q = useQuery({
    queryKey: ["finance", "invoice", invoiceId],
    queryFn: () => getInvoice(invoiceId),
    enabled: open,
  });

  const inv = q.data;
  // ⚠️ Kapama satırları YALNIZ fatura yüklendikten sonra istenir; iki isteği
  // paralel açmak, faturası olmayan/yetkisiz id'de ikinci bir 4xx üretirdi.
  const allocQ = useQuery({
    queryKey: ["finance", "invoice", invoiceId, "allocations"],
    queryFn: () => listAllocations({ invoiceId }),
    enabled: open && Boolean(inv),
  });

  const cur = (inv?.currency ?? "TRY") as Currency;
  const st = inv ? settlementOf(inv) : null;
  const allocRows = allocQ.data?.data ?? [];
  const driftK = paidDriftK(st, allocRows);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {inv ? `${inv.docNo} — ${INVOICE_TYPE_LABEL[inv.type]}` : "Fatura"}
          </DialogTitle>
          <DialogDescription>
            Faturanın satırları, kapama durumu ve resmi belgesi. Bu ekran salt okunurdur —
            onay/iptal işlemleri listedeki düğmelerden yapılır.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          // ⚠️ "Bulunamadı" DEMEYİZ (ChequeDetailDialog emsali): istek düşmüş
          // olabilir (ağ/izin/modül kapalı) ve kaydın var olmadığını söylemek
          // kullanıcıyı faturayı yeniden kesmeye iter.
          <p className="py-8 text-center text-sm text-destructive">
            Kayıt yüklenemedi — bağlantı ya da yetki sorunu olabilir. Faturanın silindiği anlamına gelmez.
          </p>
        ) : !inv ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Kayıt bulunamadı.</p>
        ) : (
          <div className="max-h-[68vh] space-y-4 overflow-auto pr-1">
            {/* ── Başlık şeridi: durum + kapama + tutar ─────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={INVOICE_STATUS_BADGE[inv.status].cls}>
                {INVOICE_STATUS_BADGE[inv.status].label}
              </Badge>
              {/* Kapama rozeti yalnız ONAYLI faturada — kapı `settlementOf`'ta. */}
              {st && (
                <>
                  {st.overdue && (
                    <Badge className="bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">
                      Vadesi geçti
                    </Badge>
                  )}
                  <Badge className={SETTLEMENT_BADGE[st.state]}>{SETTLEMENT_LABEL[st.state]}</Badge>
                </>
              )}
              <span className="text-sm font-semibold">{money(inv.grandTotal, cur)}</span>
              {inv.currency !== "TRY" && (
                <span className="text-xs text-muted-foreground">
                  ≈ {money(inv.grandTotalTry, "TRY")} (kur {Number(inv.exchangeRate).toFixed(4)})
                </span>
              )}
              {/* TASLAKTA "Düzenle", diğerlerinde "Belgeyi aç" — ikisi aynı
                  konumda çünkü ikisi de o statünün DOĞAL SONRAKİ İŞİdir.
                  ⚠️ İZİN KAPISI ZORUNLU ve liste satırındakiyle AYNI kod
                  olmalı (`InvoicesPage` → `PermissionGate finance:write`):
                  `PATCH /api/finance/invoices/:id` `finance:write` istiyor.
                  Kapısız hâlinde "Kasa / Tahsilat" rolü (finance:read +
                  finance:payment) düğmeyi LİSTEDE görmüyor ama DETAYDA
                  görüyordu → formu açıp 8 satırın fiyatını giriyor, "Kaydet"te
                  403 yiyor ve emeğin tamamını kaybediyordu. Kod tabanının
                  kuralı: iş yapmayan düğme konmaz. */}
              {inv.status === "DRAFT" && onEditDraft && (
                <PermissionGate permission="finance:write">
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => onEditDraft(inv)}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Düzenle
                  </Button>
                </PermissionGate>
              )}
              {inv.status !== "DRAFT" && onShowDocument && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onShowDocument(inv)}
                >
                  <Printer className="mr-1 h-4 w-4" />
                  Belgeyi aç
                </Button>
              )}
            </div>
            <InvoiceReceiptMatchBand match={inv.receiptMatch} currency={cur} />

            {/* ── Künye ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-3">
              <Field label="Cari" value={partyName(inv.cari)} />
              <Field
                label="Vergi no / dairesi"
                value={[
                  inv.cari.customer?.taxNumber ?? inv.cari.subcontractor?.taxNumber,
                  inv.cari.taxOffice,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Field label="Dış belge no" value={inv.externalNo ?? ""} />
              <Field label="Fatura tarihi" value={fmtDate(inv.issueDate)} />
              {/* Vadesiz fatura meşrudur ("—"); uydurma vade basılmaz. */}
              <Field label="Vade" value={fmtDate(inv.dueDate)} />
              <Field
                label="Para birimi"
                value={inv.currency === "TRY" ? "TRY" : `${inv.currency} · kur ${Number(inv.exchangeRate).toFixed(4)}`}
              />
              <Field label="Onay" value={fmtDate(inv.confirmedAt)} />
              <Field label="İptal" value={fmtDate(inv.cancelledAt)} />
              {/* KAYNAK BAĞLARI (2026-08-15: detay ucu artık dördünü de insanca
                  adıyla taşıyor; iade grubu İLİŞKİSİZDİR — skaler id, yalnız
                  varlık bilgisi basılır). Kaynağı olmayan faturada satır hiç
                  basılmaz — boş "Kaynak: —" hücresi "kaynağı yok" yalanı olurdu. */}
              {inv.goodsReceipt && (
                <Field
                  label="Kaynak (mal kabul)"
                  value={[inv.goodsReceipt.receiptNo, inv.goodsReceipt.deliveryNoteNo]
                    .filter(Boolean)
                    .join(" · irsaliye ")}
                  title="Mal kabul fişini aç"
                  onClick={
                    onOpenGoodsReceipt
                      ? () => onOpenGoodsReceipt(inv.goodsReceipt!.id)
                      : undefined
                  }
                />
              )}
              {(inv.goodsReceipts?.length ?? 0) > 1 && (
                <Field label="Kaynak (mal kabul fişleri)" value={inv.goodsReceipts!.map(receiptLabel).join(" · ")} />
              )}
              {inv.shipment && (
                <Field
                  label="Kaynak (sevkiyat)"
                  value={inv.shipment.shipmentNo}
                  title="Sevkiyat detayını aç"
                  onClick={
                    onOpenShipment
                      ? () => onOpenShipment({ id: inv.shipment!.id, kind: "SHIPMENT" })
                      : undefined
                  }
                />
              )}
              {inv.directShipment && (
                <Field
                  label="Kaynak (fasondan sevk)"
                  value={inv.directShipment.shipmentNo}
                  title="Fasondan doğrudan sevk detayını aç"
                  onClick={
                    onOpenShipment
                      ? () => onOpenShipment({ id: inv.directShipment!.id, kind: "DIRECT" })
                      : undefined
                  }
                />
              )}
              {inv.subcontractorReceipt && (
                <Field label="Kaynak (fason kabul)" value={inv.subcontractorReceipt.receiptNo} />
              )}
              {inv.returnGroupId && <Field label="Kaynak" value="İade grubu (satış iadesi)" />}
              {inv.notes && (
                <div className="col-span-2 sm:col-span-3">
                  <Field label="Not" value={inv.notes} />
                </div>
              )}
              {inv.cancelReason && (
                <div className="col-span-2 sm:col-span-3">
                  <Field label="İptal sebebi" value={inv.cancelReason} />
                </div>
              )}
            </div>

            {/* ── Satırlar ──────────────────────────────────────────────── */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Satırlar</h3>
              {inv.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Satır yok.</p>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Açıklama</th>
                        <th className="px-3 py-2 text-right">Miktar</th>
                        <th className="px-3 py-2 text-right">Birim Fiyat</th>
                        <th className="px-3 py-2 text-right">İsk.</th>
                        <th className="px-3 py-2 text-right">KDV</th>
                        <th className="px-3 py-2 text-right">Satır Toplamı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((l) => (
                        <tr key={l.id} className="border-t align-top">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{l.lineNo}</td>
                          <td className="px-3 py-2">
                            <div>{l.description}</div>
                            {/* Ürün bağı varsa kod ikinci satırda — açıklama
                                serbest metindir ve ürünü tanımlamak zorunda değil. */}
                            {l.item && (
                              <div className="text-xs text-muted-foreground">
                                {l.item.code} · {l.item.name}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {Number(l.qty).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {l.unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(l.unitPrice, cur)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pct(l.discountRate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {pct(l.vatRate)}
                            <div className="text-xs text-muted-foreground">{money(l.vatAmount, cur)}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {money(l.lineTotal, cur)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Toplamlar ─────────────────────────────────────────────── */}
            <div className="ml-auto w-full max-w-xs space-y-1 rounded-md border p-3 sm:w-80">
              <TotalRow label="Ara toplam" value={money(inv.subtotal, cur)} />
              {/* İskonto/tevkifat SIFIRSA basılmaz: her faturada duran iki boş
                  satır, gerçekten iskonto olan faturayı fark ettirmez. */}
              {Number(inv.discountTotal) !== 0 && (
                <TotalRow label="İskonto" value={money(inv.discountTotal, cur)} />
              )}
              <TotalRow label="KDV" value={money(inv.vatTotal, cur)} />
              {Number(inv.withholdingTotal) !== 0 && (
                <TotalRow label="Tevkifat" value={money(inv.withholdingTotal, cur)} />
              )}
              <div className="border-t pt-1">
                <TotalRow label="Genel toplam" value={money(inv.grandTotal, cur)} strong />
              </div>
              {inv.currency !== "TRY" && (
                <TotalRow label="TL karşılığı" value={money(inv.grandTotalTry, "TRY")} />
              )}
            </div>

            {/* ── Kapamalar ─────────────────────────────────────────────── */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Kapamalar</h3>
              {!st ? (
                // Taslak/iptalde kapama sorusu YOKTUR — boş tablo çizmek
                // "hiç ödenmemiş" gibi okunurdu.
                <p className="text-sm text-muted-foreground">
                  {inv.status === "DRAFT"
                    ? "Taslak fatura deftere işlemedi; kapama yapılamaz."
                    : "Fatura iptal edildi; kapamalar iptalde çözüldü."}
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span>
                      Kapanan:{" "}
                      <span className="font-medium tabular-nums">{money(fromKurus(st.paidK), cur)}</span>
                    </span>
                    <span>
                      Kalan açık:{" "}
                      <span className="font-medium tabular-nums">{money(fromKurus(st.openK), cur)}</span>
                    </span>
                  </div>

                  {allocQ.isLoading ? (
                    <p className="text-sm text-muted-foreground">Kapama satırları yükleniyor…</p>
                  ) : allocQ.isError ? (
                    <p className="text-sm text-destructive">
                      Kapama satırları yüklenemedi. Yukarıdaki kapanan tutar faturanın kendi
                      sayacından okunur ve doğrudur.
                    </p>
                  ) : allocRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Bu faturaya bağlı tahsilat/çek yok.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Kaynak</th>
                            <th className="px-3 py-2 text-left">Belge No</th>
                            <th className="px-3 py-2 text-left">Kapama Tarihi</th>
                            <th className="px-3 py-2 text-right">Tutar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allocRows.map((a) => {
                            const src = allocationSourceOf(a);
                            return (
                              <tr key={a.id} className="border-t align-top">
                                <td className="px-3 py-2">
                                  <div>{src.label}</div>
                                  {/* Kaynağın KENDİ tarihi etiketiyle birlikte —
                                      tahsilatın işlem günü ile çekin vadesi aynı
                                      kolonda etiketsiz basılamaz. */}
                                  {src.date && (
                                    <div className="text-xs text-muted-foreground">
                                      {src.dateLabel}: {fmtDate(src.date)}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">{src.docNo ?? "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                                <td className="px-3 py-2 text-right font-medium tabular-nums">
                                  {money(a.amount, cur)}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-t bg-muted/30">
                            <td className="px-3 py-2 text-xs uppercase text-muted-foreground" colSpan={3}>
                              Satır toplamı
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {money(fromKurus(sumAllocationsK(allocRows)), cur)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* SAYAÇ ↔ DEFTER FARKI gizlenmez. Fark normalde OLMAZ; olduğu
                      gün ekran "kapalı" deyip karşılığında satır göstermezdi ve
                      kullanıcı sebebini hiçbir yerde göremezdi. */}
                  {!allocQ.isLoading && !allocQ.isError && driftK !== 0 && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      Faturanın kapanan tutarı ({money(fromKurus(st.paidK), cur)}) ile kapama
                      satırlarının toplamı ({money(fromKurus(sumAllocationsK(allocRows)), cur)})
                      uyuşmuyor. Fark: {money(fromKurus(Math.abs(driftK)), cur)}. Kayıt yanlış
                      değil olabilir ama muhasebeye danışın.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
