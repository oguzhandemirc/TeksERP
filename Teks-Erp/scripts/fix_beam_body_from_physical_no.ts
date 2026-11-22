// =============================================================================
// ONARIM — Fiziksel levent no'su yazılı ama gövde bağı olmayan eski sarımları gövdeye bağla (devere ek B3 artığı)
// Çalıştır: npx tsx scripts/fix_beam_body_from_physical_no.ts                          (TEŞHİS — hiçbir şey yazmaz)
//           npx tsx scripts/fix_beam_body_from_physical_no.ts --apply --onay=<N> [--sec=<levent no|id>,...]
// =============================================================================
// Gövde kartı (BeamBody, B1) doğmadan önce sarımın metal gövdesi yalnız serbest metin `WarpBeam.physicalBeamNo`da
// duruyordu. Gövde kartı sonradan aynı numarayla açılınca bağ (`WarpBeam.beamBodyId`, doğum niteliği) boş kalır.
//
// EŞLEŞME: `physicalBeamNo` (kırpılmış) = `BeamBody.bodyNo`, büyük/küçük harf duyarsız (kayıt kapısıyla aynı yüklem);
// `devere.bodyNoLooseMatch` açıksa birebir yoksa normalize eşleşme — TEK boğaz `helpers/beam-body-no.helper.ts` (S3).
// HÜKÜM (sarımın bugünkü durumuna göre; gövde yalnız sarım kancasının kuralıyla yürür — `WARP_EVENT_BODY_RULES`):
//   GEÇMİŞ   EXHAUSTED · SCRAPPED  → yalnız bağ yazılır; gövde durumu/defteri DEĞİŞMEZ (sarım çoktan boşaldı).
//   DOLDUR   READY                 → bağ + gövde FILLED (boş → "dolu, bizde", üstündeki sarım bu).
//   TAK      MOUNTED               → bağ + FILLED + MOUNTED (gövde sarımın tezgâhına).
//   Gövde kancası bu sarımın sonraki olaylarını (takma/söküm/bitiş/iptal) aynı kurallarla yürütür; FILLED ve
//   MOUNTED'ın ters mekanizması kancanın tersidir (WOUND_CANCEL / MOUNT_CANCEL) — betik ayrı ters yazmaz.
// ATLANIR ve RAPORLANIR (YAZILMAZ, elle karar):
//   EŞLEŞMESİZ  numaraya ait gövde yok · ÇOK-GÖVDE  birden çok gövde (harf farkı) · SAHİP  müşteri gövdesi ama
//   sarımın sahibi başka (emanet sahipliği doğum niteliği, değiştirilmez) · MEŞGUL  canlı sarım için gövde boş/aktif
//   değil ya da başka sarım taşıyor · ÇOK-SARIM  aynı gövdeye birden çok canlı sarım · DIŞARIDA  SHIPPED_OUT ·
//   SHIPPED_TO_OWNER · REJECTED (gövdenin dışarıdaki yeri bilinmez) · Planlı/iptal sarım aday değildir.
// YAZIM — tek tx; sarım claim'i `updateMany WHERE {id, beamBodyId: NULL, status}` (+ MOUNTED'da tezgâh), gövde geçişi
// `transitionBeamBodyTx` (atomik claim, 409). Biri tutmazsa tx geri alınır, HİÇBİR ŞEY yazılmaz (veri değişti).
// Defter satırı silinmez/değişmez; yeni gövde olayları bugüne yazılır, sebep metni betiği adlar. Audit tx DIŞINDA.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus, WarpBeamStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { BEAM_BODY_EVENT_TABLE, transitionBeamBodyTx } from "../src/services/helpers/beam-body.helper";
import { matchBeamBodyNo } from "../src/services/helpers/beam-body-no.helper";
import { readDevereBodyNoLooseMatch } from "../src/services/system-setting/devere-body";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const SOURCE = "scripts/fix_beam_body_from_physical_no.ts";
const EVENT = "BEAM_BODY_LINK_BACKFILL";
const REASON = "Eski kayıt: fiziksel levent no'sundan gövde bağı (onarım betiği)";

