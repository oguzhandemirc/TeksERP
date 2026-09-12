// =============================================================================
// SONDA — VARSAYILAN DEPO YOKKEN "DEPODA" DEMEK: fail-open kapısı
// =============================================================================
// ⚠️ BU DOSYA BUGÜN KIRMIZI VERMEK İÇİN YAZILDI. Yeşile çevirmek ürün kararıdır
// (depo alanı): uç ya REDDEDECEK (4xx) ya da topu WAREHOUSE'a GEÇİRMEYECEK.
// İddia bilerek "ikisinden biri" biçiminde — hangisinin doğru olduğunu bu bekçi
// DEĞİL, düzeltmeyi yapan karar verir; bekçi yalnız BUGÜNKÜ davranışı reddeder.
//
// BUGÜNKÜ DAVRANIŞ (ölçüldü 2026-09-12): `resolveTargetWarehouseId`
// (`services/helpers/warehouse.helper.ts:50`) varsayılan depo yoksa FIRLATMAZ,
// gürültülü loglar ve `null` döner. Sonuç: uç 200/201 verir, top `WAREHOUSE`
// statüsüne geçer, `warehouseId` NULL kalır. İki farklı gerçek ("depoda" ile
// "depoda ama neresi belli değil") tek çıktıya iniyor ve `status` farkı taşımıyor.
//
// FAIL-OPEN BİLİNÇLİDİR ve gerekçesi helper'da yazılı: "tek alternatif top
// oluşturmayı reddetmek, yani fabrikada üretim kaydını durdurmaktır." Bu sonda o
// gerekçeyi çürütmez — KAPSAMINI ölçer: gerekçe KÖK yollar için (KK1 girişi)
// ikna edici, ama TERFİ yolları için (aşağıda §4) hiç konuşmuyor; orada üretim
// kaydı zaten var, yalnız statü değişiyor.
//
// ⚠️ ÖLÇÜLMEYEN DAL — kapsam olduğundan geniş görünmesin: "HİÇ DEPO YOKKEN ne
// olur" bu dosyada SONDALANMADI. `rolls_warehouseId_fkey` RESTRICT olduğu için
// topu olan bir veritabanında son depo silinemiyor; dal ancak TEMİZ bir fikstürde
// ölçülebilir. Buradaki üç bölüm "depo VAR ama VARSAYILAN yok" rejimini ölçer.
//
// MEVCUT BEKÇİYLE İLİŞKİ — `test_roll_warehouse_stamp` bu deliği KAPATMIYOR:
// `main()` ilk iş `ensureDefaultWarehouse()` çağırıyor, yani "varsayılan depo
// yok" rejimini HİÇ kurmuyor (dosya bunu kendi yorumunda açıkça söylüyor). O
// bekçi SONUCU süpürür ("test-dışı deposuz top yok"), bu sonda ANI ölçer.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { ItemType, RollStatus, StationKind, StationType } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
const PRE = `TST-WHFO-${STAMP}`;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, x = "") => {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
};

