// =============================================================================
// ONARIM — Sahipsiz doğmuş EMANET çocuk / makbuzdan doğan toplar (H10 · H10b geri doldurma)
// Çalıştır: npx tsx scripts/fix_emanet_owner_backfill.ts                       (TEŞHİS — hiçbir şey yazmaz)
//           npx tsx scripts/fix_emanet_owner_backfill.ts --apply --onay=<N> [--sevkli-dahil] [--sec=<barkod|id>,...]
// =============================================================================
// Hata: H10 (#265) öncesi Tambur/depo bölmesi ve fason doğrudan sevk çocuğu, H10/H10b öncesi fason
// makbuzundan DOĞAN top (`parentReceiptId`) kaynağın `ownerCustomerId`sini kalıtmıyordu. Sahipsiz emanet
// topu emanet sevk kapısından geçer (başka müşteriye gidebilir) ve hizmet faturasına girmez.
//
// HÜKÜM (kod yolunun aynası — sahiplik DOĞUM niteliğidir, kalıtım bugünkü kodla aynı kuralla çözülür):
//   ÇOCUK   sahipsiz ∧ `parentRollId` dolu ∧ ata sahipli (ya da bu koşumda önerilmiş) → atanın sahibi
//   DOĞAN   sahipsiz ∧ `parentReceiptId` dolu ∧ makbuz kalemlerindeki kaynakların TEK sahibi var →
//           o sahip; karışık (iki müşteri ya da sahipli + sahipsiz) → BELİRSİZ, listelenir, YAZILMAZ
//           (`singleOwner(..., { strict: true })` — makbuz yolundaki kapıyla aynı yüklem)
//   Zincir (çocuğun çocuğu, doğan topun çocuğu) sabit noktaya kadar yürür; kaynakların hepsi sahipsizse
//   top fabrikanın kendi malıdır, aday DEĞİLDİR.
// YAZIM — tek tx; sahip başına `updateMany WHERE id IN (listelenen) AND ownerCustomerId IS NULL`, sayı
// eşleşmezse tx geri alınır (veri değişti). Defter satırı yazılmaz (sahiplik ayrı defter tutmaz, G3);
// iz audit'e (`event: EMANET_OWNER_BACKFILL`), tx DIŞINDA.
// SEVK EDİLMİŞ ADAY (para kararı, kullanıcıya sorulur): sahip yazılan top hizmet faturası kümesine
// (`listShipmentServiceRollIds`) GERİYE DÖNÜK girer. Bu yüzden canlı ya da iade edilmiş sevki olan aday
// varsayılan YAZILMAZ: sevk müşterisi ≠ önerilen sahip → SEVK-UYUŞMAZ (hiç yazılmaz, elle karar);
// sevk müşterisi = sahip → SEVKLİ (yalnız `--sevkli-dahil` ile). CANCELLED top listelenmez, yazılmaz.
// KİMDE KOŞULUR: `emanet.enabled` açık ve H10'dan önce emanet topu bölünmüş / fasona gidip dönmüş
// kurulum. Emanet kapalı kurulumda sahipli top yoktur → teşhis boş döner.
// =============================================================================
import { RollStatus } from "@prisma/client";
import { AppError } from "../src/utils/app-error";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { singleOwner } from "../src/services/helpers/emanet-owner.helper";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const SOURCE = "scripts/fix_emanet_owner_backfill.ts";
const EVENT = "EMANET_OWNER_BACKFILL";
const CHUNK = 5000;

