// =============================================================================
// 2. ADIM — FATURALARI SEÇ (tutar satır satır YAZILIR)
// =============================================================================
// ⚠️ FIFO BİR ÖNERİDİR, OTOMATİK KAPAMA DEĞİL — ürün kararı. En eski vadeden
// başlayan dağıtım kutulara ÖN-DOLDURULUR, ama her satır elle değiştirilebilir.
// Sebep sektörel: "hangi faturayı ödedim" kararı müşteriyle konuşulan bir
// karardır (müşteri çoğu zaman en eskisini değil, belirli bir faturayı öder).
// Otomatik kapama, o kararı sistemin sessizce vermesi olurdu ve düzeltmek için
// önce yanlış kapamayı çözmek gerekirdi.
//
// ⚠️ AÇIK/KISMİ/KAPALI BİR KOLON DEĞİLDİR — `paidTotal` ile `grandTotal`
// karşılaştırmasından TÜRETİLİR (backend de öyle yapar). Buraya "durum" diye
// ayrı bir alan uydurmak, ikinci bir gerçek kaynağı demekti ve iki kaynak bir
// gün ayrışır: "kapalı görünen ama parası gelmemiş fatura" tam böyle doğar.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INVOICE_TYPE_LABEL, money, type Currency } from "../service";
import { fromKurus, isOverdue, toKurus } from "./allocationMath";
import type { OpenInvoiceRow } from "./service";

interface Props {
  rows: OpenInvoiceRow[];
  isLoading: boolean;
  /**
   * ⚠️ HATA ≠ BOŞ LİSTE. Ayrılmazsa ekran "bu cari ve para biriminde açık fatura
   * yok" der; oysa uç 403 (ön muhasebe kapalı / yetki yok) ya da 500 vermiş
   * olabilir. Yanlış cevap, cevapsızlıktan kötüdür: muhasebeci "fatura kapanmış"
   * sanıp aramayı bırakır.
   */
  isError: boolean;
  currency: Currency;
  /** invoiceId → kullanıcının yazdığı ham metin. */
  drafts: Record<string, string>;
  onDraftChange: (invoiceId: string, value: string) => void;
  /** "Tümü" — o satıra sığabilecek EN BÜYÜK tutarı yazar (kaynağın kalanıyla sınırlı). */
  onFillMax: (invoiceId: string) => void;
  /**
   * Tutar yazılamaz. İki sebebi var ve ikisi de aynı sonuca çıkar:
   *   • kaynak seçilmedi (neyi böldüğümüz belli değil),
   *   • kullanıcıda `finance:payment` yok (yazılan tutarın gidecek bir yolu yok).
   * İkincisi bu projede adı konmuş bir kusur sınıfıdır: kullanıcıya YAPILAMAYACAK
   * bir işi yaptırmak. On satır doldurup kaydet düğmesi olmadığını görmek, en
   * baştan pasif bir kutu görmekten çok daha pahalıdır. Sebep ayrıca alt bantta
   * YAZIYLA söylenir — pasif kutu tek başına "bozuk" diye okunur.
   */
  disabled: boolean;
}

export function OpenInvoiceTable({
  rows,
  isLoading,
  isError,
  currency,
  drafts,
  onDraftChange,
  onFillMax,
  disabled,
}: Props) {
  return (
    <div className="flex min-h-0 flex-col rounded-md border">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="text-sm font-semibold">2. Faturaları seç</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Tutarlar en eski vadeden başlayarak önerildi — her satırı değiştirebilirsiniz.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Yükleniyor…</p>
        ) : isError ? (
          <div className="m-3 rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Açık fatura listesi alınamadı — bu "açık fatura yok" ANLAMINA GELMEZ.
            Ön muhasebe modülü kapalı olabilir ya da bu hesapta görüntüleme yetkisi
            bulunmayabilir. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
          </div>
        ) : rows.length === 0 ? (
          <div className="m-3 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Bu cari ve para biriminde açık fatura yok. Yalnız ONAYLANMIŞ ve tamamı
            ödenmemiş faturalar burada görünür; taslak fatura deftere işlemediği
            için kapatılamaz.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Belge No</th>
                <th className="px-3 py-2 text-left">Tür</th>
                <th className="px-3 py-2 text-left">Vade</th>
                <th className="px-3 py-2 text-right">Fatura</th>
                <th className="px-3 py-2 text-right">Açık</th>
                <th className="px-3 py-2 text-right">Kapanacak</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const openKurus = toKurus(inv.openTotal);
                const draft = drafts[inv.id] ?? "";
                const draftKurus = toKurus(draft);
                const over = draftKurus > openKurus;
                const late = isOverdue(inv.effectiveDueDate);
                return (
                  <tr key={inv.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{inv.docNo}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {INVOICE_TYPE_LABEL[inv.type] ?? inv.type}
                    </td>
                    <td className={`px-3 py-2 whitespace-nowrap ${late ? "text-destructive" : ""}`}>
                      {new Date(inv.effectiveDueDate).toLocaleDateString("tr-TR")}
                      {late && <span className="ml-1 text-xs">(geçti)</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {money(Number(inv.grandTotal), currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {money(fromKurus(openKurus), currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={disabled}
                        // Aşım ANINDA görünür: gönderip 409 yemek, yazarken
                        // uyarılmaktan çok daha pahalı bir öğrenme yolu.
                        className={`h-8 w-32 text-right ${over ? "border-destructive text-destructive" : ""}`}
                        value={draft}
                        onChange={(e) => onDraftChange(inv.id, e.target.value)}
                      />
                      {over && (
                        <div className="mt-0.5 text-[11px] text-destructive">
                          Açık tutarı aşıyor
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        title="Bu faturaya sığabilecek en büyük tutarı yaz"
                        onClick={() => onFillMax(inv.id)}
                      >
                        Tümü
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
