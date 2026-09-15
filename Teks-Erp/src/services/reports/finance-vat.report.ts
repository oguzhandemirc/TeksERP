// =============================================================================
// KDV DÖNEM ÖZETİ — muhasebeciye giden özet; BEYANNAME DEĞİL
// =============================================================================
// YENİ TABLO YOK: salt okuma. Kaynaklar `invoices` + `invoice_lines`.
//
// ── NE SORAR ────────────────────────────────────────────────────────────────
// "Bu dönemde oran bazında ne kadar matrah, ne kadar hesaplanan KDV, ne kadar
// tevkifat oluştu?" — muhasebecinin beyanname hazırlarken dış programa
// gireceği rakamların özetidir. Resmî beyan DIŞ muhasebe programından yapılır
// (ERP fatura düzenler ama beyanname ÜRETMEZ); rapor notları bunu açıkça söyler.
//
// ── DÖNEM ÇIPASI: `issueDate` (TAHAKKUK) ────────────────────────────────────
// KDV dönemini BELGE TARİHİ belirler: fatura hangi aya kesildiyse o ayın
// beyanına girer (tahakkuk esası — KDVK md.10: vergiyi doğuran olay teslim/
// fatura anıdır). `confirmedAt` bizim İŞLEM anımızdır; geriye tarihli onaylanan
// fatura kendi dönemine düşmek ZORUNDADIR. Yaşlandırma da aynı çıpayı kullanır
// ("defter satırının txnDate'i ISSUE DATE'tir" — finance-aging başlığı); iki
// rapor aynı faturayı iki ayrı döneme yazsaydı mutabakat imkânsızlaşırdı.
//
// ── KAPSAM: YALNIZ CONFIRMED ────────────────────────────────────────────────
// DRAFT deftere hiç işlememiştir; CANCELLED ise storno edilmiştir ve bu
// sistemde iptal AYRI bir ters belge doğurmaz (fatura satırı CANCELLED'a
// çekilir + defterde INVOICE_CANCEL). Dolayısıyla iptal edilen fatura rapora
// HİÇ girmez — iptalden sonra aynı dönem raporu yeniden alınırsa rakam düşer;
// bu bilinçlidir ve rapor notunda yazılıdır (dönem beyan edildikten SONRA
// yapılan iptal, muhasebecinin düzeltme beyanı konusudur, raporun değil).
//
// ── SATIŞ ve ALIŞ AYRI BLOK; İADE AYRI SATIR, TOPLAMDA NEGATİF ──────────────
// SALES + SALES_RETURN satış bloğu, PURCHASE + PURCHASE_RETURN alış bloğu.
// İade faturaları kendi bloklarında AYRI (görünür) satırdır; blok toplamı
// ileri − iade (net) hesaplanır. Muhasebeci İKİ rakamı da ister: beyannamede
// iade satırı ayrı gösterilir, net rakam da kontrol toplamıdır. İadeyi
// gizleyip yalnız net vermek, "bu ay 40.000 satış KDV'si vardı, neden 35.000
// beyan ettik" sorusunu cevapsız bırakırdı.
//
// ── KIRILIM ORAN BAZINDA ve SATIR SEVİYESİNDEN ──────────────────────────────
// Oran grupları `InvoiceLine.vatRate`'ten toplanır, fatura başlığından DEĞİL:
// karışık oranlı fatura (%10 + %20 satırlar) tek orana yazılamaz. Oranlar
// satıra DAMGALIDIR (katalog sonradan değişse bile geçmiş belge kendi oranıyla
// okunur — schema notu), yani rapor geçmişe dönük stabil.
//
// ⚠️ TEVKİFAT SATIRDA TUTAR OLARAK SAKLANMAZ (`withholdingRate` var,
// `withholdingAmount` yok) → `computeLineAmounts` ile AYNI formül ve AYNI
// yuvarlamayla satır bazında YENİDEN türetilir: R2(vatAmount × whRate / 100).
// `vatAmount` damgalı olduğu için sonuç, onay anında hesaplanan değerin
// birebir aynısıdır — Σ(satır tevkifatı) = başlıktaki `withholdingTotal`.
// Formülü değiştirmek (örn. matrah üzerinden) fatura başlığıyla ayrıştırır.
//
// ── TL KOLONU: BELGENİN KENDİ KUR DAMGASI + KURUŞ KALINTISI DÜZELTMESİ ──────
// Seçilen yöntem: her fatura×oran grubunun tutarları o faturanın DAMGALI
// `exchangeRate`'iyle çevrilir (R2), sonra faturanın kalıntısı
// (`grandTotalTry` − Σ grupların TL toplamı) EN BÜYÜK MATRAHLI gruba yazılır.
// Gerekçeler:
//   • Bugünkü kurla yeniden çevirmek YASAK (donmuş belge kuralının muhasebe
//     karşılığı) — damga zaten `grandTotalTry`'nin türediği kurdur.
//   • Oran dağıtımı (`grandTotalTry × pay/grandTotal`) yerine ÇEVİRİ seçildi:
//     dağıtım `grandTotal = 0` belgelerde (tamamı sıfır satırlı) sıfıra bölme
//     dalı açar; çeviri bölme içermez ve TRY belgede (kur=1) kimlik dönüşümüdür.
//   • Kalıntı düzeltmesi (largest-remainder) sayesinde Σ(oran satırı TL) =
//     Σ(`grandTotalTry`) BİREBİR tutar — mutabakat `reconDiff` alanında
//     GÖRÜNÜR ve "0.00" olmak zorundadır (aging'in `reconDiff` deseni).
//     Düzeltmesiz yol, dövizli karışık oranlı belgede kuruş kaydırır (bekçinin
//     negatif sondası tam bu farkı ölçer).
//
// ── PARA BİRİMİ AYRI GRUP; TL GENEL TOPLAM ──────────────────────────────────
// 1000 USD matrah ile 30.000 TL matrah TOPLANAMAZ — belge para birimi bazında
// ayrı gruplar döner. Bloğun tek ortak ölçüsü TL'dir (her belge kendi kur
// damgasıyla) ve genel toplam yalnız TL kolonunda verilir.
//
// ── NEDEN JS'DE TOPLANIYOR (raw SQL değil) ──────────────────────────────────
// Kalıntı düzeltmesi FATURA BAŞINA sıralı bir karardır (en büyük matrahlı
// grubu seç, kalıntıyı ona yaz) — SQL'de window+CASE yığınıyla yazılabilir ama
// okunmaz ve `computeLineAmounts` yuvarlama sözleşmesinden kopar. Aralık 366
// günle sınırlı, satırlar `select` ile daraltılmış (perf kuralı 7), sorgu
// `[status, issueDate]` bileşik indeksine oturur.
//
// ⚠️ Tutarlar JSON'a STRING çıkar (2 hane) — `finance-aging.report.ts` ile
// aynı gerekçe (float toplamı kuruş kaydırır; istemci aritmetik YAPMAZ).
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { D, D0 } from "../helpers/finance.helper";
import type { DateRange } from "./_shared";

