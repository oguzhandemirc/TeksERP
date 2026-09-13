// =============================================================================
// SONDA — VARSAYILAN DEPO YOKKEN "DEPODA" DEMEK: fail-open kapandı, kapsamı ölçülüyor
// =============================================================================
// ⚠️ BU DOSYA ARTIK YEŞİL ve BİR REGRESYON BEKÇİSİDİR — 2026-09-12'ye kadar
// bilerek kırmızıydı, düzeltme indi. Eski "BEKLENEN KIRMIZI" rejimi BİTTİ;
// aşağıdaki hiçbir satır bir ürün kusurunu açıkta tutmuyor, hepsi kapanmış bir
// kusurun geri gelmesini bekliyor.
//
// DÜZELTME NE SEÇTİ (ölçüldü 2026-09-13, ağaç `8ce92cb3`): `warehouse.helper.ts`
// `resolveTargetWarehouseId` FAIL-OPEN'ı KAPATTI — artık `null` DÖNMÜYOR:
// varsayılan yoksa `ensureDefaultWarehouse()` çağırıyor (yoksa TERFİ ettirir,
// hiç yoksa `DP-MERKEZ`i doğurur), sonra tekrar okuyor; o da olmazsa **409
// FIRLATIYOR**. Yani üç yol da artık topu DAMGALI doğuruyor.
//
// ⚠️ DERS — BU SONDA KENDİ İDDİASINI ÖLÇEMEDİ: ilk yazımda iddia "ya 4xx ya
// damgalı/sokmaz" biçimindeydi ve düzeltmenin seçtiği ÜÇÜNCÜ yolu (terfi ettir,
// devam et) sessizce KABUL ETTİ — sonda yeşile döndü ama hangi davranışın
// indiğini SÖYLEMEDİ. Gevşek iddia, doğru düzeltmeyi de yanlış düzeltmeyi de
// aynı yeşille geçirir. Bu yüzden §2-§5 artık TEK davranış iddia ediyor:
// **top DAMGALI doğar ve damga (yeniden) varsayılan olan deponun kendisidir.**
//
// ═══ KAPSAM — ŞERH DEĞİL, SAYI (ölçüldü 2026-09-13) ═════════════════════════
// Eski şerh şunu diyordu: *"'hiç depo yok' dalı tek giriş noktasında ölçüldü;
// dokuz `roll.create` noktası aynı çözümleyiciden geçiyor ama 'aynı fonksiyonu
// çağırıyor' ≠ 'aynı ilk-yazma davranışını gösteriyor'."* Şerh haklıydı ve
// FARKIN KENDİSİ artık ölçüldü — dokuz top doğuran yazma noktası İKİ SINIFA
// ayrılıyor ve iki sınıf resolver'ı AYNI SIKLIKTA görmüyor:
//
//   · KOŞULSUZ (3) — her çağrıda resolver'a sorar, 409'u da terfiyi de görür:
//     `inventory.service.ts:1135` (KK1 initial-entry) ·
//     `inventory.service.ts:4906` (createOpenFabric) ·
//     `subcontractor.service.ts:3212` (receive → `roll.createMany`)
//   · KOŞULLU (6) — `parent.warehouseId ?? (await resolveTargetWarehouseId(tx))`:
//     `subcontractor.service.ts:545` · `tambur.service.ts:1076` · `:2245` ·
//     `:2781` · `:3167` · `:3629`
//     ⚠️ Ebeveyni DAMGALI bir fabrikada bu altısı resolver'a HİÇ SORMAZ —
//     ne 409'u görür ne terfiyi. Onların deposu ebeveynden MİRASTIR ve
//     doğruluğu ebeveynin damgasına bağlıdır, resolver'a değil.
//
// Bu sonda KOŞULSUZ sınıfın BİRİNİ (KK1, §2) ve KOŞULLU sınıfın İKİSİNİ
// (tambur finalize §3, terfi yolu §4) davranışsal olarak ölçer.
// ⚠️ AÇIK KALAN — KAPSAM eksiği, bilgi eksiği DEĞİL: koşulsuz sınıfın kalan
// ikisi (`createOpenFabric` bir `GoodsReceipt` fikstürü ister, `receive` bir
// fason firması fikstürü) bu sondada KOŞMUYOR. Davranışları ölçülmedi; sınıfa
// ait oldukları ÖLÇÜLDÜ (yukarıdaki envanter). Envanteri mekanik koruyacak
// AST tripwire'ı bu dosya YAZMAZ — sahibi `d5` (ölçüt commit'i durduran kapıya
// dönüşüyorsa altyapıdır).
//
// ═══ "HİÇ DEPO YOK" DALI: ULAŞILAMAZ, ve ulaşılamazlığın sebebi KODDA ═══════
// Ölçüldü (2026-09-12, boş fikstür top=0 · depo=0): `POST /api/rolls/initial-entry`
// → 201, top damgalı doğdu, depo sayısı 0→1: `DP-MERKEZ`i boot işi değil İSTEĞİN
// KENDİSİ yarattı. 2026-09-13 ölçümü bunu keskinleştirdi: üçüncü kademe artık
// `resolveTargetWarehouseId`in KENDİ gövdesinde. Dolayısıyla 409 yalnız
// YARATMANIN DÜŞTÜĞÜ durumda basılır — yani DB yazılamıyorken. Bu bir
// BASILAMAZ KAPIDIR ve kapının kendisi değil ULAŞILAMAZLIĞI çürüyebilir:
// üçüncü kademeyi kaldıran biri 409'u basılabilir hâle getirir ve bunu söyleyen
// hiçbir şey yoktur. ŞEKLİ ölçen yapısal sonda `d5`e verildi (2026-09-13).
//
// MEVCUT BEKÇİYLE İLİŞKİ — `test_roll_warehouse_stamp` bu deliği KAPATMIYOR:
// `main()` ilk iş `ensureDefaultWarehouse()` çağırıyor, yani "varsayılan depo
// yok" rejimini HİÇ kurmuyor. O bekçi SONUCU süpürür ("test-dışı deposuz top
// yok"), bu sonda ANI ölçer.
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
    // ⚠️ TEK DAVRANIŞ İDDİASI (gevşek "ya/ya" biçimi bilerek TERK EDİLDİ):
    // resolver `ensureDefaultWarehouse`i çağırır, o da mevcut depoyu TERFİ
    // ettirir ⇒ istek 201 verir ve top O DEPONUN damgasıyla doğar. Reddetme
    // (409) bu rejimde DOĞRU CEVAP DEĞİLDİR — ortada terfi edecek depo vardır.
    check(
      "§2a ⭐ varsayılan depo yokken KK1 başarılı (terfi devreye girer, üretim durmaz)",
      b.r.status === 201,
      `status=${b.r.status}`,
    );
    check(
      "§2b ⭐ doğan top DAMGALI ve damga TERFİ EDEN deponun kendisi",
      bD !== null && bD.warehouseId === varsayilan.id,
      `warehouseId=${String(bD?.warehouseId)} beklenen=${varsayilan.id} statü=${String(bD?.status)}`,
    );
    check(
      "§2c ⭐ terfi GERÇEKTEN oldu (depo yeniden isDefault) — 'damga dolu' tesadüf değil",
      (await prisma.warehouse.findUniqueOrThrow({ where: { id: varsayilan.id }, select: { isDefault: true } })).isDefault === true,
      "ensureDefaultWarehouse ikinci kademe (promoted)",
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
      // ⚠️ Bu KOŞULLU sınıfın bir üyesi (`tambur.service.ts:3629`): ebeveyn
      // deposuz olduğu için resolver'a SORAR. Ebeveyni damgalı bir fabrikada
      // aynı satır resolver'a hiç sormaz — kapsam envanteri başlıkta.
      check(
        "§3a ⭐ varsayılan depo yokken finalize başarılı (terfi devreye girer)",
        fin.status === 200,
        `status=${fin.status}`,
      );
      check(
        "§3b ⭐ doğan HER çocuk DAMGALI (kendini yalanlayan satır yok: WAREHOUSE + null)",
        hepsiDamgali,
        `çocuk=${cocuk.length} damga=[${cocuk.map((c) => String(c.warehouseId)).join(",")}] statü=[${cocuk.map((c) => c.status).join(",")}]`,
      );
    }

    console.log("\n── §4 SONDA: kardeş yol — prepare-for-sale (terfi, resolver'a HİÇ sormaz) ──");
    const c = await kk1(); // depo yok → deposuz STOCK doğar
    const terfi = c.id ? await call("POST", `/api/rolls/${c.id}/prepare-for-sale`, { token }) : { status: 0, body: {} };
    const cD = c.id ? await damga(c.id) : null;
    check(
      "§4a ⭐ terfi yolu başarılı (`prepare-for-sale`)",
      terfi.status === 200 || terfi.status === 201,
      `status=${terfi.status}`,
    );
    check(
      "§4b ⭐ WAREHOUSE'a geçen top DAMGASIZ KALMAZ — 'depoda ama neresi belli değil' YOK",
      cD !== null && !(cD.status === RollStatus.WAREHOUSE && cD.warehouseId === null),
      `warehouseId=${String(cD?.warehouseId)} statü=${String(cD?.status)}`,
    );

    // ═══ §5 — REJİMDEN BAĞIMSIZ: kendini yalanlayan satır hiç doğmadı ═══════
    // Körlük zemini: sonda kendi toplarını sayar; 0 top "bakılmadı" demektir.
    console.log("\n── §5 Kendini yalanlayan satır (sondanın ürettiği toplar) ──");
    const kendi = await prisma.roll.findMany({ where: { itemId: { in: yarat.item } }, select: { barcode: true, status: true, warehouseId: true } });
    check("§5a körlük zemini: sonda en az üç top üretti", kendi.length >= 3, `${kendi.length} top`);
    const yalanci = kendi.filter((r) => r.status === RollStatus.WAREHOUSE && r.warehouseId === null);
    check(
      "§5b ⭐ hiçbir top `WAREHOUSE` + `warehouseId=null` doğmadı (iki gerçek tek çıktıya inmiyor)",
      yalanci.length === 0,
      yalanci.length === 0 ? `${kendi.length} top denetlendi` : yalanci.map((r) => r.barcode).join(" · "),
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
        "\n⚠️  BU SONDA ARTIK BİR REGRESYON BEKÇİSİDİR — kırmızısı BEKLENEN DEĞİL.\n" +
        "    2026-09-12'de `resolveTargetWarehouseId` fail-open'ı kapandı (null dönmüyor,\n" +
        "    `ensureDefaultWarehouse` + 409). Kırmızı, o düzeltmenin geri alındığını ya da\n" +
        "    bir doğum yolunun resolver'ı atladığını söyler.\n" +
        "    §1 (pozitif kontrol) kırmızıysa önce ORAYA bak: zincir kapıya ulaşmıyordur\n" +
        "    ve §2-§5'in sonucu yorumlanamaz.",
      );
    }
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
