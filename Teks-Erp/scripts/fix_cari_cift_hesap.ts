// =============================================================================
// ONARIM — AYNI KARTA İKİ AKTİF CARİ HESAP (K3a, 2026-10-30)
// =============================================================================
// Koşum:
//   npx tsx scripts/fix_cari_cift_hesap.ts                       → DRY-RUN (varsayılan): yalnız listeler
//   npx tsx scripts/fix_cari_cift_hesap.ts --apply               → yazar (hedef `_test` ile bitmeli)
//   npx tsx scripts/fix_cari_cift_hesap.ts --apply --canli-onay  → canlı/yedek DB'ye yazar (FAIL-CLOSED kapı)
//
// NEDEN: K3a öncesi, yalnız ESKİ FASON BACAĞINA (`subcontractorId`, profil.customerId = kart) bağlı hesabı olan
// kartta karttan terim/tetik yazımı ikinci bir CUSTOMER hesabı doğuruyordu. Kod düzeldi (tek çözücü
// `findCariAccountForCardTx`); bu betik doğmuş çiftleri bulur.
//
// NE YAPAR: aynı kartın İKİ AKTİF hesabını (kart hesabı + eski fason bacağı) listeler — her hesabın hareket sayısı
// (`lib/cari-cocuk-baglari` çocukları) ve bakiyesi (para birimi başına). "İkinci hesap" = sonra doğan (createdAt,
// eşitlikte id). `--apply` YALNIZ ikinci hesabın HİÇ hareketi ve sıfırdan farklı bakiyesi yoksa onu KAPATIR (atomik
// claim `isActive: true`; kart hesabıysa deftere hiç yazmamış satır silinir ve ilk hesap karta çevrilir — `ciftUygula`). İkinci hesaptaki terimler (vade · para birimi · vergi dairesi · risk ·
// hizmet tetiği) kalan hesapta BOŞSA taşınır — K2b okuyucusu kart hesabını gösteriyordu, kullanıcının gördüğü değer
// kaybolmasın; iki hesapta FARKLI dolu terim varsa çifte DOKUNMAZ (kullanıcı kararı). Hareketli çiftte DURUR ve
// listeler: birleştirme (defter taşıma + bakiye toplama) kullanıcı kararıdır, bu betik yapmaz → çıkış 3.
// Pasif + boş eski fason hesabı (rol modeli göçünün BİRLEŞME İZİ) çift sayılmaz. İDEMPOTENT: ikinci koşum 0 yazar.
// KOŞAN KULLANICIDIR: fabrika kopyasında prova sonrası canlıda `--canli-onay` ile.
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { BILINEN_GUVENLI_DB_ADLARI } from "./lib/bilinen-guvenli-db";
import { COCUKLAR } from "./lib/cari-cocuk-baglari";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");

const TERM_FIELDS = ["paymentTermDays", "taxOffice", "riskLimit", "serviceBillingTrigger", "notes"] as const;

export interface HesapOzeti {
  id: string;
  kind: string;
  createdAt: Date;
  hareket: number;
  bakiye: Record<string, string>;
  terimler: Record<string, string | null>;
}
export interface CiftSatiri {
  customerId: string;
  kartKodu: string;
  kartAdi: string;
  ilk: HesapOzeti;
  ikinci: HesapOzeti;
  /** Taşınacak terimler (ikinciden ilke, ilkte boş olanlar). */
  terimTasi: Record<string, unknown>;
  /** null = kapatılabilir; dolu = DURUR gerekçesi. */
  engel: string | null;
}

/** Kapı: `_test` dışı hedefe yazmak `--canli-onay` ister; dry-run her hedefte serbest (okur). */
function yazmaEngeli(): string | null {
  if (!APPLY) return null;
  const db = hedefDbAdi();
  // Fixture hedefi: `_test` son eki ya da bilinen güvenli ad (CI `teks_ci`) — tek kaynak `lib/bilinen-guvenli-db`.
  if (db.endsWith("_test") || BILINEN_GUVENLI_DB_ADLARI.has(db) || CANLI_ONAY) return null;
  return `'${db}' bir fixture DB'si değil (_test ile bitmiyor). Canlı/yedek veriye yazmak için --canli-onay ver; önce dry-run çıktısını oku.`;
}

const ACC_SELECT = { id: true, kind: true, createdAt: true, isActive: true, defaultCurrency: true, paymentTermDays: true, taxOffice: true, riskLimit: true, serviceBillingTrigger: true, notes: true } as const;
type AccRow = Prisma.CariAccountGetPayload<{ select: typeof ACC_SELECT }>;

