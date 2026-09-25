// =============================================================================
// BEKÇİ — iş emri hareket defteri GEÇMİŞ DOLDURMA türetme kuralları (D7, DB'siz)
// Çalıştır: npx tsx scripts/test_backfill_workorder_events.ts
// =============================================================================
// `scripts/lib/workorder-backfill-derive.ts` SAF fonksiyonunu sentetik iş emri + audit ile ölçer:
//   §1 açılış kolonlardan (tetik WO_CREATE; bölmeden doğan WO_SPLIT_CLONE), payload `backfill:true`
//   §2 renk/en audit'in oldData → newData'sından, sebep satırda; fason kabul eni ayrı tetik
//   §3 değiştir-yaz zinciri: açılış audit'inden tohumlanan durumla fark; ikinci değiştir-yaz ilerlemiş duruma göre
//   §3b açılış audit'i yoksa ilk değiştir-yaz durumu tohumlar
//   §3c renk olayı durumu ilerletir (sonraki değiştir-yaz aynı rengi fark saymaz)
//   §4 tip değişimi `changes` dizisinden (sipariş bağı)
//   §5 elle kapanış: durum satırı + künye o anla; yaklaşık tamamlanma YAZILMAZ
//   §6 otomatik tamamlanma YAKLAŞIK (son adım bitişi), künye başlangıcı ilk adım başlangıcı
//   §7 iptal kolonlardan; önceki statü iptal audit'inin oldData'sından; ops-sql → OPS_SQL
//   §8 CREATED'lı iş emri hiç türetilmez (ikinci koşum 0)
//   §9 canlı defterin ilk satırından sonrası yazılmaz; canlı COMPLETED satırı varsa yaklaşık satır yok
//   §10 adım bitişi olmayan tamamlanmış iş emri: künye yok, kayıp listede
// NEGATİF SONDA (elle, 2026-09-25): alan yazıcısının durum ilerletmesi kaldırılınca §3c kırmızı;
// değiştir-yaz tohumlaması kaldırılınca §3b kırmızı; epoch süzgeci kaldırılınca §9 kırmızı.
// Yedek kopyadan geri alındı.
// =============================================================================

import { deriveWorkOrder, type BackfillAudit, type BackfillExisting, type BackfillWo } from "./lib/workorder-backfill-derive";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const T = (h: number) => new Date(Date.UTC(2026, 7, 10, h, 0, 0));
const NONE: BackfillExisting = { hasCreated: false, firstEventAt: null, hasCompletedEvent: false, snapshotCount: 0 };
function wo(over: Partial<BackfillWo> = {}): BackfillWo {
  return {
    id: "w1", workOrderNumber: "IE-1", status: "IN_PROGRESS", type: "STOCK_PRODUCTION", createdAt: T(1), createdById: "u1",
    cancelledAt: null, cancelledById: null, cancelReason: null, routeTemplateId: "r1", targetItemId: "i1", targetColorId: "c1",
    steps: [{ startedAt: T(2), completedAt: T(5) }, { startedAt: T(6), completedAt: T(8) }], ...over,
  };
}
const a = (h: number, action: string, newData: unknown, oldData: unknown = null, changes: unknown = null): BackfillAudit =>
  ({ action, newData, oldData, changes, userId: "u2", deviceId: null, createdAt: T(h) });
const CREATE = a(1, "CREATE", { type: "STOCK_PRODUCTION", routeTemplateId: "r1", targetItemId: "i1", targetColorId: "c1", width: 180 });
const fields = (d: ReturnType<typeof deriveWorkOrder>) => d.events.filter((e) => e.kind === "FIELD_CHANGED").map((e) => `${e.trigger}:${e.field}:${e.from}>${e.to}`);
const statuses = (d: ReturnType<typeof deriveWorkOrder>) => d.events.filter((e) => e.kind === "STATUS_CHANGED").map((e) => `${e.trigger}:${e.from}>${e.to}`);

