// =============================================================================
// BEKÇİ — TAMBUR GERİ ALMA İZİ YAYIN GÜNÜ BİR KEZ YAZILIR (K-A2, 2026-09-26)
// Çalıştır: npx tsx scripts/run-all-tests.ts tambur_undo_marker_backfill
// =============================================================================
// Geri alma kapısının audit'e bakan dalı kalktı (audit yalnız ayak izidir); eski
// damgasız parçaların TEK koruması `fix_tambur_undo_cancel_marker.ts`in yazdığı
// iz. Ölçülenler (uçtan uca, gerçek script):
//   §1 kuru koşum yazmaz; ebeveynin TAMBUR_UNDO_* satırıyla anılan parçalar (sıcak ∪
//      ARŞİV) aday, anılmayan ya da başka olayla anılan parça aday DEĞİL
//   §2 yanlış hedef / yanlış onay yazmaz (çıkış ≠ 0)
//   §3 uygulama izi yazar; kapı parçayı artık diriltmez (öncesinde diriltiyordu — pencere)
//   §4 ikinci kuru koşum 0 aday (idempotent)
// =============================================================================
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TAMBUR_UNDO_CANCEL_CODE } from "../src/constants/reason-presets";
import { resolveRollRestoreBlockReason } from "../src/services/helpers/roll-cancel-restore.helper";
import { ensureTestAdmin } from "./fixture-test-user";
import { cocukOrtami, hedefDbAdi } from "./lib/hedef-db-kapisi";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

