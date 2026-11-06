// test_gelen_belge_cok_parti §11–§13 (çok blok, 2026-11-06): parti kimliği (işlem + gönderen İE no) · PER_PARTY kısmi
// başarısızlıkta belge yarım kalmaz (açılan İE yeni token'la yeniden açılmaz) · gönderen İE no künyede ve aramada. Dosya boyu tavanı.
import { randomUUID } from "crypto";
import prisma from "../../src/lib/prisma";
import { stationWorkSearchWhere } from "../../src/services/helpers/workorder-doc-search.helper";

type Check = (label: string, ok: boolean, extra?: string) => void;
type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };
interface Ctx {
  check: Check;
  tag: string;
  mkNote: () => Promise<string>;
  parties: (id: string) => Promise<Resp>;
  formWo: (id: string, body: unknown) => Promise<Resp>;
  body: (n: number, extra?: Record<string, unknown>) => Record<string, unknown>;
}
type WoOut = { workOrderId: string; workOrderNo: string; existing?: boolean; blockNos: number[] };

export async function cokBlokKismi(c: Ctx): Promise<void> {
  console.log("§11 parti kimliği: işlem + gönderen İE no");
  const n11 = await c.mkNote();
  const sender = `${c.tag.slice(-6)}-24749`.toUpperCase();
  const decl = await prisma.customerDeliveryNote.findUnique({ where: { id: n11 }, select: { totalsDeclared: true } });
  const blocks = ((decl?.totalsDeclared as { blocks?: Array<Record<string, unknown>> } | null)?.blocks ?? []).map((b) =>
    (b.blockNo === 1 ? { ...b, processText: "KDK APRE", senderWorkOrderNo: sender } : b));
  await prisma.customerDeliveryNote.update({ where: { id: n11 }, data: { totalsDeclared: { blocks } as never } });
  // Eski taslak: blok 2'nin beyanında işlem yok → satırların tek işlem yazısından
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: n11, blockNo: 2 }, data: { processText: "YUMUŞAK APRE" } });
  const p11 = await c.parties(n11);
  const ps = (p11.data?.parties ?? []) as Array<{ blockNo: number; processText: string | null; senderWorkOrderNo: string | null }>;
  c.check("§11 onaysız belgede parti İE listesi boş", ps.every((p) => Array.isArray((p as { workOrders?: unknown[] }).workOrders) && (p as { workOrders: unknown[] }).workOrders.length === 0), JSON.stringify(ps));
  c.check("§11 ⭐ /partiler: blok 1 işlem + gönderen İE no beyandan, blok 2 işlem satırlardan (eski taslak), İE no yok → null",
    p11.status === 200 && ps[0]?.processText === "KDK APRE" && ps[0]?.senderWorkOrderNo === sender && ps[1]?.processText === "YUMUŞAK APRE" && ps[1]?.senderWorkOrderNo === null,
    JSON.stringify(ps));

  console.log("§12 PER_PARTY kısmi başarısızlık");
  const bad = { sequence: 1, plannedMachineId: randomUUID() };
  const parts = (planBad: boolean) => [
    { blockNo: 1, batchNo: `${c.tag}-K1`, meters: 330 },
    { blockNo: 2, batchNo: `${c.tag}-K2`, meters: 410, ...(planBad ? { stepPlanning: [bad] } : {}) },
  ];
  const b12 = c.body(12, { mode: "PER_PARTY", parties: parts(true) });
  const r12 = await c.formWo(n11, b12);
  const wos12 = (r12.data?.workOrders ?? []) as WoOut[];
  const failed12 = (r12.data?.failed ?? []) as Array<{ blockNo: number; code: string | null; message: string }>;
  c.check("§12 ⭐ parti 2'nin makinesi geçersiz → 201, 1 İE (parti 1) + failed[parti 2] + uyarı; belge onaylı",
    r12.status === 201 && wos12.length === 1 && wos12[0]!.blockNos[0] === 1 && failed12.length === 1 && failed12[0]!.blockNo === 2 && !!failed12[0]!.message
      && (r12.warnings ?? []).some((w) => w.includes("2. parti")) && (await prisma.customerDeliveryNote.findUnique({ where: { id: n11 }, select: { status: true } }))?.status === "APPROVED",
    `${r12.status} ${r12.code ?? ""} ${JSON.stringify({ wos12, failed12, w: r12.warnings })}`);
  const count = () => prisma.workOrder.count({ where: { batches: { some: { batchNumber: { in: [`${c.tag}-K1`, `${c.tag}-K2`] } } } } });
  const before = await count();
  const r12b = await c.formWo(n11, b12);
  c.check("§12 ⭐ aynı token replay: aynı yanıt (İE + failed), yeni İE yok",
    r12b.status === 201 && JSON.stringify(r12b.data?.workOrders) === JSON.stringify(r12.data?.workOrders) && JSON.stringify(r12b.data?.failed) === JSON.stringify(r12.data?.failed) && (await count()) === before,
    `${r12b.status} ${JSON.stringify({ a: r12.data?.workOrders, b: r12b.data?.workOrders })}`);
  const r12c = await c.formWo(n11, c.body(12, { mode: "PER_PARTY", parties: parts(false) }));
  const wos12c = (r12c.data?.workOrders ?? []) as WoOut[];
  c.check("§12 ⭐ düzeltip YENİ token: parti 1'in İE'si yeniden açılmaz (existing), parti 2 açılır; toplam 2 İE",
    r12c.status === 201 && wos12c.length === 2 && wos12c[0]!.existing === true && wos12c[0]!.workOrderId === wos12[0]!.workOrderId && !wos12c[1]!.existing
      && wos12c[1]!.workOrderId !== wos12[0]!.workOrderId && ((r12c.data?.failed ?? []) as unknown[]).length === 0 && (await count()) === before + 1,
    `${r12c.status} ${r12c.code ?? ""} ${JSON.stringify({ wos12c, f: r12c.data?.failed })}`);
  const p12 = ((await c.parties(n11)).data?.parties ?? []) as Array<{ blockNo: number; workOrders: Array<{ id: string; workOrderNumber: string }> }>;
  c.check("§12 ⭐ /partiler parti başına bağlı İE (özet satırı → top → İE zincirinden)",
    p12.length === 2 && p12[0]!.workOrders.map((w) => w.id).join() === wos12c[0]?.workOrderId && p12[1]!.workOrders.map((w) => w.id).join() === wos12c[1]?.workOrderId,
    JSON.stringify(p12.map((p) => p.workOrders)));

  console.log("§13 gönderen İE no künyede + aramada");
  const wo1 = await prisma.workOrder.findUnique({ where: { id: wos12[0]?.workOrderId ?? "00000000-0000-0000-0000-000000000000" }, select: { id: true, parameters: true } });
  const wo2 = await prisma.workOrder.findUnique({ where: { id: wos12c[1]?.workOrderId ?? "00000000-0000-0000-0000-000000000000" }, select: { parameters: true } });
  c.check("§13 ⭐ parti 1 İE'si parameters.senderWorkOrderNo = belgedeki İE no; parti 2 (İE no okunmamış) yazılmaz",
    (wo1?.parameters as { senderWorkOrderNo?: string } | null)?.senderWorkOrderNo === sender && !(wo2?.parameters as { senderWorkOrderNo?: string } | null)?.senderWorkOrderNo,
    JSON.stringify({ p1: wo1?.parameters, p2: wo2?.parameters }));
  const where = stationWorkSearchWhere(sender.toLowerCase());
  const hits = where ? await prisma.workOrder.findMany({ where, select: { id: true } }) : [];
  c.check("§13 ⭐ istasyon/İE araması gönderen İE no ile bulur (küçük harfle yazılsa da)", hits.some((h) => h.id === wo1?.id), JSON.stringify(hits));
}
