// =============================================================================
// BEKÇİ — LEVENT ve DOKUMA İŞİ NUMARASI EŞZAMANLI DOĞUMDA ÇAKIŞMAZ (P2002 retry'ı adaptör altında)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts numara_yarisi_levent_dokuma
//
// ⭐ NEDEN (2026-09-23, 1e bulgusu): iki servisin retry yüklemi `err.meta?.target` okuyordu; Prisma 7 +
//    pg adaptörü `target` VERMEZ → numara çakışması HİÇ retry edilmez, kullanıcı 409/500 görür.
//    Numaralandırma turundan sonra iki seri de biçim değiştirebildiği için risk canlıdır. Yüklem artık
//    tek yardımcıda (`p2002OnField`, `src/utils/p2002.ts`); `test_p2002_hedef_tek_kaynak` sınıfı kapatır.
//
// NE ÖLÇER:
//   ① ZAMANDAN BAĞIMSIZ: iki servisin retry yüklemi adaptörün GERÇEK P2002 biçiminde numara çakışmasını
//      tanır, token/başka kolon çakışmasını tanımaz
//   ② altı eşzamanlı levent planı (HTTP) → hepsi 2xx, numaralar tekil
//   ③ altı eşzamanlı dokuma işi (HTTP) → hepsi 2xx, numaralar tekil (8032 kilidi + yüklem)
//
// NEGATİF SONDA (2026-09-23, ölçüldü): levent yüklemi eski `meta.target` okumasına döndürülünce ①
//    levent kolu KIRMIZI; geri alınınca yeşil. ② zamanlamaya bağlıdır — ① bu yüzden ayrıca vardır.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; modül bayrakları `try` İÇİNDE açılır, `finally`de geri.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { p2002OnField } from "../src/utils/p2002";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-NYL-${process.pid}`;
const BAYRAKLAR = ["production.enabled", "devere.enabled", "dokuma.enabled"] as const;
const ids = { items: [] as string[], specs: [] as string[], beams: [] as string[], weaving: [] as string[] };

const adapterHatasi = (alan: string, kisit: string) => new Prisma.PrismaClientKnownRequestError("dup", {
  code: "P2002", clientVersion: "test",
  meta: { modelName: "X", driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "23505", originalMessage: `duplicate key value violates unique constraint "${kisit}"`, kind: "UniqueConstraintViolation", constraint: { fields: [`"${alan}"`] } } } },
});

/** Servisin retry yüklemini KAYNAKTAN çıkarır: tek yardımcıya bağlı mı ve hangi kolonla. */
function yuklemKolonu(dosya: string): string | null {
  const metin = fs.readFileSync(path.join(__dirname, "..", dosya), "utf8");
  return /\(err\) => p2002OnField\(err, "([A-Za-z]+)"\)/.exec(metin)?.[1] ?? null;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }

  // ① zamandan bağımsız
  const leventKolon = yuklemKolonu("src/services/warp-beam.service.ts");
  const dokumaKolon = yuklemKolonu("src/services/weaving-order.service.ts");
  check("① levent retry yüklemi tek yardımcıya bağlı (beamNo)", leventKolon === "beamNo", String(leventKolon));
  check("① dokuma işi retry yüklemi tek yardımcıya bağlı (weavingOrderNumber)", dokumaKolon === "weavingOrderNumber", String(dokumaKolon));
  check("① adaptör biçiminde levent numara çakışması TANINIR", p2002OnField(adapterHatasi("beamNo", "warp_beams_beamNo_key"), "beamNo"));
  check("① adaptör biçiminde dokuma işi numara çakışması TANINIR", p2002OnField(adapterHatasi("weavingOrderNumber", "weaving_orders_weavingOrderNumber_key"), "weavingOrderNumber"));
  check("① token çakışması numara sanılmaz", !p2002OnField(adapterHatasi("clientToken", "warp_beams_clientToken_key"), "beamNo"));

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const once = await prisma.systemSetting.findMany({ where: { key: { in: [...BAYRAKLAR] } } });
  try {
    for (const key of BAYRAKLAR) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    const cred = await ensureTestAdmin();
    const giris = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password }) });
    const token = String(((await giris.json()) as { data?: { token?: string } }).data?.token ?? "");
    const post = async (p: string, body: unknown) => {
      const r = await fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; message?: string } };
    };

    const kumas = await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
    const iplik = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} İPLİK`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    ids.items.push(kumas.id, iplik.id);
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-C`, name: `${TAG} ÇÖZGÜ`, yarnItemId: iplik.id, endsCount: 4000 }, select: { id: true } });
    ids.specs.push(spec.id);

    // ② levent
    const leventler = await Promise.all(Array.from({ length: 6 }, () => post("/api/warp-beams", { warpSpecId: spec.id, plannedLengthM: 100, originKind: "IN_HOUSE", clientToken: randomUUID() })));
    leventler.forEach((r) => { if (r.body.data?.id) ids.beams.push(String(r.body.data.id)); });
    const beamNos = leventler.map((r) => r.body.data?.beamNo);
    check("② altı eşzamanlı levent → hepsi 2xx, numaralar tekil", leventler.every((r) => r.status < 300) && new Set(beamNos).size === 6, `${leventler.map((r) => r.status).join("/")} ${leventler.find((r) => r.status >= 300)?.body.message ?? ""}`);

    // ③ dokuma işi
    const isler = await Promise.all(Array.from({ length: 6 }, () => post("/api/weaving-orders", { itemId: kumas.id, executionKind: "IN_HOUSE", clientToken: randomUUID() })));
    isler.forEach((r) => { if (r.body.data?.id) ids.weaving.push(String(r.body.data.id)); });
    const isNos = isler.map((r) => r.body.data?.weavingOrderNumber);
    check("③ altı eşzamanlı dokuma işi → hepsi 2xx, numaralar tekil", isler.every((r) => r.status < 300) && new Set(isNos).size === 6, `${isler.map((r) => r.status).join("/")} ${isler.find((r) => r.status >= 300)?.body.message ?? ""}`);
  } finally {
    await temizlik(once);
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

/** Teardown: bu koşumun satırları + bayrakların eski değeri. */
async function temizlik(once: Array<{ key: string; value: unknown }>): Promise<void> {
  await prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: ids.weaving } } }).catch(() => undefined);
  await prisma.weavingOrder.deleteMany({ where: { id: { in: ids.weaving } } }).catch(() => undefined);
  await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beams } } }).catch(() => undefined);
  await prisma.warpSpec.deleteMany({ where: { id: { in: ids.specs } } }).catch(() => undefined);
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } }).catch(() => undefined);
  for (const key of BAYRAKLAR) {
    const o = once.find((x) => x.key === key);
    if (o) await prisma.systemSetting.update({ where: { key }, data: { value: o.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .then(() => { console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`); })
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