function kosScript(args: string[]): { kod: number; cikti: string } {
  const r = spawnSync("npx", ["tsx", "scripts/fix_tambur_undo_cancel_marker.ts", ...args], {
    cwd: KOK, env: cocukOrtami(), encoding: "utf8", timeout: 120_000,
  });
  return { kod: r.status ?? -1, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Kapının geri kalan sinyalleri sıfır: yalnız iz karar verir. */
const kapi = (cancelReasonCode: string | null) => resolveRollRestoreBlockReason({
  status: RollStatus.CANCELLED, preCancelStatus: RollStatus.STOCK, batchId: null, sackId: null, shipmentId: null,
  currentStepId: null, cancelReasonCode, movementCount: 0, operationCount: 0, childCount: 0, dispatchItemCount: 0, kartelaItemCount: 0,
});

async function main(): Promise<void> {
  console.log("=== Tambur geri alma izi — yayın günü göçü ===\n");
  const ts = Date.now();
  const rollIds: string[] = [];
  const logIds: string[] = [];
  const arsivIds: string[] = [];
  const user = await ensureTestAdmin();
  const item = await prisma.item.create({
    data: { code: `TEST-TUM-${ts}`, name: `TEST-TUM ${ts} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  try {
    const top = async (ek: string, ek2: object = {}) => {
      const r = await prisma.roll.create({
        data: { barcode: `TEST-TUM-${ek}-${ts}`, itemId: item.id, initialQty: 40, currentQty: 40, ...ek2 },
        select: { id: true, barcode: true },
      });
      rollIds.push(r.id);
      return r;
    };
    const ebeveyn = await top("EB", { status: RollStatus.STOCK });
    const iptal = { status: RollStatus.CANCELLED, preCancelStatus: RollStatus.STOCK, parentRollId: ebeveyn.id };
    const sicak = await top("SICAK", iptal);
    const arsiv = await top("ARSIV", iptal);
    const izsiz = await top("IZSIZ", iptal);
    const baska = await top("BASKA", iptal);
    const log = async (newData: object) => {
      const l = await prisma.systemLog.create({
        data: { userId: user.id, category: "DOMAIN", action: "UPDATE", tableName: "ROLL", recordId: ebeveyn.id, newData },
        select: { id: true } });
      logIds.push(l.id);
    };
    await log({ event: "TAMBUR_UNDO_SINGLE", cancelledChildId: sicak.id });
    await log({ event: "TAMBUR_FINALIZE", cancelledChildId: baska.id });
    const arsivId = crypto.randomUUID();
    const eski = new Date(Date.now() - 200 * 86_400_000);
    await prisma.systemLogArchive.create({
      data: { id: arsivId, userId: user.id, category: "DOMAIN", action: "UPDATE", tableName: "ROLL", recordId: ebeveyn.id,
        newData: { event: "TAMBUR_UNDO_FULL", cancelledChildIds: [arsiv.id] }, createdAt: eski, updatedAt: eski } });
    arsivIds.push(arsivId);

    const kodu = async (id: string) => (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { cancelReasonCode: true } })).cancelReasonCode;

    // §1
    const kuru = kosScript([]);
    const n = Number(kuru.cikti.match(/(\d+) kayıt damgalanacak/)?.[1] ?? NaN);
    check("§1 kuru koşum yazmaz; sıcak ve ARŞİV izli parça aday, izsiz ve başka olayla anılan değil",
      kuru.kod === 0 && n >= 2 && kuru.cikti.includes(sicak.barcode!) && kuru.cikti.includes(arsiv.barcode!) &&
        !kuru.cikti.includes(izsiz.barcode!) && !kuru.cikti.includes(baska.barcode!) && (await kodu(sicak.id)) === null,
      `çıkış ${kuru.kod} · aday ${n}`);
    check("§1b PENCERE: iz yazılmadan kapı parçayı diriltir (audit dalı yok)", kapi(await kodu(sicak.id)) === null);

    // §2
    const yanlisHedef = kosScript(["--apply", `--onay=${n}`, "--hedef=baska_db"]);
    const yanlisOnay = kosScript(["--apply", `--onay=${n + 1}`, `--hedef=${hedefDbAdi()}`]);
    check("§2 yanlış hedef ve yanlış onay YAZMAZ",
      yanlisHedef.kod !== 0 && yanlisOnay.kod !== 0 && yanlisHedef.cikti.includes("Yazma YOK") && (await kodu(sicak.id)) === null,
      `hedef ${yanlisHedef.kod} · onay ${yanlisOnay.kod}`);

    // §3
    const uygula = kosScript(["--apply", `--onay=${n}`, `--hedef=${hedefDbAdi()}`]);
    const [kSicak, kArsiv, kIzsiz, kBaska] = [await kodu(sicak.id), await kodu(arsiv.id), await kodu(izsiz.id), await kodu(baska.id)];
    check("§3 ⭐ iz yazıldı (sıcak + arşiv), izsiz ve başka olayla anılan parça DOKUNULMADI",
      uygula.kod === 0 && kSicak === TAMBUR_UNDO_CANCEL_CODE && kArsiv === TAMBUR_UNDO_CANCEL_CODE && kIzsiz === null && kBaska === null,
      `çıkış ${uygula.kod} · ${[kSicak, kArsiv, kIzsiz, kBaska].map((k) => k ?? "∅").join(" / ")}`);
    check("§3b ⭐ kapı artık diriltmiyor", (kapi(kSicak) ?? "").includes("Tambur geri almasıyla"), kapi(kSicak) ?? "diriltir");

    // §4
    const ikinci = kosScript([]);
    check("§4 ikinci kuru koşum fikstürü aday saymaz (idempotent)",
      ikinci.kod === 0 && !ikinci.cikti.includes(sicak.barcode!) && !ikinci.cikti.includes(arsiv.barcode!));
  } finally {
    await temizle({ rollIds, logIds, arsivIds, itemId: item.id });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(k: { rollIds: string[]; logIds: string[]; arsivIds: string[]; itemId: string }): Promise<void> {
  try {
    await prisma.systemLog.deleteMany({ where: { OR: [{ id: { in: k.logIds } }, { recordId: { in: k.rollIds } }] } });
    await prisma.systemLogArchive.deleteMany({ where: { id: { in: k.arsivIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: k.rollIds } } });
    await prisma.item.delete({ where: { id: k.itemId } });
  } catch (e) {
    fail++;
    console.error("❌ TEMİZLİK HATASI — kalıntı kaldı:", String((e as Error).message ?? e).split("\n").map((l) => l.trim()).filter(Boolean).pop());
  }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
