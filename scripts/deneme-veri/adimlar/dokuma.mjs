// Devere + dokuma: dokuma işleri (DK) · leventler (hazır alınan · içeride sarılan · müşteri emaneti) · geçmiş 3 günün
// tezgah defteri (koşum aç/kapa · duruş aç/kapa/sınıfla · indirme) ve indirmeden KK1'de doğan toplar.
// Zamanlar ÇAPA günden türer (gövde belirlenimli ⇒ token replay). Kapatma/sınıflama tokensızdır → canlı durumdan karar.

export const DOKUMA_ISLERI = [
  // [anahtar, kumaş, çözgü kartı, plan m, başlangıç gün, bitiş gün, not]
  ["DK1", "HAM PERDELİK 280", "CZG-D01", 4800, -6, 8, "Perdelik ana sipariş"],
  ["DK2", "KETEN GÖRÜNÜMLÜ PERDE 280", "CZG-D01", 3600, -5, 6, null],
  ["DK3", "HAM TÜL 300", "CZG-D03", 3000, -4, 9, "Pamuk çözgü"],
  ["DK4", "HAM DÖŞEMELİK 140", "CZG-D02", 2400, -3, 7, null],
  ["DK5", "SATEN DÖŞEMELİK 140", "CZG-D02", 2000, -2, 10, "İhracat partisi"],
  ["DK6", "JAKARLI DÖŞEMELİK 140", "CZG-D02", 1800, -6, 12, "Jakar desen D-114"],
  ["DK7", "JAKARLI DÖŞEMELİK 140", "CZG-D02", 1200, 2, 14, "Jakar desen D-118 — planlı"],
];
/** Tezgah → dokuma işi (ağızlık türüne uygun kumaş). */
export const tezgahIsi = (i) => (i >= 25 ? (i <= 29 ? "DK6" : "DK7") : ["DK1", "DK2", "DK3", "DK4", "DK5"][(i - 1) % 5]);
const DEVIR = { DK1: [520, 26], DK2: [500, 24], DK3: [600, 22], DK4: [540, 28], DK5: [520, 30], DK6: [420, 32], DK7: [420, 32] };