export type LinkMode = "HISTORY" | "FILL" | "FILL_MOUNT";
export type SkipReason = "NO_MATCH" | "MULTI_BODY" | "OWNER" | "BUSY" | "MULTI_LIVE" | "OUTSIDE";

export interface LinkProposal {
  beamId: string;
  beamNo: string;
  physicalBeamNo: string;
  beamStatus: WarpBeamStatus;
  bodyId: string;
  bodyNo: string;
  /** Canlı bağda gövdenin şu anki (beklenen) durumu; GEÇMİŞ'te null. */
  bodyFrom: BeamBodyStatus | null;
  machineId: string | null;
  mode: LinkMode;
}
export interface LinkSkip {
  beamId: string;
  beamNo: string;
  physicalBeamNo: string;
  beamStatus: WarpBeamStatus;
  reason: SkipReason;
  detail: string;
}
export interface Diagnosis {
  proposals: LinkProposal[];
  skipped: LinkSkip[];
}

const HISTORY_STATUSES: readonly WarpBeamStatus[] = [WarpBeamStatus.EXHAUSTED, WarpBeamStatus.SCRAPPED];
const OUTSIDE_STATUSES: readonly WarpBeamStatus[] = [WarpBeamStatus.SHIPPED_OUT, WarpBeamStatus.SHIPPED_TO_OWNER, WarpBeamStatus.REJECTED];
const LIVE_MODE: Partial<Record<WarpBeamStatus, LinkMode>> = { [WarpBeamStatus.READY]: "FILL", [WarpBeamStatus.MOUNTED]: "FILL_MOUNT" };
/** FILLED kuralının kaynak durumları (`WARP_EVENT_BODY_RULES.WOUND.from`) — boş gövde, bizde ya da deverecide. */
const FILLABLE: readonly BeamBodyStatus[] = [BeamBodyStatus.EMPTY_STOCK, BeamBodyStatus.AT_SUBCONTRACTOR];