const R2 = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type VatBlockKind = "SALES" | "PURCHASE";

export interface VatRateRow {
  /** Oran, sabit 2 hane ("20.00") — gruplama anahtarının kendisi. */
  vatRate: string;
  /** İade satırı mı (blok içinde AYRI görünür, toplamda negatif). */
  isReturn: boolean;
  /** Bu orana satır yazan BELGE sayısı (karışık oranlı fatura iki oranda da sayılır). */
  docCount: number;
  /** Matrah — belge para biriminde (satır `lineTotal` toplamı = iskonto sonrası net). */
  base: string;
  /** Hesaplanan KDV — belge para biriminde (damgalı `vatAmount` toplamı). */
  vat: string;
  /** Tevkifat — belge para biriminde (satırdan yeniden türetilir, bkz. başlık). */
  withholding: string;
  baseTry: string;
  vatTry: string;
  withholdingTry: string;
  /** baseTry + vatTry − withholdingTry (kuruş kalıntısı düzeltmeli). */
  totalTry: string;
}

export interface VatKindTotals {
  docCount: number;
  base: string;
  vat: string;
  withholding: string;
  /** base + vat − withholding (belge para birimi). */
  grand: string;
  /** Damgalı `grandTotalTry` toplamı — belgelerin resmî TL karşılığı. */
  grandTry: string;
}

