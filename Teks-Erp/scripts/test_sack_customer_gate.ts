// =============================================================================
// Bekçi: Cari kapısı (Paketleme/Çuvallar giriş adımı) + "müşterisiz" süzgeci
// Çalıştır: DATABASE_URL=… npx tsx scripts/test_sack_customer_gate.ts
//
// NEDEN VAR (ölçüm, tekserp_demo 2026-09-04): fabrikada 43 aktif cari, depoda
// çuvalı olan 4 cari; depodaki 9 çuvalın 4'ü MÜŞTERİSİZ. Yani cari kapısı
// katalogdan beslenirse operatör 39 boş seçenek arasında dolaşır, müşterisiz
// kova da hiçbir yüzeyden süzülemediği için (%44) sessizce kaybolur.
//
// Ölçülenler:
//   §1 `withSacksOnly` modu: yalnız KAPSAMDA ÇUVALI OLAN cariler.
//   §2 Müşterisiz kovası AYRI SATIR, İLK sırada, doğru sayıyla.
//   §3 Arama ada/koda vurur; müşterisiz satır arama varken DÖNMEZ.
//   §4 `filter[customerId]=none` → yalnız müşterisiz çuvallar (P2007 YOK).
//   §5 `none,<uuid>` → aynı alan içinde VEYA.
//   §6 Kapı sayısı ile liste satır sayısı AYNI (tek kaynak `resolveScopeOr`).
//   §7 Varsayılan kapsam DISPATCHED çuvalı iki yüzeyde de dışlar.
//   §8 Sentinel değeri Electron aynasıyla BİREBİR (Electron backend'i import
//      edemez → değer iki yerde yaşar; ayrışırsa süzgeç sessizce 0 satır döner).
//   §9 VARSAYILAN mod TÜM cariler; çuvalsız cari 0 ile döner, çuvalı olan ÜSTTE.
//  §10 SUNUCU SIRALAMASI + KEYSET CURSOR (2026-09-22, tek toplulaştırma SQL'i):
//      top sayısı çuval kapsamıyla aynı · açık parti yalnız sevk partisi modunda ·
//      sortBy=sackCount/rollCount/openLotCount/name kapsamın tamamı üstünde ·
//      limit=1 ile sayfalar kopyasız/boşluksuz · geçersiz sortBy 400 (fail-closed) ·
//      scope=ALL SQL ikizi (`scopeSql`) Prisma ikiziyle (`scopeWhere`) aynı sayıyı verir.
//      ⭐ Negatif sonda (2026-09-22): cursor SQL'inde ad tie-break dalı silinince §10e
//      (limit=1 sayfalama, eşit sayılı C/D) KIRMIZI — D düşer; `openLotCount` her modda
//      dönünce §10c KIRMIZI.
//
// ⚠️ 2026-09-04 AKŞAM: kapı varsayılanı TERSİNE ÇEVRİLDİ (kullanıcı kararı).
//    Eskiden yalnız çuvalı olanlar dönüyordu; artık o bir SÜZGEÇ
//    (`withSacksOnly`). Ölçüm (43↔4) hâlâ doğru ama soru yanlıştı: kapının işi
//    "elimde kimin malı var" değil "hangi cariye çuval açacağım".
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma";
import { SackSearchService, CUSTOMERLESS_FILTER_VALUE, type SackCustomerSortKey } from "../src/services/sack-search.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import type { Prisma } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Row = { id: string; customer: { id: string; name: string } | null };

const rollIds: string[] = [];
const groupIds: string[] = [];
let itemId = "";
let colorId = "";
const prevFlags = new Map<string, Prisma.InputJsonValue | undefined>();
/** Bayrak yazımı — önceki değer saklanır, finally geri koyar; cache her yazımda tazelenir. */
async function setFlag(key: string, value: Prisma.InputJsonValue): Promise<void> {
  if (!prevFlags.has(key)) {
    const cur = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    prevFlags.set(key, cur ? (cur.value as Prisma.InputJsonValue) : undefined);
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value, description: "test_sack_customer_gate" }, update: { value } });
  invalidateFeatureFlagsCache();
}

