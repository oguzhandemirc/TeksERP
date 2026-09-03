// =============================================================================
// Test: KALİTE = İSTASYON YETENEĞİ — İKİZ BOĞAZ (P4 Faz A, 2026-09-03)
// Çalıştır: npx tsx scripts/test_station_quality_capability.ts
// =============================================================================
// Korunan invariant: "bu ADIM kalite kontrol yürütür mü" sorusunun TEK cevabı
// `src/services/helpers/quality-station.helper.ts`tir ve o cevap İKİ BİÇİMDE
// yaşar (saf yüklem + Prisma where parçası). Bekçinin asıl işi ikisinin
// AYRIŞMADIĞINI ölçmek: biri yeteneğe biri türe bakmaya başlarsa listede
// görünen makine seçilince 400 alınır ve dağıtımcı sebebi anlayamaz
// (emsal: kursun-bypass makine listesi ↔ atama kabulü çifti).
//
// Bölümler:
//   §1 Zemin (helper okunabildi, ikiz kullanımı gerçekten yayıldı)
//   §2 Yüklem doğruluk tablosu (Faz A köprüsü dahil)
//   §3 ⭐ İKİZ EŞDEĞERLİĞİ — CANLI DB'de where ↔ yüklem aynı kümeyi verir
//   §4 ⭐ Karar noktasında `kind === PROCESS_QC` KALMADI (gerekçeli muaflar)
//   §5 ⭐ select sözleşmesi — yüklemi çağıran her yer `appliesQuality` okur
//   §6 Helper hijyeni (`satisfies`, spread, tek hata metni)
//   §7 Backfill + seed (canlı DB ölçümü)
//
// SONDA TABLOSU (hepsi ölçüldü; cp+md5 ile birebir geri alındı). Taban 22/0.
//   S1 `QUALITY_STATION_WHERE`den `appliesQuality` dalı silinir → §3 kırmızı (3)
//   S2 yüklemden `appliesQuality` dalı silinir                  → §2+§3 kırmızı (2)
//   S3 bir çağrı yeri `kind === PROCESS_QC`e döner              → §4 kırmızı (muaf 1↔2)
//   S4 bir select'ten `STEP_QUALITY_SELECT` düşer               → §5 kırmızı (3↔2)
//   S5 helper'da `satisfies` → `as const`                       → §6 kırmızı
//
// ⚠️ İKİ KONTROL İLK YAZIMDA KÖRDÜ ve sonda onu ölçtü — kalıp kayda değer:
//   • §4 muafı DOSYA bazındaydı → muaf dosyaya eklenen YENİ tür kontrolü
//     sessizce kapsanıyordu (S3 yeşil kalmıştı). Muaf artık SAYIM taşır.
//   • §5 "dosyada STEP_QUALITY_SELECT geçiyor mu" diye bakıyordu → aynı
//     dosyadaki İKİNCİ select'in alanı atlaması gizleniyordu (S4 yeşil
//     kalmıştı). Şimdi dosya başına TABAN SAYIM kilitli.
//   "Kind seçen her select yüklem içindir" varsayımı da ölçümle çürüdü:
//   `currentStepKind` gibi GÖRÜNTÜLEME select'leri de `kind` okur.
// =============================================================================
import prisma from "../src/lib/prisma";
import { StationKind } from "@prisma/client";
import {
  stepCanApplyQuality,
  QUALITY_STATION_WHERE,
  QUALITY_STEP_ERROR,
  STEP_QUALITY_SELECT,
} from "../src/services/helpers/quality-station.helper";

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

/**
 * §4'ün GEREKÇELİ MUAFLARI — her satır "neden hâlâ türe bakıyor"u yazar.
 * ⚠️ İKİ YÖNLÜ: listede olup dosyada karşılığı kalmayan satır da KIRMIZI
 * (ölü muaf, bayat gerekçe).
 */
