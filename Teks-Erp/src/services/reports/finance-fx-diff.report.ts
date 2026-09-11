// =============================================================================
// KUR FARKI RAPORU — dövizli kapamalarda TL farkının listesi (J2, 2026-08-15)
// =============================================================================
// SORU: "USD kesilen fatura USD tahsilatla kapandı; iki belgenin TL karşılığı
// farklı — aradaki kur farkı ne kadar ve hangi yönde?" Sektör karşılığı:
// Logo/Mikro kur farkı listesi; VUK md. 280 değerleme farkının KAPAMA anındaki
// gerçekleşmiş bacağı.
//
// ⚠️ HİÇBİR ŞEY SAKLANMAZ — fark TÜRETİLİR (Sınıf 5: türet, kopyalama).
// Üç kaynağın üçü de değişmezdir: `PaymentAllocation.amount` (fatura para
// biriminde), faturanın kur damgası (onayla donar — kapama yalnız CONFIRMED
// faturaya yazılabilir) ve tahsilat/çekin kur damgası (kayıtta donar; düzeltme
// iptal + yeniden kayıttır). Kapama çözülünce satır `revokedAt` ile damgalanır
// (2026-09-11'e kadar SİLİNİYORDU) ve evren `ACTIVE_ALLOCATION` ile süzüldüğü için
// kur farkı yine kendiliğinden listeden düşer; ayrı bir storno bacağı GEREKMEZ.
// Saklanan bir kolon, release yollarının her birine "farkı da tersle" yükü
// bindirir ve unutulan tek yol sessiz drift olurdu.
//
// ⚠️ İŞARET TEK KAYNAKTAN: ham fark = tutar × (kaynakKuru − faturaKuru).
// Yön `invoiceLedgerSide` ile çözülür (finance.helper — kopyalanmaz):
//   • debit tarafı (SALES, PURCHASE_RETURN — para BİZE gelir): kaynak kuru
//     yüksekse tahsil edilen TL, defterdeki alacağın TL'sinden FAZLA → LEHTE.
//   • credit tarafı (PURCHASE, SALES_RETURN — para BİZDEN çıkar): kaynak kuru
//     yüksekse ödenen TL fazla → ALEYHTE.
// `signedDiffTry` daima "+ = lehte (kambiyo kârı), − = aleyhte (zarar)".
//
// ⚠️ DEFTERE YAZILMAZ (bilinçli v1 sınırı, kullanıcı kararı bekliyor):
// kur farkı DEKONTU/fişi üretmek ayrı bir muhasebe kararıdır (cari bakiyeye
// dokunur, belge ister). Bu rapor önce farkı GÖRÜNÜR yapar; dekont bacağı
// istenirse bu satırların üstüne kurulur. Yol haritası J bölümünde şıklarıyla
// kayıtlı.
//
// ⚠️ KURUŞ SÖZLEŞMESİ (H5 KDV özetinin dersi): satır farkı TAM hesaplanır,
// SATIR BAZINDA 2 haneye yuvarlanır; özet toplamları YUVARLANMIŞ satırların
// toplamıdır. Böylece ekrandaki toplam, satırların toplamına BİREBİR eşittir —
// "toplam tutmuyor" görüntüsü (1 kuruşluk kalıntı) yapısal olarak imkânsız.
//
// ⚠️ SIFIR FARKLI SATIR DA DÖNER: "bu dönemde dövizli kapama vardı ve fark
// doğurmadı" bilgisi, satırı gizlemekten daha dürüsttür (aynı kur = meşru
// durum, örn. aynı gün kapama). Özet toplamları sıfırlardan etkilenmez.
//
// ⚠️ TARİH ÇIPASI = KAPAMANIN ANI (`PaymentAllocation.createdAt`): kur farkı
// KAPAMA olayında gerçekleşir — faturanın ya da tahsilatın tarihinde değil.
// Aralık `resolveDateRange` sözleşmesiyle mutlak an'dır.
// =============================================================================

import { Prisma, ChequeKind, PaymentDirection } from "@prisma/client";
import prisma from "../../lib/prisma";
import { invoiceLedgerSide } from "../helpers/finance.helper";
import { ACTIVE_ALLOCATION } from "../payment-allocation.service";
import type { DateRange } from "./_shared";

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
const D0 = () => new Prisma.Decimal(0);
const kurus = (v: Prisma.Decimal): Prisma.Decimal => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface FxDiffRow {
  allocationId: string;
  /** Kapamanın anı (tarih çıpası — dosya başlığı). */
  allocatedAt: string;
  cari: { id: string; name: string };
  invoice: { docNo: string; type: string; currency: string; exchangeRate: string };
  /** Kapamanın kaynağı — tahsilat/ödeme ya da çek/senet. */
  source: { kind: "PAYMENT" | "CHEQUE"; docNo: string; label: string; exchangeRate: string };
  /** Kapatılan tutar — FATURANIN para biriminde. */
  amount: string;
  /** + = lehte (kambiyo kârı) · − = aleyhte (zarar). Satır bazında kuruşa yuvarlı. */
  signedDiffTry: string;
}

