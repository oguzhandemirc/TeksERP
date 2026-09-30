// =============================================================================
// PATRON BULUTU — HACİM ÖLÇÜMÜ (SALT OKUNUR)
// Çalıştır: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/olcum/patron-hacim-olcumu.ts [--json] [--ornek=500]
// =============================================================================
// Soru: projeksiyon satırı TELDE kaç bayt tutar? İki ölçü birlikte basılır:
//   · FİKSTÜR: satır varsa opt-in kolonların `json_build_object` uzunluğunun
//     ortalaması (tel adlarıyla, gerçek değerlerle) + örnek grubun gzip oranı;
//   · TİP TAHMİNİ: satır yoksa (ya da karşılaştırma için) kolon tiplerinden
//     üst-yaklaşık JSON genişliği — fikstürün kısa adları ölçüyü küçük göstermesin.
// ANLIK projeksiyonların üç tanesi (özet çekirdeği, stok karnesi, açık sipariş
// karşılama) GERÇEKTEN hesaplatılır ve JSON boyu ölçülür (salt okuma servisleri).
//
// ⚠️ Fabrika verisi YOK: hedef `_test` kalıbında değilse ya da fabrika ölçeğinde
// top taşıyorsa DURUR. Fabrika sayıları bu betikte UYDURULMAZ; belge 1.000 satır
// başına bayt verir, kurulumun sayımı ayrı ölçülür.
// =============================================================================
import { gzipSync } from "node:zlib";
import { pool } from "../../src/lib/prisma";
import { fixtureHedefEngeli, hacimHedefEngeli, hedefDbAdi } from "../lib/hedef-db-kapisi";
import { KAYIT_PROJEKSIYONLARI } from "./patron-katalog";
import { getStockScorecard } from "../../src/services/reports/stock-scorecard.report.service";
import { getOpenOrderCoverage } from "../../src/services/reports/open-order-coverage.report.service";
import { getFactoryOverview } from "../../src/cloud-sync/overview";
import { resolveDateRange } from "../../src/services/reports/_shared";

const JSON_CIKTI = process.argv.includes("--json");
const ORNEK = (() => {
  const a = process.argv.find((x) => x.startsWith("--ornek="));
  const n = a ? Number(a.split("=")[1]) : 500;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 500;
})();

/** Tip → JSON'da değerin üst-yaklaşık karakter boyu (tırnaklar dahil). */
function tipGenisligi(udt: string, maxLen: number | null): number {
  switch (udt) {
    case "uuid": return 38;
    case "timestamptz": case "timestamp": return 26;
    case "date": return 12;
    case "numeric": return 12;
    case "int2": case "int4": return 6;
    case "int8": return 12;
    case "bool": return 5;
    case "jsonb": case "json": return 200;
    case "text": return 32;
    case "varchar": return Math.min(maxLen ?? 64, 40) + 2;
    default: return 14; // Prisma enum'ları (ör. "PARTIAL_SHIPPED")
  }
}

