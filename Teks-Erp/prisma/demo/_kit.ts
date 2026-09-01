// =============================================================================
// DEMO SEED — ORTAK YARDIMCILAR
// =============================================================================
// `seed-demo-full.ts` ve modülleri buradan beslenir.
//
// ⚠️ NEDEN `prisma/` ALTINDA, `scripts/` DEĞİL: Dockerfile imaja yalnız
// `prisma`, `src`, `assets` kopyalar (ölçüldü — `COPY Teks-Erp/prisma ./prisma`).
// `Teks-Erp/scripts/` imaja HİÇ girmez, yani orada yaşayan bir seed sunucuda
// koşturulamaz.
// =============================================================================
import { v5 as uuidv5 } from "uuid";
import prisma from "../../src/lib/prisma";

// -----------------------------------------------------------------------------
// DB KAPISI
// -----------------------------------------------------------------------------
/**
 * ⚠️ ZORLAMA BAYRAĞI BİLEREK YOK: canlı fabrika verisine demo kaydı yazmanın
 * tek adımlık bir yolu OLMAMALI. `seed-ticaret-demo.ts` ile AYNI kural.
 */
export function assertDemoDatabase(dbName: string): void {
  if (/demo|ticaret/i.test(dbName)) return;
  console.error(
    "\n⛔ REDDEDİLDİ — bu bir demo veritabanı değil.\n" +
      `   Bağlanılan veritabanı: ${dbName}\n` +
      "   Bu script yalnız adında 'demo' ya da 'ticaret' geçen veritabanlarında koşar.\n",
  );
  process.exit(1);
}

/**
 * İKİNCİ EMNİYET KEMERİ — DB adı doğru ama İÇERİK canlı kopyası olabilir
 * (fabrika yedeği bir "demo" adına restore edilmiş olabilir). Demo-dışı üretim
 * topu sayısı eşiği aşarsa DUR.
 */
export async function assertNotProductionCopy(): Promise<void> {
  const yabanci = await prisma.roll.count({
    where: {
      AND: [
        { barcode: { not: null } },
        { barcode: { not: { startsWith: "DEMO" } } },
        { barcode: { not: { startsWith: "DF-" } } },
        { barcode: { not: { startsWith: "TST-" } } },
        { barcode: { not: { startsWith: "TEST" } } },
      ],
    },
  });
  if (yabanci > 500) {
    console.error(
      `\n⛔ REDDEDİLDİ — bu veritabanında ${yabanci} demo-dışı top var.\n` +
        "   DB adı 'demo' geçse de içerik bir üretim kopyası gibi görünüyor.\n",
    );
    process.exit(1);
  }
}

export async function dbAdi(): Promise<string> {
  const r = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  return r[0]?.db ?? "(bilinmiyor)";
}

// -----------------------------------------------------------------------------
// İDEMPOTENTLİK
// -----------------------------------------------------------------------------
/**
 * ⚠️ AD ÖNEKİ `seed-ticaret-demo`dan FARKLI (`tekserp-demo-full:`): aynı
 * namespace ama farklı uzay → iki seed birbirinin token'ını ezmez, ikisi de
 * kendi kayıtlarını replay eder.
 */
const NS = "6f9e1b2c-6a1f-4c0f-9c4e-9b3d5a7e1c20";
export function demoToken(ad: string): string {
  return uuidv5(`tekserp-demo-full:${ad}`, NS);
}

/**
 * Deterministik PRIMARY KEY — unique kolonu OLMAYAN append-only tablolar için
 * (`RollMovement`, `RollOperation`, `WorkSession`…). `createMany({skipDuplicates})`
 * ile birlikte "önce ara sonra yaz" yarışını da kapatır ve ikinci koşumda
 * 0 yeni satır üretir.
 */
export const demoId = demoToken;

// -----------------------------------------------------------------------------
// TARİH
// -----------------------------------------------------------------------------
// ⚠️ Her sabit tarih 09:00 UTC ile kurulur (Istanbul'da 12:00) — hiçbir makul
// saat diliminde takvim günü kaymaz (`seed-ticaret-demo` ile aynı kural).
const GUN = 24 * 60 * 60 * 1000;

/** Bugünden N gün ÖNCE, öğlen. */
export function gunOnce(n: number): Date {
  const d = new Date(Date.now() - n * GUN);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0));
}

/**
 * ZAMAN EKSENİ — raporların varsayılan penceresi SON 30 GÜNdür
 * (`reports/_shared.ts` → `DEFAULT_RANGE_DAYS = 30`). 4 aya EŞİT dağıtılmış bir
 * veri seti, her raporu ilk açılışta neredeyse BOŞ gösterirdi. Bu yüzden hacim
 * bugüne doğru yoğunlaşır: ~%45'i son 30 günde.
 */
export function yayilmisGun(i: number, toplam: number): number {
  const oran = i / Math.max(1, toplam - 1); // 0 → 1
  // Kübik yumuşatma: küçük i → eski tarih, büyük i → bugüne yakın.
  return Math.round(140 * Math.pow(1 - oran, 2.2));
}

// -----------------------------------------------------------------------------
// SAYAÇ + LOG
// -----------------------------------------------------------------------------
const sayac = new Map<string, number>();
export function say(ad: string, n = 1): void {
  sayac.set(ad, (sayac.get(ad) ?? 0) + n);
}
export function sayaclar(): Array<[string, number]> {
  return [...sayac.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
}

const notlar: string[] = [];
/** Bir senaryo sessizce atlandıysa BURAYA yazılır — `verify` onu ⚠ ile basar. */
export function not(mesaj: string): void {
  notlar.push(mesaj);
  console.log(`   ⚠ ${mesaj}`);
}
export function notlarListesi(): string[] {
  return notlar;
}

export function adim(baslik: string): void {
  console.log(`\n▶ ${baslik}`);
}

// -----------------------------------------------------------------------------
// KÜÇÜK YARDIMCILAR
// -----------------------------------------------------------------------------
/** Deterministik sözde-rastgele — her koşumda AYNI veri (idempotentlik şartı). */
export function rastgele(tohum: number): () => number {
  let s = tohum >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function sec<T>(dizi: readonly T[], r: () => number): T {
  return dizi[Math.floor(r() * dizi.length)] as T;
}

/** Büyük listeleri parçalara böler — tek tx 50s `statement_timeout`una çarpmasın. */
export function parcala<T>(dizi: T[], boy: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < dizi.length; i += boy) out.push(dizi.slice(i, i + boy));
  return out;
}
