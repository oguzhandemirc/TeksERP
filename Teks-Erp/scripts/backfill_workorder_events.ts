// =============================================================================
// GEÇMİŞ DOLDURMA — iş emri hareket defteri (work_order_events) + yaklaşık kapanış künyesi (D7)
// =============================================================================
//   npx tsx scripts/backfill_workorder_events.ts                                  → KURU ANLATIM (varsayılan)
//   npx tsx scripts/backfill_workorder_events.ts --apply --onay=<N> --hedef=<db>  → gerçekten yazar
//   [--dokum=<yol>]  etkilenen HER iş emrinin CSV dökümü (varsayılan scripts/out/…csv; kuru koşumda da)
//
// NE: defter 20260926000000 migration'ıyla doğdu; ondan önceki iş emirlerinin geçmişi yok. Türetme
// kuralları `lib/workorder-backfill-derive.ts` (SAF, bekçili): kolonlardan açılış/iptal, audit'ten BİR
// KEZ renk · en · tip · değiştir-yaz · düzenle · arşiv · kilit · elle kapanış; tamamlanma ve künye
// YAKLAŞIK (son adım bitişi, S5 = A). Her satır `channel=BACKFILL` (ekranda "sonradan türetildi"),
// künye `closeKind=BACKFILL`. Kuralın beyanlı "bir kez aktaran göç" istisnası (lib/audit-okuma-beyan.ts).
//
// ⚠️ BEYANLI KAYIP: otomatik başlama, yeniden açılma ve aradaki tamamlanmalar hiçbir yerde yok;
// açılış audit'i olmayan (audit öncesi) iş emrinde değiştir-yaz farkı çıkarılamaz. Sayıları basılır.
//
// KAPI: `--apply` iki teyit ister — `--onay=<N>` (N = kuru koşumdaki satır toplamı: olay + künye) ve
// `--hedef=<db-adı>`. İdempotent: defterde CREATED satırı olan iş emri atlanır; canlı defterin ilk
// satırından sonraki türetmeler yazılmaz; ikinci koşum 0 yazar.
// =============================================================================
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Prisma, WorkOrderEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { WORK_ORDER_STATUS_LABEL, recordBackfillEventsTx, type BackfillEventRow } from "../src/services/helpers/workorder-event.helper";
import { labelChanges } from "../src/services/helpers/workorder-field-diff.helper";
import { freezeCloseSnapshotTx } from "../src/services/helpers/workorder-close-snapshot.helper";
import type { WorkOrderTrackedField } from "../src/constants/workorder-event-fields";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { deriveWorkOrder, type BackfillAudit, type BackfillExisting, type BackfillWo, type Derived, type DerivedEvent } from "./lib/workorder-backfill-derive";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";
const DOKUM = (argv.find((a) => a.startsWith("--dokum=")) ?? "").split("=")[1] ?? "";

