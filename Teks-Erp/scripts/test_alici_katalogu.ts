// =============================================================================
// Test: ALICI KATALOĞU (CustomerConsignee, 2026-11-10 — tambur fason etiket planı B2)
// Çalıştır: npx tsx scripts/test_alici_katalogu.ts
// =============================================================================
// Korunan sözleşme: alıcı sahip (Customer) kapsamlı bir addır; `ensure` doğal anahtarla idempotent
// (katlanmış ad, paralelde tek satır), pasif ad yeniden aktifleşir, mezar taşı adı hedefe çözülür;
// yeniden adlandırma çakışması 409; pasife alma MV-06 kapılı (canlı top → 409 + liste, sevkli top engellemez);
// birleştirme canlı topları hedefe döndürür (basılmış olan bayatlar), sevkli top dokunulmaz; farklı sahip 400;
// cari birleştirmesinde çakışan ad birleşir, çakışmayan taşınır.
//
// NEGATİF SONDA (2026-11-10, iki kez kırıldı ve geri alındı):
//   A) `consigneeLiveRollWhere`ten durum süzgeci kaldırıldı → e2, f1, f2, f3 ❌ (4).
//   B) ensure'deki `ON CONFLICT … DO NOTHING` kaldırıldı → a3 paralel ensure 23505 ile düştü ❌.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  activateConsignee, deactivateConsignee, ensureConsignee, listConsignees, renameConsignee,
} from "../src/services/customer-consignee.service";
import { consigneeMergePreview, mergeConsignee } from "../src/services/customer-consignee-merge.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}

const TAG = `TEST-ALICI-${Date.now().toString().slice(-7)}`;
const custIds: string[] = [];
const rollIds: string[] = [];
let itemId = "";
let seq = 0;

