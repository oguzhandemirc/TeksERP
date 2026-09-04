// =============================================================================
// BEKÇİ — ÇUVAL İZLERİ (ETİKET): katalog + atama + sevkte temizlik
// Çalıştır: npx tsx scripts/test_sack_tags.ts
// =============================================================================
// İz, çuvala bırakılan bir işarettir (macOS Finder etiketi emsali) — nesnenin
// KENDİSİNİ değiştirmez. `Sack.notes` ile aynı sınıf: ANNOTATION.
//
// Ölçülenler (plan §B/§C/§D):
//   §1  DISPATCH izi TEMİZLER **+ storno GERİ GETİRİR** (soft damga)
//   §2  ⭐ EN PAHALI HATANIN KİLİDİ: iz yazımı `weightKg`e DOKUNMAZ
//       (`markSackContentChangedTx` bağlansaydı tartılmış çuvalın brüt kg'si her
//       etiket hamlesinde silinirdi — o rakam irsaliyeye ve gümrük belgesine
//       basılıyor)
//   §3  KONTROL GRUBU: aynı çuvalda `weighSack` HÂLÂ 409 (ölçüm/içerik guard'ı
//       yerinde) ama iz YAZILIR → "guard yanlışlıkla eklenmedi" değil,
//       "bilinçli olarak uygulanmadı"
//   §4  Liste rozeti ≡ `hasTag`/`tagId` filtresi kümesi (rozet↔filtre ayrışması)
//   §5  `columns.cuval.shown` sanitize + Zod turunda HAYATTA KALIR ("ayar
//       sessizce kaybolur" sınıfı — belge opt-in kolonunun ön koşulu)
//   §6  Pasif etiketin ESKİ ataması hâlâ görünür (yeni atama ise 400)
//   §7  ⭐ ETİKETLİ BOŞ ÇUVAL SİLİNEBİLİR (Cascade sondası — Restrict bırakılsaydı
//       `removeSack`in gerçek `tx.sack.delete`i ham FK hatasıyla düşerdi)
//   §8  Toplu uç: `removeAll` + `remove` → 400 · sevk edilmiş çuval `skipped`
//       (409 DEĞİL) · `add`+`remove` aynı çağrıda serbest
//   §9  Katalog: kod addan türer/değişmez · kullanımdaki etiket 409 · migration
//       O-22 DEFERRABLE composite FK'ları KORUDU
//
// ⚠️ NEGATİF SONDALAR ÜRÜN KODU ÜZERİNDE ÖLÇÜLDÜ (2026-09-04) — ALTISI DA kırmızı
// verdi, her biri sonra md5 ile birebir geri alındı:
//   1. `clearSackTagsOnDispatchTx` çağrısı `performDispatchTx`ten çıkarıldı → 7 ❌
//   2. `restoreSackTagsOnUndoDispatchTx` çağrısı `undoDispatch`ten çıkarıldı → 4 ❌
//   3. `applyTagsTx`e `markSackContentChangedTx` eşdeğeri EKLENDİ (yani tam da
//      "eksik sanıp ekleme" hatası yapıldı) → 4 ❌ (kg kontrolleri)
//   4. `ACTIVE_TAG_SELECT`ten `where` düşürüldü (rozet↔filtre ayrışması) → 1 ❌
//   5. `sack_tag_assignments_sackId_fkey` DB'de RESTRICT'e çevrildi → 3 ❌
//      (durum kodu −1 = ham Prisma FK hatası; tam da öngörülen arıza)
//   6. toplu uçtaki DISPATCHED atlaması etkisizleştirildi → 3 ❌
//
// ⚠️ 4. SONDA İLK YAZIMDA ISIRMADI (ölçüldü): §1'de yalnız FİLTRE kontrol
// ediliyordu ve filtre satırı hiç döndürmediği için rozetin ne bastığı GÖRÜNMÜYORDU
// — bekçinin kör noktası tam da kollamak istediği ayrışmanın üstündeydi. "ROZET de
// sustu" kontrolü bu yüzden AYRI bir satırdır; birleştirme.
//
// Bekçiyi değiştirirsen altısını da tekrarla — "kırmızı verebiliyor mu"
// kanıtlanmamış bekçi, bekçi değil süstür.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { sackSearchService } from "../src/services/sack-search.service";
import { SackTagService } from "../src/services/sack-tag.service";
import { sanitizeDocumentsConfig } from "../src/services/system-setting.service";
import { docConfigSchema } from "../src/controllers/printed-document.controller";
import { AppError } from "../src/utils/app-error";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
async function status(fn: () => Promise<unknown>): Promise<number | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.statusCode : -1;
  }
}

