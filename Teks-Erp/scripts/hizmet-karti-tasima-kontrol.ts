// =============================================================================
// HİZMET KARTI TAŞIMA KONTROLÜ — salt okuma; `--apply` YOK (taşımayı migration
// `service_items_split` yapar, bu araç önce/sonra ÖLÇER).
//
//   npx tsx scripts/hizmet-karti-tasima-kontrol.ts [--kaydet <dosya.json>] [--onceki <dosya.json>]
//
// Faz kendiliğinden çözülür: `service_items` yoksa ÖNCE (taşınacak hizmet + bağlı her
// tablodaki satır + migration'ın SİLECEĞİ saf pivot satırları + taşımayı DURDURACAK kayıtlar listelenir),
// varsa SONRA (aynı sayılar). İki fazda da "pasif hizmet kartına bağlı taslak fatura satırı" sayısı basılır.
// Kurulum provası: önce `--kaydet once.json` → `migrate deploy` → `--onceki once.json`
// (sayılar, UUID'ler, kodlar ve fiyat/tutar toplamları eşit olmalı).
// Çıkış: 0 temiz · 1 engel var (ÖNCE) ya da eşitsizlik (SONRA). Tek READ ONLY tx; yazmaz.
// =============================================================================
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { parseDatabaseUrl, toClientConfig } from "../src/services/helpers/pg-conn.helper";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";

/** Hizmet kalemine bakan, migration'ın TAŞIDIĞI bağlar (geri kalan her FK engeldir). */
export const HIZMET_TABLOLARI = [
  "fabric_properties",
  "fabric_property_values",
  "service_billing_links",
  "service_consumable_norms",
  "expense_allocations",
] as const;

/** Migration 0(d)'nin SİLDİĞİ saf yapılandırma pivotları (defter ③b) — kapıyı durdurmaz, deploy öncesi listelenir. */
export const SILINEN_PIVOTLAR = [
  ["item_allowed_colors", "itemId"],
  ["item_allowed_properties", "itemId"],
  ["customer_item_aliases", "itemId"],
  ["customer_item_color_aliases", "itemId"],
] as const;

/** `idler`: SİLİNECEK pivotta TAM liste (yıkıcı işlem her kaydı gösterir); ENGEL'de ilk 20 örnek. */
export interface Engel { tablo: string; kolon: string; sayi: number; idler: string[] }
export interface Olcum {
  faz: "ONCE" | "SONRA";
  db: string;
  kartlar: Array<{ id: string; code: string; name: string; mezar: boolean }>;
  sayim: Record<string, number>;
  /** Para toplamları METİN (Decimal; float'a çevrilmez). */
  toplam: { fiyat: string; faturaSatiri: string };
  engeller: Engel[];
  /** ÖNCE: migration'ın sileceği pivot satırları (engel DEĞİL; bilgi). SONRA: boş. */
  silinecek: Engel[];
  /** SONRA: items'ta kalan SERVICE (0 olmalı). */
  itemsServiceKalan: number;
}

type Sorgu = Pick<Client, "query">;

async function sayi(c: Sorgu, sql: string): Promise<number> {
  const r = await c.query<{ n: string }>(sql);
  return Number(r.rows[0]?.n ?? 0);
}