console.log("=== İş emri geçmiş doldurma — türetme ===");
{
  const d = deriveWorkOrder(wo(), [CREATE], NONE);
  const c = d.events.find((e) => e.kind === "CREATED");
  check("§1 açılış kolonlardan: an createdAt, aktör createdById, tetik WO_CREATE, payload backfill",
    c?.at.getTime() === T(1).getTime() && c.userId === "u1" && c.trigger === "WO_CREATE" && (c.payload as { backfill?: boolean }).backfill === true);
  const s = deriveWorkOrder(wo(), [CREATE, a(1, "CREATE", { event: "SPLIT_TARGET" })], NONE);
  check("§1b bölmeden doğan iş emri WO_SPLIT_CLONE", s.events[0]?.trigger === "WO_SPLIT_CLONE");
}
{
  const d = deriveWorkOrder(wo(), [
    CREATE,
    a(3, "UPDATE", { event: "TARGET_COLOR_CHANGED", targetColorId: "c2", reason: "müşteri" }, { targetColorId: "c1" }),
    a(4, "UPDATE", { event: "TARGET_WIDTH_CHANGED", width: 175, source: "FASON_RECEIPT", reason: "ölçüldü" }, { width: 180 }),
  ], NONE);
  const renk = d.events.find((e) => e.field === "targetColorId");
  check("§2 renk/en oldData → newData, sebep satırda, fason kabul eni ayrı tetik",
    fields(d).join(",") === "COLOR_CHANGE:targetColorId:c1>c2,FASON_RECEIPT_WIDTH:width:180>175" && renk?.reason === "müşteri", fields(d).join(","));
}
{
  const d = deriveWorkOrder(wo(), [
    CREATE,
    a(3, "UPDATE", { replace: true, type: "ORDER_PRODUCTION", routeTemplateId: null, targetItemId: "i1", targetColorId: "c3" }),
    a(4, "UPDATE", { replace: true, type: "ORDER_PRODUCTION", routeTemplateId: null, targetItemId: "i1", targetColorId: "c1" }),
  ], NONE);
  check("§3 değiştir-yaz: ilk kayıt açılışa göre üç fark, ikinci kayıt ilerlemiş duruma göre tek fark",
    // Sıra alan kataloğunun sırası (`WORK_ORDER_TRACKED_FIELDS`), audit anahtar sırası değil.
    fields(d).join(",") === "WO_REPLACE:targetColorId:c1>c3,WO_REPLACE:routeTemplateId:r1>null,WO_REPLACE:type:STOCK_PRODUCTION>ORDER_PRODUCTION,WO_REPLACE:targetColorId:c3>c1",
    fields(d).join(","));
}
{
  const d = deriveWorkOrder(wo(), [
    a(3, "UPDATE", { replace: true, type: "STOCK_PRODUCTION", targetColorId: "c3" }),
    a(4, "UPDATE", { replace: true, type: "STOCK_PRODUCTION", targetColorId: "c4" }),
  ], NONE);
  check("§3b açılış audit'i yoksa ilk değiştir-yaz durumu TOHUMLAR (fark yok), ikincisi fark verir; kayıp beyanı",
    fields(d).join(",") === "WO_REPLACE:targetColorId:c3>c4" && d.losses.some((l) => l.includes("açılış audit")), fields(d).join(","));
}
{
  const d = deriveWorkOrder(wo(), [
    CREATE,
    a(3, "UPDATE", { event: "TARGET_COLOR_CHANGED", targetColorId: "c2" }, { targetColorId: "c1" }),
    a(4, "UPDATE", { replace: true, type: "STOCK_PRODUCTION", routeTemplateId: "r1", targetItemId: "i1", targetColorId: "c2" }),
  ], NONE);
  check("§3c renk olayı durumu ilerletir: aynı rengi taşıyan değiştir-yaz fark üretmez",
    fields(d).join(",") === "COLOR_CHANGE:targetColorId:c1>c2", fields(d).join(","));
}
{
  const d = deriveWorkOrder(wo(), [CREATE, a(3, "UPDATE", { event: "ORDER_LINK_ADDED", typeChanged: true }, null, [{ field: "type", old: "STOCK_PRODUCTION", new: "ORDER_PRODUCTION" }])], NONE);
  check("§4 tip changes dizisinden, tetik ORDER_LINK", fields(d).join(",") === "ORDER_LINK:type:STOCK_PRODUCTION>ORDER_PRODUCTION", fields(d).join(","));
}
{
  const d = deriveWorkOrder(wo({ status: "COMPLETED" }), [CREATE, a(9, "UPDATE", { status: "COMPLETED", manualComplete: true, reason: "kalan dağıtıldı" }, { status: "IN_PROGRESS" })], NONE);
  check("§5 elle kapanış satırı + künye o anla; yaklaşık satır yok",
    statuses(d).join(",") === "MANUAL_COMPLETE:IN_PROGRESS>COMPLETED" && d.snapshot?.closedAt.getTime() === T(9).getTime(), statuses(d).join(","));
}
{
  const d = deriveWorkOrder(wo({ status: "COMPLETED" }), [CREATE], NONE);
  check("§6 yaklaşık tamamlanma son adım bitişinde; künye başlangıcı ilk adım başlangıcı",
    statuses(d).join(",") === "APPROX_LAST_STEP:IN_PROGRESS>COMPLETED" && d.snapshot?.closedAt.getTime() === T(8).getTime()
      && d.snapshot.startedAt.getTime() === T(2).getTime(), statuses(d).join(","));
}
{
  const d = deriveWorkOrder(wo({ status: "CANCELLED", cancelledAt: T(7), cancelledById: "u9", cancelReason: "yanlış" }),
    [CREATE, a(7, "DELETE", { status: "CANCELLED" }, { status: "PLANNED" })], NONE);
  const iptal = d.events.find((e) => e.to === "CANCELLED");
  const ops = deriveWorkOrder(wo({ status: "CANCELLED", cancelledAt: null }), [CREATE, a(7, "UPDATE", { status: "CANCELLED", via: "ops-sql (test)" })], NONE);
  check("§7 iptal kolonlardan (an · aktör · sebep), önceki statü audit'ten; ops-sql → OPS_SQL",
    statuses(d).join(",") === "WO_CANCEL:PLANNED>CANCELLED" && iptal?.userId === "u9" && iptal.reason === "yanlış"
      && statuses(ops).join(",") === "OPS_SQL:IN_PROGRESS>CANCELLED", `${statuses(d)} · ${statuses(ops)}`);
}
{
  const d = deriveWorkOrder(wo({ status: "COMPLETED" }), [CREATE], { ...NONE, hasCreated: true });
  check("§8 CREATED'lı iş emri türetilmez", d.events.length === 0 && d.snapshot === null);
}
{
  const d = deriveWorkOrder(wo({ status: "COMPLETED" }), [CREATE, a(3, "UPDATE", { event: "TARGET_COLOR_CHANGED", targetColorId: "c2" }, { targetColorId: "c1" })],
    { hasCreated: false, firstEventAt: T(3), hasCompletedEvent: true, snapshotCount: 0 });
  check("§9 canlı ilk satırdan sonrası yazılmaz; canlı COMPLETED varken yaklaşık satır yok, künye de yok (kapanış canlı sonrası)",
    d.events.every((e) => e.at.getTime() < T(3).getTime()) && fields(d).length === 0 && statuses(d).length === 0 && d.snapshot === null,
    `${d.events.map((e) => e.kind).join(",")}`);
}
{
  const d = deriveWorkOrder(wo({ status: "COMPLETED", steps: [{ startedAt: null, completedAt: null }] }), [CREATE], NONE);
  check("§10 adım bitişi yok: künye yok, kayıp listede", d.snapshot === null && d.losses.some((l) => l.includes("tamamlanma anı yok")), d.losses.join("; "));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