export interface VatCurrencyGroup {
  currency: string;
  /** Önce ileri satırlar (oran artan), sonra iade satırları (oran artan). */
  rows: VatRateRow[];
  forward: VatKindTotals;
  /** İade yoksa null — sıfır dolu blok basmak "iade vardı" yalanına açık. */
  returns: VatKindTotals | null;
  /** İleri − iade (belge para birimi + TL). */
  net: { base: string; vat: string; withholding: string; grand: string; grandTry: string };
}

export interface VatBlockTotalsTry {
  /** Σ grandTotalTry — ileri belgeler. */
  forward: string;
  /** Σ grandTotalTry — iade belgeleri. */
  returns: string;
  /** forward − returns. */
  net: string;
  /** Oran satırlarından türetilen net matrah TL. */
  netBase: string;
  /** Oran satırlarından türetilen net hesaplanan KDV TL. */
  netVat: string;
  /** Oran satırlarından türetilen net tevkifat TL. */
  netWithholding: string;
  /**
   * Σ(oran satırı totalTry, iade negatif) − net(damgalı). Kalıntı düzeltmesi
   * doğru çalışıyorsa DAİMA "0.00" — ayrışırsa dağıtım hatası var demektir ve
   * GİZLENMEZ (aging `reconDiff` deseni).
   */
  reconDiff: string;
}

export interface VatBlock {
  kind: VatBlockKind;
  label: string;
  /** Bloktaki BELGE sayısı (ileri + iade, tekil). */
  docCount: number;
  currencies: VatCurrencyGroup[];
  totalsTry: VatBlockTotalsTry;
}

export interface VatSummaryReport {
  sales: VatBlock;
  purchase: VatBlock;
  notes: string[];
  /**
   * YALNIZ süzgeçliyken dolar — süzgeçsiz gövde bayt bayt eskisiyle aynı kalır.
   * `dusenBelge`/`dusenSatir` şart: süzgeç boş sonuç verdiğinde ekranda "veri yok"
   * ile "süzgeç kesti" ayrılmalı, yoksa kullanıcı olmayan bir boşluğa bakar.
   */
  meta?: { suzgec: VatSuzgecMeta };
}

export interface VatSuzgecMeta {
  yon: VatYon | null;
  oran: string | null;
  /** Yön süzgecinin ELEDİĞİ belge sayısı (aralıktaki toplam − süzgeçli toplam). */
  dusenBelge: number;
  /** Oran süzgecinin yüklenen belgelerde ELEDİĞİ satır sayısı. */
  dusenSatir: number;
}

/** Fatura yönü — `InvoiceType`un aynası; iade yönleri AYRI değer (blokta ayrı satır). */
export const VAT_YONLERI = ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"] as const;
export type VatYon = (typeof VAT_YONLERI)[number];

export interface VatSummaryParams {
  range: DateRange;
  /** Fatura yönü — `where.type`a iner (sunucuda süzme). */
  yon?: VatYon;
  /** KDV oranı, sabit 2 hane ("20.00") — `where.lines.some.vatRate` + satır döngüsü. */
  oran?: string;
}

// -----------------------------------------------------------------------------
// İç toplayıcılar
// -----------------------------------------------------------------------------

interface RateAcc {
  base: Prisma.Decimal;
  vat: Prisma.Decimal;
  wh: Prisma.Decimal;
  baseTry: Prisma.Decimal;
  vatTry: Prisma.Decimal;
  whTry: Prisma.Decimal;
  docs: Set<string>;
}

interface KindAcc {
  /** rateKey → toplayıcı. */
  rates: Map<string, RateAcc>;
  docs: Set<string>;
  /** Damgalı başlık toplamları (mutabakatın "resmî" tarafı). */
  stampedGrandTry: Prisma.Decimal;
}

/** currency → { forward, returns } */
type BlockAcc = Map<string, { forward: KindAcc; returns: KindAcc }>;

const newKindAcc = (): KindAcc => ({ rates: new Map(), docs: new Set(), stampedGrandTry: D0() });

const newRateAcc = (): RateAcc => ({
  base: D0(),
  vat: D0(),
  wh: D0(),
  baseTry: D0(),
  vatTry: D0(),
  whTry: D0(),
  docs: new Set(),
});

/** TRY önce, kalanı alfabetik — muhasebecinin ilk baktığı blok yerel para. */
function currencyOrder(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "TRY") return -1;
  if (b === "TRY") return 1;
  return a.localeCompare(b);
}

