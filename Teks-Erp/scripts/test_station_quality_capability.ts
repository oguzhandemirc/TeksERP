// =============================================================================
// Test: İSTASYON YETENEK İKİZLERİ — AKIŞ ↔ KALİTE (P4 Faz A 2026-09-03; KQ-D1 2026-10-24)
// Çalıştır: npx tsx scripts/test_station_quality_capability.ts
// =============================================================================
// Korunan invariant: `src/services/helpers/quality-station.helper.ts` İKİ soruya
// İKİ ikizle cevap verir ve ikisi karışmaz:
//   AKIŞ   — `stepRunsStepFlow` ↔ `STEP_FLOW_WHERE` (PROCESS_QC ∨ appliesQuality):
//            ara-istasyon kart akışı, kurşun kuyruğu, dağıtım adayı.
//   KALİTE — `stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE` (inspectionEnabled):
//            bu istasyonda hata kaydı (muayene) açılır mı. `stationCanInspect`
//            AYNI fonksiyondur (K4P).
// Kurşun dağıtım hedefi üçüncü yüklem değil: `KURSUN_DISPATCH_STATION_WHERE`
// (akış ∧ KURSUN AUTO) — liste = kabul.
//
// Bölümler:
//   §1 Zemin (helper okundu; akış ≥ 20, kalite ≥ 4 kullanım)
//   §2 İki doğruluk tablosu + doğuş varsayılanı tablosu
//   §3 ⭐ İki ikizin canlı DB eşdeğerliği (where ↔ yüklem aynı küme)
//   §4 ⭐ `PROCESS_QC` literali yalnız helper'da (gerekçeli muaflar, sayım);
//        kalite tüketicilerinde tür karşılaştırması yok (Tambur ekran ailesi muaf)
//   §5 ⭐ select sözleşmeleri (akış → STEP_FLOW_SELECT, kalite → STEP_QUALITY_SELECT)
//   §6 Helper hijyeni (`satisfies`, spread, aynı kapsamda ikinci OR yok)
//   §7 ⭐ Migration UPDATE ↔ `inspectionDefaultForKind` (tx + ROLLBACK) + seed
//   §8 ⭐ AST — ikizler TEK dosyada, yan yana, `satisfies`; helper dışı `=== PROCESS_QC` yok
//   §9 ⭐ AST — akış gövdesi `inspectionEnabled` okumaz; kalite gövdesi `kind`/`appliesQuality` okumaz
//   §10 `stationCanInspect === stepCanApplyQuality` (aynı nesne)
//   §11 ⭐ Kalite tüketici beyanı iki yönlü (`scripts/lib/kalite-tuketici-beyan.ts`)
//   §12 ⭐ (DB) Kurşun dağıtım listesi = kabul; Tambur listede yok
//
// SONDA TABLOSU (KQ-D1 2026-10-24, cp + md5 ile geri alındı). Taban 54/0.
//   S6  akış gövdesine `|| inspectionEnabled`              → §3 + §9 kırmızı (2)
//   S7  kalite gövdesine `kind === PROCESS_QC` dalı        → §2 + §3 + §8 + §9 kırmızı (4)
//   S8  `listDistribution` → `STEP_FLOW_WHERE`             → §12 kırmızı (1, AUTO'suz PQC)
//   S8b `listDistribution` → `{inspectionEnabled:true}`    → §12 kırmızı (2, Tambur listede)
//   S9  migration'dan `'TAMBUR'` silinir                   → §7 kırmızı (1)
//   S10 beyansız yeni `stepCanApplyQuality` çağrısı        → §11 kırmızı (1)
// Faz A sondaları (S1–S5) aynı kalıpları akış ikizinde ölçmüştü; dersleri:
//   • muaf DOSYA bazında değil SAYIM bazında (aynı dosyaya eklenen yeni tür
//     kontrolü sessizce kapsanıyordu);
//   • select "dosyada geçiyor mu" değil TABAN SAYIM (ikinci select alanı atlıyordu).
// =============================================================================
// `ts` adı main() içinde zaman damgasına ayrılmış — derleyici API'si `tsc` diye alınır.
import * as tsc from "typescript";
import prisma from "../src/lib/prisma";
import { StationKind, StepStatus, WorkOrderStatus, RollStatus, RollForm, Prisma } from "@prisma/client";
import {
  stepRunsStepFlow,
  STEP_FLOW_WHERE,
  STEP_FLOW_ERROR,
  STEP_FLOW_SELECT,
  stepCanApplyQuality,
  stationCanInspect,
  QUALITY_STATION_WHERE,
  QUALITY_STEP_ERROR,
  STEP_QUALITY_SELECT,
  inspectionDefaultForKind,
  INSPECTION_DEFAULT_KINDS,
  KURSUN_PROPERTY_CODE,
  stepDecidesDefects,
  DEFECT_DECISION_STATION_WHERE,
  type QualityCaps,
} from "../src/services/helpers/quality-station.helper";
import { KALITE_TUKETICI_BEYANI } from "./lib/kalite-tuketici-beyan";
import { KursunBypassService } from "../src/services/kursun-bypass.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Yorumları söker — bekçinin kendi açıklama satırları kalıpları METİN olarak taşır. */
function yorumlariSok(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const HELPER = "services/helpers/quality-station.helper";
const KALITE_ADLARI = new Set(["stepCanApplyQuality", "QUALITY_STATION_WHERE", "stationCanInspect"]);

/**
 * §4'ün GEREKÇELİ MUAFLARI — her satır "neden hâlâ türe bakıyor"u yazar.
 * ⚠️ İKİ YÖNLÜ: listede olup dosyada karşılığı kalmayan satır da KIRMIZI.
 */
const KIND_MUAF: Record<string, { sayi: number; gerekce: string }> = {
  "services/work-session.service.ts": {
    sayi: 1,
    gerekce:
      "SESSIONABLE_STATION_KINDS + izin haritası — soru 'kalite yürütür mü' DEĞİL, " +
      "'bu istasyon TÜRÜNÜN tablet ekranı hangisi' (RAW_QC→KK1, PROCESS_QC→KK2…).",
  },
  "services/import/adapters/station.adapter.ts": {
    sayi: 1,
    gerekce: "İçe aktarım SEÇENEK listesi (kullanıcıya gösterilen enum etiketi).",
  },
};

/**
 * §4b — kalite tüketici fonksiyonlarında TÜR karşılaştırması muafları.
 * Anahtar `dosya#fonksiyon`; sayı tam eşleşir (aşan da eksik de kırmızı).
 */
const KALITE_KIND_MUAF: Record<string, { sayi: number; gerekce: string }> = {
  "services/helpers/roll-defect.helper.ts#assertDefectStepGate": {
    sayi: 1,
    gerekce:
      "`kind !== TAMBUR` EKRAN AİLESİ kontrolüdür (Tambur ucu yalnız Tambur adımına yazar); " +
      "muayene sorusu hemen ardından kalite ikiziyle ayrıca sorulur.",
  },
  "services/tambur.service.ts#getStep": {
    sayi: 1,
    gerekce:
      "`kind !== TAMBUR` EKRAN AİLESİ kontrolüdür (Tambur özeti yalnız Tambur adımını açar); " +
      "`inspectionEnabled` alanı kalite ikizinden ayrıca hesaplanır (KQ-D7).",
  },
};

/** Düğümü saran en yakın ADLANDIRILMIŞ fonksiyon/metot (ok fonksiyonunda değişken adı). */
function sarmalayanFonksiyon(n: tsc.Node): string {
  let p: tsc.Node | undefined = n.parent;
  while (p) {
    if ((tsc.isFunctionDeclaration(p) || tsc.isMethodDeclaration(p)) && p.name) {
      return p.name.getText();
    }
    if ((tsc.isArrowFunction(p) || tsc.isFunctionExpression(p)) && tsc.isVariableDeclaration(p.parent)) {
      return p.parent.name.getText();
    }
    p = p.parent;
  }
  return "<modül>";
}

function importIcinde(n: tsc.Node): boolean {
  let p: tsc.Node | undefined = n.parent;
  while (p) {
    if (tsc.isImportDeclaration(p) || tsc.isExportDeclaration(p)) return true;
    p = p.parent;
  }
  return false;
}

/** Fonksiyon gövdesinde geçen tanımlayıcı/özellik adları (AST). */
function gecenAdlar(n: tsc.Node): Set<string> {
  const out = new Set<string>();
  const gez = (k: tsc.Node): void => {
    if (tsc.isIdentifier(k)) out.add(k.text);
    tsc.forEachChild(k, gez);
  };
  gez(n);
  return out;
}

async function main() {
  const ts = Date.now();
  const fs = await import("node:fs/promises");
  const cleanupStationIds: string[] = [];
  const cleanupMachineIds: string[] = [];
  const cleanupWoIds: string[] = [];
  const cleanupRollIds: string[] = [];
  let flagOnceki: Prisma.JsonValue | null | undefined;
  let cleanupItemId: string | null = null;

  try {
    // ── §1 Zemin ────────────────────────────────────────────────────────────
    const helperYol = "src/services/helpers/quality-station.helper.ts";
    const helperSrc = await fs.readFile(helperYol, "utf8");
    check("§1 zemin: helper okunabildi", helperSrc.length > 500, `${helperSrc.length} bayt`);
    check("§1 zemin: iki hata metni tek kaynakta ve FARKLI",
      STEP_FLOW_ERROR.length > 10 && QUALITY_STEP_ERROR.length > 10 && (STEP_FLOW_ERROR as string) !== QUALITY_STEP_ERROR,
      `${STEP_FLOW_ERROR} | ${QUALITY_STEP_ERROR}`);

    const srcFiles: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".ts")) srcFiles.push(p);
      }
    }
    await walk("src");
    const kaynaklar = new Map<string, string>();
    for (const f of srcFiles) kaynaklar.set(f.replace(/^src\//, ""), await fs.readFile(f, "utf8"));
    check("§1 zemin: src taraması dosya buldu", kaynaklar.size > 100, `${kaynaklar.size} dosya`);

    let akisKullanim = 0;
    let kaliteKullanim = 0;
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith(HELPER)) continue;
      const s = yorumlariSok(ham);
      akisKullanim += (s.match(/stepRunsStepFlow\(|\.\.\.STEP_FLOW_WHERE/g) ?? []).length;
      kaliteKullanim += (s.match(/stepCanApplyQuality\(|\.\.\.QUALITY_STATION_WHERE|stationCanInspect\(/g) ?? []).length;
    }
    check("§1 zemin: akış ikizi yayıldı (>=20)", akisKullanim >= 20, `${akisKullanim} kullanım`);
    check("§1 zemin: kalite ikizi yayıldı (>=4)", kaliteKullanim >= 4, `${kaliteKullanim} kullanım`);

    // ── §2 Doğruluk tabloları ───────────────────────────────────────────────
    const akisTablo: Array<[StationKind, boolean, boolean]> = [
      [StationKind.PROCESS_QC, true, true],
      [StationKind.PROCESS_QC, false, true], // Faz A köprüsü
      [StationKind.OTHER, true, true],
      [StationKind.OTHER, false, false],
      [StationKind.TAMBUR, false, false],     // Tambur akışa GİRMEZ (dağıtım listesi)
    ];
    const akisYanlis = akisTablo.filter(([k, q, b]) => stepRunsStepFlow({ kind: k, appliesQuality: q }) !== b);
    check("§2 akış tablosu (PROCESS_QC/OTHER/TAMBUR × appliesQuality)", akisYanlis.length === 0,
      akisYanlis.map(([k, q]) => `${k}/${q}`).join(", ") || "5/5");
    check("§2 akış: null/undefined → FALSE", stepRunsStepFlow(null) === false && stepRunsStepFlow(undefined) === false);

    // Kalite tablosu: tür ve akış bayrağı ne olursa olsun YALNIZ inspectionEnabled.
    // (Fazla alanlı nesne bilerek — gövdeye tür dalı eklenirse burası kırmızı, S7.)
    const kaliteTablo: Array<[StationKind, boolean, boolean]> = [];
    for (const k of [StationKind.PROCESS_QC, StationKind.TAMBUR, StationKind.OTHER, StationKind.RAW_QC]) {
      for (const q of [true, false]) {
        for (const ins of [true, false]) kaliteTablo.push([k, q, ins]);
      }
    }
    const kaliteYanlis = kaliteTablo.filter(([k, q, ins]) =>
      stepCanApplyQuality({ kind: k, appliesQuality: q, inspectionEnabled: ins } as QualityCaps) !== ins);
    check("§2 kalite tablosu: sonuç = inspectionEnabled (tür × appliesQuality etkisiz)",
      kaliteYanlis.length === 0, kaliteYanlis.map(([k, q, i]) => `${k}/${q}/${i}`).join(", ") || `${kaliteTablo.length}/${kaliteTablo.length}`);
    check("§2 kalite: null/undefined → FALSE (fail-closed)",
      stepCanApplyQuality(null) === false && stepCanApplyQuality(undefined) === false);

    const tumTurler = Object.values(StationKind) as StationKind[];
    const dogusYanlis = tumTurler.filter((k) =>
      inspectionDefaultForKind(k) !== (k === StationKind.PROCESS_QC || k === StationKind.TAMBUR));
    // KARAR İKİZİ (KQ-D8): yalnız TAMBUR; muayene/akış bayrağı etkisiz.
    const kararYanlis = tumTurler.filter((k) => stepDecidesDefects({ kind: k }) !== (k === StationKind.TAMBUR));
    check("§2 karar tablosu: yalnız TAMBUR karar verir", kararYanlis.length === 0 &&
      stepDecidesDefects(null) === false && stepDecidesDefects(undefined) === false, kararYanlis.join(", ") || `${tumTurler.length} tür`);
    check("§2 doğuş varsayılanı: yalnız PROCESS_QC + TAMBUR true", dogusYanlis.length === 0 &&
      INSPECTION_DEFAULT_KINDS.length === 2 && inspectionDefaultForKind(undefined) === false,
      dogusYanlis.join(", ") || `${tumTurler.length} tür`);

    // ── §3 ⭐ İki ikizin canlı DB eşdeğerliği ───────────────────────────────
    const kose: Array<{ ad: string; kind: StationKind; q: boolean; ins: boolean }> = [];
    for (const [kAd, kind] of [["PQC", StationKind.PROCESS_QC], ["OTH", StationKind.OTHER], ["TMB", StationKind.TAMBUR]] as const) {
      for (const q of [true, false]) {
        for (const ins of [true, false]) kose.push({ ad: `${kAd}-${q ? "Q" : "N"}${ins ? "I" : "X"}`, kind, q, ins });
      }
    }
    const idAd = new Map<string, string>();
    for (const k of kose) {
      const st = await prisma.station.create({
        data: {
          code: `TEST-SQC-${k.ad}-${ts}`,
          name: `TEST Yetenek İkizi ${k.ad} ${ts}`,
          type: "INTERNAL",
          kind: k.kind,
          appliesQuality: k.q,
          inspectionEnabled: k.ins,
        },
        select: { id: true },
      });
      cleanupStationIds.push(st.id);
      idAd.set(st.id, k.ad);
    }
    const hepsi = await prisma.station.findMany({
      where: { id: { in: cleanupStationIds } },
      select: { id: true, ...STEP_FLOW_SELECT, ...STEP_QUALITY_SELECT },
    });
    const kumeStr = (ids: string[]) => ids.map((i) => idAd.get(i)!).sort().join(",");
    const akisYuklem = kumeStr(hepsi.filter((s) => stepRunsStepFlow(s)).map((s) => s.id));
    const akisWhere = kumeStr((await prisma.station.findMany({
      where: { id: { in: cleanupStationIds }, ...STEP_FLOW_WHERE }, select: { id: true },
    })).map((s) => s.id));
    check("§3 ⭐ AKIŞ: yüklem ile where AYNI küme", akisYuklem === akisWhere, `yüklem={${akisYuklem}} where={${akisWhere}}`);
    const akisBeklenen = kose.filter((k) => k.kind === StationKind.PROCESS_QC || k.q).map((k) => k.ad).sort().join(",");
    check("§3 AKIŞ kümesi beklenen (PQC hepsi + appliesQuality'li OTH/TMB; inspectionEnabled etkisiz)",
      akisWhere === akisBeklenen, akisWhere);

    const kaliteYuklem = kumeStr(hepsi.filter((s) => stepCanApplyQuality(s)).map((s) => s.id));
    const kaliteWhere = kumeStr((await prisma.station.findMany({
      where: { id: { in: cleanupStationIds }, ...QUALITY_STATION_WHERE }, select: { id: true },
    })).map((s) => s.id));
    check("§3 ⭐ KALİTE: yüklem ile where AYNI küme", kaliteYuklem === kaliteWhere, `yüklem={${kaliteYuklem}} where={${kaliteWhere}}`);
    const kaliteBeklenen = kose.filter((k) => k.ins).map((k) => k.ad).sort().join(",");
    check("§3 KALİTE kümesi beklenen (yalnız inspectionEnabled; tür etkisiz)", kaliteWhere === kaliteBeklenen, kaliteWhere);
    const kararYuklem = kumeStr(hepsi.filter((s) => stepDecidesDefects(s)).map((s) => s.id));
    const kararWhere = kumeStr((await prisma.station.findMany({
      where: { id: { in: cleanupStationIds }, ...DEFECT_DECISION_STATION_WHERE }, select: { id: true },
    })).map((s) => s.id));
    check("§3 ⭐ KARAR: yüklem ile where AYNI küme (yalnız TMB köşeleri)", kararYuklem === kararWhere &&
      kararWhere === kose.filter((k) => k.kind === StationKind.TAMBUR).map((k) => k.ad).sort().join(","), kararWhere);
    check("§3 zemin: iki where de süzüyor (12 köşenin hepsi değil, hiçbiri değil)",
      akisWhere.split(",").length === 8 && kaliteWhere.split(",").length === 6,
      `akış ${akisWhere.split(",").length}/12 · kalite ${kaliteWhere.split(",").length}/12`);

    // ── §4 ⭐ `PROCESS_QC` literali yalnız helper'da (gerekçeli muaflar) ─────
    const kararKalibi = /(StationKind\.PROCESS_QC|["']PROCESS_QC["'])/;
    const ihlaller: string[] = [];
    const kullanilanMuaf = new Set<string>();
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith(HELPER)) continue;
      const s = yorumlariSok(ham);
      const bulunan = (s.match(new RegExp(kararKalibi.source, "g")) ?? []).length;
      if (bulunan === 0) continue;
      const muaf = KIND_MUAF[ad];
      if (muaf) {
        kullanilanMuaf.add(ad);
        if (bulunan !== muaf.sayi) ihlaller.push(`${ad}: muaf ${muaf.sayi} bekliyor, ${bulunan} bulundu`);
        continue;
      }
      const satir = s.split("\n").findIndex((l) => kararKalibi.test(l)) + 1;
      ihlaller.push(`${ad}:${satir}`);
    }
    check("§4 ⭐ `PROCESS_QC` literali helper DIŞINDA yalnız muaflarda (sayım dahil)",
      ihlaller.length === 0, ihlaller.join(" · ") || "0 ihlal");
    const oluMuaf = Object.keys(KIND_MUAF).filter((k) => !kullanilanMuaf.has(k));
    check("§4 muaf listesi ÖLÜ satır taşımıyor (iki yönlü)", oluMuaf.length === 0, oluMuaf.join(", ") || "0 ölü");
    check("§4 her muafın gerekçesi yazılı",
      [...Object.values(KIND_MUAF), ...Object.values(KALITE_KIND_MUAF)].every((r) => r.gerekce.length > 20));

    // §4b — kalite tüketicisi fonksiyonlarında tür karşılaştırması (=== / !== ile
    // `.kind` ya da `StationKind.X`). Muayene sorusu türe bakmaz; tek muaf
    // Tambur ekran ailesi kontrolü.
    const turMu = (n: tsc.Node): boolean =>
      (tsc.isPropertyAccessExpression(n) && (n.name.text === "kind" ||
        (tsc.isIdentifier(n.expression) && n.expression.text === "StationKind")));
    const kaliteFonkTur = new Map<string, number>();
    for (const b of KALITE_TUKETICI_BEYANI) {
      const ham = kaynaklar.get(b.dosya);
      if (!ham) continue;
      const sf = tsc.createSourceFile(b.dosya, ham, tsc.ScriptTarget.Latest, true);
      let sayi = 0;
      const gez = (n: tsc.Node): void => {
        if ((tsc.isFunctionDeclaration(n) || tsc.isMethodDeclaration(n)) && n.name?.getText(sf) === b.fonksiyon && n.body) {
          const ic = (k: tsc.Node): void => {
            if (tsc.isBinaryExpression(k) &&
              (k.operatorToken.kind === tsc.SyntaxKind.EqualsEqualsEqualsToken ||
                k.operatorToken.kind === tsc.SyntaxKind.ExclamationEqualsEqualsToken) &&
              (turMu(k.left) || turMu(k.right))) sayi++;
            tsc.forEachChild(k, ic);
          };
          ic(n.body);
        }
        tsc.forEachChild(n, gez);
      };
      gez(sf);
      kaliteFonkTur.set(`${b.dosya}#${b.fonksiyon}`, sayi);
    }
    const turIhlal: string[] = [];
    for (const [anahtar, sayi] of kaliteFonkTur) {
      const beklenen = KALITE_KIND_MUAF[anahtar]?.sayi ?? 0;
      if (sayi !== beklenen) turIhlal.push(`${anahtar}: ${beklenen} bekleniyor, ${sayi} bulundu`);
    }
    const oluKaliteMuaf = Object.keys(KALITE_KIND_MUAF).filter((k) => !kaliteFonkTur.has(k));
    check("§4b ⭐ kalite tüketicilerinde tür karşılaştırması YOK (Tambur ekran ailesi muaf, sayım)",
      turIhlal.length === 0 && oluKaliteMuaf.length === 0,
      [...turIhlal, ...oluKaliteMuaf.map((k) => `ölü muaf ${k}`)].join(" · ") || `${kaliteFonkTur.size} fonksiyon tarandı`);

    // ── §5 ⭐ select sözleşmeleri — TABAN SAYIM ─────────────────────────────
    const AKIS_SELECT_TABANI: Record<string, number> = {
      "services/helpers/kursun-bypass-eligibility.helper.ts": 2,
      "services/inventory.service.ts": 3,
      "services/kursun-bypass.service.ts": 3,
      "services/kursun-qc.service.ts": 3,
    };
    // KQ-D7: hata yazma kapısı `roll-defect.helper`a taşındı (inventory/tambur seçimi oraya geçti).
    const KALITE_SELECT_TABANI: Record<string, number> = {
      "services/helpers/roll-defect.helper.ts": 2,
      "services/kursun-qc.service.ts": 3,
      "services/tambur.service.ts": 1,
    };
    const selectIhlal: string[] = [];
    for (const [tablo, ad] of [[AKIS_SELECT_TABANI, "STEP_FLOW_SELECT"], [KALITE_SELECT_TABANI, "STEP_QUALITY_SELECT"]] as const) {
      for (const [dosya, beklenen] of Object.entries(tablo)) {
        const ham = kaynaklar.get(dosya);
        if (!ham) { selectIhlal.push(`${dosya}: DOSYA YOK (taban bayat)`); continue; }
        const bulunan = (yorumlariSok(ham).match(new RegExp(ad, "g")) ?? []).length;
        if (bulunan < beklenen) selectIhlal.push(`${dosya} ${ad}: ${beklenen} bekleniyor, ${bulunan} var`);
      }
    }
    check("§5 ⭐ select kullanımı taban sayımın ALTINA düşmedi (akış + kalite)",
      selectIhlal.length === 0, selectIhlal.join(" · ") || "0 ihlal");
    const akisOkumayan: string[] = [];
    const kaliteOkumayan: string[] = [];
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith(HELPER)) continue;
      const s = yorumlariSok(ham);
      if (s.includes("stepRunsStepFlow(") && !s.includes("STEP_FLOW_SELECT") && !/appliesQuality:\s*true/.test(s)) akisOkumayan.push(ad);
      if (/stepCanApplyQuality\(|stationCanInspect\(/.test(s) && !s.includes("STEP_QUALITY_SELECT") && !/inspectionEnabled:\s*true/.test(s)) kaliteOkumayan.push(ad);
    }
    check("§5 akış yüklemini çağıran her dosya akış alanlarını okuyor", akisOkumayan.length === 0, akisOkumayan.join(", ") || "0 ihlal");
    check("§5 kalite yüklemini çağıran her dosya `inspectionEnabled` okuyor", kaliteOkumayan.length === 0, kaliteOkumayan.join(", ") || "0 ihlal");

    // ── §6 Helper hijyeni ───────────────────────────────────────────────────
    const tumKod = [...kaynaklar.values()].map(yorumlariSok).join("\n");
    const WHERE_ADLARI = ["STEP_FLOW_WHERE", "QUALITY_STATION_WHERE", "KURSUN_DISPATCH_STATION_WHERE"];
    check("§6 where parçaları SPREAD ile kullanılıyor (mutasyon yok)",
      WHERE_ADLARI.every((w) => !new RegExp(`${w}\\.\\w`).test(tumKod)));
    const cakisma: string[] = [];
    for (const [ad, ham] of kaynaklar) {
      const s = yorumlariSok(ham);
      for (const w of WHERE_ADLARI) {
        if (new RegExp(`OR:\\s*\\[[\\s\\S]{0,400}?\\.\\.\\.${w}\\b`).test(s) && w === "STEP_FLOW_WHERE") cakisma.push(`${ad} (${w})`);
      }
    }
    check("§6 OR taşıyan `STEP_FLOW_WHERE` spread'i ile aynı kapsamda ikinci `OR:` yok",
      cakisma.length === 0, cakisma.join(", ") || "0 çakışma");

    // ── §7 ⭐ Migration türetmesi ↔ doğuş tablosu (tx + ROLLBACK) + seed ─────
    const migDizin = (await fs.readdir("prisma/migrations")).filter((d) => d.endsWith("_station_inspection_enabled"));
    check("§7 zemin: migration TEK dizinde", migDizin.length === 1, migDizin.join(", ") || "YOK");
    const migSql = migDizin.length === 1
      ? await fs.readFile(`prisma/migrations/${migDizin[0]}/migration.sql`, "utf8") : "";
    const migKod = migSql.replace(/--.*$/gm, "");
    check("§7 ADD COLUMN idempotent (`IF NOT EXISTS`)",
      /ADD COLUMN IF NOT EXISTS "inspectionEnabled" BOOLEAN NOT NULL DEFAULT false/.test(migKod));
    const updateSql = migKod.match(/UPDATE\s+"stations"[\s\S]*?;/)?.[0] ?? "";
    check("§7 zemin: UPDATE ifadesi dosyadan okundu", updateSql.length > 30, updateSql.replace(/\s+/g, " ").slice(0, 90));
    const ROLLBACK = new Error("ROLLBACK-SONDA");
    const sqlSonuc: Array<{ kind: StationKind; q: boolean; ins: boolean }> = [];
    try {
      await prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const kind of tumTurler) {
          for (const q of [true, false]) {
            // Başlangıç değeri BEKLENENİN TERSİ: UPDATE gerçekten çalışmazsa kırmızı.
            const st = await tx.station.create({
              data: {
                code: `TSQCMIG-${ids.length}-${ts}`, // kod kolonu 32 karakter
                name: `TEST Migration Türetme ${kind} ${q} ${ts}`,
                type: "INTERNAL", kind, appliesQuality: q,
                inspectionEnabled: !inspectionDefaultForKind(kind),
              },
              select: { id: true },
            });
            ids.push(st.id);
          }
        }
        await tx.$executeRawUnsafe(updateSql);
        const satirlar = await tx.station.findMany({
          where: { id: { in: ids } },
          select: { kind: true, appliesQuality: true, inspectionEnabled: true },
        });
        for (const r of satirlar) sqlSonuc.push({ kind: r.kind, q: r.appliesQuality, ins: r.inspectionEnabled });
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    const sqlYanlis = sqlSonuc.filter((r) => r.ins !== inspectionDefaultForKind(r.kind));
    check("§7 ⭐ migration UPDATE her StationKind × appliesQuality'de `inspectionDefaultForKind` ile AYNI",
      sqlSonuc.length === tumTurler.length * 2 && sqlYanlis.length === 0,
      sqlYanlis.map((r) => `${r.kind}/${r.q}→${r.ins}`).join(", ") || `${sqlSonuc.length} satır`);
    const geriAlindi = await prisma.station.count({ where: { code: { startsWith: "TSQCMIG-" } } });
    check("§7 tx ROLLBACK edildi (geçici satır kalmadı)", geriAlindi === 0, `${geriAlindi} satır`);

    const seedSrc = await fs.readFile("prisma/seed.ts", "utf8");
    const blok = (kod: string) => {
      const i = seedSrc.indexOf(`code: "${kod}"`);
      return i < 0 ? "" : seedSrc.slice(i, i + 400);
    };
    check("§7 seed KURSUN_KK2 + TAMBUR_1 `inspectionEnabled: true` AÇIK yazar (migration boş tabloda koşar)",
      /inspectionEnabled:\s*true/.test(blok("KURSUN_KK2")) && /inspectionEnabled:\s*true/.test(blok("TAMBUR_1")));
    check("§7 seed KURSUN_KK2 `appliesQuality: true` yazar (akış köprüsü)", /appliesQuality:\s*true/.test(blok("KURSUN_KK2")));
    const seedSatir = await prisma.station.findMany({
      where: { code: { in: ["KK1_1", "KURSUN_KK2", "TAMBUR_1"] } },
      select: { code: true, kind: true, inspectionEnabled: true },
    });
    const seedYanlis = seedSatir.filter((r) => r.inspectionEnabled !== inspectionDefaultForKind(r.kind));
    check("§7 canlı DB seed satırları: KK2/Tambur true, KK1 false", seedSatir.length === 3 && seedYanlis.length === 0,
      seedSatir.map((r) => `${r.code}=${r.inspectionEnabled}`).join(" "));

    // ── §8 ⭐ AST — ikizlerin YAPISI ─────────────────────────────────────────
    const helperAst = tsc.createSourceFile(helperYol, helperSrc, tsc.ScriptTarget.Latest, true);
    const ust = helperAst.statements;
    const fnIdx = (ad: string) => ust.findIndex((st) => tsc.isFunctionDeclaration(st) && st.name?.text === ad);
    const varIdx = (ad: string) => ust.findIndex((st) => tsc.isVariableStatement(st) &&
      st.declarationList.declarations.some((d) => tsc.isIdentifier(d.name) && d.name.text === ad));
    const varInit = (ad: string): tsc.Expression | undefined => {
      const st = ust[varIdx(ad)];
      return st && tsc.isVariableStatement(st)
        ? st.declarationList.declarations.find((d) => tsc.isIdentifier(d.name) && d.name.text === ad)?.initializer
        : undefined;
    };
    for (const [fn, wh] of [["stepRunsStepFlow", "STEP_FLOW_WHERE"], ["stepCanApplyQuality", "QUALITY_STATION_WHERE"]] as const) {
      const a = fnIdx(fn);
      const b = varIdx(wh);
      check(`§8 ⭐ ${fn} ↔ ${wh} AYNI dosyada ve YAN YANA`, a !== -1 && b !== -1 && b - a === 1, `yüklem@${a} where@${b}`);
    }
    for (const wh of WHERE_ADLARI) {
      const init = varInit(wh);
      check(`§8 ⭐ ${wh} \`satisfies Prisma.StationWhereInput\` (AST, \`as const\` DEĞİL)`,
        !!init && tsc.isSatisfiesExpression(init) && init.type.getText(helperAst) === "Prisma.StationWhereInput",
        init ? tsc.SyntaxKind[init.kind] : "initializer YOK");
    }
    const pqcMi = (n: tsc.Node): boolean =>
      (tsc.isStringLiteralLike(n) && n.text === "PROCESS_QC") ||
      (tsc.isPropertyAccessExpression(n) && n.name.text === "PROCESS_QC");
    let esitlikSayisi = 0;
    const astIhlal: string[] = [];
    for (const [ad, ham] of kaynaklar) {
      const sf = tsc.createSourceFile(ad, ham, tsc.ScriptTarget.Latest, true);
      const gez = (n: tsc.Node): void => {
        if (tsc.isBinaryExpression(n) &&
          (n.operatorToken.kind === tsc.SyntaxKind.EqualsEqualsEqualsToken ||
            n.operatorToken.kind === tsc.SyntaxKind.ExclamationEqualsEqualsToken)) {
          esitlikSayisi++;
          if (!ad.startsWith(HELPER) && (pqcMi(n.left) || pqcMi(n.right))) {
            astIhlal.push(`${ad}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
          }
        }
        tsc.forEachChild(n, gez);
      };
      gez(sf);
    }
    check("§8 zemin: AST gezildi (`===`/`!==` düğümü bulundu)", esitlikSayisi > 1000, `${esitlikSayisi} karşılaştırma`);
    check("§8 ⭐ helper DIŞINDA `=== PROCESS_QC` karşılaştırması YOK", astIhlal.length === 0, astIhlal.join(", ") || "0 ihlal");
    // Akış türü okuması helper içinde YALNIZ akış ikizinde.
    const helperPqcFonk = new Set<string>();
    const gezH = (n: tsc.Node): void => {
      if (tsc.isBinaryExpression(n) && (pqcMi(n.left) || pqcMi(n.right))) helperPqcFonk.add(sarmalayanFonksiyon(n));
      tsc.forEachChild(n, gezH);
    };
    gezH(helperAst);
    check("§8 helper içinde `=== PROCESS_QC` yalnız akış ikizinde",
      [...helperPqcFonk].every((f) => f === "stepRunsStepFlow") && helperPqcFonk.size === 1, [...helperPqcFonk].join(", "));

    // ── §9 ⭐ İki gövde birbirinin alanını okumaz ────────────────────────────
    const fnGovde = (ad: string) => {
      const st = ust[fnIdx(ad)];
      return st && tsc.isFunctionDeclaration(st) && st.body ? st.body : undefined;
    };
    const akisGovde = fnGovde("stepRunsStepFlow");
    const kaliteGovde = fnGovde("stepCanApplyQuality");
    const akisAdlar = akisGovde ? gecenAdlar(akisGovde) : new Set<string>();
    const kaliteAdlar = kaliteGovde ? gecenAdlar(kaliteGovde) : new Set<string>();
    check("§9 zemin: iki gövde de bulundu ve okuma yapıyor",
      akisAdlar.has("appliesQuality") && kaliteAdlar.has("inspectionEnabled"),
      `akış {${[...akisAdlar].join(",")}} kalite {${[...kaliteAdlar].join(",")}}`);
    check("§9 ⭐ AKIŞ gövdesi `inspectionEnabled` OKUMAZ (Tambur akışa/dağıtıma düşmez)", !akisAdlar.has("inspectionEnabled"));
    const kaliteYasak = ["kind", "appliesQuality", "StationKind"].filter((a) => kaliteAdlar.has(a));
    check("§9 ⭐ KALİTE gövdesi `kind`/`appliesQuality`/`StationKind` OKUMAZ", kaliteYasak.length === 0, kaliteYasak.join(", ") || "temiz");

    // ── §10 K4P adı aynı nesne ──────────────────────────────────────────────
    const aliasInit = varInit("stationCanInspect");
    check("§10 `stationCanInspect === stepCanApplyQuality` (çalışma zamanı + AST: düz atama, sarmalayıcı yok)",
      stationCanInspect === stepCanApplyQuality && !!aliasInit && tsc.isIdentifier(aliasInit) && aliasInit.text === "stepCanApplyQuality");

    // ── §11 ⭐ Kalite tüketici beyanı iki yönlü ─────────────────────────────
    const kullanim = new Map<string, number>();
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith(HELPER) || ![...KALITE_ADLARI].some((k) => ham.includes(k))) continue;
      const sf = tsc.createSourceFile(ad, ham, tsc.ScriptTarget.Latest, true);
      const gez = (n: tsc.Node): void => {
        if (tsc.isIdentifier(n) && KALITE_ADLARI.has(n.text) && !importIcinde(n)) {
          const anahtar = `${ad}#${sarmalayanFonksiyon(n)}`;
          kullanim.set(anahtar, (kullanim.get(anahtar) ?? 0) + 1);
        }
        tsc.forEachChild(n, gez);
      };
      gez(sf);
    }
    const beyanAnahtar = new Set(KALITE_TUKETICI_BEYANI.map((b) => `${b.dosya}#${b.fonksiyon}`));
    const beyansiz = [...kullanim.keys()].filter((k) => !beyanAnahtar.has(k));
    const oluBeyan = [...beyanAnahtar].filter((k) => !kullanim.has(k));
    check("§11 zemin: kalite kullanımı bulundu", kullanim.size >= 4, `${kullanim.size} fonksiyon`);
    check("§11 ⭐ her kalite ikizi kullanımı BEYANLI", beyansiz.length === 0, beyansiz.join(" · ") || "0 beyansız");
    check("§11 ⭐ ölü beyan YOK (beyanın kullanımı var)", oluBeyan.length === 0, oluBeyan.join(" · ") || "0 ölü");
    check("§11 her beyanın gerekçesi yazılı", KALITE_TUKETICI_BEYANI.every((b) => b.gerekce.length > 20));

    // ── §12 ⭐ (DB) Kurşun dağıtım listesi = kabul ───────────────────────────
    // Ortamdaki "herhangi bir" kayda yaslanılmaz (TD-17): kumaş + aktör fikstürden.
    const item = await prisma.item.create({
      data: { code: `TSQC-${ts}`, name: `TEST Yetenek İkizi Kumaş ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    cleanupItemId = item.id;
    const actorId = await testActorId();
    const kursunProp = await prisma.fabricProperty.findFirst({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
    const tamburSeed = await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } });
    if (!kursunProp || !tamburSeed) throw new Error("Seed fixture eksik (FabricProperty KURSUN / TAMBUR_1)");
    const istasyon = async (ad: string, kind: StationKind, ins: boolean, q = false) => {
      const st = await prisma.station.create({
        data: { code: `TEST-SQC-D-${ad}-${ts}`, name: `TEST Dağıtım ${ad} ${ts}`, type: "INTERNAL", kind, appliesQuality: q, inspectionEnabled: ins },
        select: { id: true },
      });
      cleanupStationIds.push(st.id);
      return st.id;
    };
    const makine = async (stationId: string, ad: string) => {
      const m = await prisma.machine.create({
        data: { stationId, code: `TEST-SQC-M-${ad}-${ts}`, name: `TEST Makine ${ad} ${ts}`, isActive: true },
        select: { id: true },
      });
      cleanupMachineIds.push(m.id);
      return m.id;
    };
    const stTambur = await istasyon("TMB", StationKind.TAMBUR, true, false);
    const stPqcYok = await istasyon("PQC0", StationKind.PROCESS_QC, true);
    const stPqcAuto = await istasyon("PQC1", StationKind.PROCESS_QC, true);
    // Tambur'a KURSUN AUTO da verilir: listeyi tutan şey AKIŞ olmalı, yetenek değil.
    await prisma.stationProperty.create({ data: { stationId: stTambur, propertyId: kursunProp.id, mode: "AUTO" } });
    await prisma.stationProperty.create({ data: { stationId: stPqcAuto, propertyId: kursunProp.id, mode: "AUTO" } });
    const mTambur = await makine(stTambur, "TMB");
    const mPqcYok = await makine(stPqcYok, "PQC0");
    const mPqcAuto = await makine(stPqcAuto, "PQC1");

    const svc = new KursunBypassService();
    const liste = new Set((await svc.listDistribution()).data.machines.map((m) => m.id));
    check("§12 ⭐ muayeneli (appliesQuality=false) TAMBUR makinesi listede YOK", !liste.has(mTambur));
    check("§12 ⭐ KURSUN AUTO'suz PROCESS_QC makinesi listede YOK", !liste.has(mPqcYok));
    check("§12 KURSUN AUTO'lu PROCESS_QC makinesi listede VAR (zemin)", liste.has(mPqcAuto));

    // assign kabulü: AUTO'suz makine 400, AUTO'lu makine kabul — aynı parça.
    const flagSatir = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED }, select: { value: true } });
    flagOnceki = flagSatir ? flagSatir.value : null;
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
      create: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED, value: true, description: "TEST — kurşun bypass bayrağı" },
      update: { value: true },
    });
    const isEmri = async (sira: number) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-SQC-${ts}-${sira}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
          targetItemId: item.id,
          steps: { create: [
            { stationId: stPqcAuto, stepSequence: 1, status: StepStatus.ACTIVE },
            { stationId: tamburSeed.id, stepSequence: 2, status: StepStatus.PENDING },
          ] },
        },
        select: { id: true, steps: { select: { id: true, stepSequence: true } } },
      });
      cleanupWoIds.push(wo.id);
      const stepId = wo.steps.find((s) => s.stepSequence === 1)!.id;
      const roll = await prisma.roll.create({
        data: { barcode: null, itemId: item.id, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION,
          currentStepId: stepId, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK },
        select: { id: true },
      });
      cleanupRollIds.push(roll.id);
      await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: 100 } });
      return wo.id;
    };
    const wo1 = await isEmri(1);
    let red: unknown = null;
    try { await svc.assign({ workOrderId: wo1, machineId: mPqcYok }, actorId); } catch (e) { red = e; }
    check("§12 ⭐ listede olmayan (AUTO'suz) makineye `assign` 400",
      red instanceof AppError && red.statusCode === 400 && /OTOMATİK/.test(red.message),
      red instanceof Error ? red.message.slice(0, 80) : "HATA YOK");
    let red2: unknown = null;
    try { await svc.assign({ workOrderId: wo1, machineId: mTambur }, actorId); } catch (e) { red2 = e; }
    check("§12 listede olmayan TAMBUR makinesine `assign` 400",
      red2 instanceof AppError && red2.statusCode === 400, red2 instanceof Error ? red2.message.slice(0, 80) : "HATA YOK");
    const kabul = await svc.assign({ workOrderId: wo1, machineId: mPqcAuto }, actorId);
    check("§12 listedeki makineye `assign` KABUL (liste = kabul)", kabul.success === true && kabul.data.machineId === mPqcAuto);
  } finally {
    await prisma.kursunBypassAssignment.deleteMany({ where: { workOrderId: { in: cleanupWoIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: cleanupRollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: cleanupRollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: cleanupWoIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: cleanupWoIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...cleanupWoIds, ...cleanupRollIds] } } }).catch(() => {});
    if (cleanupItemId) await prisma.item.deleteMany({ where: { id: cleanupItemId } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: { in: cleanupMachineIds } } }).catch(() => {});
    await prisma.stationProperty.deleteMany({ where: { stationId: { in: cleanupStationIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: cleanupStationIds } } }).catch(() => {});
    if (flagOnceki !== undefined) {
      if (flagOnceki === null) {
        await prisma.systemSetting.delete({ where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED } }).catch(() => {});
      } else {
        await prisma.systemSetting.update({
          where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
          data: { value: flagOnceki as Prisma.InputJsonValue },
        }).catch(() => {});
      }
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