async function main() {
  const ts = Date.now();
  const svc = new SackSearchService();

  // A cari: 2 depo çuvalı · B cari: 1 depo çuvalı · C cari: HİÇ çuvalı yok
  // (§9'un öznesi: VARSAYILAN modda GÖRÜNÜR, `withSacksOnly` modunda GÖRÜNMEZ)
  // · müşterisiz: 3 depo çuvalı
  // · A carinin 1 çuvalı DISPATCHED sevkiyatta (varsayılan kapsam dışı).
  const [cA, cB, cC] = await Promise.all([
    prisma.customer.create({ data: { code: `TST-GATE-A-${ts}`, name: `ZZKAPI ALFA ${ts}` }, select: { id: true, name: true } }),
    prisma.customer.create({ data: { code: `TST-GATE-B-${ts}`, name: `ZZKAPI BETA ${ts}` }, select: { id: true, name: true } }),
    // ⚠️ ADI BİLEREK "AAA": alfabetik olarak A carisinden ÖNCE gelir. §9d'nin
    // ölçtüğü kural "çuvalı olan ÜSTTE"dir; ad "CEVIZ" olsaydı alfabetik sıra
    // da aynı sonucu verir ve sonda KÖR kalırdı (ölçüldü: sıralama kuralını
    // söküp test yine yeşil geçti).
    prisma.customer.create({ data: { code: `TST-GATE-C-${ts}`, name: `ZZKAPI AAA ${ts}` }, select: { id: true, name: true } }),
  ]);
  // D: C ile HER sayıda eşit (0 çuval · 0 top · 0 parti) — §10e'nin ad/id tie-break'ini
  // ölçen özne; tek başına C olsaydı eşitlik hiç oluşmaz ve cursor kusuru görünmezdi.
  const cD = await prisma.customer.create({ data: { code: `TST-GATE-D-${ts}`, name: `ZZKAPI DELTA ${ts}` }, select: { id: true, name: true } });
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TEST-GATE-${ts}`, customerId: cA.id, status: "DISPATCHED" },
    select: { id: true },
  });

  const mkSack = (n: number, customerId: string | null, shipmentId: string | null = null, seq: number | null = null) =>
    prisma.sack.create({
      data: { sackNo: `TEST-GATE-SK${n}-${ts}`, customerId, shipmentId, seq },
      select: { id: true },
    });

  const sacks = await Promise.all([
    mkSack(1, cA.id),
    mkSack(2, cA.id),
    mkSack(3, cB.id),
    mkSack(4, null),
    mkSack(5, null),
    mkSack(6, null),
    mkSack(7, cA.id, shipment.id, 1), // sevk edilmiş → varsayılan kapsam dışı
  ]);
  const sackIds = sacks.map((s) => s.id);
  const mine = new Set(sackIds);

  try {
    // ── §1 Kapı: yalnız çuvalı olan cariler ────────────────────────────────
    const gate = (await svc.listSackCustomers({ withSacksOnly: true })).data.items.filter(
      (r) => r.customerId === null || [cA.id, cB.id, cC.id].includes(r.customerId),
    );
    const gA = gate.find((r) => r.customerId === cA.id);
    const gB = gate.find((r) => r.customerId === cB.id);
    const gC = gate.find((r) => r.customerId === cC.id);
    check("§1 Çuvalı olan cari kapıda var (A)", !!gA, `sackCount=${gA?.sackCount}`);
    check("§1 Çuvalı olan cari kapıda var (B)", !!gB, `sackCount=${gB?.sackCount}`);
    check("⭐ §1 ÇUVALI OLMAYAN cari kapıda YOK (katalog değil)", !gC);
    check("§1 A carisinin sayısı sevk edilmişi SAYMAZ (2, 3 değil)", gA?.sackCount === 2, String(gA?.sackCount));

    // ── §2 Müşterisiz kovası ───────────────────────────────────────────────
    const full = (await svc.listSackCustomers({ withSacksOnly: true })).data.items;
    const none = full.find((r) => r.customerId === null);
    check("⭐ §2 Müşterisiz kovası AYRI SATIR olarak dönüyor", !!none);
    check("§2 Müşterisiz satırı İLK sırada", full[0]?.customerId === null, full[0]?.name);
    check(
      "§2 Müşterisiz sayısı bu koşumun 3 çuvalını içeriyor",
      (none?.sackCount ?? 0) >= 3,
      String(none?.sackCount),
    );
    check("§2 Müşterisiz satırın adı Türkçe ve açık", none?.name === "Müşterisiz (genel stok)", none?.name);

    // ── §3 Arama ───────────────────────────────────────────────────────────
    const searched = (await svc.listSackCustomers({ search: `ZZKAPI ALFA ${ts}`, withSacksOnly: true })).data.items;
    check("§3 Arama cariye vuruyor", searched.some((r) => r.customerId === cA.id), `${searched.length} satır`);
    check("§3 Arama diğer cariyi eliyor", !searched.some((r) => r.customerId === cB.id));
    check("⭐ §3 Arama varken müşterisiz satır DÖNMEZ (adı yok, eşleşmiyor)", !searched.some((r) => r.customerId === null));
    const byCode = (await svc.listSackCustomers({ search: `TST-GATE-B-${ts}`, withSacksOnly: true })).data.items;
    check("§3 Arama KODA da vuruyor", byCode.some((r) => r.customerId === cB.id));

    // ── §4 "none" sentineli ────────────────────────────────────────────────
    let p2007 = "";
    let noneRows: Row[] = [];
    try {
      noneRows = ((await svc.searchSacks({ customerId: CUSTOMERLESS_FILTER_VALUE, limit: 100 })).data as Row[])
        .filter((r) => mine.has(r.id));
    } catch (e) {
      p2007 = String((e as { code?: string }).code ?? (e as Error).message);
    }
    check("⭐ §4 `none` süzgeci Prisma P2007 ÜRETMİYOR", p2007 === "", p2007);
    check("§4 `none` yalnız müşterisiz çuvalları döner", noneRows.length === 3 && noneRows.every((r) => r.customer === null), `${noneRows.length} satır`);

    // ── §5 none + uuid → VEYA ──────────────────────────────────────────────
    // ⚠️ try/catch ŞART: sentinel ayrıştırması düşerse burada P2007 FIRLAR ve
    // yakalanmazsa script "Sonuç" satırını hiç basmadan ölür — bu depoda kayıtlı
    // en sessiz kırmızı. Hata da bir ölçümdür, ❌ olarak raporlanır.
    let mixed: Row[] = [];
    let mixedErr = "";
    try {
      mixed = ((await svc.searchSacks({ customerId: `${CUSTOMERLESS_FILTER_VALUE},${cB.id}`, limit: 100 })).data as Row[])
        .filter((r) => mine.has(r.id));
    } catch (e) {
      mixedErr = String((e as { code?: string }).code ?? (e as Error).message);
    }
    check(
      "⭐ §5 `none,<uuid>` aynı alan içinde VEYA (3 müşterisiz + 1 B)",
      mixed.length === 4 && mixed.some((r) => r.customer?.id === cB.id) && mixed.filter((r) => r.customer === null).length === 3,
      mixedErr ? `HATA: ${mixedErr}` : `${mixed.length} satır`,
    );

    // ── §6 Kapı sayısı ↔ liste satır sayısı ────────────────────────────────
    const listA = ((await svc.searchSacks({ customerId: cA.id, limit: 100 })).data as Row[]).filter((r) => mine.has(r.id));
    check(
      "⭐ §6 Kapıdaki sayı ile listedeki satır sayısı AYNI (tek kaynak kapsam)",
      listA.length === gA?.sackCount,
      `liste=${listA.length} kapı=${gA?.sackCount}`,
    );

    // ── §7 Varsayılan kapsam DISPATCHED'i iki yüzeyde de dışlar ────────────
    check("§7 Liste sevk edilmiş çuvalı varsayılan kapsamda göstermiyor", !listA.some((r) => r.id === sacks[6]!.id));
    const gateAll = (await svc.listSackCustomers({ scope: "ALL", withSacksOnly: true })).data.items.find((r) => r.customerId === cA.id);
    check("§7 scope=ALL verilince sevk edilmiş de sayılıyor (3)", gateAll?.sackCount === 3, String(gateAll?.sackCount));
    // ── §9 VARSAYILAN mod: TÜM cariler (2026-09-04 akşam kararı) ──────────
    // ⚠️ Bu bölüm §1'in TERSİNİ ölçer ve bu bilinçli: §1 artık "süzgeç açıkken"
    //    kuralıdır, §9 "süzgeç kapalıyken" (varsayılan) kuralıdır.
    // ⚠️ SÜZGEÇ LOAD-BEARING (2026-09-06): eskiden `listSackCustomers({})` ile TÜM
    // liste isteniyordu ve §9d fixture'ın sayfada olduğunu VARSAYIYORDU. Sayfa
    // ~101 satırla sınırlı; dev veritabanı 99 aktif cariye çıkınca "ZZKAPI ALFA"
    // sayfanın DIŞINA düştü ve kontrol `dolu=-1` ile kırmızı verdi — ölçtüğü kural
    // (çuvallı üstte) bozulmadığı hâlde. Bekçi ortamdaki kayıt SAYISINA bağımlı
    // olamaz ([TD-17]); fixture'ını kendi öneğiyle SÜZER.
    const tumu = (await svc.listSackCustomers({ search: `ZZKAPI` })).data;
    const tumIds = new Set(tumu.items.map((r) => r.customerId));
    check(
      "⭐ §9a Varsayılan mod ÇUVALSIZ cariyi de döndürüyor (kapı artık katalog kapısı)",
      tumIds.has(cC.id),
      `${tumu.items.length} satır`,
    );
    check(
      "§9b Çuvalsız cari sackCount=0 ile döner (gizlenmez — kıyaslama düğmenin sebebi)",
      tumu.items.find((r) => r.customerId === cC.id)?.sackCount === 0,
    );
    check(
      "⭐ §9c Süzgeç AÇIKKEN aynı cari DÖNMEZ (eski davranış süzgeç olarak duruyor)",
      !(await svc.listSackCustomers({ withSacksOnly: true })).data.items.some(
        (r) => r.customerId === cC.id,
      ),
    );
    // Çuvalı olanlar ÜSTTE — 39/43 tuzağını kesme yerine SIRALAMA kapatıyor.
    const idxDolu = tumu.items.findIndex((r) => r.customerId === cA.id);
    const idxBos = tumu.items.findIndex((r) => r.customerId === cC.id);
    check(
      "⭐ §9d Çuvalı olan cari, çuvalsız cariden ÖNCE geliyor",
      idxDolu >= 0 && idxBos >= 0 && idxDolu < idxBos,
      `dolu=${idxDolu} boş=${idxBos}`,
    );
    check(
      "§9e Yanıt sayfalı (nextCursor alanı var — sessiz kesme yok)",
      "nextCursor" in tumu,
    );

    // ── §8 Electron aynası ────────────────────────────────────────────────
    // Electron backend'i import EDEMEZ (mobil `permissions.ts` ile aynı durum):
    // sentinel değeri iki dosyada yaşar. Ayrışırsa panel "none" yerine başka bir
    // metin gönderir, backend onu UUID sanıp P2007 verir ya da (daha kötüsü)
    // sessizce filtreyi düşürür ve YANLIŞ liste basar.
    const mirrorPath = resolve(__dirname, "../../Electron/src/pages/Operations/SackContentEdit/types.ts");
    let mirror = "";
    try { mirror = readFileSync(mirrorPath, "utf-8"); } catch { /* Electron yoksa aşağıda kırmızı */ }
    check(
      "⭐ §8 Electron aynası backend sentineliyle BİREBİR",
      new RegExp(`CUSTOMERLESS_FILTER_VALUE\\s*=\\s*"${CUSTOMERLESS_FILTER_VALUE}"`).test(mirror),
      mirrorPath,
    );
    // ── §10 Sunucu sıralaması + keyset cursor (tek toplulaştırma SQL'i) ──────
    // Top: A=2 (SK1), B=1 (SK3), C=0. Açık parti: A=1 (+1 CLOSED sayılmaz), B=2, C=0.
    const item = await prisma.item.create({
      data: { code: `TST-GATE-I-${ts}`, name: `GATE KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" }, select: { id: true },
    });
    itemId = item.id;
    const color = await prisma.color.create({ data: { code: `TST-GATE-C-${ts}`, name: `GATE EKRU ${ts}` }, select: { id: true } });
    colorId = color.id;
    const grade = await firstGrade();
    const wh = await fixtureWarehouseId();
    const mkRoll = (n: number, sackId: string) =>
      prisma.roll.create({
        data: {
          warehouseId: wh, barcode: `TEST-GATE-R${n}-${ts}`, itemId, colorId, status: "WAREHOUSE",
          currentQty: 10, initialQty: 10, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id,
          entrySource: "SUPPLIER_RECEIPT", sackId,
        },
        select: { id: true },
      });
    for (const r of [await mkRoll(1, sacks[0]!.id), await mkRoll(2, sacks[0]!.id), await mkRoll(3, sacks[2]!.id)]) rollIds.push(r.id);
    const mkGroup = (n: number, customerId: string, status: "OPEN" | "CLOSED") =>
      prisma.packingGroup.create({ data: { customerId, code: `PRT-TST-G${n}${ts}`.slice(0, 16), name: `TEST-GATE-P${n}-${ts}`, status }, select: { id: true } });
    for (const g of [
      await mkGroup(1, cA.id, "OPEN"), await mkGroup(2, cA.id, "CLOSED"),
      await mkGroup(3, cB.id, "OPEN"), await mkGroup(4, cB.id, "OPEN"),
    ]) groupIds.push(g.id);

    const byKey = async (sortBy: SackCustomerSortKey, sortOrder?: "asc" | "desc") =>
      (await svc.listSackCustomers({ search: "ZZKAPI", sortBy, sortOrder })).data.items.map((r) => r.customerId);
    const sira = (ids: (string | null)[], ...beklenen: string[]) =>
      beklenen.map((id) => ids.indexOf(id)).every((i, k, arr) => i >= 0 && (k === 0 || i > arr[k - 1]!));

    const g10 = (await svc.listSackCustomers({ search: "ZZKAPI" })).data.items;
    const rA = g10.find((r) => r.customerId === cA.id), rB = g10.find((r) => r.customerId === cB.id), rC = g10.find((r) => r.customerId === cC.id);
    check("§10a top sayısı çuval kapsamından (A=2 · B=1 · C=0)", rA?.rollCount === 2 && rB?.rollCount === 1 && rC?.rollCount === 0,
      `${rA?.rollCount}/${rB?.rollCount}/${rC?.rollCount}`);
    check("§10b sortBy=rollCount desc: A → B → C", sira(await byKey("rollCount"), cA.id, cB.id, cC.id));
    check("§10b sortBy=name asc: AAA(C) → ALFA(A) → BETA(B)", sira(await byKey("name"), cC.id, cA.id, cB.id));
    check("§10b sortBy=sackCount asc: C(0) → B(1) → A(2)", sira(await byKey("sackCount", "asc"), cC.id, cB.id, cA.id));

    // Açık parti yalnız sevk partisi modunda döner — bayrak upsert'i try İÇİNDE, finally geri alır.
    await setFlag(SETTING_KEYS.PACKING_GROUPS_ENABLE, "true");
    await setFlag(SETTING_KEYS.PACKING_GROUP_MODE, "grup");
    const grupModu = (await svc.listSackCustomers({ search: "ZZKAPI" })).data.items.find((r) => r.customerId === cB.id);
    check("§10c grup modunda `openLotCount` alanı HİÇ gitmez", grupModu !== undefined && !("openLotCount" in grupModu));
    await setFlag(SETTING_KEYS.PACKING_GROUP_MODE, "sevk-partisi");
    const lotModu = (await svc.listSackCustomers({ search: "ZZKAPI" })).data.items;
    const lA = lotModu.find((r) => r.customerId === cA.id), lB = lotModu.find((r) => r.customerId === cB.id), lC = lotModu.find((r) => r.customerId === cC.id);
    check("§10c sevk partisi modunda açık parti (A=1, CLOSED sayılmaz · B=2 · C=0)",
      lA?.openLotCount === 1 && lB?.openLotCount === 2 && lC?.openLotCount === 0, `${lA?.openLotCount}/${lB?.openLotCount}/${lC?.openLotCount}`);
    check("§10d sortBy=openLotCount desc: B → A → C", sira(await byKey("openLotCount"), cB.id, cA.id, cC.id));

    // Keyset cursor: limit=1 ile üç sayfa — kopya yok, boşluk yok; eşit sayılı (0 top) cariler de.
    const sayfalar: (string | null)[] = [];
    let cur: string | undefined;
    for (let i = 0; i < 8; i++) {
      const pg = (await svc.listSackCustomers({ search: "ZZKAPI", sortBy: "rollCount", limit: 1, cursor: cur })).data;
      sayfalar.push(...pg.items.map((r) => r.customerId));
      if (!pg.nextCursor) break;
      cur = pg.nextCursor;
    }
    const ucCari = sayfalar.filter((id) => id && [cA.id, cB.id, cC.id, cD.id].includes(id));
    check("⭐ §10e limit=1 keyset sayfalama: dört cari birer kez, sırayla (A, B, C, D — C/D eşit, ad tie-break)",
      ucCari.length === 4 && new Set(ucCari).size === 4 && sira(ucCari, cA.id, cB.id, cC.id, cD.id), ucCari.length + " satır");
    check("§10e cursor'lu sayfada müşterisiz kovası TEKRAR gelmez", sayfalar.filter((id) => id === null).length <= 1);

    // Kapsam ikizi: SQL (`scopeSql`) ↔ Prisma (`scopeWhere`) — scope=ALL'da A 3 çuval, liste de 3.
    const sqlAll = (await svc.listSackCustomers({ search: "ZZKAPI", scope: "ALL" })).data.items.find((r) => r.customerId === cA.id);
    const prismaAll = ((await svc.searchSacks({ customerId: cA.id, scope: "ALL", limit: 100 })).data as Row[]).filter((r) => mine.has(r.id));
    check("⭐ §10f scope=ALL: SQL ikizi ile Prisma ikizi aynı sayıyı verir (3)", sqlAll?.sackCount === 3 && prismaAll.length === 3,
      `sql=${sqlAll?.sackCount} prisma=${prismaAll.length}`);
    const sqlPlanned = (await svc.listSackCustomers({ search: "ZZKAPI", scope: "DISPATCHED" })).data.items.find((r) => r.customerId === cA.id);
    check("§10f scope=DISPATCHED: yalnız sevk edilmiş (1)", sqlPlanned?.sackCount === 1, String(sqlPlanned?.sackCount));

    // Arama SQL ikizi: kod ve ad (katlanmış) — `buildTextSearch` ile aynı hüküm.
    const kodla = (await svc.listSackCustomers({ search: `TST-GATE-B-${ts}` })).data.items;
    check("§10g arama KODA vuruyor (SQL ikizi)", kodla.some((r) => r.customerId === cB.id) && !kodla.some((r) => r.customerId === cA.id));
    const adla = (await svc.listSackCustomers({ search: "zzkapı beta" })).data.items;
    check("§10g arama ADA Türkçe katlamayla vuruyor (ı → i, iki kelime AND)", adla.some((r) => r.customerId === cB.id) && !adla.some((r) => r.customerId === cA.id));
    const jokerli = (await svc.listSackCustomers({ search: "%" })).data.items;
    check("§10g LIKE jokeri DEĞER olarak kaçırılır ('%' hiçbir cariyi eşlemez)", jokerli.length === 0, `${jokerli.length} satır`);
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.packingGroup.deleteMany({ where: { id: { in: groupIds } } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: [cA.id, cB.id, cC.id, cD.id] } } }).catch(() => {});
    if (itemId) await prisma.item.delete({ where: { id: itemId } }).catch(() => {});
    if (colorId) await prisma.color.delete({ where: { id: colorId } }).catch(() => {});
    for (const [key, prev] of prevFlags) {
      if (prev === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: prev } });
    }
    invalidateFeatureFlagsCache();
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