async function mkCustomer(suffix: string): Promise<string> {
  const id = (await prisma.customer.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` }, select: { id: true } })).id;
  custIds.push(id);
  return id;
}
async function mkRoll(consigneeId: string, status: RollStatus, printed: boolean): Promise<string> {
  const id = (await prisma.roll.create({
    data: {
      barcode: `${TAG}-R${++seq}`, itemId, initialQty: 50, currentQty: 50, status, entrySource: "SUPPLIER_RECEIPT",
      labelConsigneeId: consigneeId, labelPrintedAt: printed ? new Date() : null, labelDirty: false,
    },
    select: { id: true },
  })).id;
  rollIds.push(id);
  return id;
}
const rollOf = (id: string) => prisma.roll.findUniqueOrThrow({ where: { id }, select: { labelConsigneeId: true, labelDirty: true } });
const audits = (recordId: string) => prisma.systemLog.count({ where: { recordId, tableName: "CUSTOMER_CONSIGNEE" } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  itemId = (await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} KUMAS`, itemType: "FABRIC" }, select: { id: true } })).id;
  const owner = await mkCustomer("SAHIP");
  const other = await mkCustomer("BASKA");

  // a) doğal anahtar: farklı yazım tek kayıt; paralel iki ensure tek kayıt
  const a1 = await ensureConsignee(owner, "  abc   konfeksiyon ");
  const a2 = await ensureConsignee(owner, "ABC KONFEKSİYON");
  check("a1) ilk ensure doğurur, ad normalize", a1.created && a1.consignee.name === "ABC KONFEKSİYON", a1.consignee.name);
  check("a2) farklı yazım (boşluk/harf) aynı kaydı döner", !a2.created && a2.consignee.id === a1.consignee.id);
  const [p1, p2] = await Promise.all([ensureConsignee(owner, "Paralel Alıcı"), ensureConsignee(owner, "PARALEL ALICI")]);
  const pCount = await prisma.customerConsignee.count({ where: { customerId: owner, name: "PARALEL ALICI" } });
  check("a3) paralel iki ensure → tek satır", pCount === 1 && p1.consignee.id === p2.consignee.id, `satır=${pCount}`);
  check("a4) doğum audit'i yazıldı", (await audits(a1.consignee.id)) >= 1);
  check("a5) boş ad 400", (await errCode(ensureConsignee(owner, "   "))) === "400:CONSIGNEE_NAME_INVALID");
  const sameOther = await ensureConsignee(other, "ABC KONFEKSİYON");
  check("a6) aynı ad başka sahipte ayrı kayıt", sameOther.created && sameOther.consignee.id !== a1.consignee.id);

  // b) pasif ad ensure → yeniden aktif + audit
  const b = await ensureConsignee(owner, "Pasif Alıcı");
  await deactivateConsignee(b.consignee.id);
  const before = await audits(b.consignee.id);
  const b2 = await ensureConsignee(owner, "pasif alıcı");
  check("b1) pasif ad ensure → aynı kayıt yeniden aktif", b2.reactivated && b2.consignee.id === b.consignee.id && b2.consignee.isActive);
  check("b2) yeniden aktifleşme audit'i", (await audits(b.consignee.id)) > before);

  // d) yeniden adlandırma çakışması
  const d = await ensureConsignee(owner, "XYZ Tekstil");
  check("d1) çakışan ad → 409 CONSIGNEE_NAME_TAKEN", (await errCode(renameConsignee(d.consignee.id, "abc konfeksiyon"))) === "409:CONSIGNEE_NAME_TAKEN");
  const dr = await renameConsignee(d.consignee.id, "XYZ Tekstil A.Ş.");
  check("d2) çakışmasız ad değişir", dr.name === "XYZ TEKSTİL A.Ş.", dr.name);

  // e) pasife alma MV-06
  const e = await ensureConsignee(owner, "Kapı Alıcı");
  const eLive = await mkRoll(e.consignee.id, RollStatus.STOCK, false);
  const eCode = await errCode(deactivateConsignee(e.consignee.id));
  let eRolls: unknown[] = [];
  try { await deactivateConsignee(e.consignee.id); } catch (x) { eRolls = ((x as { details?: { rolls?: unknown[] } }).details?.rolls) ?? []; }
  check("e1) canlı topu olan alıcı pasife alınamaz → 409 CONSIGNEE_IN_USE + top listesi", eCode === "409:CONSIGNEE_IN_USE" && eRolls.length === 1, `${eCode} liste=${eRolls.length}`);
  await prisma.roll.update({ where: { id: eLive }, data: { status: RollStatus.SHIPPED } });
  check("e2) yalnız sevkli topu olan alıcı pasife alınır", (await errCode(deactivateConsignee(e.consignee.id))) === "OK");
  check("e3) aktifleştir geri açar", (await activateConsignee(e.consignee.id)).isActive === true);

  // f) birleştirme
  const fs = await ensureConsignee(owner, "Birleşen Eski");
  const ft = await ensureConsignee(owner, "Birleşen Yeni");
  const fLivePrinted = await mkRoll(fs.consignee.id, RollStatus.STOCK, true);
  const fLiveRaw = await mkRoll(fs.consignee.id, RollStatus.WAREHOUSE, false);
  const fShipped = await mkRoll(fs.consignee.id, RollStatus.SHIPPED, true);
  const prev = await consigneeMergePreview(fs.consignee.id, ft.consignee.id);
  check("f1) önizleme canlı topları TEK TEK listeler, sevkliyi sayıyla", prev.rolls.length === 2 && prev.untouchedRollCount === 1, `canlı=${prev.rolls.length} değişmez=${prev.untouchedRollCount}`);
  const fm = await mergeConsignee(fs.consignee.id, ft.consignee.id);
  const [r1, r2, r3] = [await rollOf(fLivePrinted), await rollOf(fLiveRaw), await rollOf(fShipped)];
  check("f2) canlı toplar hedefe döndü", r1.labelConsigneeId === ft.consignee.id && r2.labelConsigneeId === ft.consignee.id && fm.movedRolls === 2);
  check("f3) sevkli top dokunulmadı (eski alıcı, bayrak yok)", r3.labelConsigneeId === fs.consignee.id && r3.labelDirty === false);
  check("f4) basılmış canlı top bayat, basılmamış değil", r1.labelDirty === true && r2.labelDirty === false);
  const tomb = await prisma.customerConsignee.findUniqueOrThrow({ where: { id: fs.consignee.id }, select: { isActive: true, mergedIntoId: true } });
  check("f5) kaynak mezar taşı: pasif + mergedIntoId", tomb.isActive === false && tomb.mergedIntoId === ft.consignee.id);
  check("f6) ikinci birleştirme → 409", (await errCode(mergeConsignee(fs.consignee.id, ft.consignee.id))) === "409:CONSIGNEE_MERGED");
  // c) mezar taşı adı → hedef
  const c = await ensureConsignee(owner, "birleşen eski");
  check("c1) mezar taşı adıyla ensure hedefi döner (yeni satır yok)", !c.created && c.consignee.id === ft.consignee.id);
  const listed = await listConsignees(owner, {});
  check("c2) liste mezar taşını göstermez", !listed.some((l) => l.id === fs.consignee.id) && listed.some((l) => l.id === ft.consignee.id));

  // g) farklı sahip
  check("g1) farklı sahibin alıcısıyla birleştirme → 400", (await errCode(mergeConsignee(a1.consignee.id, sameOther.consignee.id))) === "400:CONSIGNEE_OWNER_MISMATCH");

  // h) cari birleştirmesi: çakışan ad birleşir, çakışmayan taşınır
  const hs = await mkCustomer("HKAYNAK");
  const ht = await mkCustomer("HHEDEF");
  const hsSame = await ensureConsignee(hs, "Ortak Alıcı");
  const hsOnly = await ensureConsignee(hs, "Yalnız Kaynakta");
  const htSame = await ensureConsignee(ht, "ORTAK ALICI");
  const hRoll = await mkRoll(hsSame.consignee.id, RollStatus.STOCK, false);
  const pv = await MasterDataMergeService.preview("customer", ht, [hs]);
  await MasterDataMergeService.merge("customer", { survivorId: ht, sourceIds: [hs], reason: "alici katalogu bekcisi", acknowledgedConflicts: pv.conflicts.length });
  const hsSameAfter = await prisma.customerConsignee.findUniqueOrThrow({ where: { id: hsSame.consignee.id }, select: { mergedIntoId: true, customerId: true } });
  const hsOnlyAfter = await prisma.customerConsignee.findUniqueOrThrow({ where: { id: hsOnly.consignee.id }, select: { mergedIntoId: true, customerId: true } });
  check("h1) çakışan ad hedefin alıcısına birleşti", hsSameAfter.mergedIntoId === htSame.consignee.id);
  check("h2) çakışmayan alıcı hedef cariye taşındı (canlı)", hsOnlyAfter.customerId === ht && hsOnlyAfter.mergedIntoId === null);
  check("h3) çakışan alıcının canlı topu hedef alıcıda", (await rollOf(hRoll)).labelConsigneeId === htSame.consignee.id);
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    try {
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      // Mezar taşları önce (birleştirme zinciri düzleştirilir → tek kat), sonra canlılar.
      await prisma.customerConsignee.deleteMany({ where: { customerId: { in: custIds }, mergedIntoId: { not: null } } });
      await prisma.customerConsignee.deleteMany({ where: { customerId: { in: custIds } } });
      await prisma.customer.updateMany({ where: { id: { in: custIds } }, data: { mergedIntoId: null } });
      await prisma.mergeOperationRef.deleteMany({ where: { operation: { survivorId: { in: custIds } } } });
      await prisma.mergeOperationSource.deleteMany({ where: { operation: { survivorId: { in: custIds } } } });
      await prisma.mergeOperation.deleteMany({ where: { survivorId: { in: custIds } } });
      await prisma.cariAccount.deleteMany({ where: { customerId: { in: custIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
      if (itemId) await prisma.item.delete({ where: { id: itemId } });
    } catch (e) { console.error("⚠️ temizlik:", (e as Error).message); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