// -----------------------------------------------------------------------------
// RAPOR
// -----------------------------------------------------------------------------

export async function getVatSummaryReport(params: VatSummaryParams): Promise<VatSummaryReport> {
  const { range, yon, oran } = params;
  const suzgecVar = yon !== undefined || oran !== undefined;

  // Süzgeç WHERE'e iner (bellek-içi süzme YASAK: cursor'lu listede süzme sunucuda).
  // ⚠️ `oran` İKİ YERDE uygulanır ve ikisi de gerekli: `lines.some` belgeyi seçer,
  // satır döngüsündeki atlama ise SEÇİLEN belgenin öbür oranlarını dışarıda tutar.
  // Yalnız `lines.some` yazılsaydı "20 KDV'li faturaları getir" demek olurdu ve
  // aynı faturanın 10'luk satırları da toplama girerdi.
  const temelWhere: Prisma.InvoiceWhereInput = {
    status: "CONFIRMED",
    issueDate: { gte: range.from, lte: range.to },
  };
  const where: Prisma.InvoiceWhereInput = {
    ...temelWhere,
    ...(yon ? { type: yon } : {}),
    ...(oran ? { lines: { some: { vatRate: new Prisma.Decimal(oran) } } } : {}),
  };
  // DÜŞEN BELGE ölçülür, TAHMİN EDİLMEZ: süzgeçli sorgu eleneni zaten görmez.
  // Ek sayım yalnız süzgeçliyken koşar — süzgeçsiz yol bayt bayt eski.
  const droppedDocs = suzgecVar
    ? (await prisma.invoice.count({ where: temelWhere })) - (await prisma.invoice.count({ where }))
    : 0;
  let droppedRows = 0;

  const invoices = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      type: true,
      currency: true,
      exchangeRate: true,
      grandTotalTry: true,
      lines: {
        select: { vatRate: true, withholdingRate: true, lineTotal: true, vatAmount: true },
      },
    },
  });

  const acc: Record<VatBlockKind, BlockAcc> = { SALES: new Map(), PURCHASE: new Map() };

  for (const inv of invoices) {
    const blockKind: VatBlockKind =
      inv.type === "SALES" || inv.type === "SALES_RETURN" ? "SALES" : "PURCHASE";
    const isReturn = inv.type === "SALES_RETURN" || inv.type === "PURCHASE_RETURN";

    let cur = acc[blockKind].get(inv.currency);
    if (!cur) {
      cur = { forward: newKindAcc(), returns: newKindAcc() };
      acc[blockKind].set(inv.currency, cur);
    }
    const kindAcc = isReturn ? cur.returns : cur.forward;

    // 1) Satırları orana grupla — belge para biriminde, damgalı değerlerle.
    const groups = new Map<string, { base: Prisma.Decimal; vat: Prisma.Decimal; wh: Prisma.Decimal }>();
    for (const line of inv.lines) {
      const key = D(line.vatRate).toFixed(2);
      if (oran !== undefined && key !== oran) { droppedRows++; continue; }
      let g = groups.get(key);
      if (!g) {
        g = { base: D0(), vat: D0(), wh: D0() };
        groups.set(key, g);
      }
      g.base = g.base.plus(D(line.lineTotal));
      g.vat = g.vat.plus(D(line.vatAmount));
      // Tevkifat SATIR bazında, `computeLineAmounts` ile AYNI yuvarlamayla:
      // R2(vatAmount × whRate / 100). Grup toplamından türetmek yuvarlamayı
      // kaydırır ve başlıktaki `withholdingTotal` ile ayrışır.
      g.wh = g.wh.plus(R2(D(line.vatAmount).mul(D(line.withholdingRate)).div(100)));
    }

    // 2) Her grubu belgenin KENDİ kur damgasıyla TL'ye çevir.
    const rate = D(inv.exchangeRate);
    const converted = [...groups.entries()].map(([key, g]) => ({
      key,
      g,
      baseTry: R2(g.base.mul(rate)),
      vatTry: R2(g.vat.mul(rate)),
      whTry: R2(g.wh.mul(rate)),
    }));

    // 3) Kuruş kalıntısı: grandTotalTry − Σ grupların TL toplamı → EN BÜYÜK
    //    matrahlı gruba (eşitlikte küçük oran — deterministik). Böylece
    //    Σ(oran satırı TL) = Σ(grandTotalTry) BİREBİR tutar.
    if (converted.length > 0) {
      const sumTry = converted.reduce(
        (s, c) => s.plus(c.baseTry).plus(c.vatTry).minus(c.whTry),
        D0(),
      );
      const residual = D(inv.grandTotalTry).minus(sumTry);
      if (!residual.isZero()) {
        let target = converted[0];
        for (const c of converted) {
          if (
            c.g.base.gt(target.g.base) ||
            (c.g.base.eq(target.g.base) && Number(c.key) < Number(target.key))
          ) {
            target = c;
          }
        }
        target.baseTry = target.baseTry.plus(residual);
      }
    }

    // 4) Toplayıcılara yaz.
    kindAcc.docs.add(inv.id);
    kindAcc.stampedGrandTry = kindAcc.stampedGrandTry.plus(D(inv.grandTotalTry));
    for (const c of converted) {
      let r = kindAcc.rates.get(c.key);
      if (!r) {
        r = newRateAcc();
        kindAcc.rates.set(c.key, r);
      }
      r.base = r.base.plus(c.g.base);
      r.vat = r.vat.plus(c.g.vat);
      r.wh = r.wh.plus(c.g.wh);
      r.baseTry = r.baseTry.plus(c.baseTry);
      r.vatTry = r.vatTry.plus(c.vatTry);
      r.whTry = r.whTry.plus(c.whTry);
      r.docs.add(inv.id);
    }
  }

  return {
    sales: buildBlock("SALES", "Satış", acc.SALES),
    purchase: buildBlock("PURCHASE", "Alış", acc.PURCHASE),
    notes: [
      "Bu rapor KDV BEYANNAMESİ DEĞİLDİR — muhasebeciye giden dönem özetidir; resmî beyan dış muhasebe programından yapılır.",
      "Kapsam: yalnız ONAYLANMIŞ faturalar. Taslaklar deftere işlemediği, iptal edilenler storno edildiği için rapora girmez — iptalden sonra aynı dönem yeniden alınırsa rakam değişir.",
      "Dönem çıpası FATURA TARİHİDİR (tahakkuk) — onay/işlem tarihi değil; geriye tarihli onaylanan fatura kendi dönemine düşer.",
      "İade faturaları kendi bloklarında AYRI satırdır; blok toplamına negatif (net) girer.",
      "Kırılım satır oranlarından toplanır — karışık oranlı fatura her oranda kendi payıyla görünür; tevkifat KDV üzerinden satır oranıyla türetilir.",
      "TL kolonları her belgenin KENDİ kur damgasıyla çevrilir (bugünkü kurla yeniden çevrim yapılmaz); kuruş kalıntısı en büyük matrah satırına yazılır ve TL toplamı belge TL toplamına birebir eşittir.",
      ...(suzgecVar
        ? ["SÜZGEÇ AÇIK: aşağıdaki rakamlar dönemin TAMAMI değil, süzgeçten geçen belgelerdir — `meta.suzgec` neyin elendiğini sayar."]
        : []),
    ],
    ...(suzgecVar
      ? { meta: { suzgec: { yon: yon ?? null, oran: oran ?? null, dusenBelge: droppedDocs, dusenSatir: droppedRows } } }
      : {}),
  };
}