export async function dokuma(c) {
  const k = c.kayit;
  const tedarikci = k.tedarikci["Atlas Çözgü Hazırlama"];
  const iplikDepo = k.depo["İplik Deposu"];
  k.dk = {};
  for (const [key, kumas, czg, m, s, e, notes] of DOKUMA_ISLERI) {
    const r = await c.tokenli("dokuma-isi", `dv:dk:${key}`, "/api/weaving-orders", {
      itemId: k.kalem[kumas], warpSpecId: k.cozgu[czg], plannedM: m, executionKind: "IN_HOUSE", plannedStartDate: c.an(s, 6), plannedEndDate: c.an(e, 18), notes,
    });
    k.dk[key] = { id: r.id, no: r.weavingOrderNumber };
  }
  // Fason dokuma işi (dış tezgah)
  const fason = (await c.hepsi("/api/subcontractors")).filter((x) => x.isActive !== false).sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
  if (fason) {
    const r = await c.tokenli("dokuma-isi", "dv:dk:F1", "/api/weaving-orders", {
      itemId: k.kalem["HAM DÖŞEMELİK 140"], warpSpecId: k.cozgu["CZG-D02"], plannedM: 1500, executionKind: "SUBCONTRACTED", subcontractorId: fason.id,
      plannedStartDate: c.an(-1, 8), plannedEndDate: c.an(9, 18), notes: "Kapasite aşımı — fason tezgah",
    });
    k.dk.F1 = { id: r.id, no: r.weavingOrderNumber };
  }

  // Leventler: her dokuma işine bir hazır levent (PURCHASED) + DK1/DK3 için içeride sarılan (IN_HOUSE, iplik çıkışlı) + emanet
  const lotlar = await c.hepsi("/api/yarn/lots");
  const lotOf = (no) => lotlar.find((l) => l.lotNo === no)?.id ?? null;
  const LEVENTLER = [
    ...DOKUMA_ISLERI.map(([key, , czg], i) => ({ key: `LV-${key}`, dk: key, czg, m: 3000, origin: "PURCHASED", supplierId: tedarikci, phys: `G-${String(110 + i)}` })),
    { key: "LV-IH1", dk: "DK1", czg: "CZG-D01", m: 2800, origin: "IN_HOUSE", phys: "G-201", issue: { lot: "DRK-2609-150A", kg: 310 } },
    { key: "LV-IH2", dk: "DK3", czg: "CZG-D03", m: 2600, origin: "IN_HOUSE", phys: "G-202", issue: { lot: "PNR-2610-P30", kg: 285 } },
    // Emanet: müşterinin hazır getirdiği levent (sahip doğumda) + emanet iplikten içeride sarılan (sahip lot'tan kalıtılır)
    { key: "LV-EMN", dk: null, czg: "CZG-D02", m: 2000, origin: "CONSIGNED", phys: "G-301", owner: k.musteriler[0].id },
    { key: "LV-EMN2", dk: null, czg: "CZG-D02", m: 1800, origin: "IN_HOUSE", phys: "G-302", issue: { lotId: k.emanetLot, kg: 160 } },
    { key: "LV-PLN", dk: "DK7", czg: "CZG-D02", m: 2500, origin: "IN_HOUSE", phys: "G-203", planOnly: true },
  ];
  k.levent = {};
  for (const L of LEVENTLER) {
    const b = await c.tokenli("levent", `dv:lv:${L.key}:plan`, "/api/warp-beams", {
      warpSpecId: k.cozgu[L.czg], plannedLengthM: L.m, originKind: L.origin, supplierId: L.supplierId ?? null, ownerCustomerId: L.owner ?? null,
      weavingOrderId: L.dk ? k.dk[L.dk].id : null, physicalBeamNo: L.phys, notes: L.owner ? "Müşteri ipliğinden emanet levent" : null,
    });
    k.levent[L.key] = b.id;
    if (L.planOnly) continue;
    const lotId = L.issue?.lotId ?? (L.issue?.lot ? lotOf(L.issue.lot) : null);
    const yarnIssues = L.issue ? [{ warehouseId: iplikDepo, qtyKg: L.issue.kg, lotId }] : undefined;
    await c.kosulluYaz("levent-sarim", async () => ((await c.api("GET", `/api/warp-beams/${b.id}`)).data?.status ?? "PLANNED") === "PLANNED",
      () => c.api("POST", `/api/warp-beams/${b.id}/wind`, {
        lengthM: L.m, kgSource: L.issue ? "WEIGHED" : "THEORETICAL", machineId: L.origin === "IN_HOUSE" ? k.makine_WARPING : null,
        yarnIssues, sectionCount: L.origin === "IN_HOUSE" ? 8 : null, breakCount: L.origin === "IN_HOUSE" ? 3 : null,
        startedAt: L.origin === "IN_HOUSE" ? c.an(-7, 8) : null, clientToken: tokenOf(`dv:lv:${L.key}:wind`),
      }));
  }

  // Kapalı duruş geçmişi (6 gün, tezgah 1..24) — Pareto/karne raporları dolsun. Duruş 7 güne kadar geriye yazılabilir.
  const tezgah = (i) => k.tezgahlar.find((t) => t.i === i);
  const SEBEPLER = ["ATKI_KOPUSU", "COZGU_KOPUSU", "KENAR_KOPUSU", "TARAK_DEGISIMI", "MEKANIK_ARIZA", "IPLIK_BITTI", "TOP_ALMA", "ELEKTRIK_ARIZA", "MOLA", "HAVA_BASINCI"];
  for (let i = 1; i <= 24; i++) {
    const t = tezgah(i);
    for (let g = -6; g <= -2; g++) {
      for (let n = 0; n < 2; n++) {
        const sebep = SEBEPLER[(i * 3 + g * 7 + n * 5 + 70) % SEBEPLER.length];
        const sure = sebep === "MEKANIK_ARIZA" ? 55 + (i % 4) * 10 : sebep === "MOLA" ? 30 : sebep === "TARAK_DEGISIMI" ? 25 : 5 + ((i + g + n + 20) % 12);
        const bas = 8 + n * 6 + (i % 3);
        const sinifsiz = i === 7 && g === -3 && n === 0; // sebepsiz açılıp sonradan sınıflanan
        // Sınıflanan duruşun güncel sebebi açılış gövdesinden farklıdır (replay 409 verir) ⇒ önce canlı listede aranır.
        const st = (sinifsiz && (await durusBul(c, t.id, c.an(g, bas))))
          || await c.tokenli("tezgah-durus", `dv:stop:${i}:${g}:${n}`, "/api/machine-stops", { machineId: t.id, startedAt: c.an(g, bas), reasonCode: sinifsiz ? null : sebep });
        await c.kosulluYaz("tezgah-durus-kapa", async () => !st.endedAt && !(await durusKapali(c, t.id, st.id)),
          () => c.api("POST", `/api/machine-stops/${st.id}/close`, { endedAt: c.an(g, bas + sure / 60) }));
        if (sinifsiz) await c.kosulluYaz("tezgah-durus-sinifla", async () => !(await durusSebebi(c, t.id, st.id)),
          () => c.api("POST", `/api/machine-stops/${st.id}/classify`, { reasonCode: "MEKANIK_ARIZA", reasonNote: "Armür kolu ayarı — bakım ekibi" }));
      }
    }
  }

  // Gece vardiyasından süren koşumlar + bu sabahki indirmeler (KK1 topu). Koşum/indirme en çok 36 sa geriye yazılır
  // (aşan değer sunucuda "şimdi"ye çekilir) ⇒ yalnız pencere içindeyken YENİ kayıt açılır; koşum KAPANMAZ (salon "çalışıyor").
  const simdi = Date.now();
  const pencere = simdi >= Date.parse(c.an(0, 7)) && simdi <= Date.parse(c.an(-1, 22)) + 34 * 3_600_000;
  if (!pencere) { console.log(`  ⚠ çapa ${c.gunStr(0)} gece koşum penceresi dışında — koşum/indirme geçmişi atlandı (--cap bugünü verin)`); return; }
  for (let i = 1; i <= 12; i++) {
    const t = tezgah(i);
    const dk = tezgahIsi(i);
    const [ppm, ppc] = DEVIR[dk];
    const run = await c.tokenli("tezgah-kosum", `dv:run:${i}:gece`, "/api/machine-runs", {
      machineId: t.id, productionLineNo: 1, weavingOrderId: k.dk[dk].id, targetUnitsPerMin: ppm, unitsPerCm: ppc, startedAt: c.an(-1, 22 + (i % 3) * 0.25),
    });
    const kumas = DOKUMA_ISLERI.find((x) => x[0] === dk)[1];
    for (const [n, [g, s, m]] of [[0, 1.5, 104 + i], [0, 5.5, 98 + (i % 7)]].entries()) {
      const d = await c.tokenli("tezgah-indirme", `dv:gdoff:${i}:${n}`, "/api/machine-doffs", {
        machineId: t.id, productionLineNo: 1, machineRunId: run.id, doffedAt: c.an(g, s), pieceCount: 1, counterSource: "OPERATOR",
      });
      await c.tokenli("kk1-top", `dv:gdoff:${i}:${n}:top`, "/api/rolls/initial-entry", {
        itemId: k.kalem[kumas], colorId: null, initialQty: m + 0.4, width: /140/.test(kumas) ? 140 : /300/.test(kumas) ? 300 : 280,
        qualityGrade: "1.KALITE", doffEventId: d.id, clientEnteredAt: c.an(g, s + 0.3),
      });
    }
    // Gece duruşları (koşum içinde, kapalı)
    for (const [n, [s, sebep, dk2]] of [[23.2, "ATKI_KOPUSU", 6], [3 + (i % 2), i % 3 ? "TOP_ALMA" : "KENAR_KOPUSU", 9]].entries()) {
      const g = s > 12 ? -1 : 0;
      const st = await c.tokenli("tezgah-durus", `dv:gstop:${i}:${n}`, "/api/machine-stops", { machineId: t.id, startedAt: c.an(g, s), reasonCode: sebep });
      await c.kosulluYaz("tezgah-durus-kapa", async () => !st.endedAt && !(await durusKapali(c, t.id, st.id)),
        () => c.api("POST", `/api/machine-stops/${st.id}/close`, { endedAt: c.an(g, s + dk2 / 60) }));
    }
  }
}

import { belirlenimliToken } from "../lib/token.mjs";
const tokenOf = belirlenimliToken;
async function durusKapali(c, machineId, id) {
  const acik = (await c.api("GET", `/api/machine-stops?machineId=${machineId}&open=true&limit=500`)).data ?? [];
  return !acik.some((s) => s.id === id);
}
async function durusBul(c, machineId, startedAt) {
  const l = (await c.api("GET", `/api/machine-stops?machineId=${machineId}&limit=500`)).data ?? [];
  return l.find((s) => Date.parse(s.startedAt) === Date.parse(startedAt)) ?? null;
}
async function durusSebebi(c, machineId, id) {
  const l = (await c.api("GET", `/api/machine-stops?machineId=${machineId}&limit=500`)).data ?? [];
  return l.find((s) => s.id === id)?.reasonCode ?? null;
}