async function ozet(a: AccRow): Promise<HesapOzeti> {
  let hareket = 0;
  for (const c of COCUKLAR) {
    // Çocuk tablosu model+alan çiftidir (tek kaynak `lib/cari-cocuk-baglari`); delege adı çalışma anında seçilir.
    hareket += await (prisma as unknown as Record<string, { count: (q: unknown) => Promise<number> }>)[c.model]!.count({ where: { [c.alan]: a.id } });
  }
  const bakiyeler = await prisma.cariBalance.findMany({ where: { cariId: a.id }, select: { currency: true, balance: true }, orderBy: { currency: "asc" } });
  const bakiye: Record<string, string> = {};
  for (const b of bakiyeler) if (!new Prisma.Decimal(b.balance).isZero()) bakiye[b.currency] = b.balance.toString();
  const terimler: Record<string, string | null> = { defaultCurrency: a.defaultCurrency };
  for (const f of TERM_FIELDS) terimler[f] = a[f] == null ? null : String(a[f]);
  return { id: a.id, kind: a.kind, createdAt: a.createdAt, hareket, bakiye, terimler };
}

function terimKarari(ilk: AccRow, ikinci: AccRow): { tasi: Record<string, unknown>; catisma: string[] } {
  const tasi: Record<string, unknown> = {};
  const catisma: string[] = [];
  for (const f of TERM_FIELDS) {
    const a = ilk[f];
    const b = ikinci[f];
    if (b == null) continue;
    if (a == null) tasi[f] = b;
    else if (String(a) !== String(b)) catisma.push(f);
  }
  if (ikinci.defaultCurrency !== Currency.TRY) {
    if (ilk.defaultCurrency === Currency.TRY) tasi.defaultCurrency = ikinci.defaultCurrency;
    else if (ilk.defaultCurrency !== ikinci.defaultCurrency) catisma.push("defaultCurrency");
  }
  return { tasi, catisma };
}

export async function ciftOlc(): Promise<{ hedef: string; ciftler: CiftSatiri[]; birlesmeIzi: number }> {
  const eskiBacak = await prisma.cariAccount.findMany({
    where: { subcontractorId: { not: null }, subcontractor: { customerId: { not: null } } },
    select: { ...ACC_SELECT, subcontractor: { select: { customerId: true } } },
    orderBy: { id: "asc" },
  });
  const ciftler: CiftSatiri[] = [];
  let birlesmeIzi = 0;
  for (const eski of eskiBacak) {
    const customerId = eski.subcontractor!.customerId!;
    const kart = await prisma.cariAccount.findUnique({ where: { customerId }, select: { ...ACC_SELECT, customer: { select: { code: true, name: true } } } });
    if (!kart) continue;
    if (!eski.isActive || !kart.isActive) {
      birlesmeIzi++;
      continue;
    }
    const [ilk, ikinci] = eski.createdAt.getTime() < kart.createdAt.getTime() || (eski.createdAt.getTime() === kart.createdAt.getTime() && eski.id < kart.id) ? [eski, kart] : [kart, eski];
    const o2 = await ozet(ikinci);
    const { tasi, catisma } = terimKarari(ilk, ikinci);
    let engel: string | null = null;
    if (o2.hareket > 0 || Object.keys(o2.bakiye).length > 0) engel = `ikinci hesap HAREKETLİ (${o2.hareket} hareket, bakiye ${JSON.stringify(o2.bakiye)}) — birleştirme kullanıcı kararı`;
    else if (catisma.length > 0) engel = `terim çatışması (${catisma.join(", ")}) — hangi değerin kalacağı kullanıcı kararı`;
    ciftler.push({ customerId, kartKodu: kart.customer!.code, kartAdi: kart.customer!.name, ilk: await ozet(ilk), ikinci: o2, terimTasi: tasi, engel });
  }
  return { hedef: hedefDbAdi(), ciftler, birlesmeIzi };
}

/**
 * Kapatılabilir çiftlerde ikinci hesabı kapatır; çift başına AYRI tx. Dönüş: kapatılan sayısı.
 * İkinci = kart hesabı (K2b yazımının doğurduğu, olağan durum): deftere HİÇ yazmamış satır SİLİNİR ve eski fason
 * bacağındaki ilk hesap kartın hesabına çevrilir (rol modeli göçüyle aynı TEK UPDATE) — `customerId @unique` boşalmadan
 * çevirme olmaz, pasif kopya bırakılırsa kart hesabı her okuyucuda fason hesabı kalırdı. İkinci = eski fason bacağı:
 * pasife çekilir (göçün birleşme izi biçimi).
 */