// -----------------------------------------------------------------------------
// Blok kurulumu — TEK kaynaktan (toplayıcı satırları); totaller satırlardan
// TÜRETİLİR, ikinci bir sorgu/yol yok (Sınıf 5).
// -----------------------------------------------------------------------------

function kindTotals(k: KindAcc): VatKindTotals & {
  _rowsTry: Prisma.Decimal;
  _base: Prisma.Decimal;
  _vat: Prisma.Decimal;
  _wh: Prisma.Decimal;
  _baseTry: Prisma.Decimal;
  _vatTry: Prisma.Decimal;
  _whTry: Prisma.Decimal;
} {
  let base = D0();
  let vat = D0();
  let wh = D0();
  let baseTry = D0();
  let vatTry = D0();
  let whTry = D0();
  for (const r of k.rates.values()) {
    base = base.plus(r.base);
    vat = vat.plus(r.vat);
    wh = wh.plus(r.wh);
    baseTry = baseTry.plus(r.baseTry);
    vatTry = vatTry.plus(r.vatTry);
    whTry = whTry.plus(r.whTry);
  }
  const rowsTry = baseTry.plus(vatTry).minus(whTry);
  return {
    docCount: k.docs.size,
    base: base.toFixed(2),
    vat: vat.toFixed(2),
    withholding: wh.toFixed(2),
    grand: base.plus(vat).minus(wh).toFixed(2),
    grandTry: k.stampedGrandTry.toFixed(2),
    _rowsTry: rowsTry,
    _base: base,
    _vat: vat,
    _wh: wh,
    _baseTry: baseTry,
    _vatTry: vatTry,
    _whTry: whTry,
  };
}