/** Yalnız okur. `onlyBeamIds` verilirse aday kümesi o sarımlarla sınırlanır (bekçi ve `--sec`). */
export async function diagnose(opts: { onlyBeamIds?: string[] } = {}): Promise<Diagnosis> {
  const beams = await prisma.warpBeam.findMany({
    where: {
      beamBodyId: null,
      physicalBeamNo: { not: null },
      status: { notIn: [WarpBeamStatus.PLANNED, WarpBeamStatus.CANCELLED] },
      ...(opts.onlyBeamIds ? { id: { in: opts.onlyBeamIds } } : {}),
    },
    select: { id: true, beamNo: true, physicalBeamNo: true, status: true, ownerCustomerId: true, currentMachineId: true },
    orderBy: { beamNo: "asc" },
  });
  const out: Diagnosis = { proposals: [], skipped: [] };
  const loose = await readDevereBodyNoLooseMatch();
  const live = new Map<string, LinkProposal[]>();
  const bodyCache = new Map<string, Array<{ id: string; bodyNo: string; status: BeamBodyStatus; isActive: boolean; ownerRole: BeamBodyOwnerRole | null; ownerCustomerId: string | null; currentWarpBeamId: string | null }>>();
  for (const b of beams) {
    const no = b.physicalBeamNo!.trim();
    if (!no) continue;
    const base = { beamId: b.id, beamNo: b.beamNo, physicalBeamNo: no, beamStatus: b.status };
    const skip = (reason: SkipReason, detail: string) => out.skipped.push({ ...base, reason, detail });
    if (OUTSIDE_STATUSES.includes(b.status)) { skip("OUTSIDE", `sarım ${b.status} — gövdenin dışarıdaki yeri bilinmez`); continue; }
    const key = no.toLowerCase();
    let bodies = bodyCache.get(key);
    if (!bodies) {
      const match = await matchBeamBodyNo(prisma, no, { loose });
      bodies = await prisma.beamBody.findMany({
        where: { id: { in: match.ids } },
        select: { id: true, bodyNo: true, status: true, isActive: true, ownerRole: true, ownerCustomerId: true, currentWarpBeamId: true },
        orderBy: { bodyNo: "asc" },
      });
      bodyCache.set(key, bodies);
    }
    if (bodies.length === 0) { skip("NO_MATCH", "bu numarada gövde kartı yok"); continue; }
    if (bodies.length > 1) { skip("MULTI_BODY", `birden çok gövde: ${bodies.map((x) => x.bodyNo).join(", ")}`); continue; }
    const body = bodies[0]!;
    if (body.ownerRole === BeamBodyOwnerRole.CUSTOMER && body.ownerCustomerId !== b.ownerCustomerId) {
      skip("OWNER", `${body.bodyNo} müşteri gövdesi, sarımın sahibi farklı`);
      continue;
    }
    const proposal: LinkProposal = { ...base, bodyId: body.id, bodyNo: body.bodyNo, bodyFrom: null, machineId: null, mode: "HISTORY" };
    if (HISTORY_STATUSES.includes(b.status)) { out.proposals.push(proposal); continue; }
    const mode = LIVE_MODE[b.status];
    if (!mode) { skip("OUTSIDE", `sarım ${b.status}`); continue; }
    if (!body.isActive || body.currentWarpBeamId !== null || !FILLABLE.includes(body.status)) {
      skip("BUSY", `${body.bodyNo} şu an ${body.status}${body.isActive ? "" : " (pasif)"}${body.currentWarpBeamId ? " ve başka sarım taşıyor" : ""}`);
      continue;
    }
    if (mode === "FILL_MOUNT" && !b.currentMachineId) { skip("BUSY", "takılı sarımın tezgâhı yok"); continue; }
    const p = { ...proposal, mode, bodyFrom: body.status, machineId: mode === "FILL_MOUNT" ? b.currentMachineId : null };
    live.set(body.id, [...(live.get(body.id) ?? []), p]);
  }
  // `warp_beams_physical_live_uq` aynı no'lu iki canlı sarımı tr_fold ile reddeder; bu sed yalnız katlama farkı içindir.
  for (const group of live.values()) {
    if (group.length === 1) { out.proposals.push(group[0]!); continue; }
    for (const p of group) {
      out.skipped.push({ beamId: p.beamId, beamNo: p.beamNo, physicalBeamNo: p.physicalBeamNo, beamStatus: p.beamStatus, reason: "MULTI_LIVE", detail: `${p.bodyNo} gövdesine ${group.length} canlı sarım: ${group.map((g) => g.beamNo).join(", ")}` });
    }
  }
  out.proposals.sort((a, b) => a.beamNo.localeCompare(b.beamNo));
  return out;
}

/** Tek tx; claim tutmazsa ya da gövde beklenen durumda değilse hiçbir şey yazılmaz. Döner: yazılan gövde olayları. */
export async function applyProposals(proposals: LinkProposal[]): Promise<Array<{ beamId: string; eventIds: string[] }>> {
  if (proposals.length === 0) return [];
  const written = await prisma.$transaction(async (tx) => {
    const rows: Array<{ beamId: string; eventIds: string[] }> = [];
    // Kilit sırası sarım → gövde (kanca ile aynı): önce sarım claim'i, sonra gövde geçişi.
    for (const p of proposals) {
      const claim = await tx.warpBeam.updateMany({
        where: { id: p.beamId, beamBodyId: null, status: p.beamStatus, ...(p.mode === "FILL_MOUNT" ? { currentMachineId: p.machineId } : {}) },
        data: { beamBodyId: p.bodyId },
      });
      if (claim.count !== 1) throw new Error(`Veri değişti: ${p.beamNo} artık ${p.beamStatus}/bağsız değil — liste yeniden okunmalı, hiçbir şey yazılmadı`);
      const eventIds: string[] = [];
      if (p.mode !== "HISTORY") {
        const filled = await transitionBeamBodyTx(tx, {
          bodyId: p.bodyId, kind: "FILLED", from: p.bodyFrom!, to: BeamBodyStatus.FULL_STOCK,
          place: { warehouseId: null, subcontractorId: null, machineId: null }, warpBeamId: p.beamId, reason: REASON, userId: null,
        });
        eventIds.push(filled.id);
        if (p.mode === "FILL_MOUNT") {
          const mounted = await transitionBeamBodyTx(tx, {
            bodyId: p.bodyId, kind: "MOUNTED", from: BeamBodyStatus.FULL_STOCK, to: BeamBodyStatus.MOUNTED,
            place: { warehouseId: null, subcontractorId: null, machineId: p.machineId }, warpBeamId: p.beamId, reason: REASON, userId: null,
          });
          eventIds.push(mounted.id);
        }
      }
      rows.push({ beamId: p.beamId, eventIds });
    }
    return rows;
  }, { timeout: 120_000 });
  const byBeam = new Map(proposals.map((p) => [p.beamId, p]));
  await AuditService.logMany(written.flatMap((w) => {
    const p = byBeam.get(w.beamId)!;
    return [
      { userId: undefined, action: "UPDATE" as const, tableName: "WARP_BEAM", recordId: p.beamId, oldData: { beamBodyId: null }, newData: { beamBodyId: p.bodyId, bodyNo: p.bodyNo, physicalBeamNo: p.physicalBeamNo, mode: p.mode, event: EVENT, source: SOURCE } },
      ...w.eventIds.map((id) => ({ userId: undefined, action: "CREATE" as const, tableName: BEAM_BODY_EVENT_TABLE, recordId: id, newData: { bodyId: p.bodyId, bodyNo: p.bodyNo, warpBeamId: p.beamId, event: EVENT, source: SOURCE } })),
    ];
  }));
  return written;
}