export async function ciftUygula(ciftler: CiftSatiri[]): Promise<number> {
  let kapatilan = 0;
  for (const c of ciftler) {
    if (c.engel) continue;
    const kartHesabiIkinci = c.ikinci.kind === "CUSTOMER";
    const ok = await prisma.$transaction(async (tx) => {
      // Atomik claim: ikinci hesap hâlâ aktif VE hâlâ hareketsiz (arada fatura/ödeme yazıldıysa dokunma).
      const claim = await tx.cariAccount.updateMany({
        where: {
          id: c.ikinci.id,
          isActive: true,
          transactions: { none: {} },
          invoices: { none: {} },
          payments: { none: {} },
          cheques: { none: {} },
          endorsedCheques: { none: {} },
          chequeEvents: { none: {} },
          periodCloses: { none: {} },
          reconciliationLetters: { none: {} },
          chequeDeliveryNotes: { none: {} },
          balances: { none: { balance: { not: 0 } } },
        },
        data: { isActive: false },
      });
      if (claim.count === 0) return false;
      if (kartHesabiIkinci) {
        await tx.cariBalance.deleteMany({ where: { cariId: c.ikinci.id } });
        await tx.cariAccount.delete({ where: { id: c.ikinci.id } });
        const moved = await tx.cariAccount.updateMany({
          where: { id: c.ilk.id, customerId: null, isActive: true },
          data: { customerId: c.customerId, subcontractorId: null, kind: "CUSTOMER", ...(c.terimTasi as Prisma.CariAccountUpdateManyMutationInput) },
        });
        if (moved.count === 0) throw new Error(`ilk hesap ${c.ilk.id} çevrilemedi (arada değişti) — çift geri alındı`);
      } else if (Object.keys(c.terimTasi).length > 0) {
        await tx.cariAccount.update({ where: { id: c.ilk.id }, data: c.terimTasi as Prisma.CariAccountUpdateInput });
      }
      return true;
    });
    if (!ok) continue;
    kapatilan++;
    if (kartHesabiIkinci) {
      await AuditService.log({ userId: undefined, action: "DELETE", tableName: "CARI_ACCOUNT", recordId: c.ikinci.id, oldData: { customerId: c.customerId, kind: "CUSTOMER" }, newData: { kaynak: "fix_cari_cift_hesap", kalanHesap: c.ilk.id, gerekce: "hareketsiz ikinci kart hesabı" } });
      await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: c.ilk.id, newData: { customerId: c.customerId, subcontractorId: null, kind: "CUSTOMER", tasinanTerimler: Object.keys(c.terimTasi), kaynak: "fix_cari_cift_hesap" } });
    } else {
      await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: c.ikinci.id, newData: { isActive: false, kaynak: "fix_cari_cift_hesap", kalanHesap: c.ilk.id } });
      if (Object.keys(c.terimTasi).length > 0) {
        await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: c.ilk.id, newData: { tasinanTerimler: Object.keys(c.terimTasi), kaynakHesap: c.ikinci.id, kaynak: "fix_cari_cift_hesap" } });
      }
    }
  }
  return kapatilan;
}

function bas(c: CiftSatiri): void {
  const h = (o: HesapOzeti) => `${o.id} ${o.kind} doğuş ${o.createdAt.toISOString()} · ${o.hareket} hareket · bakiye ${JSON.stringify(o.bakiye)}`;
  console.log(`  · ${c.kartKodu}  ${c.kartAdi}`);
  console.log(`      ilk    : ${h(c.ilk)}`);
  console.log(`      ikinci : ${h(c.ikinci)}`);
  if (Object.keys(c.terimTasi).length > 0) console.log(`      taşınacak terimler: ${Object.keys(c.terimTasi).join(", ")}`);
  const karar = c.ikinci.kind === "CUSTOMER" ? "hareketsiz ikinci kart hesabı silinir, ilk hesap kartın hesabına çevrilir" : "ikinci (eski fason) hesap pasife çekilir";
  console.log(`      karar  : ${c.engel ? `⛔ DURUR — ${c.engel}` : karar}`);
}

async function main(): Promise<void> {
  const engel = yazmaEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  const o = await ciftOlc();
  console.log(`=== CARİ ÇİFT HESAP ONARIMI — ${APPLY ? "UYGULA" : "DRY-RUN"} · hedef ${o.hedef} ===\n`);
  console.log(`Aynı karta iki AKTİF hesap: ${o.ciftler.length}`);
  for (const c of o.ciftler) bas(c);
  console.log(`Birleşme izi (bir tarafı pasif, çift sayılmaz): ${o.birlesmeIzi}`);
  const duran = o.ciftler.filter((c) => c.engel);
  if (!APPLY) {
    console.log("\n(dry-run — hiçbir şey yazılmadı; yazmak için --apply)");
    return;
  }
  const kapatilan = await ciftUygula(o.ciftler);
  console.log(`\n✅ ${kapatilan} çift onarıldı (ikinci hesap kapatıldı).`);
  if (duran.length > 0) {
    console.log(`⛔ ${duran.length} çift DURDU (hareketli ya da terim çatışması) — birleştirme kullanıcı kararı; yukarıdaki listeye bak.`);
    process.exitCode = 3;
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("HATA", e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
