// =============================================================================
// SATIŞ İADE FATURASI — SAF KATMAN (görünürlük yüklemi + satır kırılımı)
// =============================================================================
// Bekçi: `returnInvoice.test.ts`.
//
// İki karar bileşenlerin içine dağılmış `&&` zincirleri olarak kalsaydı (düğme
// sayfada, kırılım diyalog sarmalayıcısında) birini tersine çevirmek hiçbir
// testi kırmazdı — sevkiyat emsali `AccountingDispatch/invoiceDraftVisibility.ts`
// tam bu gerekçeyle saf katmana çıkarılmıştı.
// =============================================================================

/** Görünürlük yükleminin ihtiyaç duyduğu ALANLAR (ReturnRow'un yapısal alt kümesi). */
export interface ReturnInvoiceCandidate {
  cancelledAt: string | null;
  customer: { id: string } | null;
  /**
   * Bu iade GRUBUNDAN doğmuş, iptal edilmemiş iç faturanın belge numarası.
   *
   * ⚠️ DİKİŞ BEKLİYOR: bugün hiçbir uç bu alanı doldurmuyor (`/api/returns`
   * listesi `Invoice` tarafına hiç bakmıyor ve fatura listesi `returnGroupId`
   * ile SORGULANAMIYOR — `LIST_SELECT` o kolonu taşımıyor, filtre de yok). Alan
   * `undefined` geldiği sürece bu kol UYKUDADIR ve mükerrer faturayı
   * `invoice.service.assertSourceFree`'nin 409'u durdurur (mesaj apiClient
   * interceptor'ı ile ekrana basılır — sessiz değil, ama düğme kullanıcıyı
   * kesin bir hataya yürütür). Doldurulması gereken yer sonuç JSON'undaki
   * `dikisIhtiyaci` maddesinde yazılı.
   */
  invoiceDocNo?: string | null;
}

/**
 * "Satış İade Faturası" düğmesi çizilsin mi?
 *
 * DÖRT koşul, dördü de gerekli:
 *  ① **TİCARET REJİMİ** (`finance.enabled`) — fabrikada ön muhasebe yoktur;
 *     düğme orada var olmayan bir modüle yol gösterirdi (fabrika sıfır-fark).
 *  ② **İADE İPTAL EDİLMEMİŞ** — iptal, malı sevkiyatına GERİ verir (top yeniden
 *     `SHIPPED`). Ortada iade YOKTUR; onun faturasını kesmek müşterinin
 *     hesabına gerçekleşmemiş bir alacak yazardı.
 *  ③ **HENÜZ FATURALANMAMIŞ** — backend "bir iade grubu → tek aktif fatura"
 *     diyor (`assertSourceFree`). Gri buton yerine HİÇ çizmemek tercih edilir:
 *     devre dışı buton var olmayan bir yolu vaat eder (sevkiyat emsali).
 *  ④ **MÜŞTERİ ÇÖZÜLEBİLİYOR** — fatura bir cariye kesilir. `RollReturn.customerId`
 *     şemada NOT NULL'dır, yani bu kol pratikte tetiklenmez; istemci tipi alanı
 *     nullable ilan ettiği için durur — aksi halde diyalog carisiz açılır ve
 *     kullanıcı "Taslağı Oluştur"a basamadan tıkanırdı.
 *
 * ⚠️ Bu bir İZİN kontrolü DEĞİLDİR. İzin ayrı katman (`finance:write` +
 * `PermissionGate`) ve bilinçli olarak `return:write`'tan FARKLIDIR: biri iade
 * defterine yazar, diğeri cari deftere işleyecek bir taslak doğurur.
 */
export function canDraftReturnInvoice(
  row: ReturnInvoiceCandidate,
  financeEnabled: boolean,
): boolean {
  if (!financeEnabled) return false;
  if (row.cancelledAt) return false;
  if (row.invoiceDocNo) return false;
  if (!row.customer) return false;
  return true;
}

// -----------------------------------------------------------------------------
// SATIR KIRILIMI
// -----------------------------------------------------------------------------

/** Kırılıma giren iade kalemi (ReturnRow'un yapısal alt kümesi). */
export interface ReturnGroupMember {
  createdAt: string;
  qty: number;
  width: number | null;
  item: { id: string; name: string } | null;
  color: { id: string; name: string } | null;
}

export interface ReturnInvoiceLine {
  /** Fiyat önerisini (SALE) tetikleyen kalem bağı — çözülemezse null. */
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
}

/**
 * Ürün etiketi — sevk fişindeki `products[].name` ile BİREBİR aynı biçim
 * (`shipping.service`: `[item.name, color.name, "<en>cm."].filter(Boolean)`).
 * Aynı müşterinin satış faturası ile iade faturası yan yana konduğunda satır
 * metinleri örtüşsün diye; ayrı bir biçim iki belgeyi elle eşleştirilemez yapardı.
 */
export function returnProductLabel(m: ReturnGroupMember): string {
  const widthStr = m.width != null ? `${m.width}cm.` : "";
  const label = [m.item?.name ?? "", m.color?.name ?? "", widthStr].filter(Boolean).join(" ");
  // Açıklamasız satır diyaloğun `valid` kapısından geçmez (kullanıcı sebebini
  // göremeden "Taslağı Oluştur" pasif kalırdı) → görünür bir yer tutucu.
  return label || "Kumaş (tanımsız)";
}

/** Metraj yuvarlaması — `RollReturn.qty` ve `InvoiceLine.qty` İKİSİ de Decimal(12,3). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * İade grubunun kalemlerini FATURA SATIRLARINA çevirir.
 *
 * ⚠️ SATIR = ÜRÜN kırılımı, TOP değil (sevkiyat emsalindeki gerekçenin aynısı):
 * fatura kalemi ticari birimdir; 12 topu 12 satır yazmak faturayı okunmaz yapar
 * ve müşteri de öyle beklemez. Top dökümü zaten iade irsaliyesinde duruyor.
 *
 * ⚠️ Gruplama anahtarı KİMLİK (itemId|colorId|en), AD DEĞİL: aynı ada sahip iki
 * katalog kaydı tek satırda toplanır ve o satırın `itemId`'si (dolayısıyla fiyat
 * önerisi) ikisinden birine sessizce sapardı.
 *
 * ⚠️ Sıra `createdAt` ARTAN — iade belgesinin kalem sırasıyla aynı (return.service:
 * "liste sırası belge kalem sırasıdır, lider = ilk kalem"). Liste ucu YENİDEN
 * ESKİYE döner; sıralamadan geçirmezsek fatura satırları belgeye göre ters çıkardı.
 */
export function buildReturnInvoiceLines(members: ReturnGroupMember[]): ReturnInvoiceLine[] {
  const ordered = [...members].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups = new Map<string, ReturnInvoiceLine>();

  for (const m of ordered) {
    const key = `${m.item?.id ?? "-"}|${m.color?.id ?? "-"}|${m.width ?? "-"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty = round3(existing.qty + m.qty);
      continue;
    }
    groups.set(key, {
      itemId: m.item?.id ?? null,
      description: returnProductLabel(m),
      qty: round3(m.qty),
      unit: "m",
    });
  }

  return [...groups.values()];
}
