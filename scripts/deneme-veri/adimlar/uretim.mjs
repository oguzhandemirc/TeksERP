// Üretim zinciri: sipariş → KK1 topu → iş emri (rota) → fason sevk/kabul → Kurşun+KK2 → Tambur → çuval/tartı → sevkiyat.
// Her iş emri FARKLI aşamada bırakılır (sunum: her ekranda iş var). İstasyon türlerinin hepsi en az bir rotada:
// RAW_QC (KK1 girişi) · SUBCONTRACTOR (zımpara/boya fasonu) · PROCESS_QC · OTHER (katlama) · TAMBUR · SHIPPING (çuval).
// Tokensız geçişler (hızlı iş emri, fason sevk, KK2, tambur, çuval okutma, tartı) CANLI durumdan karar verir.

export const SIPARISLER = [
  // [anahtar, müşteri sırası, sipariş günü, termin günü, satırlar [kumaş, metre, en, birim fiyat]]
  ["S1", 0, -9, 4, [["HAM PERDELİK 280", 330, 280, 95], ["KETEN GÖRÜNÜMLÜ PERDE 280", 210, 280, 120]]],
  ["S2", 1, -8, -1, [["HAM TÜL 300", 480, 300, 70]]],
  ["S3", 2, -6, 7, [["SATEN DÖŞEMELİK 140", 260, 140, 160]]],
  ["S4", 3, -2, 12, [["KETEN GÖRÜNÜMLÜ PERDE 280", 150, 280, 120]]],
  ["S5", 4 % 8, -7, 3, [["HAM DÖŞEMELİK 140", 240, 140, 110]]],
  ["S6", 5 % 8, -5, 9, [["JAKARLI DÖŞEMELİK 140", 200, 140, 185]]],
];
// [anahtar, kumaş, metre, en]
export const TOPLAR = [
  ["U1a", "HAM PERDELİK 280", 112.4, 280], ["U1b", "HAM PERDELİK 280", 108.9, 280], ["U1c", "HAM PERDELİK 280", 115.0, 280],
  ["U2a", "KETEN GÖRÜNÜMLÜ PERDE 280", 104.5, 280], ["U2b", "KETEN GÖRÜNÜMLÜ PERDE 280", 109.2, 280],
  ["U3a", "HAM TÜL 300", 121.3, 300], ["U3b", "HAM TÜL 300", 118.7, 300], ["U3c", "HAM TÜL 300", 124.0, 300], ["U3d", "HAM TÜL 300", 119.6, 300],
  ["U4a", "SATEN DÖŞEMELİK 140", 127.8, 140], ["U4b", "SATEN DÖŞEMELİK 140", 131.2, 140],
  ["U5a", "HAM DÖŞEMELİK 140", 122.5, 140], ["U5b", "HAM DÖŞEMELİK 140", 118.3, 140],
  ["U6a", "JAKARLI DÖŞEMELİK 140", 96.3, 140], ["U6b", "JAKARLI DÖŞEMELİK 140", 92.8, 140],
  ["U7a", "HAM PERDELİK 280", 110.6, 280], ["U7b", "HAM TÜL 300", 122.2, 300],
];