export async function olc(c: Sorgu): Promise<Olcum> {
  const db = (await c.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
  const sonra = (await c.query<{ v: boolean }>(`SELECT to_regclass('public.service_items') IS NOT NULL AS v`)).rows[0]!.v;
  const kume = sonra ? `SELECT s."id" FROM "service_items" s` : `SELECT i."id" FROM "items" i WHERE i."itemType" = 'SERVICE'`;
  const kartTablo = sonra ? `"service_items"` : `"items" WHERE "itemType" = 'SERVICE'`;
  const kartlar = (await c.query<{ id: string; code: string; name: string; mezar: boolean }>(
    `SELECT "id"::text AS id, "code" AS code, "name" AS name, ("mergedIntoId" IS NOT NULL) AS mezar FROM ${kartTablo} ORDER BY "id"`)).rows;

  const sayim: Record<string, number> = { kart: kartlar.length, kartMezar: kartlar.filter((k) => k.mezar).length };
  for (const t of HIZMET_TABLOLARI) sayim[t] = await sayi(c, `SELECT count(*) AS n FROM "${t}" WHERE "serviceItemId" IN (${kume})`);
  const fiyatKolon = sonra ? `"serviceItemId"` : `"itemId"`;
  sayim.item_prices = await sayi(c, `SELECT count(*) AS n FROM "item_prices" WHERE ${fiyatKolon} IN (${kume})`);
  sayim.item_prices_kademe = await sayi(c, `SELECT count(*) AS n FROM "item_prices" WHERE ${fiyatKolon} IN (${kume}) AND "propertyValueId" IS NOT NULL`);
  const satirKolon = sonra ? `"serviceItemId"` : `"itemId"`;
  sayim.invoice_lines = await sayi(c, `SELECT count(*) AS n FROM "invoice_lines" WHERE ${satirKolon} IN (${kume})`);
  // Pasif (ARCHIVED) hizmet kartına bağlı TASLAK fatura satırı: taşıma bunu değiştirmez, ama kesilmeden önce
  // kart Aktif'e alınmalı ya da satır düzeltilmeli (D1c kapısı pasif karta yeni satır bağlamaz).
  const pasifKart = sonra
    ? `SELECT s."id" FROM "service_items" s WHERE s."lifecycleStatus" = 'ARCHIVED'`
    : `SELECT i."id" FROM "items" i WHERE i."itemType" = 'SERVICE' AND i."lifecycleStatus" = 'ARCHIVED'`;
  sayim.taslak_satir_pasif_hizmet = await sayi(c,
    `SELECT count(*) AS n FROM "invoice_lines" l JOIN "invoices" v ON v."id" = l."invoiceId"
     WHERE v."status" = 'DRAFT' AND l.${satirKolon} IN (${pasifKart})`);
  if (sonra) sayim.invoice_lines_tip_service = await sayi(c, `SELECT count(*) AS n FROM "invoice_lines" WHERE "lineType" = 'SERVICE'`);

  const toplamRow = (await c.query<{ f: string; s: string }>(
    `SELECT (SELECT COALESCE(sum("price"), 0)::text FROM "item_prices" WHERE ${fiyatKolon} IN (${kume})) AS f,
            (SELECT COALESCE(sum("lineTotal"), 0)::text FROM "invoice_lines" WHERE ${satirKolon} IN (${kume})) AS s`)).rows[0]!;

  const engeller: Engel[] = [];
  const silinecek: Engel[] = [];
  let itemsServiceKalan = 0;
  if (!sonra) {
    // Migration kapısı 0a'nın AYNISI: items'a bakan her FK, taşınan bağlar hariç.
    const fkler = (await c.query<{ tablo: string; kolon: string }>(
      `SELECT c.conrelid::regclass::text AS tablo, a.attname::text AS kolon
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND c.confrelid = 'public.items'::regclass ORDER BY 1, 2`)).rows;
    const tasinan = new Set([...HIZMET_TABLOLARI.map((t) => `${t}.serviceItemId`), "item_prices.itemId", "invoice_lines.itemId", "items.mergedIntoId"]);
    const pivot = new Set(SILINEN_PIVOTLAR.map(([t, k]) => `${t}.${k}`));
    for (const fk of fkler) {
      if (tasinan.has(`${fk.tablo}.${fk.kolon}`)) continue;
      const r = await c.query<{ id: string }>(
        `SELECT t."id"::text AS id FROM ${fk.tablo} t WHERE t."${fk.kolon.replace(/"/g, '""')}" IN (${kume}) ORDER BY 1`);
      if (r.rows.length === 0) continue;
      const sil = pivot.has(`${fk.tablo}.${fk.kolon}`);
      const idler = (sil ? r.rows : r.rows.slice(0, 20)).map((x) => x.id);
      (sil ? silinecek : engeller).push({ tablo: fk.tablo, kolon: fk.kolon, sayi: r.rows.length, idler });
    }
    const soy = await sayi(c, `SELECT count(*) AS n FROM "items" a JOIN "items" b ON b."id" = a."mergedIntoId" WHERE (a."itemType" = 'SERVICE') <> (b."itemType" = 'SERVICE')`);
    if (soy > 0) engeller.push({ tablo: "items", kolon: "mergedIntoId (tür sınırını geçen soy)", sayi: soy, idler: [] });
    const kademe = await sayi(c, `SELECT count(*) AS n FROM "item_prices" p JOIN "items" i ON i."id" = p."itemId" WHERE p."propertyValueId" IS NOT NULL AND i."itemType" <> 'SERVICE'`);
    if (kademe > 0) engeller.push({ tablo: "item_prices", kolon: "propertyValueId (ürün fiyatında kademe)", sayi: kademe, idler: [] });
  } else {
    itemsServiceKalan = await sayi(c, `SELECT count(*) AS n FROM "items" WHERE "itemType" = 'SERVICE'`);
  }
  return { faz: sonra ? "SONRA" : "ONCE", db, kartlar, sayim, toplam: { fiyat: toplamRow.f, faturaSatiri: toplamRow.s }, engeller, silinecek, itemsServiceKalan };
}

/** ÖNCE ↔ SONRA eşitliği; boş dizi = eşit. */
export function karsilastir(once: Olcum, sonra: Olcum): string[] {
  const farklar: string[] = [];
  if (once.faz !== "ONCE" || sonra.faz !== "SONRA") farklar.push(`faz sırası beklenmedik: ${once.faz} → ${sonra.faz}`);
  for (const k of Object.keys(once.sayim)) {
    if (once.sayim[k] !== sonra.sayim[k]) farklar.push(`sayım ${k}: önce ${once.sayim[k]} ≠ sonra ${sonra.sayim[k]}`);
  }
  if (sonra.sayim.invoice_lines_tip_service !== undefined && sonra.sayim.invoice_lines_tip_service !== once.sayim.invoice_lines) {
    farklar.push(`lineType=SERVICE satır ${sonra.sayim.invoice_lines_tip_service} ≠ taşınan ${once.sayim.invoice_lines}`);
  }
  const anahtar = (k: Olcum["kartlar"][number]) => `${k.id}|${k.code}|${k.name}|${k.mezar}`;
  const a = once.kartlar.map(anahtar).join("\n");
  const b = sonra.kartlar.map(anahtar).join("\n");
  if (a !== b) farklar.push("kart kimliği/kodu/adı/mezar durumu birebir değil (UUID ve eski kod korunmalı)");
  if (once.toplam.fiyat !== sonra.toplam.fiyat) farklar.push(`fiyat toplamı ${once.toplam.fiyat} ≠ ${sonra.toplam.fiyat}`);
  if (once.toplam.faturaSatiri !== sonra.toplam.faturaSatiri) farklar.push(`fatura satırı toplamı ${once.toplam.faturaSatiri} ≠ ${sonra.toplam.faturaSatiri}`);
  if (sonra.itemsServiceKalan !== 0) farklar.push(`items'ta ${sonra.itemsServiceKalan} SERVICE kaldı`);
  return farklar;
}

function arg(ad: string): string | undefined {
  const i = process.argv.indexOf(ad);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const conn = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!conn) throw new Error("DATABASE_URL yok ya da çözülemedi");
  const c = new Client({ ...toClientConfig(conn, { applicationName: "hizmet-karti-tasima-kontrol" }), options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const o = await olc(c);
    await c.query("COMMIT");
    console.log(`Hedef DB: ${o.db} · faz: ${o.faz === "ONCE" ? "ÖNCE (taşıma yapılmamış)" : "SONRA (service_items var)"}`);
    console.log(`Hizmet kartı: ${o.sayim.kart} (mezar taşı ${o.sayim.kartMezar})`);
    for (const [k, v] of Object.entries(o.sayim)) {
      if (k === "kart" || k === "kartMezar") continue;
      if (k === "taslak_satir_pasif_hizmet") console.log(`  Pasif hizmet kartına bağlı taslak fatura satırı: ${v}${v > 0 ? " — kesmeden önce kartı Aktif'e alın ya da satırı düzeltin" : ""}`);
      else console.log(`  ${k}: ${v}`);
    }
    console.log(`  fiyat toplamı: ${o.toplam.fiyat} · fatura satırı toplamı: ${o.toplam.faturaSatiri}`);
    let hata = 0;
    if (o.faz === "ONCE") {
      if (o.silinecek.length === 0) console.log("ℹ️  Migration'ın sileceği pivot satırı yok.");
      for (const e of o.silinecek) {
        console.log(`ℹ️  SİLİNECEK (saf pivot, defter ③b) ${e.tablo}.${e.kolon}: ${e.sayi} satır${e.idler.length ? ` — ${e.idler.join(", ")}` : ""}`);
      }
      if (o.engeller.length === 0) console.log("✅ Taşımayı durduracak kayıt yok.");
      for (const e of o.engeller) {
        hata++;
        console.log(`❌ ENGEL ${e.tablo}.${e.kolon}: ${e.sayi} kayıt${e.idler.length ? ` — ilk ${e.idler.length}: ${e.idler.join(", ")}` : ""}`);
      }
    } else if (o.itemsServiceKalan !== 0) {
      hata++;
      console.log(`❌ items'ta ${o.itemsServiceKalan} SERVICE kaldı`);
    }
    const kaydet = arg("--kaydet");
    if (kaydet) { writeFileSync(kaydet, JSON.stringify(o, null, 2)); console.log(`Ölçüm yazıldı: ${kaydet}`); }
    const onceki = arg("--onceki");
    if (onceki) {
      const farklar = karsilastir(JSON.parse(readFileSync(onceki, "utf8")) as Olcum, o);
      if (farklar.length === 0) console.log("✅ Önce ↔ sonra eşit (sayılar, UUID/kod, toplamlar).");
      for (const f of farklar) { hata++; console.log(`❌ ${f}`); }
    }
    process.exitCode = hata > 0 ? 1 : 0;
  } finally {
    await c.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
}