function rateRows(k: KindAcc, isReturn: boolean): VatRateRow[] {
  return [...k.rates.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rateKey, r]) => ({
      vatRate: rateKey,
      isReturn,
      docCount: r.docs.size,
      base: r.base.toFixed(2),
      vat: r.vat.toFixed(2),
      withholding: r.wh.toFixed(2),
      baseTry: r.baseTry.toFixed(2),
      vatTry: r.vatTry.toFixed(2),
      withholdingTry: r.whTry.toFixed(2),
      totalTry: r.baseTry.plus(r.vatTry).minus(r.whTry).toFixed(2),
    }));
}

function buildBlock(kind: VatBlockKind, label: string, blockAcc: BlockAcc): VatBlock {
  const currencies: VatCurrencyGroup[] = [];
  const docIds = new Set<string>();

  let fwdStampedTry = D0();
  let retStampedTry = D0();
  let fwdRowsTry = D0();
  let retRowsTry = D0();
  let netBaseTry = D0();
  let netVatTry = D0();
  let netWhTry = D0();

  for (const currency of [...blockAcc.keys()].sort(currencyOrder)) {
    const { forward, returns } = blockAcc.get(currency)!;
    const f = kindTotals(forward);
    const r = kindTotals(returns);

    for (const id of forward.docs) docIds.add(id);
    for (const id of returns.docs) docIds.add(id);

    fwdStampedTry = fwdStampedTry.plus(forward.stampedGrandTry);
    retStampedTry = retStampedTry.plus(returns.stampedGrandTry);
    fwdRowsTry = fwdRowsTry.plus(f._rowsTry);
    retRowsTry = retRowsTry.plus(r._rowsTry);
    netBaseTry = netBaseTry.plus(f._baseTry).minus(r._baseTry);
    netVatTry = netVatTry.plus(f._vatTry).minus(r._vatTry);
    netWhTry = netWhTry.plus(f._whTry).minus(r._whTry);

    const hasReturns = returns.docs.size > 0;
    currencies.push({
      currency,
      rows: [...rateRows(forward, false), ...rateRows(returns, true)],
      forward: strip(f),
      returns: hasReturns ? strip(r) : null,
      net: {
        base: f._base.minus(r._base).toFixed(2),
        vat: f._vat.minus(r._vat).toFixed(2),
        withholding: f._wh.minus(r._wh).toFixed(2),
        grand: f._base
          .plus(f._vat)
          .minus(f._wh)
          .minus(r._base.plus(r._vat).minus(r._wh))
          .toFixed(2),
        grandTry: forward.stampedGrandTry.minus(returns.stampedGrandTry).toFixed(2),
      },
    });
  }

  const netRowsTry = fwdRowsTry.minus(retRowsTry);
  const netStampedTry = fwdStampedTry.minus(retStampedTry);

  return {
    kind,
    label,
    docCount: docIds.size,
    currencies,
    totalsTry: {
      forward: fwdStampedTry.toFixed(2),
      returns: retStampedTry.toFixed(2),
      net: netStampedTry.toFixed(2),
      netBase: netBaseTry.toFixed(2),
      netVat: netVatTry.toFixed(2),
      netWithholding: netWhTry.toFixed(2),
      // Türetilen (oran satırları) − damgalı (başlık) — "0.00" olmak ZORUNDA.
      reconDiff: netRowsTry.minus(netStampedTry).toFixed(2),
    },
  };
}

function strip(t: ReturnType<typeof kindTotals>): VatKindTotals {
  return {
    docCount: t.docCount,
    base: t.base,
    vat: t.vat,
    withholding: t.withholding,
    grand: t.grand,
    grandTry: t.grandTry,
  };
}
