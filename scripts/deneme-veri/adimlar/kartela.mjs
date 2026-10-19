// Kartela dolgusu (dolgu-2): yeni sezon kartelası. Zincir gerçek akışla: KK1 topu → iş emri (Kurşun+KK2 → Tambur) → tamburda
// her toptan 4,5 m kartela parçası kesilir → parçalar kartela firmasına sevk → biri kabul (kartelalar SW- olarak doğar, stoka
// girer) · diğeri firmada bekler (tablet "Kartela Kabul" iş listesi dolsun). Ana parçalar mamul depoda kalır.
// KK1 gövdesi saat taşımaz (sunucu "şimdi" yazar) ⇒ çapa ne olursa olsun replay tutar. Geçişler canlı durumdan karar verir.
import { katSec } from "./kalite.mjs";

/** [anahtar, kumaş, metre, en, kartela adedi (kabulde)] */
export const KARTELA_TOPLARI = [
  ["KR1", "SATEN DÖŞEMELİK 140", 88.4, 140, 36],
  ["KR2", "JAKARLI DÖŞEMELİK 140", 76.2, 140, 0], // firmada bekler
];
const PARCA_M = 4.5;

export async function kartela(c) {
  const k = c.kayit;
  const ist = (await c.hepsi("/api/stations")).filter((s) => s.isActive !== false);
  const tur = (kind) => ist.filter((s) => s.kind === kind && s.allowAsWorkOrderStep !== false).sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
  const KK2 = tur("PROCESS_QC"), TAMBUR = tur("TAMBUR");
  if (!KK2 || !TAMBUR) throw new Error("kartela: PROCESS_QC/TAMBUR istasyonu yok");
  const firma = (await c.hepsi("/api/subcontractors")).filter((f) => f.isActive !== false && (f.categories ?? []).some((x) => x.category?.code === "KARTELA"))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
  if (!firma) { console.log("  ⚠ KARTELA kategorili fason firma yok — kartela atlandı"); return; }

  const top = {};
  for (const [key, kumas, m, en] of KARTELA_TOPLARI) {
    const r = await c.tokenli("kk1-top", `dv2:kartela:top:${key}`, "/api/rolls/initial-entry", { itemId: k.kalem[kumas], colorId: null, initialQty: m, width: en, qualityGrade: "1.KALITE" });
    top[key] = { id: r.id, bc: r.barcode, m };
  }
  // Terbiye iş emri tek kumaş içindir ⇒ kartela topu başına bir iş emri (Kurşun+KK2 → Tambur)
  const rollOku = async (id) => (await c.api("GET", `/api/rolls/${id}`)).data;
  const kat = await katSec(c, "TUP");
  const parca = {};
  for (const [key, kumas, m] of KARTELA_TOPLARI) {
    const d = await c.tokenli("is-emri", `dv2:kartela:ie:${key}`, "/api/work-orders/quick-start", {
      rollBarcodes: [top[key].bc], targetItemId: k.kalem[kumas],
      steps: [KK2, TAMBUR].map((s) => ({ stationId: s.id, plannedSubcontractorId: null })),
    });
    const woId = (d.workOrder ?? d).id;
    const wo = (await c.api("GET", `/api/work-orders/${woId}`)).data;
    const a2 = (wo.steps ?? []).find((a) => a.stationId === KK2.id), aT = (wo.steps ?? []).find((a) => a.stationId === TAMBUR.id);
    await c.kosulluYaz("kk2", async () => { const t = await rollOku(top[key].id); return t.status === "IN_PRODUCTION" && t.currentStepId === a2.id && !(t.operations ?? []).some((o) => o.operationType === "QC2_COMPLETED" && !o.revokedAt); },
      () => c.api("POST", "/api/kursun-qc/complete-qc2", { rollId: top[key].id, stepId: a2.id }));
    await c.kosulluYaz("kk2-adim-bitir", async () => (await c.api("GET", `/api/work-orders/${woId}`)).data.steps.find((x) => x.id === a2.id)?.status === "ACTIVE",
      () => c.api("POST", "/api/kursun-qc/finish-step", { stepId: a2.id }));
    await c.kosulluYaz("tambur", async () => { const t = await rollOku(top[key].id); return t.status === "IN_PRODUCTION" && t.currentStepId === aT.id; },
      () => c.api("POST", "/api/tambur/finalize", {
        rollId: top[key].id, foldType: kat, decisions: [],
        cuts: [{ length: +(m - PARCA_M).toFixed(1), qualityGrade: "1.KALITE", relatedErrorIds: [] }, { length: PARCA_M, qualityGrade: "1.KALITE", relatedErrorIds: [] }],
      }));
    // Kartela parçası: tamburda doğan çocuklardan PARCA_M boylu olan (liste ebeveyn taşımaz ⇒ detaydan)
    const j = await c.api("GET", `/api/work-orders/${woId}/rolls`);
    for (const r of (j.data?.rolls ?? j.data ?? []).filter((x) => x.barcode)) {
      const dd = await rollOku(r.id);
      if (dd.parentRollId === top[key].id && Math.abs(Number(dd.initialQty ?? dd.currentQty) - PARCA_M) < 0.01) parca[key] = dd;
    }
  }
  k.kartelaParca = parca;

  for (const [key, , , , adet] of KARTELA_TOPLARI) {
    const p = parca[key];
    if (!p) { console.log(`  ⚠ ${key} kartela parçası bulunamadı`); continue; }
    // Sevk: parça depodaysa (sunucu aynı firma + aynı topla açık sevki kendiliğinden döndürür)
    await c.kosulluYaz("kartela-sevk", async () => (await rollOku(p.id)).status === "WAREHOUSE",
      () => c.api("POST", "/api/kartela/dispatch", { subcontractorId: firma.id, rollIds: [p.id], plateNumber: "16 DV 455", notes: "Yeni sezon kartelası — 2026 kış koleksiyonu" }));
    if (!adet) continue;
    await c.kosulluYaz("kartela-kabul", async () => (await rollOku(p.id)).status === "AT_KARTELA",
      async () => {
        const acik = (await c.hepsi("/api/kartela/dispatches")).find((x) => (x.rolls ?? x.items ?? []).some((r) => (r.rollId ?? r.id) === p.id) && !x.cancelledAt);
        return c.api("POST", "/api/kartela/receive", {
          subcontractorId: firma.id, dispatchId: acik?.id ?? null, manifestNo: "KRT-1026",
          returns: [{ rollId: p.id, count: adet, bulkLengthCm: 30, bulkWeightKg: 0.12, notes: "30×45 cm kartela kartonu" }],
        });
      });
  }
}
