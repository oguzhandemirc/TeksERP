// =============================================================================
// TERİM GÖÇÜ — katalog satırlarındaki görünen ad (kullanıcı kararı 2026-10-11)
// =============================================================================
// "İş Emri" → "Terbiye İş Emri" (WorkOrder) · "Dokuma İşi" → "Dokuma İş Emri" (WeavingOrder).
// Kod kataloğu değişti ama boot uzlaştırmaları VAR OLAN satırın metnini EZMEZ (izin açıklaması,
// rol şablonu adı/açıklaması, sebep metni — fabrika düzeltmiş olabilir). Bu betik o satırları
// BİR KEZ yeni metne çeker — YALNIZ metin hâlâ eski kod varsayılanına BİREBİR eşitse; fabrikanın
// elle değiştirdiği metin ve fabrikanın kendi satırları DOKUNULMADAN listelenir.
//
//   npx tsx scripts/terim_katalog_metin_gocu.ts                       # KURU KOŞUM (yazmaz, listeler)
//   npx tsx scripts/terim_katalog_metin_gocu.ts --apply               # fixture DB'de yazar
//   npx tsx scripts/terim_katalog_metin_gocu.ts --apply --canli-onay  # fabrika DB'sinde yazar
//
// Kapsam: permissions.description · permission_templates.name/description (yalnız kodlu satır) ·
//   reason_presets.label/fullText (yalnız isSystem) · label_templates.fields[].label (alan anahtarı +
//   eski varsayılan etiket). YALNIZ LİSTELENİR: number_series.label (boot uzlaştırması kod-sahipli
//   etiketi zaten yazar) · traveler_card_templates config/html ve label_templates rawCode (serbest
//   metin; elle bakılır).
// DEFTERE DOKUNMAZ: hareket/olay satırlarındaki eski metin (ör. sebep metni, devir notu) "ne oldu"dur.
// Atomik: her yazım `updateMany WHERE {id, alan = eski}` — koşum arasında değişen satır atlanır.
// =============================================================================
import type { Prisma, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { fixtureHedefEngeli, hedefDbAdi, YAZILMASI_YASAK_DB } from "./lib/hedef-db-kapisi";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");
const SCRIPT = "scripts/terim_katalog_metin_gocu.ts";
const ESKI_AD = /(?<!\p{L})(?:(?:iş|İş|İŞ)\s+(?:emr|Emr|EMR|emir|Emir|EMİR)|(?:dokuma|Dokuma|DOKUMA)\s+(?:iş|İş|İŞ)(?:i|İ|in|ine|inde|leri|lerin|ler)?(?!\p{L}))/u;
/** Önünde Terbiye/Dokuma olan yeni ad eşleşmesin. */
function eskiAdVar(metin: string): boolean {
  const temiz = metin.replace(/(?:terbiye|Terbiye|TERBİYE|dokuma|Dokuma|DOKUMA)\s+(?:iş|İş|İŞ)\s+(?:emr|Emr|EMR|emir|Emir|EMİR)/gu, "");
  return ESKI_AD.test(temiz);
}

// Çiftler `git show <önceki>:…` kataloğu ile yeni katalog karşılaştırılarak üretildi (elle yazılmadı).
const IZIN_ACIKLAMASI: readonly (readonly [kod: string, eski: string, yeni: string])[] = [
  ["workorder:read", "İş emri listesi/detay görüntüleme", "Terbiye iş emri listesi/detay görüntüleme"],
  ["workorder:write", "İş emri oluşturma/düzenleme/finalize etme", "Terbiye iş emri oluşturma/düzenleme/finalize etme"],
  ["workorder:distribute", "Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama", "Kurşun dağıtım — fason dönüşü terbiye iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama"],
  ["weavingorder:read", "Dokuma işi listesi/detay görüntüleme", "Dokuma iş emri listesi/detay görüntüleme"],
  ["weavingorder:write", "Dokuma işi oluşturma/düzenleme/kapatma/iptal", "Dokuma iş emri oluşturma/düzenleme/kapatma/iptal"],
  ["settings:work-orders", "Özellik Anahtarları → İş Emirleri (parti no, plan süresi)", "Özellik Anahtarları → Terbiye İş Emirleri (parti no, plan süresi)"],
  ["mobile:hizli-is-emri", "Hızlı İş Emri ekranı (stok topu okut → iş emri başlat + iş emri yönetimi)", "Hızlı Terbiye İş Emri ekranı (stok topu okut → terbiye iş emri başlat + terbiye iş emri yönetimi)"],
  ["mobile:is-emri-duzelt", "İş emri düzeltme — tablet (renk · en · sipariş bağı · refakat kartı yeniden basımı)", "Terbiye iş emri düzeltme — tablet (renk · en · sipariş bağı · refakat kartı yeniden basımı)"],
  // Eski senkron betiklerinin yazdığı varsayılan (sync-quick-wo-permission.ts).
  ["mobile:hizli-is-emri", "Hızlı İş Emri ekranı (stok topu okut → WO başlat + WO yönetimi)", "Hızlı Terbiye İş Emri ekranı (stok topu okut → WO başlat + WO yönetimi)"],
];
const ROL_SABLONU: readonly (readonly [kod: string, alan: "name" | "description", eski: string, yeni: string])[] = [
  ["WEB_PRODUCTION_PLANNING", "description", "İş emri aç/yönet, rota-istasyon-ürün tanımla, kurşun dağıt, üretim raporları", "Terbiye iş emri aç/yönet, rota-istasyon-ürün tanımla, kurşun dağıt, üretim raporları"],
  ["MOBILE_HIZLI_IS_EMRI", "name", "Mobil — Hızlı İş Emri", "Mobil — Hızlı Terbiye İş Emri"],
  ["MOBILE_HIZLI_IS_EMRI", "description", "Stok topu okut → iş emri başlat + iş emri yönetimi", "Stok topu okut → terbiye iş emri başlat + terbiye iş emri yönetimi"],
  ["MOBILE_KURSUN_DAGITIM", "description", "İş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir", "Terbiye iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir"],
  // Eski senkron betiklerinin yazdığı varsayılanlar (sync-kursun-bypass-permissions.ts · sync-quick-wo-permission.ts).
  ["MOBILE_KURSUN_DAGITIM", "description", "Kurşun dağıtım ekranı (iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir)", "Kurşun dağıtım ekranı (terbiye iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir)"],
  ["MOBILE_HIZLI_IS_EMRI", "description", "Stok topu okut → iş emri başlat + iş emri yönetimi (masaüstü WO yetkileri)", "Stok topu okut → terbiye iş emri başlat + terbiye iş emri yönetimi (masaüstü WO yetkileri)"],
];
const SEBEP: readonly (readonly [tur: ReasonPresetKind, kod: string, alan: "label" | "fullText", eski: string, yeni: string])[] = [
  ["WORK_ORDER_PLAN_CHANGE", "YANLIS_GIRILMIS", "fullText", "İş emri yanlış değerle açılmıştı", "Terbiye iş emri yanlış değerle açılmıştı"],
];
const ETIKET_ALANI: readonly (readonly [anahtar: string, eski: string, yeni: string])[] = [
  ["workOrderNumber", "İş Emri No", "Terbiye İş Emri No"],
];

/** `yaz` yoksa kalem yalnız listelenir (etiket şablonunda yazım şablon başına tek kalemde). */
type Plan = { tablo: string; kimlik: string; alan: string; eski: string; yeni: string; yaz?: () => Promise<number> };

async function main(): Promise<void> {
  console.log(`\n🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  if (YAZILMASI_YASAK_DB.has(hedefDbAdi())) {
    console.error(`\n⛔ DURDURULDU — '${hedefDbAdi()}' üretim adı; bu betik oraya YAZMAZ.\n`);
    process.exitCode = 1;
    return;
  }
  const fixtureDisi = fixtureHedefEngeli();
  if (APPLY && fixtureDisi && !CANLI_ONAY) {
    console.error(`\n⛔ --apply DURDURULDU — hedef fixture kalıbında değil.\n   ${fixtureDisi}\n   Fabrika verisinde bilerek koşuyorsan: --apply --canli-onay\n`);
    process.exitCode = 1;
    return;
  }
  console.log(APPLY ? "▶ UYGULAMA MODU (yazacak)" : "▶ KURU KOŞUM (hiçbir şey yazılmaz)");

  const plan: Plan[] = [];
  const elle: string[] = [];

  // ── izin açıklaması ──
  const izinler = await prisma.permission.findMany({ select: { id: true, code: true, description: true } });
  for (const p of izinler) {
    const bulunan = IZIN_ACIKLAMASI.find(([k, e]) => k === p.code && p.description === e);
    const c = bulunan ? { e: bulunan[1], y: bulunan[2] } : undefined;
    if (c) {
      plan.push({ tablo: "permissions", kimlik: p.code, alan: "description", eski: c.e, yeni: c.y,
        yaz: async () => (await prisma.permission.updateMany({ where: { id: p.id, description: c.e }, data: { description: c.y } })).count });
    } else if (p.description && eskiAdVar(p.description)) elle.push(`permissions ${p.code} description: "${p.description}"`);
  }

  // ── rol şablonu (yalnız kodlu) ──
  const sablonlar = await prisma.permissionTemplate.findMany({ select: { id: true, code: true, name: true, description: true } });
  for (const t of sablonlar) {
    for (const alan of ["name", "description"] as const) {
      const deger = t[alan];
      const c = t.code ? ROL_SABLONU.find(([k, a, e]) => k === t.code && a === alan && deger === e) : undefined;
      if (c) {
        const [, , e, y] = c;
        plan.push({ tablo: "permission_templates", kimlik: t.code ?? t.id, alan, eski: e, yeni: y,
          yaz: async () => (await prisma.permissionTemplate.updateMany({ where: { id: t.id, [alan]: e }, data: { [alan]: y } })).count });
      } else if (deger && eskiAdVar(deger)) elle.push(`permission_templates ${t.code ?? `(kodsuz) ${t.id}`} ${alan}: "${deger}"`);
    }
  }

  // ── sebep kataloğu (yalnız sistem satırı) ──
  const sebepler = await prisma.reasonPreset.findMany({ select: { id: true, kind: true, code: true, isSystem: true, label: true, fullText: true } });
  for (const r of sebepler) {
    for (const alan of ["label", "fullText"] as const) {
      const deger = r[alan];
      const c = r.isSystem ? SEBEP.find(([k, kod, a, e]) => k === r.kind && kod === r.code && a === alan && deger === e) : undefined;
      if (c) {
        const [, , , e, y] = c;
        plan.push({ tablo: "reason_presets", kimlik: `${r.kind}:${r.code}`, alan, eski: e, yeni: y,
          yaz: async () => (await prisma.reasonPreset.updateMany({ where: { id: r.id, [alan]: e }, data: { [alan]: y } })).count });
      } else if (deger && eskiAdVar(deger)) elle.push(`reason_presets ${r.kind}:${r.code} ${alan}: "${deger}"`);
    }
  }

  // ── etiket şablonu alan etiketi ──
  const etiketler = await prisma.labelTemplate.findMany({ select: { id: true, name: true, fields: true, rawCode: true, updatedAt: true } });
  for (const t of etiketler) {
    const alanlar = Array.isArray(t.fields) ? (t.fields as Prisma.JsonArray) : [];
    let degisti = false;
    const yeniAlanlar = alanlar.map((f) => {
      if (!f || typeof f !== "object" || Array.isArray(f)) return f;
      const o = f as Prisma.JsonObject;
      const c = ETIKET_ALANI.find(([k, e]) => o.key === k && o.label === e);
      if (c) {
        degisti = true;
        plan.push({ tablo: "label_templates", kimlik: `${t.name} · ${String(o.key)}`, alan: "fields[].label", eski: c[1], yeni: c[2] });
        return { ...o, label: c[2] };
      }
      if (typeof o.label === "string" && eskiAdVar(o.label)) elle.push(`label_templates "${t.name}" alan ${String(o.key)}: "${o.label}"`);
      return f;
    });
    if (degisti) {
      // Şablon başına TEK yazım; satırın son yazımı değiştiyse (`updatedAt`) atlanır.
      const son = [...plan].reverse().find((p) => p.tablo === "label_templates" && p.kimlik.startsWith(`${t.name} · `));
      if (son) son.yaz = async () => (await prisma.labelTemplate.updateMany({ where: { id: t.id, updatedAt: t.updatedAt }, data: { fields: yeniAlanlar } })).count;
    }
    if (t.rawCode && eskiAdVar(JSON.stringify(t.rawCode))) elle.push(`label_templates "${t.name}" rawCode eski ad içeriyor`);
  }

  // ── yalnız listelenenler ──
  const kartlar = await prisma.travelerCardTemplate.findMany({ select: { name: true, config: true, html: true } });
  for (const k of kartlar) {
    if (eskiAdVar(JSON.stringify(k.config)) || (k.html && eskiAdVar(k.html))) elle.push(`traveler_card_templates "${k.name}" config/html eski ad içeriyor`);
  }
  const seriler = await prisma.numberSeries.findMany({ select: { key: true, label: true } });
  const seriBayat = seriler.filter((s) => eskiAdVar(s.label));

  console.log(`\n── Yazılacak (eski varsayılana birebir eşit): ${plan.length} ──`);
  for (const p of plan) console.log(`  ${p.tablo}  ${p.kimlik}  ${p.alan}\n      - ${p.eski}\n      + ${p.yeni}`);
  console.log(`\n── DOKUNULMAZ, elle bakılır (fabrika metni / serbest metin): ${elle.length} ──`);
  for (const s of elle) console.log(`  ${s}`);
  console.log(`\n── Boot uzlaştırması yazar (bilgi): number_series bayat etiket ${seriBayat.length} ──`);
  for (const s of seriBayat) console.log(`  ${s.key}: "${s.label}"`);

  if (!APPLY) {
    console.log("\n⚠️ KURU KOŞUM — hiçbir şey yazılmadı. Yazmak için: --apply (fabrika verisinde --apply --canli-onay)");
    return;
  }
  if (fixtureDisi) console.warn(`\n⚠️  CANLI HEDEFTE TERİM GÖÇÜ — ${hedefDbAdi()} (--canli-onay ile)`);

  let yazilan = 0;
  const atlanan: string[] = [];
  for (const p of plan) {
    if (!p.yaz) continue;
    try {
      const n = await p.yaz();
      if (n === 0) atlanan.push(`${p.tablo} ${p.kimlik} ${p.alan} (bu arada değişmiş)`);
      yazilan += n;
    } catch (e) {
      atlanan.push(`${p.tablo} ${p.kimlik} ${p.alan} — ${(e as Error).message.split("\n")[0]}`);
    }
  }
  console.log(`\n✔ ${yazilan} satır güncellendi (plan ${plan.length} kalem).`);
  for (const a of atlanan) console.log(`  ⏭ ${a}`);

  const iz = await onarimIziYaz({
    script: SCRIPT,
    action: "TERM_CATALOG_TEXT_MIGRATED",
    olcum: { guncellenen: yazilan, planlanan: plan.length, atlanan: atlanan.length, elleBakilacak: elle.length, numaraSerisiBayat: seriBayat.length },
  });
  if (!iz) {
    console.error(izDustuUyarisi(SCRIPT, false));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