export async function uretim(c) {
  const k = c.kayit;
  const ist = Object.fromEntries((await c.hepsi("/api/stations")).filter((s) => s.isActive).map((s) => [s.code, s]));
  const istTur = (kind) => Object.values(ist).filter((s) => s.kind === kind && s.allowAsWorkOrderStep !== false).sort((a, b) => a.code.localeCompare(b.code))[0];
  const KK2 = istTur("PROCESS_QC"), TAMBUR = istTur("TAMBUR"), KATLAMA = ist[Object.keys(ist).find((x) => ist[x].id === k.istasyon.OTHER)];
  const ZIMPARA = Object.values(ist).find((s) => s.kind === "SUBCONTRACTOR" && /ZIMPARA/.test(s.code)) ?? istTur("SUBCONTRACTOR");
  const BOYA = Object.values(ist).find((s) => s.kind === "SUBCONTRACTOR" && /BOYA/.test(s.code)) ?? ZIMPARA;
  if (!KK2 || !TAMBUR || !ZIMPARA) throw new Error("rota istasyonları eksik (PROCESS_QC/TAMBUR/SUBCONTRACTOR)");
  const fasonlar = (await c.hepsi("/api/subcontractors")).filter((x) => x.isActive).sort((a, b) => a.code.localeCompare(b.code));
  const fasonOf = (kat) => fasonlar.find((f) => (f.categories ?? []).some((x) => x.category?.code === kat)) ?? fasonlar[0];

  // Siparişler
  k.siparis = {};
  for (const [key, mi, og, tg, satirlar] of SIPARISLER) {
    const m = k.musteriler[mi % k.musteriler.length];
    const o = await c.tokenli("siparis", `dv:siparis:${key}`, "/api/orders", {
      customerId: m.id, orderDate: c.an(og, 10), deadline: c.an(tg, 17), currency: "TRY",
      lines: satirlar.map(([n, q, w, p]) => ({ itemId: k.kalem[n], quantity: q, width: w, unitPrice: p, colorId: null })),
    });
    const tam = (await c.api("GET", `/api/orders/${o.id}`)).data;
    k.siparis[key] = { id: o.id, no: tam.orderNumber, musteri: m.id, satir: Object.fromEntries((tam.lines ?? []).map((l) => [l.itemId, l.id])) };
  }
  // KK1 topları (ham giriş; iki gün önce)
  k.top = {};
  for (const [n, [key, kumas, m, en]] of TOPLAR.entries()) {
    const r = await c.tokenli("kk1-top", `dv:top:${key}`, "/api/rolls/initial-entry", {
      itemId: k.kalem[kumas], colorId: null, initialQty: m, width: en, qualityGrade: "1.KALITE", clientEnteredAt: c.an(-3, 8 + n * 0.4),
    });
    k.top[key] = { id: r.id, bc: r.barcode, m };
  }
  const top = async (key) => (await c.api("GET", `/api/rolls/${k.top[key].id}`)).data;

  // İş emirleri (hızlı başlat: okutulan top + sipariş satırı + rota; tokenlı).
  const ISLER = [
    // [anahtar, sipariş, kumaş, toplar, rota]
    ["IE1", "S1", "HAM PERDELİK 280", ["U1a", "U1b", "U1c"], [KK2, TAMBUR]],
    ["IE2", "S1", "KETEN GÖRÜNÜMLÜ PERDE 280", ["U2a", "U2b"], [KK2, TAMBUR]],
    ["IE3", "S2", "HAM TÜL 300", ["U3a", "U3b", "U3c", "U3d"], [KK2, KATLAMA, TAMBUR]],
    ["IE4", "S3", "SATEN DÖŞEMELİK 140", ["U4a", "U4b"], [KK2, TAMBUR]],
    ["IE5", "S5", "HAM DÖŞEMELİK 140", ["U5a", "U5b"], [ZIMPARA, KK2, TAMBUR]],
    ["IE6", "S6", "JAKARLI DÖŞEMELİK 140", ["U6a", "U6b"], [BOYA, KK2, TAMBUR]],
    ["IE7", null, "HAM PERDELİK 280", ["U7a"], [KK2, TAMBUR]], // stok üretimi (siparişsiz)
  ];
  k.ie = {};
  for (const [key, sk, kumas, toplar, rota] of ISLER) {
    const d = await c.tokenli("is-emri", `dv:ie:${key}`, "/api/work-orders/quick-start", {
      rollBarcodes: toplar.map((x) => k.top[x].bc), orderLineIds: sk ? [k.siparis[sk].satir[k.kalem[kumas]]] : undefined, targetItemId: k.kalem[kumas],
      steps: rota.map((s) => ({ stationId: s.id, plannedSubcontractorId: s.kind === "SUBCONTRACTOR" ? fasonOf(s === BOYA ? "BOYA" : "ZIMPARA").id : null })),
    });
    const woId = (d.workOrder ?? d).id;
    const wo = (await c.api("GET", `/api/work-orders/${woId}`)).data;
    k.ie[key] = { id: woId, no: wo.workOrderNumber, adim: (wo.steps ?? []).slice().sort((a, b) => (a.stepSequence ?? a.sequence) - (b.stepSequence ?? b.sequence)), toplar };
  }
  const woToplar = async (key) => { const j = await c.api("GET", `/api/work-orders/${k.ie[key].id}/rolls`); return j.data?.rolls ?? j.data ?? []; };
  const adim = (key, istasyon) => k.ie[key].adim.find((a) => a.stationId === istasyon.id);
  /** Sunucusu kendiliğinden idempotent (mevcut kaydı döner) ya da canlı durumdan karar verilen yazım. */
  const yaz = async (modul, gerekli, fn) => c.kosulluYaz(modul, gerekli, fn);

  // Kurşun + KK2: IE1/IE3/IE7 tümü, IE4 yalnız ilk top (KK2'de yarım); IE2 KK2'de bekler.
  for (const [key, adet] of [["IE1", 9], ["IE3", 9], ["IE7", 9], ["IE4", 1]]) {
    const a = adim(key, KK2);
    for (const tk of k.ie[key].toplar.slice(0, adet)) {
      await yaz("kk2", async () => { const t = await top(tk); return t.status === "IN_PRODUCTION" && t.currentStepId === a.id && !qc2Var(t, a.id); },
        () => c.api("POST", "/api/kursun-qc/complete-qc2", { rollId: k.top[tk].id, stepId: a.id }));
    }
    if (adet < 9) continue;
    await yaz("kk2-adim-bitir", async () => (await c.api("GET", `/api/work-orders/${k.ie[key].id}`)).data.steps.find((x) => x.id === a.id)?.status === "ACTIVE",
      () => c.api("POST", "/api/kursun-qc/finish-step", { stepId: a.id }));
  }

  // Tambur: IE1 (U1b'de kısa A1 parçası) ve IE7 (stok üretimi → depoda bekler) kesilir.
  const A1 = { U1b: 6.5 };
  for (const key of ["IE1", "IE7"]) {
    const a = adim(key, TAMBUR);
    for (const tk of k.ie[key].toplar) {
      const m = k.top[tk].m;
      const cuts = A1[tk] ? [{ length: +(m - A1[tk]).toFixed(1), qualityGrade: "1.KALITE", relatedErrorIds: [] }, { length: A1[tk], qualityGrade: "A1", relatedErrorIds: [] }]
        : [{ length: m, qualityGrade: "1.KALITE", relatedErrorIds: [] }];
      await yaz("tambur", async () => { const t = await top(tk); return t.status === "IN_PRODUCTION" && t.currentStepId === a.id; },
        () => c.api("POST", "/api/tambur/finalize", { rollId: k.top[tk].id, cuts, decisions: [], foldType: "2-KAT" }));
    }
  }
  /** Tamburda doğan mamuller (liste ebeveyn taşımaz ⇒ detaydan). */
  const cocuklar = async (key, tk) => {
    const out = [];
    for (const r of (await woToplar(key)).filter((x) => x.barcode && !/CONSUMED/.test(x.status))) {
      const d = (await c.api("GET", `/api/rolls/${r.id}`)).data;
      if (d.parentRollId === k.top[tk].id) out.push(d);
    }
    return out.sort((a, b) => String(a.barcode).localeCompare(String(b.barcode)));
  };

  // Çuval + tartı (SHIPPING): A = U1a+U1b mamulleri (sevk edilir), B = U1c mamulü (tartılmış, sevk bekliyor)
  const s1 = k.siparis.S1;
  k.cuval = {};
  for (const [ck, toplar, kg] of [["A", ["U1a", "U1b"], 81.6], ["B", ["U1c"], 42.3]]) {
    const sack = await c.tokenli("cuval", `dv:cuval:${ck}`, "/api/shipping/sacks", { customerId: s1.musteri });
    k.cuval[ck] = sack.id;
    for (const tk of toplar) for (const r of await cocuklar("IE1", tk)) {
      await yaz("cuval-okutma", async () => r.status === "WAREHOUSE" && r.sackId !== sack.id, () => c.api("POST", `/api/shipping/sacks/${sack.id}/scan`, { barcode: r.barcode }));
    }
    await yaz("cuval-tarti", async () => !(await c.api("GET", `/api/shipping/sacks/${sack.id}/contents`)).data?.weightKg,
      () => c.api("POST", `/api/shipping/sacks/${sack.id}/weigh`, { weightKg: kg, source: "MANUAL" }));
  }
  // Sevkiyat (BRÜT; iade ayrı belge) — yalnız A
  const sh = await c.tokenli("sevkiyat", "dv:sevk:SH1", "/api/shipping/shipments", {
    sackIds: [k.cuval.A], customerId: s1.musteri, orderIds: [s1.id], plateNumber: "16 DV 128", driverName: "Sürücü 1", destination: "DOMESTIC",
  });
  k.sevkiyat = { SH1: sh.id };

  // Fason: IE5 zımparaya (iki top) → U5a TAM kabul (açık kumaş KK2'ye), U5b fasonda; IE6 boyahanede.
  for (const [key, ist2, kat] of [["IE5", ZIMPARA, "ZIMPARA"], ["IE6", BOYA, "BOYA"]]) {
    const a = adim(key, ist2);
    const bekleyen = [];
    for (const tk of k.ie[key].toplar) { const t = await top(tk); if (t.status === "IN_PRODUCTION" && t.currentStepId === a.id) bekleyen.push(t.id); }
    await yaz("fason-sevk", async () => bekleyen.length > 0, () => c.api("POST", "/api/subcontractor/dispatch", {
      workOrderId: k.ie[key].id, stepId: a.id, subcontractorId: fasonOf(kat).id, rollIds: bekleyen, plateNumber: "16 DV 455", instruction: key === "IE5" ? "Tek yüz zımpara, orta sertlik" : "Hedef renk — numuneye göre",
    }));
  }
  {
    const a = adim("IE5", ZIMPARA);
    await c.tokenli("fason-kabul", "dv:fason-kabul:IE5:U5a", "/api/subcontractor/receive", {
      workOrderId: k.ie.IE5.id, stepId: a.id, subcontractorId: fasonOf("ZIMPARA").id, manifestNo: "ZMP-0412", returns: [{ rollId: k.top.U5a.id }],
      newRolls: [{ qty: 120.9, weightKg: 44.1 }], appliedWidth: 140,
    });
  }
  console.log(`  iş emirleri: ${Object.entries(k.ie).map(([a, w]) => `${a}=${w.no}`).join(" ")}`);
}

/** Topun bu adımda geri alınmamış QC2 kaydı var mı (rulo detayındaki `operations`). */
const qc2Var = (t, stepId) => (t.operations ?? []).some((o) => o.operationType === "QC2_COMPLETED" && (o.workOrderStepId ?? stepId) === stepId && !o.revokedAt);