export interface OwnerProposal {
  rollId: string;
  barcode: string | null;
  kind: "CHILD" | "BORN";
  ownerCustomerId: string;
  /** Atanın id'si (CHILD) ya da makbuz id'si (BORN). */
  fromId: string;
  /** Topun canlı + iade edilmiş (iptalsiz) sevklerinin müşterileri; boş = hiç sevk edilmemiş. */
  shippedToCustomerIds: string[];
}
export interface OwnerConflict {
  receiptId: string;
  receiptNo: string;
  rollIds: string[];
  owners: Array<string | null>;
}
export interface Diagnosis {
  /** Varsayılan yazılabilir: sevksiz, iptal edilmemiş. */
  proposals: OwnerProposal[];
  /** Sevk müşterisi = önerilen sahip; yalnız `--sevkli-dahil` ile yazılır (para kararı). */
  shipped: OwnerProposal[];
  /** Sevk müşterisi ≠ önerilen sahip; hiç yazılmaz. */
  shippedMismatch: OwnerProposal[];
  conflicts: OwnerConflict[];
  /** Önerilip CANCELLED olduğu için atlanan top sayısı. */
  cancelledSkipped: number;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** Yalnız okur. Önerilen sahip + belirsiz (karışık kaynaklı) makbuzlar. */
export async function diagnose(): Promise<Diagnosis> {
  const anyOwned = await prisma.roll.count({ where: { ownerCustomerId: { not: null } } });
  if (anyOwned === 0) return { proposals: [], shipped: [], shippedMismatch: [], conflicts: [], cancelledSkipped: 0 };

  const proposed = new Map<string, OwnerProposal>();
  const ownerOf = (id: string, dbOwner: string | null): string | null => dbOwner ?? proposed.get(id)?.ownerCustomerId ?? null;

  /** ÇOCUK: önce sahipli atalar, sonra yeni önerilen atalar — sabit noktaya kadar. */
  const walkChildren = async (seedParentIds: string[] | null): Promise<string[]> => {
    const added: string[] = [];
    let frontier = seedParentIds;
    for (;;) {
      const batches = frontier === null ? [null] : chunks(frontier);
      const next: string[] = [];
      for (const ids of batches) {
        const rows = await prisma.roll.findMany({
          where: {
            ownerCustomerId: null,
            parentRollId: ids === null ? { not: null } : { in: ids },
            ...(ids === null ? { parent: { ownerCustomerId: { not: null } } } : {}),
          },
          select: { id: true, barcode: true, parentRollId: true, parent: { select: { ownerCustomerId: true } } },
          orderBy: { id: "asc" },
        });
        for (const r of rows) {
          if (proposed.has(r.id)) continue;
          const owner = ownerOf(r.parentRollId!, r.parent?.ownerCustomerId ?? null);
          if (!owner) continue;
          proposed.set(r.id, { rollId: r.id, barcode: r.barcode, kind: "CHILD", ownerCustomerId: owner, fromId: r.parentRollId!, shippedToCustomerIds: [] });
          next.push(r.id);
          added.push(r.id);
        }
      }
      if (next.length === 0) return added;
      frontier = next;
    }
  };

  /** DOĞAN: kaynağında sahipli (DB ya da öneri) en az bir top olan makbuzlar; katı tek sahip. */
  let conflicts = new Map<string, OwnerConflict>();
  const walkReceipts = async (): Promise<string[]> => {
    const added: string[] = [];
    const proposedIds = [...proposed.keys()];
    const receiptIds = new Set<string>();
    const owned = await prisma.subcontractorReceiptItem.findMany({
      where: { newRoll: { ownerCustomerId: { not: null } }, receipt: { bornRolls: { some: { ownerCustomerId: null } } } },
      select: { receiptId: true }, distinct: ["receiptId"],
    });
    owned.forEach((o) => receiptIds.add(o.receiptId));
    for (const ids of chunks(proposedIds)) {
      const viaProposed = await prisma.subcontractorReceiptItem.findMany({ where: { newRollId: { in: ids } }, select: { receiptId: true }, distinct: ["receiptId"] });
      viaProposed.forEach((o) => receiptIds.add(o.receiptId));
    }
    const nextConflicts = new Map<string, OwnerConflict>();
    for (const ids of chunks([...receiptIds].sort())) {
      const receipts = await prisma.subcontractorReceipt.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, receiptNo: true,
          items: { select: { newRoll: { select: { id: true, ownerCustomerId: true } } } },
          bornRolls: { where: { ownerCustomerId: null }, select: { id: true, barcode: true }, orderBy: { id: "asc" } },
        },
        orderBy: { id: "asc" },
      });
      for (const rc of receipts) {
        const born = rc.bornRolls.filter((b) => !proposed.has(b.id));
        if (born.length === 0) continue;
        const owners = rc.items.map((i) => ownerOf(i.newRoll.id, i.newRoll.ownerCustomerId));
        let owner: string | null;
        try {
          owner = singleOwner(owners, "Fason kabulü", { strict: true });
        } catch (e) {
          if (e instanceof AppError) { nextConflicts.set(rc.id, { receiptId: rc.id, receiptNo: rc.receiptNo, rollIds: born.map((b) => b.id), owners }); continue; }
          throw e;
        }
        if (!owner) continue;
        for (const b of born) {
          proposed.set(b.id, { rollId: b.id, barcode: b.barcode, kind: "BORN", ownerCustomerId: owner, fromId: rc.id, shippedToCustomerIds: [] });
          added.push(b.id);
        }
      }
    }
    conflicts = nextConflicts;
    return added;
  };

  // Çocuklar → doğanlar → doğanların çocukları …; yeni öneri çıkmayınca biter (çatışma listesi son turunki).
  await walkChildren(null);
  for (let born = await walkReceipts(); born.length > 0; born = await walkReceipts()) await walkChildren(born);
  // Zincir bütün önerilerle yürüdü; sınıflama sonda (iptal / sevk edilmiş çocuğun çocuğu yine aday kalır).
  const all = [...proposed.values()].sort((a, b) => a.rollId.localeCompare(b.rollId));
  const cancelled = new Set<string>();
  const shippedTo = new Map<string, Set<string>>();
  const addShip = (rollId: string, customerId: string) => shippedTo.set(rollId, (shippedTo.get(rollId) ?? new Set<string>()).add(customerId));
  for (const ids of chunks(all.map((p) => p.rollId))) {
    const rolls = await prisma.roll.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, shipment: { select: { customerId: true } } } });
    for (const r of rolls) {
      if (r.status === RollStatus.CANCELLED) cancelled.add(r.id);
      if (r.shipment) addShip(r.id, r.shipment.customerId);
    }
    const returns = await prisma.rollReturn.findMany({ where: { rollId: { in: ids }, cancelledAt: null, fromShipmentId: { not: null } }, select: { rollId: true, fromShipment: { select: { customerId: true } } } });
    for (const rr of returns) if (rr.fromShipment) addShip(rr.rollId, rr.fromShipment.customerId);
  }
  const out: Diagnosis = { proposals: [], shipped: [], shippedMismatch: [], conflicts: [...conflicts.values()], cancelledSkipped: cancelled.size };
  for (const p of all) {
    if (cancelled.has(p.rollId)) continue;
    p.shippedToCustomerIds = [...(shippedTo.get(p.rollId) ?? [])].sort();
    if (p.shippedToCustomerIds.length === 0) out.proposals.push(p);
    else if (p.shippedToCustomerIds.every((c) => c === p.ownerCustomerId)) out.shipped.push(p);
    else out.shippedMismatch.push(p);
  }
  return out;
}

