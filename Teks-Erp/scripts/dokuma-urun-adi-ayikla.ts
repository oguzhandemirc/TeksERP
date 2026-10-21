// =============================================================================
// VERİ UYUMU (S5) — kumaş kalem adından kök / çözgü / atkı-sim / varyant / en
// =============================================================================
// KURU KOŞUM VARSAYILAN (yalnız SELECT + rapor):
//   DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/dokuma-urun-adi-ayikla.ts [--aktif] [--csv=<yol>]
// UYGULAMA (S5c — S2 şeması + kullanıcı kararı sonrası):
//   … --apply --kabul=<KARAR sütunu doldurulmuş csv> [--canli-onay="<kullanıcının cümlesi>"]
//
// Plan: docs/design/DOKUMA-MANUEL-PLAN.md § S5 · kurallar: scripts/lib/kumas-adi-ayiklama.ts.
// Ürün ADI ve KODU hiç değişmez; öneri tablosunu kullanıcı onaylar (KARAR=KABUL).
//
// NEDEN `.env` OKUNMAZ: ana ağacın `.env`i fabrika verisini gösterir. Hedef yalnız
// komut satırından gelir; kuru koşum `src/lib/prisma`yı (dotenv yükler) HİÇ içe
// aktarmaz, salt `pg` havuzuyla okur. Bütün kapılar DB bağlantısından ÖNCE koşar.
// =============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { Prisma } from "@prisma/client";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import {
  ayikla, csvYaz, kabulKimlikleri, uygulamaPlani, type OneriSatiri,
} from "./lib/kumas-adi-ayiklama";

const BETIK = "dokuma-urun-adi-ayikla";
const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes("--apply");
const AKTIF = ARGV.includes("--aktif");
const deger = (ad: string): string | undefined =>
  ARGV.find((a) => a.startsWith(`--${ad}=`))?.slice(ad.length + 3);
const CSV_YOLU = deger("csv");
const KABUL_YOLU = deger("kabul");
const CANLI_ONAY = deger("canli-onay")?.trim() ?? "";

function dur(mesaj: string): never {
  console.error(`\n⛔ ${BETIK} DURDURULDU — ${mesaj}\n`);
  process.exit(1);
}

/** Kapılar sırayla; hepsi DB'ye dokunmadan karar verir. */
function kapilar(): void {
  const bilinen = /^--(?:apply|aktif|csv=.+|kabul=.+|canli-onay=.+)$/;
  const yabanci = ARGV.filter((a) => !bilinen.test(a));
  if (yabanci.length > 0) dur(`tanınmayan argüman: ${yabanci.join(" ")}`);
  if (!process.env.DATABASE_URL) dur("DATABASE_URL ver (yalnız komut satırında; `.env` okunmaz).");
  const engel = hedefDbEngeli();
  if (engel) dur(engel);
  assertGelistirmeVeritabani(BETIK);
  if (APPLY) {
    const db = hedefDbAdi();
    // Prova dışı uygulama yalnız kullanıcının sabah onayıyla (cümlesi çıktıya basılır).
    if (!db.endsWith("_test")) {
      if (CANLI_ONAY.length < 10) {
        dur(`--apply yalnız '_test' ile biten prova veritabanında (hedef '${db}'). ` +
          'Prova dışı uygulama: --canli-onay="<kullanıcının onay cümlesi>".');
      }
      console.log(`⚠️ PROVA DIŞI UYGULAMA — kullanıcı onayı: "${CANLI_ONAY}"`);
    }
    if (!KABUL_YOLU) dur("--apply yalnız --kabul=<csv> ile (KARAR=KABUL satırları).");
  } else if (KABUL_YOLU) {
    console.log("ℹ️ --kabul yalnız --apply ile anlamlı; kuru koşumda yok sayıldı.");
  }
}

interface HamKalem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  lifecycleStatus: string;
  topSayisi: number;
  renkSayisi: number;
}

async function kalemleriOku(pool: Pool): Promise<OneriSatiri[]> {
  const r = await pool.query<HamKalem>(
    `SELECT i.id, i.code, i.name, i."isActive", i."lifecycleStatus"::text AS "lifecycleStatus",
            (SELECT count(*)::int FROM rolls r WHERE r."itemId" = i.id) AS "topSayisi",
            (SELECT count(DISTINCT r."colorId")::int FROM rolls r WHERE r."itemId" = i.id) AS "renkSayisi"
       FROM items i
      WHERE i."itemType" = 'FABRIC' ${AKTIF ? 'AND i."isActive"' : ""}
      ORDER BY i.code`,
  );
  const sirala = new Intl.Collator("tr");
  return r.rows
    .map((k) => ({
      itemId: k.id, code: k.code, name: k.name, isActive: k.isActive, lifecycleStatus: k.lifecycleStatus,
      topSayisi: k.topSayisi, renkSayisi: k.renkSayisi, ayiklama: ayikla(k.name),
    }))
    .sort((a, b) => sirala.compare(a.ayiklama.kok, b.ayiklama.kok) || sirala.compare(a.name, b.name));
}

const kes = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s).padEnd(n);

