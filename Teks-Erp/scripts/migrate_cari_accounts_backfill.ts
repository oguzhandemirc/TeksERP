// =============================================================================
// GÖÇ — HESAPSIZ AKTİF KARTLARA CARİ HESAP AÇ (cari kart ↔ hesap birleşimi Z-A, karar A)
// =============================================================================
// Koşum:
//   npx tsx scripts/migrate_cari_accounts_backfill.ts                     → DRY-RUN (varsayılan): yalnız listeler
//   npx tsx scripts/migrate_cari_accounts_backfill.ts --apply             → yazar (hedef `_test` ile bitmeli)
//   npx tsx scripts/migrate_cari_accounts_backfill.ts --apply --canli-onay → canlı/yedek DB'ye yazar (FAIL-CLOSED kapı)
//
// NE YAPAR: `finance.enabled` AÇIK kurulumda hesabı olmayan her AKTİF kartı listeler ve `--apply` ile her birine
// `ensureCariAccountTx` üstünden hesap açar (kart formu / fatura yolu ile AYNI tek kapı — ikinci yazar yok).
// Hesap BOŞ doğar (varsayılan terimler; `CariBalance` satırı yaratılmaz). İDEMPOTENT: ikinci koşum 0 değişiklik.
// RAPOR (yazmaz): kartsız hesaplar (`customerId` null, eski fason bacağı) · aynı karta bağlı çift hesap (şemada
// `customerId @unique` ⇒ yapısal olarak 0 — yine de sayılır, sed düşerse görünsün). Pasif kartlar DOKUNULMAZ (listede ayrı satır: bilgi).
//
// KOŞAN KULLANICIDIR (canlı veri kuralı): script yalnız etkilenen her kartı ADIYLA listeler ve `--apply`de
// yazar; fabrika kopyasında prova sonrası canlıda `--canli-onay` ile koşulur. Sayılar Z-A tasarım belgesine
// (CARI-KART-HESAP-BIRLESIMI §6.1 "ÖLÇÜLEMEDİ") bu dry-run çıktısından yazılır.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { readFinanceEnabled } from "../src/services/system-setting.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");

interface KartSatiri {
  id: string;
  code: string;
  name: string;
  isCustomerRole: boolean;
  isSupplierRole: boolean;
  isSubcontractorRole: boolean;
}

const roller = (k: KartSatiri): string =>
  [k.isCustomerRole && "Müşteri", k.isSupplierRole && "Tedarikçi", k.isSubcontractorRole && "Fason"].filter(Boolean).join("+") || "rolsüz";

/** Kapı: `_test` dışı hedefe yazmak `--canli-onay` ister; dry-run her hedefte serbest (okur). */
function yazmaEngeli(): string | null {
  if (!APPLY) return null;
  const db = hedefDbAdi();
  if (db.endsWith("_test")) return null;
  if (CANLI_ONAY) return null;
  return `'${db}' bir fixture DB'si değil (_test ile bitmiyor). Canlı/yedek veriye yazmak için --canli-onay ver; önce dry-run çıktısını oku.`;
}

export interface BackfillOzeti {
  hedef: string;
  financeEnabled: boolean;
  hesapsizAktif: KartSatiri[];
  hesapsizPasif: number;
  kartsizHesap: Array<{ id: string; subcontractorId: string | null; kind: string }>;
  ciftHesapKart: Array<{ customerId: string; hesapSayisi: number }>;
  acilan: number;
}

export async function backfillOlc(): Promise<Omit<BackfillOzeti, "acilan">> {
  const financeEnabled = await readFinanceEnabled();
  const hesapsiz = await prisma.customer.findMany({
    where: { cariAccount: null },
    select: { id: true, code: true, name: true, isActive: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true },
    orderBy: { code: "asc" },
  });
  const kartsiz = await prisma.cariAccount.findMany({ where: { customerId: null }, select: { id: true, subcontractorId: true, kind: true } });
  const cift = await prisma.cariAccount.groupBy({ by: ["customerId"], where: { customerId: { not: null } }, _count: { _all: true }, having: { customerId: { _count: { gt: 1 } } } });
  return {
    hedef: hedefDbAdi(),
    financeEnabled,
    hesapsizAktif: hesapsiz.filter((k) => k.isActive),
    hesapsizPasif: hesapsiz.filter((k) => !k.isActive).length,
    kartsizHesap: kartsiz,
    ciftHesapKart: cift.map((g) => ({ customerId: g.customerId as string, hesapSayisi: g._count._all })),
  };
}

/** Yazma: kart başına AYRI tx (biri düşerse ötekiler kalır; her biri tek kapıdan). */
export async function backfillUygula(kartlar: KartSatiri[]): Promise<number> {
  let acilan = 0;
  for (const k of kartlar) {
    await prisma.$transaction(async (tx) => {
      await ensureCariAccountTx(tx, { customerId: k.id });
    });
    acilan++;
  }
  return acilan;
}

async function main(): Promise<void> {
  const engel = yazmaEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  const olcum = await backfillOlc();
  console.log(`=== CARİ HESAP GÖÇÜ — ${APPLY ? "UYGULA" : "DRY-RUN"} · hedef ${olcum.hedef} · finance.enabled=${olcum.financeEnabled} ===\n`);
  console.log(`Hesapsız AKTİF kart: ${olcum.hesapsizAktif.length}`);
  for (const k of olcum.hesapsizAktif) console.log(`  · ${k.code}  ${k.name}  [${roller(k)}]`);
  console.log(`Hesapsız PASİF kart (dokunulmaz): ${olcum.hesapsizPasif}`);
  console.log(`Kartsız hesap (eski fason bacağı, rapor): ${olcum.kartsizHesap.length}`);
  for (const h of olcum.kartsizHesap) console.log(`  · hesap ${h.id}  kind=${h.kind}  subcontractorId=${h.subcontractorId ?? "-"}`);
  console.log(`Aynı karta çift hesap (rapor): ${olcum.ciftHesapKart.length}`);
  for (const c of olcum.ciftHesapKart) console.log(`  · kart ${c.customerId}  ${c.hesapSayisi} hesap`);

  if (!APPLY) {
    console.log("\n(dry-run — hiçbir şey yazılmadı; yazmak için --apply)");
    return;
  }
  if (!olcum.financeEnabled) {
    console.log("\n⛔ finance.enabled KAPALI — bu kurulumda hesap doğurulmaz (bayrak açılınca yeniden koş).");
    process.exit(2);
  }
  const acilan = await backfillUygula(olcum.hesapsizAktif);
  const sonra = await backfillOlc();
  console.log(`\n✅ ${acilan} hesap açıldı · kalan hesapsız aktif kart: ${sonra.hesapsizAktif.length} (idempotent: ikinci koşum 0 yazar)`);
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