const KIND_MUAF: Record<string, { sayi: number; gerekce: string }> = {
  "services/kursun-qc.service.ts": {
    sayi: 1,
    gerekce:
      "assertWoAtStepKind(PROCESS_QC) — `roll-step.helper` TAMBUR ile PAYLAŞILIYOR " +
      "(tambur.service:451/:3705); imzasını yetenekleştirmek Tambur kart-okutma " +
      "yolunu da değiştirirdi, yani Faz A'nın 'davranış birebir' iddiasını kırardı (Faz B).",
  },
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

async function main() {
  const ts = Date.now();
  const fs = await import("node:fs/promises");
  const cleanupStationIds: string[] = [];

  try {
    // ── §1 Zemin ────────────────────────────────────────────────────────────
    const helperSrc = await fs.readFile(
      "src/services/helpers/quality-station.helper.ts",
      "utf8",
    );
    check("§1 zemin: helper okunabildi", helperSrc.length > 500, `${helperSrc.length} bayt`);
    check("§1 zemin: hata metni tek kaynakta", QUALITY_STEP_ERROR.length > 10, QUALITY_STEP_ERROR);

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

    // İkiz gerçekten YAYILDI mı? (çözücü boşa düşerse §4/§5 vakumen yeşile döner)
    let yuklemCagri = 0;
    let whereCagri = 0;
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith("services/helpers/quality-station.helper")) continue;
      const s = yorumlariSok(ham);
      yuklemCagri += (s.match(/stepCanApplyQuality\(/g) ?? []).length;
      whereCagri += (s.match(/\.\.\.QUALITY_STATION_WHERE/g) ?? []).length;
    }
    check("§1 zemin: saf yüklem çağrısı yayıldı (>=7)", yuklemCagri >= 7, `${yuklemCagri} çağrı`);
    check("§1 zemin: where parçası yayıldı (>=10)", whereCagri >= 10, `${whereCagri} kullanım`);

    // ── §2 Yüklem doğruluk tablosu ──────────────────────────────────────────
    check("§2 PROCESS_QC + appliesQuality=false → TRUE (Faz A köprüsü)",
      stepCanApplyQuality({ kind: StationKind.PROCESS_QC, appliesQuality: false }) === true);
    check("§2 OTHER + appliesQuality=true → TRUE (yeni kapı)",
      stepCanApplyQuality({ kind: StationKind.OTHER, appliesQuality: true }) === true);
    check("§2 OTHER + appliesQuality=false → FALSE",
      stepCanApplyQuality({ kind: StationKind.OTHER, appliesQuality: false }) === false);
    check("§2 null/undefined → FALSE (fail-closed)",
      stepCanApplyQuality(null) === false && stepCanApplyQuality(undefined) === false);

    // ── §3 ⭐ İKİZ EŞDEĞERLİĞİ (canlı DB) ────────────────────────────────────
    // Dört köşe fixture: türü/yeteneği çaprazla. `where` sonucu ile yüklem
    // sonucu BİREBİR aynı kümeyi vermeli — ayrışma buradan görünür.
    const kose: Array<{ ad: string; kind: StationKind; q: boolean }> = [
      { ad: "PQC-Q", kind: StationKind.PROCESS_QC, q: true },
      { ad: "PQC-N", kind: StationKind.PROCESS_QC, q: false },
      { ad: "OTH-Q", kind: StationKind.OTHER, q: true },
      { ad: "OTH-N", kind: StationKind.OTHER, q: false },
    ];
    const idAd = new Map<string, string>();
    for (const k of kose) {
      const st = await prisma.station.create({
        data: {
          code: `TEST-SQC-${k.ad}-${ts}`,
          name: `TEST Kalite Yeteneği ${k.ad}`,
          type: "INTERNAL",
          kind: k.kind,
          appliesQuality: k.q,
        },
        select: { id: true },
      });
      cleanupStationIds.push(st.id);
      idAd.set(st.id, k.ad);
    }

    const hepsi = await prisma.station.findMany({
      where: { id: { in: cleanupStationIds } },
      select: { id: true, ...STEP_QUALITY_SELECT },
    });
    const yuklemKume = new Set(
      hepsi.filter((s) => stepCanApplyQuality(s)).map((s) => idAd.get(s.id)!),
    );
    const whereSatirlar = await prisma.station.findMany({
      where: { id: { in: cleanupStationIds }, ...QUALITY_STATION_WHERE },
      select: { id: true },
    });
    const whereKume = new Set(whereSatirlar.map((s) => idAd.get(s.id)!));

    const yuklemStr = [...yuklemKume].sort().join(",");
    const whereStr = [...whereKume].sort().join(",");
    check("§3 ⭐ yüklem ile where AYNI kümeyi verir (ikiz ayrışmadı)",
      yuklemStr === whereStr, `yüklem={${yuklemStr}} where={${whereStr}}`);
    check("§3 küme BEKLENEN üç köşe (PQC-N Faz A köprüsüyle İÇERİDE)",
      whereStr === "OTH-Q,PQC-N,PQC-Q", whereStr);
    // Zemin: sorgu gerçekten süzüyor mu (hepsini döndürseydi eşitlik yalancı olurdu)
    check("§3 zemin: where dört köşenin hepsini döndürmüyor",
      whereSatirlar.length === 3, `${whereSatirlar.length}/4`);

    // ── §4 ⭐ KODDA `PROCESS_QC` literali KALMADI (gerekçeli muaflar dışında) ─
    // Kalıp BİLEREK GENİŞ: yalnız `===` aramak, aynı soruyu başka biçimde soran
    // yolları kaçırır — `assertWoAtStepKind(StationKind.PROCESS_QC)` bir karar
    // noktasıdır ama karşılaştırma operatörü taşımaz (Faz B'ye bırakıldı ve
    // AŞAĞIDA gerekçeli muaftır). Yorumlar ve Swagger blokları söküldüğü için
    // dokümantasyon metni bu taramaya girmez.
    const kararKalibi = /(StationKind\.PROCESS_QC|["']PROCESS_QC["'])/;
    const ihlaller: string[] = [];
    const kullanilanMuaf = new Set<string>();
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith("services/helpers/quality-station.helper")) continue;
      const s = yorumlariSok(ham);
      const bulunan = (s.match(new RegExp(kararKalibi.source, "g")) ?? []).length;
      if (bulunan === 0) continue;
      const muaf = KIND_MUAF[ad];
      if (muaf) {
        kullanilanMuaf.add(ad);
        // ⚠️ SAYIM BAZLI: muafı dosya bazında yazmak, o dosyaya eklenen YENİ bir
        //    tür kontrolünü sessizce kapsar (sonda S3 bunu ölçtü ve bekçi kör
        //    kalmıştı). Beklenen sayı aşılırsa kırmızı.
        if (bulunan !== muaf.sayi) {
          ihlaller.push(`${ad}: muaf ${muaf.sayi} bekliyor, ${bulunan} bulundu`);
        }
        continue;
      }
      const satir = s.split("\n").findIndex((l) => kararKalibi.test(l)) + 1;
      ihlaller.push(`${ad}:${satir}`);
    }
    check("§4 ⭐ karar noktasında `PROCESS_QC` literali KALMADI (muaf sayıları dahil)",
      ihlaller.length === 0, ihlaller.join(" · ") || "0 ihlal");
    const oluMuaf = Object.keys(KIND_MUAF).filter((k) => !kullanilanMuaf.has(k));
    check("§4 muaf listesi ÖLÜ satır taşımıyor (iki yönlü)",
      oluMuaf.length === 0, oluMuaf.join(", ") || "0 ölü");
    check("§4 her muafın gerekçesi yazılı",
      Object.values(KIND_MUAF).every((r) => r.gerekce.length > 20));

    // ── §5 ⭐ select sözleşmesi ──────────────────────────────────────────────
    // Yüklem `appliesQuality`yi okur; select'te alan yoksa `undefined` gelir ve
    // yüklem SESSİZCE false döner (Faz A'da `kind` dalı kurtarır, Faz B'de
    // kurtarmaz) — yani bugün sessiz, yarın davranış farkı.
    // ── §5 ⭐ select sözleşmesi — TABAN SAYIM ─────────────────────────────
    // Yüklem `appliesQuality`yi okur; select'te alan yoksa `undefined` gelir ve
    // yüklem SESSİZCE false döner (Faz A'da `kind` dalı kurtarır, Faz B'de
    // KURTARMAZ) — bugün sessiz, yarın davranış farkı.
    // ⚠️ NEDEN SAYIM: "dosyada STEP_QUALITY_SELECT geçiyor mu" kontrolü, aynı
    //    dosyadaki İKİNCİ bir select'in alanı atlamasını gizler (sonda S4 bunu
    //    ölçtü, bekçi kör kalmıştı). "Kind seçen her select yüklem içindir"
    //    varsayımı da yanlış: `currentStepKind` gibi GÖRÜNTÜLEME select'leri de
    //    `kind` okur. Bu yüzden taban SAYIM kilitlenir — düşerse kırmızı.
    const SELECT_TABANI: Record<string, number> = {
      "services/helpers/kursun-bypass-eligibility.helper.ts": 2,
      "services/inventory.service.ts": 3,
      "services/kursun-bypass.service.ts": 3,
      "services/kursun-qc.service.ts": 3,
    };
    const selectIhlal: string[] = [];
    for (const [ad, beklenen] of Object.entries(SELECT_TABANI)) {
      const ham = kaynaklar.get(ad);
      if (!ham) { selectIhlal.push(`${ad}: DOSYA YOK (taban bayat)`); continue; }
      const bulunan = (yorumlariSok(ham).match(/STEP_QUALITY_SELECT/g) ?? []).length;
      if (bulunan < beklenen) selectIhlal.push(`${ad}: ${beklenen} bekleniyor, ${bulunan} var`);
    }
    check("§5 ⭐ `STEP_QUALITY_SELECT` kullanımı taban sayımın ALTINA düşmedi",
      selectIhlal.length === 0, selectIhlal.join(" · ") || "0 ihlal");
    // Yüklemi çağıran ama select sözleşmesini hiç kullanmayan dosya (kaba ağ):
    const hicOkumayan: string[] = [];
    for (const [ad, ham] of kaynaklar) {
      if (ad.startsWith("services/helpers/quality-station.helper")) continue;
      const s = yorumlariSok(ham);
      if (!s.includes("stepCanApplyQuality(")) continue;
      if (!s.includes("STEP_QUALITY_SELECT") && !/appliesQuality:\s*true/.test(s)) hicOkumayan.push(ad);
    }
    check("§5 yüklemi çağıran her dosya `appliesQuality` alanını da okuyor",
      hicOkumayan.length === 0, hicOkumayan.join(", ") || "0 ihlal");

    // ── §6 Helper hijyeni ───────────────────────────────────────────────────
    const helperKod = yorumlariSok(helperSrc);
    check("§6 `QUALITY_STATION_WHERE` `satisfies` ile yazılmış (`as const` DEĞİL)",
      /QUALITY_STATION_WHERE[\s\S]{0,200}satisfies Prisma\.StationWhereInput/.test(helperKod) &&
        !/QUALITY_STATION_WHERE[\s\S]{0,200}as const/.test(helperKod));
    check("§6 where parçası SPREAD ile kullanılıyor (mutasyon yok)",
      !/QUALITY_STATION_WHERE\.\w/.test(
        [...kaynaklar.values()].map(yorumlariSok).join("\n"),
      ));
    // Aynı anahtar çakışması: `station: { OR: [...], ...QUALITY_STATION_WHERE }`
    // yazılırsa biri SESSİZCE kaybolur.
    const cakisma: string[] = [];
    for (const [ad, ham] of kaynaklar) {
      const s = yorumlariSok(ham);
      if (/OR:\s*\[[\s\S]{0,400}?\.\.\.QUALITY_STATION_WHERE/.test(s)) cakisma.push(ad);
    }
    check("§6 spread ile aynı kapsamda ikinci `OR:` yok",
      cakisma.length === 0, cakisma.join(", ") || "0 çakışma");

    // ── §7 Backfill + seed ──────────────────────────────────────────────────
    const kacikPqc = await prisma.station.count({
      where: { kind: StationKind.PROCESS_QC, appliesQuality: false, id: { notIn: cleanupStationIds } },
    });
    check("§7 canlı veri: PROCESS_QC istasyonların hepsi appliesQuality=true (backfill)",
      kacikPqc === 0, `${kacikPqc} kaçak`);
    const seedSrc = await fs.readFile("prisma/seed.ts", "utf8");
    const kk2Blok = seedSrc.slice(
      Math.max(0, seedSrc.indexOf("KURSUN_KK2") - 400),
      seedSrc.indexOf("KURSUN_KK2") + 400,
    );
    check("§7 seed KURSUN_KK2 `appliesQuality: true` YAZAR (migration boş tabloda koşar)",
      /appliesQuality:\s*true/.test(kk2Blok), kk2Blok.includes("KURSUN_KK2") ? "blok bulundu" : "blok YOK");
  } finally {
    await prisma.station.deleteMany({ where: { id: { in: cleanupStationIds } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