/** Tek tx; yalnız listelenen id'ler ve hâlâ sahipsiz olanlar. Sayı tutmazsa hiçbir şey yazılmaz. */
export async function applyProposals(proposals: OwnerProposal[]): Promise<number> {
  if (proposals.length === 0) return 0;
  const byOwner = new Map<string, string[]>();
  for (const p of proposals) byOwner.set(p.ownerCustomerId, [...(byOwner.get(p.ownerCustomerId) ?? []), p.rollId]);
  await prisma.$transaction(async (tx) => {
    for (const [owner, ids] of [...byOwner.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const part of chunks(ids)) {
        const r = await tx.roll.updateMany({ where: { id: { in: part }, ownerCustomerId: null }, data: { ownerCustomerId: owner } });
        if (r.count !== part.length) throw new Error(`Veri değişti: ${part.length} top beklendi, ${r.count} güncellenebildi — liste yeniden okunmalı, hiçbir şey yazılmadı`);
      }
    }
  }, { timeout: 120_000 });
  await AuditService.logMany(proposals.map((p) => ({
    userId: undefined,
    action: "UPDATE" as const,
    tableName: "ROLL",
    recordId: p.rollId,
    oldData: { ownerCustomerId: null },
    newData: { ownerCustomerId: p.ownerCustomerId, event: EVENT, source: SOURCE, kind: p.kind, fromId: p.fromId },
  })));
  return proposals.length;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  // Yazan yol hangi veritabanını vurduğunu çıktıda söyler (test_script_guards §11).
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  const d = await diagnose();
  const { conflicts } = d;
  const includeShipped = process.argv.includes("--sevkli-dahil");
  const proposals = includeShipped ? [...d.proposals, ...d.shipped].sort((a, b) => a.rollId.localeCompare(b.rollId)) : d.proposals;
  const custIds = [...new Set([...d.proposals, ...d.shipped, ...d.shippedMismatch].flatMap((p) => [p.ownerCustomerId, ...p.shippedToCustomerIds]))];
  const names = new Map((await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const nm = (id: string) => names.get(id) ?? id;
  const line = (tag: string, p: OwnerProposal) => console.log(`  ${tag}  ${p.kind === "CHILD" ? "ÇOCUK" : "DOĞAN"}  ${p.barcode ?? "(barkodsuz)"}  ${p.rollId}  → ${nm(p.ownerCustomerId)}  (kaynak ${p.fromId})${p.shippedToCustomerIds.length ? `  sevk: ${p.shippedToCustomerIds.map(nm).join(", ")}` : ""}`);
  console.log(`=== Emanet sahiplik geri doldurma — ${d.proposals.length} aday, ${d.shipped.length} sevkli, ${d.shippedMismatch.length} sevk-uyuşmaz, ${conflicts.length} belirsiz makbuz, ${d.cancelledSkipped} iptal atlandı ===`);
  for (const p of d.proposals) line("ADAY        ", p);
  for (const p of d.shipped) line(includeShipped ? "SEVKLİ+     " : "SEVKLİ      ", p);
  for (const p of d.shippedMismatch) line("SEVK-UYUŞMAZ", p);
  if (d.shipped.length && !includeShipped) console.log(`  → ${d.shipped.length} SEVKLİ top varsayılan YAZILMAZ: sahip yazılırsa geçmiş sevk hizmet faturası kümesine girer (para kararı); istenirse --sevkli-dahil`);
  if (d.shippedMismatch.length) console.log(`  → SEVK-UYUŞMAZ toplar başka müşteriye sevk edilmiş — YAZILMAZ, elle karar`);
  for (const c of conflicts) console.log(`  BELİRSİZ makbuz ${c.receiptNo}: kaynak sahipleri karışık — ${c.rollIds.length} doğan top YAZILMAZ, elle karar (açıksa makbuzu iptal edip kaynakları ayrı kabul edin)`);
  const sec = arg("sec")?.split(",").map((s) => s.trim()).filter(Boolean);
  let target = proposals;
  if (sec) {
    const unknown = sec.filter((s) => !proposals.some((p) => p.rollId === s || p.barcode === s));
    if (unknown.length) { console.log(`\n⛔ --sec içinde aday listesinde olmayan kayıt: ${unknown.join(", ")} — hiçbir şey yazılmadı.`); process.exitCode = 1; return; }
    target = proposals.filter((p) => sec.includes(p.rollId) || (p.barcode !== null && sec.includes(p.barcode)));
  }
  if (!apply) {
    if (target.length) console.log(`\n  → Yazmak için: npx tsx ${SOURCE} --apply --onay=${target.length}${includeShipped ? " --sevkli-dahil" : ""}${sec ? ` --sec=${sec.join(",")}` : ""}`);
    return;
  }
  if (Number(arg("onay")) !== target.length) {
    console.log(`\n⛔ --onay=${arg("onay") ?? "(yok)"} ama yazılacak kayıt ${target.length} — listeyi yeniden okuyun. Hiçbir şey yazılmadı.`);
    process.exitCode = 1;
    return;
  }
  const n = await applyProposals(target);
  console.log(`\n✅ ${n} topa sahip yazıldı (audit: ${EVENT}).`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end().catch(() => {}); });
}