/** Türetilmiş alan başına tahmini tel boyu (sayı ya da kısa dizi). */
const TURETILMIS_GENISLIK = 16;

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) { console.error(`DURDU: ${engel}`); process.exit(2); }
  const hacim = await hacimHedefEngeli();
  if (hacim.engel) { console.error(`DURDU: ${hacim.engel}`); process.exit(2); }

  const tipler = await pool.query<{ t: string; c: string; u: string; m: number | null }>(
    `SELECT table_name AS t, column_name AS c, udt_name AS u, character_maximum_length AS m
       FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const tipHaritasi = new Map(tipler.rows.map((r) => [`${r.t}.${r.c}`, r]));

  const satirlar: Array<{
    projeksiyon: string; tablo: string; satir: number; kolon: number; turetilmis: number;
    fikstur: { ortalamaBayt: number; gzipOrani: number } | null; tahminBayt: number; bin: { hamKB: number; gzipKB: number | null };
  }> = [];

  for (const p of KAYIT_PROJEKSIYONLARI) {
    const sayim = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${p.kok.tablo}"`);
    const n = sayim.rows[0].n;
    // Anahtar uzunlukları + ayraçlar: "tel":değer,
    const tahmin = 2 + p.kolonlar.reduce((s, c) => {
      const t = tipHaritasi.get(`${p.kok.tablo}.${c.kaynak}`);
      return s + c.tel.length + 4 + (t ? tipGenisligi(t.u, t.m) : 14);
    }, 0) + p.turetilmis.reduce((s, d) => s + d.tel.length + 4 + TURETILMIS_GENISLIK, 0);

    let fikstur: { ortalamaBayt: number; gzipOrani: number } | null = null;
    if (n > 0) {
      // Kolon/tablo adları katalogdan gelir (kullanıcı girdisi değil); tırnaklanır.
      const obj = p.kolonlar.map((c) => `'${c.tel}', "${c.kaynak}"`).join(", ");
      const r = await pool.query<{ j: string }>(
        `SELECT json_build_object(${obj})::text AS j FROM "${p.kok.tablo}" ORDER BY "id" LIMIT ${ORNEK}`,
      );
      const govdeler = r.rows.map((x) => x.j);
      const ham = govdeler.reduce((s, x) => s + Buffer.byteLength(x), 0);
      const turetilmisPayi = p.turetilmis.reduce((s, d) => s + d.tel.length + 4 + TURETILMIS_GENISLIK, 0);
      const ortalama = Math.round(ham / govdeler.length) + turetilmisPayi;
      const gz = gzipSync(Buffer.from(`[${govdeler.join(",")}]`)).length;
      fikstur = { ortalamaBayt: ortalama, gzipOrani: Math.round((gz / Math.max(1, ham)) * 100) / 100 };
    }
    const birim = fikstur ? Math.max(fikstur.ortalamaBayt, tahmin) : tahmin;
    satirlar.push({
      projeksiyon: p.ad, tablo: p.kok.tablo, satir: n, kolon: p.kolonlar.length, turetilmis: p.turetilmis.length,
      fikstur, tahminBayt: tahmin,
      bin: {
        hamKB: Math.round((birim * 1000) / 102.4) / 10,
        gzipKB: fikstur ? Math.round((birim * 1000 * fikstur.gzipOrani) / 102.4) / 10 : null,
      },
    });
  }

  // ANLIK — gerçekten hesaplat, JSON boyunu ölç (servisler salt okur).
  const anlik: Array<{ ad: string; bayt: number; gzip: number; ms: number }> = [];
  const olc = async (ad: string, f: () => Promise<unknown>): Promise<void> => {
    const t0 = Date.now();
    const v = await f();
    const ms = Date.now() - t0;
    const s = JSON.stringify(v);
    anlik.push({ ad, bayt: Buffer.byteLength(s), gzip: gzipSync(Buffer.from(s)).length, ms });
  };
  await olc("ozet (tüm bölümler, son 30 gün)", () =>
    getFactoryOverview(resolveDateRange({})));
  await olc("stok-karnesi", () => getStockScorecard());
  await olc("acik-siparis-karsilama", () => getOpenOrderCoverage());

  const sonuc = { hedef: hedefDbAdi(), ornek: ORNEK, satirlar, anlik };
  if (JSON_CIKTI) {
    console.log(JSON.stringify(sonuc, null, 2));
  } else {
    console.log(`# Patron bulutu hacim ölçümü — hedef ${sonuc.hedef} (örnek ≤ ${ORNEK} satır)\n`);
    console.log("| projeksiyon | tablo | fikstür satır | kolon+türetilmiş | fikstür ort. bayt | gzip oranı | tip tahmini bayt | 1.000 satır ham KB | 1.000 satır gzip KB |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const r of satirlar) {
      console.log(`| ${r.projeksiyon} | ${r.tablo} | ${r.satir} | ${r.kolon}+${r.turetilmis} | ${r.fikstur?.ortalamaBayt ?? "—"} | ${r.fikstur?.gzipOrani ?? "—"} | ${r.tahminBayt} | ${r.bin.hamKB} | ${r.bin.gzipKB ?? "—"} |`);
    }
    console.log("\n| anlık projeksiyon | JSON bayt | gzip bayt | hesap ms |\n|---|---|---|---|");
    for (const a of anlik) console.log(`| ${a.ad} | ${a.bayt} | ${a.gzip} | ${a.ms} |`);
  }
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(3);
});