export interface FxDiffSummary {
  count: number;
  /** Σ pozitif satırlar (lehte). */
  gainTry: string;
  /** Σ |negatif satırlar| (aleyhte) — POZİTİF sayı olarak döner. */
  lossTry: string;
  /** gain − loss. */
  netTry: string;
  byCurrency: Array<{ currency: string; count: number; gainTry: string; lossTry: string; netTry: string }>;
}

export interface FxDiffReport {
  rows: FxDiffRow[];
  summary: FxDiffSummary;
}

const SOURCE_LABEL: Record<string, string> = {
  [`PAYMENT_${PaymentDirection.IN}`]: "Tahsilat",
  [`PAYMENT_${PaymentDirection.OUT}`]: "Ödeme",
  [`CHEQUE_${ChequeKind.RECEIVED}`]: "Aldığımız çek/senet",
  [`CHEQUE_${ChequeKind.ISSUED}`]: "Verdiğimiz çek/senet",
};

export async function getFxDiffReport(opts: {
  range: DateRange;
  cariId?: string;
  currency?: string;
}): Promise<FxDiffReport> {
  const rows = await prisma.paymentAllocation.findMany({
    where: {
      // ÇÖZÜLMÜŞ kapama kur farkı üretmez — damga 2026-09-11'de geldi, bu süzme
      // olmadan geri alınmış bir kapama raporda yaşamaya devam ederdi.
      ...ACTIVE_ALLOCATION,
      createdAt: { gte: opts.range.from, lte: opts.range.to },
      invoice: {
        // TRY faturada kur farkı tanım gereği yok (iki damga da 1) — evrenin
        // dışında. Dövizli faturayı TRY kaynakla kapamak zaten 400 (para birimi
        // eşitliği guard'ı), yani kaynak da otomatik dövizlidir.
        currency: { not: "TRY" },
        ...(opts.currency ? { currency: opts.currency as never } : {}),
        ...(opts.cariId ? { cariId: opts.cariId } : {}),
      },
    },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      invoice: {
        select: {
          docNo: true,
          type: true,
          currency: true,
          exchangeRate: true,
          cari: {
            select: {
              id: true,
              customer: { select: { name: true } },
              subcontractor: { select: { name: true } },
            },
          },
        },
      },
      payment: { select: { docNo: true, direction: true, exchangeRate: true } },
      cheque: { select: { docNo: true, kind: true, exchangeRate: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const out: FxDiffRow[] = [];
  let gain = D0();
  let loss = D0();
  const byCur = new Map<string, { count: number; gain: Prisma.Decimal; loss: Prisma.Decimal }>();

  for (const r of rows) {
    // XOR'a GÜVENİLMEZ (fatura detay yüzeyindeki kuralın backend ikizi): iki
    // kaynak da boşsa satır atlanır — uydurma bir kur ile fark HESAPLANMAZ.
    const src = r.payment
      ? { kind: "PAYMENT" as const, docNo: r.payment.docNo, key: `PAYMENT_${r.payment.direction}`, rate: D(r.payment.exchangeRate) }
      : r.cheque
        ? { kind: "CHEQUE" as const, docNo: r.cheque.docNo, key: `CHEQUE_${r.cheque.kind}`, rate: D(r.cheque.exchangeRate) }
        : null;
    if (!src) continue;

    const amount = D(r.amount);
    const invRate = D(r.invoice.exchangeRate);
    // Ham fark: kaynak TL'si − fatura TL'si (aynı FX tutar için).
    const raw = amount.mul(src.rate.minus(invRate));
    // Yön: tek kaynak `invoiceLedgerSide` — dosya başlığındaki tablo.
    const side = invoiceLedgerSide(r.invoice.type);
    const signed = kurus(side === "debit" ? raw : raw.neg());

    if (signed.gt(0)) gain = gain.plus(signed);
    else loss = loss.plus(signed.abs());

    const cur = byCur.get(r.invoice.currency) ?? { count: 0, gain: D0(), loss: D0() };
    cur.count += 1;
    if (signed.gt(0)) cur.gain = cur.gain.plus(signed);
    else cur.loss = cur.loss.plus(signed.abs());
    byCur.set(r.invoice.currency, cur);

    out.push({
      allocationId: r.id,
      allocatedAt: r.createdAt.toISOString(),
      cari: {
        id: r.invoice.cari.id,
        name: r.invoice.cari.customer?.name ?? r.invoice.cari.subcontractor?.name ?? "—",
      },
      invoice: {
        docNo: r.invoice.docNo,
        type: r.invoice.type,
        currency: r.invoice.currency,
        exchangeRate: invRate.toString(),
      },
      source: {
        kind: src.kind,
        docNo: src.docNo,
        label: SOURCE_LABEL[src.key] ?? src.kind,
        exchangeRate: src.rate.toString(),
      },
      amount: amount.toString(),
      signedDiffTry: signed.toString(),
    });
  }

  return {
    rows: out,
    summary: {
      count: out.length,
      gainTry: gain.toString(),
      lossTry: loss.toString(),
      netTry: gain.minus(loss).toString(),
      byCurrency: [...byCur.entries()].map(([currency, v]) => ({
        currency,
        count: v.count,
        gainTry: v.gain.toString(),
        lossTry: v.loss.toString(),
        netTry: v.gain.minus(v.loss).toString(),
      })),
    },
  };
}
