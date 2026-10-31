// =============================================================================
// BEKÇİ — PATRON BULUTU CARİ KİLİDİ PROJEKSİYONU (D4-I6; tasarım DALGA4 §10.8 + §12.2)
// =============================================================================
//   §1 katalog — `cari-hesap.kilit` türetilmiş alanı `cari_holds`u okur ve `cari_holds` (cariId) değişiklik
//      kaynağıdır (kilit konunca/açılınca hesap satırı yeniden gider); alan kök (İŞLEM) satırda
//   §2 statik — türeticinin `cariHold` select'i serbest metin (`reasonText` · `releaseReason`) ve kullanıcı
//      kimliği (`placedById` · `releasedById`) SEÇMEZ
//   §3 ⭐ canlı — kilit konunca tel satırında `kilit` = {durum AKTIF, kilitId, kapsam (Türkçe kod), sebepKodu,
//      baslangic}; serbest sebep metni ve koyanın kimliği HİÇBİR alt satırda yok
//   §4 ⭐ açılınca `kilit` = {durum ACILDI, aynı kilitId, acilis dolu}; açma gerekçesi tele girmez; kilidi
//      hiç olmamış hesapta `kilit` = null
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): türeticinin select'ine `reasonText: true` eklenip çıktıya
//    `sebepMetni: h.reasonText` yazıldı → §2a + §3c ❌ (exit 1); geri alındı → yeşil. Katalog tarafı:
//    `test_bulut_projeksiyon_allowlist` §K6 (cari-hesap'a `reasonText` kolonu → sızıntı denetçisi kırmızı).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar fotoğrafa döner.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cariHoldService } from "../src/services/cari-hold.service";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-BCK-${process.pid}`;
const DERIVER = path.resolve(__dirname, "../src/cloud-sync/derived-cari-hold.ts");
const AYARLAR = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON];

function katalog(): void {
  console.log("── §1 Katalog ──");
  const p = RECORD_PROJECTIONS.find((x) => x.name === "cari-hesap");
  const d = p?.derived.find((x) => x.wire === "kilit");
  check("§1a ⭐ cari-hesap.kilit türetilmiş alanı cari_holds'u okur, kök (İŞLEM) satırda", !!d && d.reads.includes("cari_holds") && d.dataClass === "ISLEM" && !d.timeBound);
  const src = p?.sources.find((s) => s.table === "cari_holds");
  check("§1b ⭐ cari_holds değişiklik kaynağı (cariId → hesap kökü)", !!src && src.watermark === "updatedAt" && src.root.kind === "column" && src.root.column === "cariId", JSON.stringify(src ?? null));
}

function statik(): void {
  console.log("── §2 Statik ──");
  const s = readFileSync(DERIVER, "utf8");
  const sel = /const HOLD_WIRE_SELECT = \{([\s\S]*?)\} as const/.exec(s)?.[1] ?? "";
  check("§2 körlük zemini: select bloğu bulundu", sel.includes("reasonCode"));
  const yasak = ["reasonText", "releaseReason", "placedById", "releasedById"].filter((k) => new RegExp(`\\b${k}\\b`).test(sel));
  check("§2a ⭐ türetici serbest metin / kullanıcı kimliği SEÇMEZ", yasak.length === 0, yasak.join(", ") || "temiz");
}