const yarat = { item: [] as string[], customer: [] as string[], grade: [] as string[], station: [] as string[], route: [] as string[] };
let depoBayragiEski: { id: string } | null = null;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`\n❌ ${engel}\n`); fail++; return; }
  console.log("=== SONDA: varsayılan depo yokken 'depoda' demek ===\n");

  await ensureDefaultWarehouse();
  const server: Server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (m: string, p: string, o: { token?: string; body?: unknown } = {}) => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (o.token) h.Authorization = `Bearer ${o.token}`;
    const r = await fetch(`${base}${p}`, { method: m, headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    let b: Record<string, unknown> = {};
    try { b = (await r.json()) as Record<string, unknown>; } catch { /* gövdesiz */ }
    return { status: r.status, body: b };
  };
  const veri = (r: { body: Record<string, unknown> }) => (r.body.data ?? {}) as Record<string, unknown>;

  try {
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const lg = await call("POST", "/api/auth/login", { body: { username: cred.username, password: cred.password, clientType: "electron" } });
    const token = String((veri(lg) as { token?: string }).token ?? "");
    if (!token) { console.error("❌ token alınamadı"); fail++; return; }

    const item = await prisma.item.create({ data: { code: `${PRE}-U`, name: `${PRE} Kumaş`, itemType: ItemType.FABRIC }, select: { id: true } });
    yarat.item.push(item.id);
    const grade = await prisma.qualityGrade.create({ data: { code: `${PRE}-K`, name: `${PRE} Kalite`, targetStatus: RollStatus.WAREHOUSE }, select: { id: true, code: true } });
    yarat.grade.push(grade.id);

    const damga = async (id: string) => (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { status: true, warehouseId: true } }));
    const kk1 = async () => {
      const r = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: randomUUID(), itemId: item.id, initialQty: 50, width: 180, qualityGrade: grade.code } });
      return { r, id: String((veri(r) as { id?: string }).id ?? "") };
    };

    // ═══ §1 POZİTİF KONTROL — depo VARKEN aynı akış yeşil ve damga DOLU ═════
    // Bu bölüm olmadan sonda "her şeye kırmızı diyen bir sabit"e dönerdi.
    console.log("── §1 POZİTİF KONTROL (varsayılan depo VAR) ──");
    const varsayilan = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true, isActive: true }, select: { id: true, name: true } });
    const a = await kk1();
    check("§1a KK1 girişi 201", a.r.status === 201, `status=${a.r.status}`);
    const aD = a.id ? await damga(a.id) : null;
    check("§1b ⭐ damga DOLU ve varsayılan depo", aD?.warehouseId === varsayilan.id, `warehouseId=${aD?.warehouseId} (${varsayilan.name})`);
    if (a.id) await prisma.roll.delete({ where: { id: a.id } }).catch(() => {});

    // ═══ §2-§4 SONDA — varsayılan depo YOK ══════════════════════════════════
    depoBayragiEski = varsayilan;
    await prisma.warehouse.update({ where: { id: varsayilan.id }, data: { isDefault: false } });
    console.log("\n── §2 SONDA: varsayılan depo YOK, KK1 girişi (kök yol) ──");
    const b = await kk1();
    const bD = b.id ? await damga(b.id) : null;
    // İDDİA: ya 4xx ya da damgalı doğsun. Bugün 201 + NULL geliyor ⇒ KIRMIZI.
    check(
      "§2 ⭐ varsayılan depo yokken KK1 ya REDDEDER ya da DAMGALI top doğurur",
      b.r.status >= 400 || (bD !== null && bD.warehouseId !== null),
      `status=${b.r.status} warehouseId=${String(bD?.warehouseId)} statü=${String(bD?.status)}`,
    );

    console.log("\n── §3 SONDA: varsayılan depo YOK, tambur finalize (zincir yolu) ──");
    const customer = await prisma.customer.create({ data: { code: `${PRE}-M`, name: `${PRE} Müşteri` }, select: { id: true } });
    yarat.customer.push(customer.id);
    const krs = await prisma.station.create({ data: { code: `${PRE}-KRS`, name: `${PRE} Kurşun`, type: StationType.INTERNAL, kind: StationKind.PROCESS_QC, appliesQuality: true }, select: { id: true } });
    const tmb = await prisma.station.create({ data: { code: `${PRE}-TMB`, name: `${PRE} Tambur`, type: StationType.INTERNAL, kind: StationKind.TAMBUR, appliesQuality: true }, select: { id: true } });
    yarat.station.push(krs.id, tmb.id);
    const route = await prisma.route.create({ data: { name: `${PRE} Rota`, steps: { create: [{ stationId: krs.id, sequence: 1 }, { stationId: tmb.id, sequence: 2 }] } }, select: { id: true } });
    yarat.route.push(route.id);

    const parent = await kk1();
    const barkod = String((veri(parent.r) as { barcode?: string }).barcode ?? "");
    const wo = await call("POST", "/api/work-orders/quick-start", { token, body: { clientToken: randomUUID(), routeTemplateId: route.id, rollBarcodes: [barkod], targetItemId: item.id, width: 180 } });
    const woId = String(((veri(wo) as { workOrder?: { id?: string } }).workOrder ?? {}).id ?? "");
    if (!woId) { check("§3 ön koşul: iş emri kuruldu", false, `status=${wo.status}`); }
    else {
      const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, orderBy: { stepSequence: "asc" }, select: { id: true } });
      await call("POST", "/api/kursun-qc/complete-qc2", { token, body: { rollId: parent.id, stepId: steps[0].id } });
      await call("POST", "/api/kursun-qc/finish-step", { token, body: { stepId: steps[0].id } });
      const fin = await call("POST", "/api/tambur/finalize", { token, body: { rollId: parent.id, cuts: [{ length: 25, qualityGrade: grade.code }] } });
      const cocuk = await prisma.roll.findMany({ where: { parentRollId: parent.id }, select: { id: true, status: true, warehouseId: true } });
      const hepsiDamgali = cocuk.length > 0 && cocuk.every((c) => c.warehouseId !== null);
      const hicbiriDepoda = cocuk.every((c) => c.status !== RollStatus.WAREHOUSE);
      check(
        "§3 ⭐ varsayılan depo yokken finalize ya REDDEDER ya da çocuğu depoya SOKMAZ/damgalar",
        fin.status >= 400 || hepsiDamgali || hicbiriDepoda,
        `status=${fin.status} çocuk=${cocuk.length} damga=[${cocuk.map((c) => String(c.warehouseId)).join(",")}] statü=[${cocuk.map((c) => c.status).join(",")}]`,
      );
    }

    console.log("\n── §4 SONDA: kardeş yol — prepare-for-sale (terfi, resolver'a HİÇ sormaz) ──");
    const c = await kk1(); // depo yok → deposuz STOCK doğar
    const terfi = c.id ? await call("POST", `/api/rolls/${c.id}/prepare-for-sale`, { token }) : { status: 0, body: {} };
    const cD = c.id ? await damga(c.id) : null;
    check(
      "§4 ⭐ deposuz top WAREHOUSE'a terfi ETTİRİLMEMELİ (ya da terfi damgalamalı)",
      terfi.status >= 400 || (cD !== null && cD.warehouseId !== null) || cD?.status !== RollStatus.WAREHOUSE,
      `status=${terfi.status} warehouseId=${String(cD?.warehouseId)} statü=${String(cD?.status)}`,
    );
  } finally {
    server.close();
  }
}