const MODE_TEXT: Record<LinkMode, string> = { HISTORY: "GEÇMİŞ  (yalnız bağ)", FILL: "DOLDUR  (bağ + FILLED)", FILL_MOUNT: "TAK     (bağ + FILLED + MOUNTED)" };
const SKIP_TEXT: Record<SkipReason, string> = { NO_MATCH: "EŞLEŞMESİZ", MULTI_BODY: "ÇOK-GÖVDE ", OWNER: "SAHİP     ", BUSY: "MEŞGUL    ", MULTI_LIVE: "ÇOK-SARIM ", OUTSIDE: "DIŞARIDA  " };

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  // Yazan yol hangi veritabanını vurduğunu çıktıda söyler (test_script_guards §11).
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  const d = await diagnose();
  console.log(`=== Gövde bağı onarımı — ${d.proposals.length} aday, ${d.skipped.length} atlandı ===`);
  for (const p of d.proposals) console.log(`  ADAY  ${MODE_TEXT[p.mode]}  ${p.beamNo}  (${p.beamStatus})  "${p.physicalBeamNo}" → ${p.bodyNo}${p.bodyFrom ? `  gövde ${p.bodyFrom}` : ""}`);
  for (const s of d.skipped) console.log(`  ATLA  ${SKIP_TEXT[s.reason]}  ${s.beamNo}  (${s.beamStatus})  "${s.physicalBeamNo}" — ${s.detail}`);
  const sec = arg("sec")?.split(",").map((s) => s.trim()).filter(Boolean);
  let target = d.proposals;
  if (sec) {
    const unknown = sec.filter((s) => !d.proposals.some((p) => p.beamId === s || p.beamNo === s));
    if (unknown.length) { console.log(`\n⛔ --sec içinde aday listesinde olmayan kayıt: ${unknown.join(", ")} — hiçbir şey yazılmadı.`); process.exitCode = 1; return; }
    target = d.proposals.filter((p) => sec.includes(p.beamId) || sec.includes(p.beamNo));
  }
  if (!apply) {
    if (target.length) console.log(`\n  → Yazmak için: npx tsx ${SOURCE} --apply --onay=${target.length}${sec ? ` --sec=${sec.join(",")}` : ""}`);
    return;
  }
  if (Number(arg("onay")) !== target.length) {
    console.log(`\n⛔ --onay=${arg("onay") ?? "(yok)"} ama yazılacak kayıt ${target.length} — listeyi yeniden okuyun. Hiçbir şey yazılmadı.`);
    process.exitCode = 1;
    return;
  }
  const w = await applyProposals(target);
  console.log(`\n✅ ${w.length} sarım gövdeye bağlandı, ${w.reduce((n, x) => n + x.eventIds.length, 0)} gövde olayı yazıldı (audit: ${EVENT}).`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end().catch(() => {}); });
}