function raporla(satirlar: readonly OneriSatiri[]): void {
  console.log(`\n${satirlar.length} FABRIC kalem${AKTIF ? " (yalnız aktif)" : ""}:\n`);
  console.log(
    `  ${kes("kod", 11)} ${kes("ad", 34)} ${kes("durum", 6)} ${"top".padStart(5)} ${"rnk".padStart(3)}  ` +
      `${kes("sınıf", 20)} ${kes("kök", 16)} ${kes("çözgü", 6)} ${kes("atkı/sim", 24)} ${kes("var.", 8)} ${kes("en", 6)} öneri / işaret`,
  );
  for (const r of satirlar) {
    const a = r.ayiklama;
    const isaret = [
      a.oneriCozguKarti, a.oneriAtkiKarti,
      a.sinif === "?" ? "KARAR BEKLER" : "",
      r.topSayisi > 0 ? "KULLANIMDA" : "",
      a.dokunulmaz ? "DOKUNULMAZ" : "",
      a.not ? `(${a.not})` : "",
    ].filter(Boolean).join(" · ");
    console.log(
      `  ${kes(r.code, 11)} ${kes(r.name, 34)} ${kes(r.isActive ? "aktif" : "pasif", 6)} ` +
        `${String(r.topSayisi).padStart(5)} ${String(r.renkSayisi).padStart(3)}  ${kes(a.sinif, 20)} ` +
        `${kes(a.kok, 16)} ${kes(a.cozguRengi, 6)} ${kes(a.atkiSim, 24)} ${kes(a.varyant, 8)} ${kes(a.en, 6)} ${isaret}`,
    );
  }

  const dagilim = new Map<string, { aktif: number; pasif: number }>();
  for (const r of satirlar) {
    const d = dagilim.get(r.ayiklama.sinif) ?? { aktif: 0, pasif: 0 };
    if (r.isActive) d.aktif++;
    else d.pasif++;
    dagilim.set(r.ayiklama.sinif, d);
  }
  console.log("\nSınıf dağılımı:");
  console.log(`  ${kes("sınıf", 22)} ${"aktif".padStart(6)} ${"pasif".padStart(6)}`);
  for (const [s, d] of [...dagilim].sort((x, y) => y[1].aktif + y[1].pasif - (x[1].aktif + x[1].pasif))) {
    console.log(`  ${kes(s, 22)} ${String(d.aktif).padStart(6)} ${String(d.pasif).padStart(6)}`);
  }

  const bekleyen = satirlar.filter((r) => r.ayiklama.sinif === "?");
  const kullanimda = satirlar.filter((r) => r.topSayisi > 0);
  const dokunulmaz = satirlar.filter((r) => r.ayiklama.dokunulmaz);
  if (bekleyen.length > 0) {
    console.log(`\n⚠️ KARAR BEKLER: ${bekleyen.length} kalem sınıflandırılamadı — elle karar:`);
    for (const r of bekleyen) console.log(`     ${r.code}  ${r.name}  (${r.ayiklama.not}; ${r.topSayisi} top)`);
  }
  if (kullanimda.length > 0) {
    console.log(`\n⚠️ KULLANIMDA: ${kullanimda.length} kalemin topu var — ad değişmez, yalnız S2 alanları yazılır.`);
  }
  if (dokunulmaz.length > 0) {
    console.log(`\nℹ️ DOKUNULMAZ: ${dokunulmaz.length} kalem (varyant / renk adı) — KABUL yazılsa da atlanır.`);
  }
}

async function uygula(satirlar: readonly OneriSatiri[]): Promise<void> {
  let kabul: Set<string>;
  try {
    kabul = kabulKimlikleri(readFileSync(KABUL_YOLU as string, "utf8"));
  } catch (e) {
    dur(`kabul CSV okunamadı: ${(e as Error).message}`);
  }
  const plan = uygulamaPlani(satirlar, kabul);
  console.log(`\n=== UYGULAMA ÖNİZLEMESİ — ${kabul.size} KABUL ===`);
  console.log(`\nYazılacak (${plan.yazilacak.length}) — weftSpecId ← atkı kartı:`);
  for (const p of plan.yazilacak) console.log(`  ${p.satir.code}  ${p.satir.name}  → ${p.atkiKarti}`);
  console.log(`\nAtlanan (${plan.atlanan.length}):`);
  for (const a of plan.atlanan) console.log(`  ${a.satir.code}  ${a.satir.name}  — ${a.sebep}`);
  if (plan.bulunamayan.length > 0) {
    console.log(`\n⚠️ Hedefte bulunamayan itemId (${plan.bulunamayan.length}): ${plan.bulunamayan.join(", ")}`);
  }

  // S2 şeması (WeftSpec + Item.weftSpecId/rawWidthCm) inmeden yazım yok.
  if (!("WeftSpec" in Prisma.ModelName)) {
    dur("S2 inmedi — `WeftSpec` modeli şemada yok; yazım yapılmadı (önizleme yukarıda).");
  }
  // TODO(S2): yazım `ItemService.update` ile (audit) — weftSpecId (atkı kartı, yoksa
  // WeftSpec oluştur), rawWidthCm yalnız sayısal en varsa; ad/kod değişmez. Çözgü kartı
  // iplik kalemi kararına bağlı (WarpSpec.yarnItemId NOT NULL) — o satırlar atlanır.
  dur("S2 yazım dalı henüz yazılmadı (TODO(S2)).");
}

async function main(): Promise<void> {
  kapilar();
  console.log(`\n=== Kumaş adı ayıklama — ${APPLY ? "UYGULAMA" : "KURU KOŞUM"} · hedef ${hedefDbAdi()} ===`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: PG_SESSION_OPTIONS });
  try {
    const satirlar = await kalemleriOku(pool);
    raporla(satirlar);
    if (CSV_YOLU) {
      writeFileSync(CSV_YOLU, csvYaz(satirlar), "utf8");
      console.log(`\n📄 Öneri tablosu: ${CSV_YOLU} (KARAR sütununa KABUL / RED yaz)`);
    }
    if (!APPLY) {
      console.log("\nKURU KOŞUM — hiçbir şey yazılmadı. Uygulamak için: --apply --kabul=<csv> (S2 sonrası).\n");
      return;
    }
    await uygula(satirlar);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("HATA:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