async function telSatirlari(cariId: string): Promise<Map<string, Record<string, unknown>>> {
  const p = RECORD_PROJECTIONS.find((x) => x.name === "cari-hesap")!;
  const built = await buildRecords(p, [cariId], Date.now());
  const out = new Map<string, Record<string, unknown>>();
  for (const [ad, rows] of built.rows) for (const r of rows) if (r.id === cariId) out.set(ad, r as Record<string, unknown>);
  return out;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== PATRON BULUTU CARİ KİLİDİ BEKÇİSİ ===\n");
  katalog();
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin();
  const customers: string[] = [];
  const kartAc = async (): Promise<string> => {
    const r = (await customerService.create({ name: `${TAG} ${Math.random().toString(36).slice(2, 7)}`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
    customers.push(r.data.id);
    return (await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } })).id;
  };
  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.FINANCE_ENABLED }, create: { key: SETTING_KEYS.FINANCE_ENABLED, value: true }, update: { value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON } });

    console.log("\n── §3 Kilit konunca ──");
    const bos = await kartAc();
    const cari = await kartAc();
    const gizli = `${TAG}-GIZLI-SEBEP-${randomUUID()}`;
    const kilit = await cariHoldService.place(cari, {
      blocksIntake: false, blocksShipment: true, blocksInvoice: true, reasonCode: "BORC", reasonText: gizli, clientToken: randomUUID(),
    }, admin.id);
    const t1 = await telSatirlari(cari);
    const k1 = (t1.get("cari-hesap")?.kilit ?? null) as Record<string, unknown> | null;
    check("§3a ⭐ AKTIF kilit kök satırda: kilitId · kapsam SEVK,FATURA · sebepKodu BORC · başlangıç",
      k1?.durum === "AKTIF" && k1.kilitId === kilit.data.id && JSON.stringify(k1.kapsam) === '["SEVK","FATURA"]' && k1.sebepKodu === "BORC" && typeof k1.baslangic === "string" && k1.acilis === null,
      JSON.stringify(k1));
    check("§3b kilit finans alt satırına bölünmedi", !t1.get("cari-hesap.finans") || !("kilit" in t1.get("cari-hesap.finans")!));
    const json1 = JSON.stringify([...t1.values()]);
    check("§3c ⭐ serbest reasonText HİÇBİR tel satırında yok (buluta gitmez)", !json1.includes(gizli) && !json1.includes("GIZLI-SEBEP"), json1.includes(gizli) ? "SIZDI" : "temiz");
    check("§3d koyanın kullanıcı kimliği tele girmez", !json1.includes(admin.id));
    const t0 = await telSatirlari(bos);
    check("§3e kilidi hiç olmamış hesapta kilit = null (alan VAR)", t0.get("cari-hesap") !== undefined && "kilit" in t0.get("cari-hesap")! && t0.get("cari-hesap")!.kilit === null);

    console.log("\n── §4 Kilit açılınca ──");
    const acmaGerekcesi = `${TAG}-ACMA-GEREKCESI`;
    await cariHoldService.release(kilit.data.id, acmaGerekcesi, admin.id);
    const t2 = await telSatirlari(cari);
    const k2 = (t2.get("cari-hesap")?.kilit ?? null) as Record<string, unknown> | null;
    check("§4a ⭐ ACILDI: aynı kilitId, açılış damgası dolu", k2?.durum === "ACILDI" && k2.kilitId === kilit.data.id && typeof k2.acilis === "string", JSON.stringify(k2));
    const json2 = JSON.stringify([...t2.values()]);
    check("§4b açma gerekçesi ve serbest sebep tele girmez", !json2.includes(acmaGerekcesi) && !json2.includes(gizli));
    const yeni = await cariHoldService.place(cari, { blocksIntake: true, blocksShipment: false, blocksInvoice: false, reasonCode: "RISK", reasonText: null, clientToken: randomUUID() } as Parameters<typeof cariHoldService.place>[1], admin.id);
    const k3 = ((await telSatirlari(cari)).get("cari-hesap")?.kilit ?? null) as Record<string, unknown> | null;
    check("§4c yeniden kilit → yeni kilitId AKTIF (açılmış eskisi değil)", k3?.durum === "AKTIF" && k3.kilitId === yeni.data.id && JSON.stringify(k3.kapsam) === '["KABUL"]', JSON.stringify(k3));
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    const accIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((a) => a.id);
    const holds = (await prisma.cariHold.findMany({ where: { cariId: { in: accIds } }, select: { id: true } })).map((h) => h.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...holds, ...customers, ...accIds] } } });
    await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customers } } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: AYARLAR } } });
    for (const f of foto) await prisma.systemSetting.create({ data: { key: f.key, value: f.value as Prisma.InputJsonValue } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