async function loadWorkOrders(): Promise<BackfillWo[]> {
  return prisma.workOrder.findMany({
    select: {
      id: true, workOrderNumber: true, status: true, type: true, createdAt: true, createdById: true,
      cancelledAt: true, cancelledById: true, cancelReason: true, routeTemplateId: true, targetItemId: true, targetColorId: true,
      steps: { select: { startedAt: true, completedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function loadExisting(): Promise<Map<string, BackfillExisting>> {
  const out = new Map<string, BackfillExisting>();
  const get = (id: string) => out.get(id) ?? out.set(id, { hasCreated: false, firstEventAt: null, hasCompletedEvent: false, snapshotCount: 0 }).get(id)!;
  for (const g of await prisma.workOrderEvent.groupBy({ by: ["workOrderId"], _min: { createdAt: true } })) get(g.workOrderId).firstEventAt = g._min.createdAt;
  for (const e of await prisma.workOrderEvent.findMany({ where: { type: WorkOrderEventType.CREATED }, select: { workOrderId: true } })) get(e.workOrderId).hasCreated = true;
  for (const e of await prisma.workOrderEvent.findMany({ where: { type: WorkOrderEventType.STATUS_CHANGED, toValue: "COMPLETED" }, select: { workOrderId: true } })) {
    get(e.workOrderId).hasCompletedEvent = true;
  }
  for (const g of await prisma.workOrderCloseSnapshot.groupBy({ by: ["workOrderId"], _count: { _all: true } })) get(g.workOrderId).snapshotCount = g._count._all;
  return out;
}

/** Sıcak ∪ arşiv audit, iş emri başına zaman sıralı — göçün TEK okuması. */
async function loadAudits(): Promise<Map<string, BackfillAudit[]>> {
  const rows = await prisma.$queryRaw<(BackfillAudit & { recordId: string })[]>(Prisma.sql`
    SELECT "recordId", action, "oldData", "newData", changes, "userId"::text AS "userId", "deviceId", "createdAt"
      FROM system_logs WHERE "tableName" = 'WORK_ORDER'
    UNION ALL
    SELECT "recordId", action, "oldData", "newData", changes, "userId"::text AS "userId", "deviceId", "createdAt"
      FROM system_log_archives WHERE "tableName" = 'WORK_ORDER'
    ORDER BY "createdAt" ASC`);
  const out = new Map<string, BackfillAudit[]>();
  for (const r of rows) (out.get(r.recordId) ?? out.set(r.recordId, []).get(r.recordId)!).push(r);
  return out;
}

async function deriveAll() {
  const [wos, existing, audits] = [await loadWorkOrders(), await loadExisting(), await loadAudits()];
  const empty: BackfillExisting = { hasCreated: false, firstEventAt: null, hasCompletedEvent: false, snapshotCount: 0 };
  return wos.map((wo) => ({ wo, d: deriveWorkOrder(wo, audits.get(wo.id) ?? [], existing.get(wo.id) ?? empty) }));
}

/** Türetilen satırı deftere yazılacak biçime çevirir — kimlik alanlarının adı bugünkü ad (yaklaşık). */
async function toRows(tx: Prisma.TransactionClient, wo: BackfillWo, events: DerivedEvent[]): Promise<BackfillEventRow[]> {
  const groups = new Map<string, string>();
  const gid = (k: string) => groups.get(k) ?? groups.set(k, randomUUID()).get(k)!;
  const out: BackfillEventRow[] = [];
  for (const e of events) {
    const base = { workOrderId: wo.id, trigger: e.trigger, reason: e.reason ?? null, createdById: e.userId, deviceId: e.deviceId, groupId: gid(e.group), createdAt: e.at };
    if (e.kind === "CREATED") {
      out.push({ ...base, type: WorkOrderEventType.CREATED, toValue: e.to, toLabel: wo.workOrderNumber, payload: e.payload as Prisma.InputJsonValue });
    } else if (e.kind === "STATUS_CHANGED") {
      const lbl = (v: string | null | undefined) => (v ? WORK_ORDER_STATUS_LABEL[v as keyof typeof WORK_ORDER_STATUS_LABEL] ?? v : null);
      out.push({ ...base, type: WorkOrderEventType.STATUS_CHANGED, field: "status", fromValue: e.from, toValue: e.to, fromLabel: lbl(e.from), toLabel: lbl(e.to) });
    } else {
      const [c] = await labelChanges(tx, [{ field: e.field as WorkOrderTrackedField, from: e.from ?? null, to: e.to ?? null }]);
      out.push({ ...base, type: WorkOrderEventType.FIELD_CHANGED, field: c.field, fromValue: c.from, toValue: c.to, fromLabel: c.fromLabel, toLabel: c.toLabel });
    }
  }
  return out;
}

/** Tek iş emri, tek tx — CREATED varsa (başka koşum yazdıysa) atlanır; canlı defterin ilk satırından sonrası yazılmaz. */
async function applyOne(wo: BackfillWo, d: Derived): Promise<number> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.workOrderEvent.count({ where: { workOrderId: wo.id, type: WorkOrderEventType.CREATED } })) > 0) return 0;
    const first = await tx.workOrderEvent.findFirst({ where: { workOrderId: wo.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const limit = first?.createdAt.getTime() ?? Number.POSITIVE_INFINITY;
    let n = await recordBackfillEventsTx(tx, await toRows(tx, wo, d.events.filter((e) => e.at.getTime() < limit)));
    if (d.snapshot && (await tx.workOrderCloseSnapshot.count({ where: { workOrderId: wo.id } })) === 0) {
      await freezeCloseSnapshotTx(tx, wo.id, { closeKind: "BACKFILL", ctx: { trigger: "BACKFILL" }, closedAt: d.snapshot.closedAt, startedAt: d.snapshot.startedAt });
      n++;
    }
    return n;
  }, { timeout: 60_000 });
}

function summarize(list: { wo: BackfillWo; d: Derived }[]) {
  const touched = list.filter((x) => x.d.events.length > 0 || x.d.snapshot);
  const byKind = { CREATED: 0, STATUS_CHANGED: 0, FIELD_CHANGED: 0 };
  const byTrigger = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const x of list) {
    for (const e of x.d.events) {
      byKind[e.kind]++;
      byTrigger.set(e.trigger, (byTrigger.get(e.trigger) ?? 0) + 1);
    }
    for (const l of x.d.losses) losses.set(l, (losses.get(l) ?? 0) + 1);
  }
  const snapshots = touched.filter((x) => x.d.snapshot).length;
  const events = byKind.CREATED + byKind.STATUS_CHANGED + byKind.FIELD_CHANGED;
  return { touched, byKind, byTrigger, losses, snapshots, events, total: events + snapshots };
}

function writeDump(db: string, touched: { wo: BackfillWo; d: Derived }[]): string {
  const damga = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const yol = DOKUM ? resolve(DOKUM) : resolve(__dirname, "out", `backfill_workorder_events-${db}-${damga}.csv`);
  mkdirSync(dirname(yol), { recursive: true });
  const lines = ["workOrderId;workOrderNumber;status;olay;alan;tetik;an;kunye;kayip"];
  for (const { wo, d } of touched) {
    for (const e of d.events) lines.push([wo.id, wo.workOrderNumber, wo.status, e.kind, e.field ?? "", e.trigger, e.at.toISOString(), "", ""].join(";"));
    if (d.snapshot) lines.push([wo.id, wo.workOrderNumber, wo.status, "KUNYE", "", "BACKFILL", d.snapshot.closedAt.toISOString(), "yaklaşık", ""].join(";"));
    for (const l of d.losses) lines.push([wo.id, wo.workOrderNumber, wo.status, "KAYIP", "", "", "", "", l].join(";"));
  }
  writeFileSync(yol, lines.join("\n") + "\n");
  return yol;
}

function report(db: string, s: ReturnType<typeof summarize>, all: number): void {
  console.log(`Hedef: ${db} · ${all} iş emri tarandı`);
  for (const { wo, d } of s.touched) {
    const k = { C: 0, S: 0, F: 0 };
    for (const e of d.events) k[e.kind === "CREATED" ? "C" : e.kind === "STATUS_CHANGED" ? "S" : "F"]++;
    console.log(`  ${wo.workOrderNumber} · ${wo.status} · açılış ${k.C} · durum ${k.S} · alan ${k.F} · künye ${d.snapshot ? "yaklaşık" : "—"}${d.losses.length ? ` · kayıp: ${d.losses.join("; ")}` : ""}`);
  }
  console.log(`\nİş emri: ${s.touched.length} · olay: ${s.events} (açılış ${s.byKind.CREATED} · durum ${s.byKind.STATUS_CHANGED} · alan ${s.byKind.FIELD_CHANGED}) · yaklaşık künye: ${s.snapshots}`);
  console.log(`Tetiklere göre: ${[...s.byTrigger].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(" · ")}`);
  console.log(`BEYANLI KAYIP: ${[...s.losses].map(([l, n]) => `${l} ×${n}`).join(" · ") || "yok"}`);
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  const list = await deriveAll();
  const s = summarize(list);
  report(db, s, list.length);
  const yol = writeDump(db, s.touched);
  console.log(`Döküm: ${yol}`);
  if (!APPLY) {
    console.log(`\nKURU ANLATIM — hiçbir şey yazılmadı. Uygulamak için (kullanıcı onayıyla, HEDEF adı birebir; onay = olay + künye):\n  npx tsx scripts/backfill_workorder_events.ts --apply --onay=${s.total} --hedef=${db}`);
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== s.total) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${s.total} satır, --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }
  let written = 0;
  for (const { wo, d } of s.touched) written += await applyOne(wo, d);
  const kalan = summarize(await deriveAll()).total;
  console.log(`\n✅ ${written} satır yazıldı (olay ${s.events} · künye ${s.snapshots}). Yeniden koşumda yazılacak: ${kalan} (beklenen 0).`);
  const izOnce = AuditService.getHealth().failureCount;
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "WORK_ORDER_EVENTS_BACKFILL",
    tableName: "WORK_ORDER",
    payload: { source: "scripts/backfill_workorder_events.ts", veritabani: db, yazilan: written, isEmri: s.touched.length, olay: s.events, kunye: s.snapshots, dokum: yol },
  });
  if (AuditService.getHealth().failureCount !== izOnce) {
    console.error(`\n⚠️  AUDIT SATIRI YAZILAMADI — dökümü (${yol}) ve bu çıktıyı göçün izi olarak saklayın.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