async function temizlik(): Promise<void> {
  const y = <T>(p: Promise<T>) => p.catch(() => undefined);
  if (depoBayragiEski) await y(prisma.warehouse.update({ where: { id: depoBayragiEski.id }, data: { isDefault: true } }));
  const rolls = (await prisma.roll.findMany({ where: { itemId: { in: yarat.item } }, select: { id: true } }).catch(() => [])).map((r) => r.id);
  const wos = (await prisma.workOrder.findMany({ where: { steps: { some: { stationId: { in: yarat.station } } } }, select: { id: true } }).catch(() => [])).map((w) => w.id);
  for (const t of ["rollVariance", "rollOperation", "rollMovement", "rollProperty", "rollError", "warehouseMovement"] as const) {
    await y((prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rolls } } }));
  }
  await y(prisma.roll.deleteMany({ where: { id: { in: rolls }, parentRollId: { not: null } } }));
  await y(prisma.roll.deleteMany({ where: { id: { in: rolls } } }));
  for (const id of wos) {
    await y(prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }));
    await y(prisma.travelerCard.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.batch.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.workOrder.delete({ where: { id } }));
  }
  await y(prisma.routeStep.deleteMany({ where: { routeId: { in: yarat.route } } }));
  await y(prisma.route.deleteMany({ where: { id: { in: yarat.route } } }));
  await y(prisma.station.deleteMany({ where: { id: { in: yarat.station } } }));
  await y(prisma.qualityGrade.deleteMany({ where: { id: { in: yarat.grade } } }));
  await y(prisma.item.deleteMany({ where: { id: { in: yarat.item } } }));
  await y(prisma.customer.deleteMany({ where: { id: { in: yarat.customer } } }));
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await temizlik().catch((e) => console.error("temizlik:", (e as Error).message));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    // BEKLENEN KIRMIZI — bu satır olmadan, pencereye denk gelen biri kendi
    // değişikliğinin kırdığını sanır. Koşucuda "bilerek kırmızı" diye bir sınıf
    // YOK (ölçüldü 2026-09-12: ne emsal ne `run-all-tests` desteği), tek görünür
    // yüzey bu cümledir. Çıkış kodu BİLEREK 1 kalır — sessiz bekçi yazmıyoruz.
    if (fail > 0) {
      console.log(
        "\n⚠️  BU KIRMIZI BEKLENİYOR — sonda ürün kusurunu açıkta tutmak için yazıldı\n" +
        "    (varsayılan depo yokken üç yol da topu 'depoda' sayıyor; `warehouse.helper.ts`\n" +
        "     fail-open'ı bilinçli, ama terfi yollarını kapsamıyor). Düzeltme DEPO alanında:\n" +
        "     uç ya 4xx döndürecek ya da topu WAREHOUSE'a geçirmeyecek. Yeşile döndüğünde\n" +
        "     bu bekçi düzeltmenin çalıştığının KANITIDIR — silinmez.\n" +
        "    §1 (pozitif kontrol) da kırmızıysa durum BAŞKA: orada gerçek bir regresyon var.",
      );
    }
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