const N = (v: unknown) => Number(v);

/** Liste satırının bu bekçinin okuduğu alanları. */
interface SackRow {
  id: string;
  sackNo: string;
  weightKg: number | null;
  hasTag: boolean;
  tags: { id: string; code: string; name: string; hex: string; isActive: boolean }[];
}
const listRows = async (params: Parameters<typeof sackSearchService.searchSacks>[0]): Promise<SackRow[]> =>
  ((await sackSearchService.searchSacks({ scope: "ALL", limit: 100, ...params })) as { data: SackRow[] }).data;

async function main(): Promise<void> {
  const ts = Date.now();
  const admin = await ensureTestAdmin();

  const customer = await prisma.customer.create({
    data: { code: `TST-TAG-${ts}`, name: `ETİKET TEST MÜŞTERİ ${ts}` },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-TAG-I-${ts}`, name: `ETİKET KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });

  const tagIds: string[] = [];
  const sackIds: string[] = [];
  const rollIds: string[] = [];
  let shipmentId: string | null = null;

  const mkTag = async (name: string, hex = "#FF9900"): Promise<string> => {
    const r = await SackTagService.createTag({ name: `${name} ${ts}`, hex }, admin.id);
    tagIds.push(r.data.id);
    return r.data.id;
  };
  const mkSack = async (suffix: string): Promise<{ id: string; sackNo: string }> => {
    const s = await prisma.sack.create({
      data: { sackNo: `TEST-TAG-SK-${suffix}-${ts}`, customerId: customer.id },
      select: { id: true, sackNo: true },
    });
    sackIds.push(s.id);
    return s;
  };
  let rollSeq = 0;
  const mkRoll = async (qty: number, sackId: string): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-TAG-R${++rollSeq}-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        currentQty: qty,
        initialQty: qty,
        width: 150,
        entrySource: "SUPPLIER_RECEIPT",
        sackId,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };
  const kgOf = async (sackId: string) =>
    (await prisma.sack.findUnique({
      where: { id: sackId },
      select: { weightKg: true, weightSource: true, weighedAt: true, labelDirty: true },
    }))!;

  try {
    // =====================================================================
    console.log("\n[§9] KATALOG — kod addan türer, kullanımdaki etiket silinemez");
    const tKontrol = await mkTag("KONTROL ET");
    const tEksik = await mkTag("EKSİK VAR", "#3366FF");
    const kat = await prisma.sackTag.findUnique({ where: { id: tKontrol }, select: { code: true, name: true } });
    check("kod addan ASCII'ye katlanarak türedi", /^KONTROL_ET_\d+$/.test(kat?.code ?? ""), kat?.code);
    // Kod DEĞİŞMEZ — ad düzeltmesi rapor anahtarını bölmemeli.
    await SackTagService.updateTag(tKontrol, { name: `KONTROL EDİLECEK ${ts}` }, admin.id);
    const kat2 = await prisma.sackTag.findUnique({ where: { id: tKontrol }, select: { code: true, name: true } });
    check("ad düzeltilince KOD DEĞİŞMEDİ", kat2?.code === kat?.code, `${kat?.code} → ${kat2?.code}`);
    check("ad güncellendi", kat2?.name === `KONTROL EDİLECEK ${ts}`, kat2?.name);
    check(
      "geçersiz hex reddedilir",
      (await status(() => SackTagService.createTag({ name: `HATALI ${ts}`, hex: "kirmizi" }, admin.id))) === 400,
    );
    check(
      "aynı adla ikinci etiket 409",
      (await status(() => SackTagService.createTag({ name: `EKSİK VAR ${ts}`, hex: "#111111" }, admin.id))) === 409,
    );

    // O-22 sondası — migration DEFERRABLE composite FK'ları DROP etmemiş olmalı.
    const o22 = await prisma.$queryRawUnsafe<{ conname: string; condeferrable: boolean }[]>(
      `SELECT conname, condeferrable FROM pg_constraint WHERE conname LIKE '%sackId_shipmentId_consistency_fkey'`,
    );
    check(
      "⭐ migration O-22 DEFERRABLE composite FK'larını KORUDU (rolls + swatches)",
      o22.length === 2 && o22.every((c) => c.condeferrable === true),
      JSON.stringify(o22.map((c) => c.conname)),
    );

    // =====================================================================
    console.log("\n[§2/§3] İZ YAZIMI ÖLÇÜME DOKUNMAZ — kg korunur, guard duruyor");
    const sPool = await mkSack("POOL");
    await mkRoll(120, sPool.id);
    await shippingService.weighSack({ sackId: sPool.id, weightKg: 47.3 }, admin.id);
    const before = await kgOf(sPool.id);
    check("ön koşul — çuval tartıldı (47.3 kg)", N(before.weightKg) === 47.3, String(before.weightKg));
    const labelDirtyBefore = before.labelDirty;

    await SackTagService.setSackTags(sPool.id, [tKontrol, tEksik], admin.id);
    const after = await kgOf(sPool.id);
    check("⭐ §2 iz yazımı `weightKg`e DOKUNMADI", N(after.weightKg) === 47.3, String(after.weightKg));
    check("⭐ §2 tartı izi de korundu (weightSource/weighedAt)", after.weightSource !== null && after.weighedAt !== null);
    check("§C `labelDirty`ye DOKUNULMADI", after.labelDirty === labelDirtyBefore, String(after.labelDirty));

    const badges = (await SackTagService.getSackTags(sPool.id)).data;
    check("iki iz de bırakıldı", badges.length === 2, badges.map((b) => b.name).join(", "));
    const asg = await prisma.sackTagAssignment.findFirst({
      where: { sackId: sPool.id, tagId: tKontrol },
      select: { createdById: true },
    });
    check("künye kalıcı — kim bıraktı satırda duruyor", asg?.createdById === admin.id);

    // =====================================================================
    console.log("\n[§4] LİSTE ROZETİ ≡ FİLTRE KÜMESİ");
    const sBos = await mkSack("BOS"); // izsiz kontrol grubu
    const withTag = await listRows({ tagId: tKontrol });
    check("`tagId` filtresi izli çuvalı döndürdü", withTag.some((r) => r.id === sPool.id), `${withTag.length} satır`);
    check("`tagId` filtresi izsiz çuvalı DÖNDÜRMEDİ", !withTag.some((r) => r.id === sBos.id));
    const row = withTag.find((r) => r.id === sPool.id)!;
    check("liste satırında rozet var (rozet ≡ filtre)", row.tags.length === 2 && row.hasTag === true);
    check("liste satırında kg hâlâ 47.3 (ölçüm bozulmadı)", N(row.weightKg) === 47.3, String(row.weightKg));

    const untagged = await listRows({ tagId: "none", customerId: customer.id });
    check(
      "`tagId=none` sentineli izsiz çuvalı döndürdü (P2007 YOK)",
      untagged.some((r) => r.id === sBos.id) && !untagged.some((r) => r.id === sPool.id),
      `${untagged.length} satır`,
    );
    const csv = await listRows({ tagId: `${tKontrol},${tEksik}` });
    check("ham CSV `tagId` P2007 vermedi, VEYA semantiği çalıştı", csv.some((r) => r.id === sPool.id));
    const hasTagFalse = await listRows({ hasTag: false, customerId: customer.id });
    check(
      "`hasTag:false` izsizleri döndürdü",
      hasTagFalse.some((r) => r.id === sBos.id) && !hasTagFalse.some((r) => r.id === sPool.id),
    );

    // KONTROL GRUBU (§3) — ölçüm/içerik guard'ı YERİNDE.
    const shipment = await prisma.shipment.create({
      data: { shipmentNo: `TEST-TAG-S-${ts}`, customerId: customer.id, status: "PLANNED" },
      select: { id: true },
    });
    shipmentId = shipment.id;
    await prisma.sack.update({ where: { id: sPool.id }, data: { shipmentId: shipment.id, seq: 1 } });
    await prisma.roll.updateMany({ where: { sackId: sPool.id }, data: { shipmentId: shipment.id } });
    check(
      "⭐ §3 KONTROL GRUBU: sevkiyattaki çuvalın TARTISI hâlâ 409 (guard duruyor)",
      (await status(() => shippingService.weighSack({ sackId: sPool.id, weightKg: 9 }, admin.id))) === 409,
    );
    const t3 = await mkTag("SEVKİYATTA YAZILDI", "#22AA55");
    check(
      "⭐ §3 AMA aynı çuvala iz YAZILDI (409 değil) — guard bilinçli uygulanmadı",
      (await status(() => SackTagService.setSackTags(sPool.id, [tKontrol, tEksik, t3], admin.id))) === null,
    );

    // =====================================================================
    console.log("\n[§1] SEVK İZİ TEMİZLER + STORNO GERİ GETİRİR");
    await shippingService.dispatchShipment(shipment.id, { plateNumber: "34TAG01" }, admin.id);
    const afterDispatch = await SackTagService.getSackTags(sPool.id);
    check("⭐ §1 DISPATCH sonrası ETKİN iz kalmadı", afterDispatch.data.length === 0, `${afterDispatch.data.length}`);
    const cleared = await prisma.sackTagAssignment.findMany({
      where: { sackId: sPool.id },
      select: { clearedAt: true, clearedShipmentId: true },
    });
    check(
      "⭐ §1 satırlar SİLİNMEDİ, SOFT damgalandı (clearedShipmentId = terslemenin adresi)",
      cleared.length === 3 && cleared.every((c) => c.clearedAt !== null && c.clearedShipmentId === shipment.id),
      JSON.stringify(cleared.map((c) => !!c.clearedAt)),
    );
    const listAfterDispatch = await listRows({ tagId: tKontrol });
    check(
      "§1 FİLTRE sustu — temizlenen iz `tagId` süzgecinde dönmüyor",
      !listAfterDispatch.some((r) => r.id === sPool.id),
    );
    // ⚠️ ROZETİ AYRICA ÖLÇ — yukarıdaki kontrol tek başına KÖRDÜR: filtre satırı
    // hiç döndürmediği için rozetin ne bastığı görünmez. Rozet `ACTIVE_TAG_SELECT`
    // yüklemini kaybederse (ayrışma) tam burada kırmızı olur.
    const poolRowAfter = (await listRows({ customerId: customer.id })).find((r) => r.id === sPool.id);
    check(
      "⭐ §1 ROZET de sustu — liste satırında `tags` boş, `hasTag` false (rozet ≡ filtre)",
      poolRowAfter !== undefined && poolRowAfter.tags.length === 0 && poolRowAfter.hasTag === false,
      JSON.stringify(poolRowAfter?.tags?.map((t) => t.code)),
    );

    // Sevk SONRASI yeni iz bırakmak SERBEST — ve storno onu diriltmemeli.
    const tSonrasi = await mkTag("SEVK SONRASI", "#884400");
    await SackTagService.setSackTags(sPool.id, [tSonrasi], admin.id);
    check("§1 sevk sonrası yeni iz bırakılabildi", (await SackTagService.getSackTags(sPool.id)).data.length === 1);

    await shippingService.undoDispatch(shipment.id, "TEST — iz stornosu ölçümü", admin.id);
    const restored = (await SackTagService.getSackTags(sPool.id)).data.map((t) => t.id).sort();
    check(
      "⭐ §1 STORNO üç izi de GERİ GETİRDİ (+ sevk sonrası bırakılan duruyor = 4)",
      restored.length === 4,
      `${restored.length} iz`,
    );
    const stillCleared = await prisma.sackTagAssignment.count({
      where: { sackId: sPool.id, clearedAt: { not: null } },
    });
    check("§1 storno sonrası temizlenmiş satır KALMADI", stillCleared === 0, String(stillCleared));
    const kgAfterCycle = await kgOf(sPool.id);
    check(
      "⭐ §2 sevk+storno turundan sonra da kg bozulmadı",
      N(kgAfterCycle.weightKg) === 47.3,
      String(kgAfterCycle.weightKg),
    );

    // =====================================================================
    console.log("\n[§6] PASİF ETİKET — eski atama görünür, yeni atama 400");
    await SackTagService.updateTag(tEksik, { isActive: false }, admin.id);
    const withPassive = (await SackTagService.getSackTags(sPool.id)).data;
    check(
      "⭐ §6 pasif etiketin ESKİ ataması hâlâ görünüyor",
      withPassive.some((t) => t.id === tEksik && t.isActive === false),
      withPassive.map((t) => `${t.name}:${t.isActive}`).join(", "),
    );
    const listWithPassive = await listRows({ tagId: tEksik });
    check("§6 pasif etiketin filtresi de çalışıyor", listWithPassive.some((r) => r.id === sPool.id));
    check(
      "§6 pasif etiketle YENİ atama 400",
      (await status(() => SackTagService.setSackTags(sBos.id, [tEksik], admin.id))) === 400,
    );
    check("§6 katalog listesi pasifi GİZLER", !(await SackTagService.listTags()).data.some((t) => t.id === tEksik));
    check(
      "§6 `includeInactive` pasifi GÖSTERİR",
      (await SackTagService.listTags({ includeInactive: true })).data.some((t) => t.id === tEksik),
    );
    await SackTagService.updateTag(tEksik, { isActive: true }, admin.id);

    // =====================================================================
    console.log("\n[§8] TOPLU UÇ — çelişki 400, sevk edilmiş çuval `skipped`");
    check(
      "⭐ §8 `removeAll` + `remove` birlikte → 400",
      (await status(() =>
        SackTagService.bulkTags({ sackIds: [sBos.id], remove: [tKontrol], removeAll: true }, admin.id),
      )) === 400,
    );
    check(
      "§8 boş hamle (add/remove/removeAll yok) → 400",
      (await status(() => SackTagService.bulkTags({ sackIds: [sBos.id] }, admin.id))) === 400,
    );

    // Sevk EDİLMİŞ çuval → skipped (409 DEĞİL). Yeni bir sevkiyat kur.
    const sShipped = await mkSack("SHIPPED");
    const shipment2 = await prisma.shipment.create({
      data: { shipmentNo: `TEST-TAG-S2-${ts}`, customerId: customer.id, status: "DISPATCHED", dispatchedAt: new Date() },
      select: { id: true },
    });
    await prisma.sack.update({ where: { id: sShipped.id }, data: { shipmentId: shipment2.id, seq: 1 } });
    const bulk = (await SackTagService.bulkTags(
      { sackIds: [sBos.id, sShipped.id], add: [tKontrol] },
      admin.id,
    )) as { data: { added: number; removed: number; skipped: { sackId: string; reason: string }[] } };
    check("⭐ §8 sevk edilmiş çuval ATLANDI (409 atılmadı)", bulk.data.skipped.some((s) => s.sackId === sShipped.id));
    check("§8 karışık seçimde uygun çuval İŞLENDİ", bulk.data.added === 1, JSON.stringify(bulk.data));
    check("§8 atlanan çuvala iz YAZILMADI", (await SackTagService.getSackTags(sShipped.id)).data.length === 0);

    // add + remove aynı çağrıda (yeniden etiketleme tek hamledir)
    const swap = (await SackTagService.bulkTags(
      { sackIds: [sBos.id], add: [t3], remove: [tKontrol] },
      admin.id,
    )) as { data: { added: number; removed: number } };
    check(
      "§8 `add`+`remove` aynı çağrıda çalıştı (yeniden etiketleme)",
      swap.data.added === 1 && swap.data.removed === 1,
      JSON.stringify(swap.data),
    );
    const bosTags = (await SackTagService.getSackTags(sBos.id)).data;
    check("§8 sonuç doğru — yalnız yeni iz duruyor", bosTags.length === 1 && bosTags[0]!.id === t3);

    // İdempotency — aynı toplu hamle iki kez, mükerrer satır AÇMAZ.
    await SackTagService.bulkTags({ sackIds: [sBos.id], add: [t3] }, admin.id);
    check(
      "§8 aynı hamle tekrarı mükerrer satır AÇMADI (`skipDuplicates`)",
      (await prisma.sackTagAssignment.count({ where: { sackId: sBos.id, tagId: t3 } })) === 1,
    );

    // removeAll
    const all = (await SackTagService.bulkTags({ sackIds: [sBos.id], removeAll: true }, admin.id)) as {
      data: { removed: number };
    };
    check("§8 `removeAll` tüm izleri kaldırdı", all.data.removed === 1 && (await SackTagService.getSackTags(sBos.id)).data.length === 0);

    // =====================================================================
    console.log("\n[§9b] KULLANIMDAKİ ETİKET SİLİNEMEZ (Restrict'in Türkçe sesi)");
    check(
      "kullanımdaki etiket sert silme → 409",
      (await status(() => SackTagService.deleteTag(tKontrol, admin.id))) === 409,
    );
    const tUnused = await mkTag("HİÇ KULLANILMADI", "#999999");
    check(
      "kullanılmamış etiket silinebildi",
      (await status(() => SackTagService.deleteTag(tUnused, admin.id))) === null,
    );

    // =====================================================================
    console.log("\n[§B] BÖLME — çocuk çuval izi MİRAS ALMAZ");
    // ⚠️ Bu "eksik" DEĞİL, karar: iz fiziksel çuvala bırakılmış bir işarettir;
    // kopyalamak "bunu ayır" talimatını sessizce İKİZLERDİ.
    const sSplit = await mkSack("SPLIT");
    const r1 = await mkRoll(60, sSplit.id);
    await mkRoll(40, sSplit.id);
    await SackTagService.setSackTags(sSplit.id, [tKontrol], admin.id);
    const split = (await shippingService.splitSack({ sackId: sSplit.id, rollIds: [r1] }, admin.id)) as {
      data: { sackId: string };
    };
    sackIds.push(split.data.sackId);
    check(
      "⭐ §B bölme çocuğu izi MİRAS ALMADI",
      (await SackTagService.getSackTags(split.data.sackId)).data.length === 0,
    );
    check("§B kaynak çuvalın izi DURUYOR", (await SackTagService.getSackTags(sSplit.id)).data.length === 1);

    // =====================================================================
    console.log("\n[§7] ETİKETLİ BOŞ ÇUVAL SİLİNEBİLİR (Cascade sondası)");
    const sSil = await mkSack("SILINECEK");
    await SackTagService.setSackTags(sSil.id, [tKontrol], admin.id);
    check(
      "ön koşul — silinecek çuvalın izi var",
      (await prisma.sackTagAssignment.count({ where: { sackId: sSil.id } })) === 1,
    );
    const delStatus = await status(() => shippingService.removeSack(sSil.id, admin.id));
    check("⭐ §7 ETİKETLİ BOŞ ÇUVAL SİLİNDİ (Cascade — Restrict olsaydı ham FK hatası)", delStatus === null, String(delStatus));
    check("§7 çuval gerçekten gitti", (await prisma.sack.findUnique({ where: { id: sSil.id } })) === null);
    check(
      "§7 bağ satırı da Cascade ile gitti (öksüz kalmadı)",
      (await prisma.sackTagAssignment.count({ where: { sackId: sSil.id } })) === 0,
    );

    // =====================================================================
    console.log("\n[§5] BELGE AYARI — `columns.cuval.shown` sanitize + Zod turunda hayatta kalır");
    // ⚠️ "Ayar sessizce kaybolur" sınıfı: opt-in kolon allowlist'i DÖRT kapıdan
    // geçer; ikisi burada ölçülür (sunucu sanitize + canlı önizleme Zod'u).
    // Belge kolonunun kendisi ayrı bir turun işi — bu sonda KANALIN açık
    // olduğunu kilitler, kolonun varlığını değil.
    const rawCfg = { cuval: { columns: { cuval: { shown: ["tag", "note"] } } } };
    const sanitized = sanitizeDocumentsConfig(rawCfg as Record<string, unknown>);
    check(
      "⭐ §5 sunucu sanitize `columns.cuval.shown`u KORUDU",
      sanitized.cuval?.columns?.cuval?.shown?.includes("tag") === true,
      JSON.stringify(sanitized.cuval?.columns),
    );
    const zod = docConfigSchema.parse({ columns: { cuval: { shown: ["tag"] } } });
    check(
      "⭐ §5 canlı önizleme Zod'u `shown`u ATMADI",
      zod?.columns?.cuval?.shown?.includes("tag") === true,
      JSON.stringify(zod?.columns),
    );

    // =====================================================================
    console.log("\n[§AUDIT] iz yazımı denetim izi bırakır");
    const auditRow = await prisma.systemLog.findFirst({
      where: { tableName: "SACK", recordId: sPool.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const nd = auditRow?.newData as { kind?: string } | null;
    check("tekil iz yazımı audit satırı düştü (kind=SACK_TAGS)", nd?.kind === "SACK_TAGS", JSON.stringify(nd));
    const bulkAudit = await prisma.systemLog.findFirst({
      where: { tableName: "SACK", action: "UPDATE", recordId: sBos.id },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const bnd = bulkAudit?.newData as { kind?: string } | null;
    check("toplu hamle ÇAĞRI BAŞINA BİR satır (kind=SACK_TAGS_BULK)", bnd?.kind === "SACK_TAGS_BULK", JSON.stringify(bnd));
  } finally {
    // Cleanup — bağımlılık sırasıyla. `sack_tag_assignments` çuvalla Cascade
    // gider ama etiket satırı Restrict'lidir → atamalar ÖNCE düşer.
    await prisma.sackTagAssignment.deleteMany({ where: { tagId: { in: tagIds } } });
    await prisma.sackTag.deleteMany({ where: { id: { in: tagIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentId ? [shipmentId] : [] } } });
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipment: { customerId: customer.id } } });
    await prisma.printedDocument.deleteMany({
      where: { sourceId: { in: (await prisma.shipment.findMany({ where: { customerId: customer.id }, select: { id: true } })).map((s) => s.id) } },
    });
    await prisma.shipment.deleteMany({ where: { customerId: customer.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
