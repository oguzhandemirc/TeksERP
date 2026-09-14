// =============================================================================
// ONARIM — Fasondan kısmi doğrudan sevkte düşürülen ebeveyn `initialQty`si
// Çalıştır: npx tsx scripts/fix_fason_directship_initialqty.ts          (TEŞHİS — hiçbir şey yazmaz)
//           npx tsx scripts/fix_fason_directship_initialqty.ts --apply --onay=<N> --kod-yayinda [--sec=<barkod|id>,...]
// =============================================================================
// Hata: `createFasonShipChild` ebeveynin `currentQty`siyle birlikte `initialQty`sini de
// çocuğun metrajı kadar düşürüyordu (düzeltme `5980ff06` · bkz. arşiv 2026-09-11 fason initialQty).
// Doğrudan sevk terminaldir; hasar kendiliğinden kapanmaz.
//
// İMZA — bağımsız çapa `SubcontractorDispatchItem.dispatchedQty` (D: fasona sevk anındaki metraj).
//   Kısmi-sevk çocuğu = `directShipmentId` dolu ama HİÇBİR sevkin kalemi olmayan top (tam sevk
//   edilen top daima kalemdir; bölünmeyle doğan çocuk asla kalem olmaz).
//   S = Σ çocuk initialQty · Rp = Σ aktif kısmi kabul receivedQty · I/C = ebeveynin şimdiki metrajları
//     KESİN    I + S = D  ve  C = D − S − Rp   (hasar + kalan zinciri tutuyor) → --apply I := D
//     TEMİZ    I = D
//     BELİRSİZ diğer her durum — tek tek listelenir, --apply DOKUNMAZ.
//   NEDEN `I < S + C` DEĞİL: kısmi kabul C'yi de düşürür ve hasarı gizler (300 m → 100 sevk →
//   100 kısmi kabul: hasarlı I=200, S+C=200 → "temiz" görünür).
//
// DEFTER KARARI — `RollVariance` YAZILMAZ; iz audit'e (`event: FASON_DIRECT_SHIP_INITIALQTY_RESTORE`).
//   RollVariance fiziksel metraj sapmasının defteridir (SCRAP mal vardı-gitti · RECORD_CORRECTION mal
//   hiç yoktu · OVERAGE fazla çıktı). Buradaki metre gerçekti ve müşteriye gitti; olay zaten
//   DirectShipment + çocuk top defterinde. Bozuk olan yalnız giriş SNAPSHOT'ı ve doğru değer kalıcı
//   kolona döner. Sapma satırı fire/düzeltme raporuna hayalet metraj yazar, tambur-undo'nun rollId
//   bazlı sapma toplamına karışır. "Kolon onarıldı" bilgisi yalnız denetime girer → audit.
//
// SIRA — ÖNCE KOD: eski backend `computeWoInput`ta hasarı çocuk metrajıyla TELAFİ ediyor; onarım
// eski kodun üstünde koşarsa iş emri girdi metrajı ÇİFT sayılır. `--kod-yayinda` bu beyandır.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";

import { FACTORY_TIMEZONE } from "../src/constants/time";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";

const KAYNAK = "scripts/fix_fason_directship_initialqty.ts";
const OLAY = "FASON_DIRECT_SHIP_INITIALQTY_RESTORE";
const SIFIR = new Prisma.Decimal(0);

export type Hukum = "KESIN" | "BELIRSIZ" | "TEMIZ";

export interface KismiSevk {
  cocukId: string;
  barkod: string | null;
  metraj: Prisma.Decimal;
  sevkNo: string;
  sevkTarihi: Date;
  musteri: string;
}

export interface EbeveynBulgusu {
  rollId: string;
  barkod: string | null;
  durum: RollStatus;
  isEmriNo: string;
  fasonSevkNo: string;
  fasonFirma: string;
  initialQty: Prisma.Decimal;
  currentQty: Prisma.Decimal;
  /** D — null: ebeveynin o adımda tek bir aktif sevk kalemi bulunamadı. */
  sevkMetraji: Prisma.Decimal | null;
  kismiSevkToplami: Prisma.Decimal;
  kismiKabulToplami: Prisma.Decimal;
  kismiSevkler: KismiSevk[];
  hukum: Hukum;
  gerekce: string;
}

export interface TeshisRaporu {
  veritabani: string;
  kapsamli: boolean;
  toplamTop: number;
  directShipmentSayisi: number;
  sevkEdilenTop: number;
  tamSevk: number;
  kismiSevkCocugu: number;
  siraDisi: Array<{ rollId: string; barkod: string | null; sevkNo: string; neden: string }>;
  /** null = kapsamlı koşumda bakılmadı. */
  eskiDirectShipOp: number | null;
  eskiBolunmeSekilli: Array<{ rollId: string; barkod: string | null; tarih: Date }> | null;
  ebeveynler: EbeveynBulgusu[];
}

/** Saf yüklem — sonda aynı fonksiyonu sentetik ve gerçek veriyle sınar. */
export function siniflandir(g: {
  initialQty: Prisma.Decimal;
  currentQty: Prisma.Decimal;
  sevkMetraji: Prisma.Decimal | null;
  /** Oluşma sırasıyla. */
  cocukMetrajlari: Prisma.Decimal[];
  kismiKabul: Prisma.Decimal;
}): { hukum: Hukum; gerekce: string } {
  const D = g.sevkMetraji;
  if (D === null) {
    return { hukum: "BELIRSIZ", gerekce: "ebeveynin bu fason adımında tek bir aktif sevk kalemi yok (iptal/taşıma?) — çapa kurulamadı" };
  }
  const I = g.initialQty;
  const S = g.cocukMetrajlari.reduce((a, b) => a.plus(b), SIFIR);
  if (I.equals(D)) return { hukum: "TEMIZ", gerekce: "giriş metrajı sevk anındaki metrajla aynı" };

  const beklenenKalan = D.minus(S).minus(g.kismiKabul);
  if (I.plus(S).equals(D)) {
    if (!g.currentQty.equals(beklenenKalan)) {
      return {
        hukum: "BELIRSIZ",
        gerekce: `hasar imzası tutuyor ama kalan zinciri tutmuyor (currentQty ${m(g.currentQty)}, beklenen ${m(beklenenKalan)}) — sevkten sonra başka bir yazar var`,
      };
    }
    return { hukum: "KESIN", gerekce: "initialQty + Σ kısmi sevk = sevk metrajı ve kalan zinciri tutuyor" };
  }
  // Kısmi sevkler kod güncellemesinin iki yanına düştüyse yalnız ilk k tanesi düşürmüştür.
  let birikim = I;
  for (let k = 1; k < g.cocukMetrajlari.length; k++) {
    birikim = birikim.plus(g.cocukMetrajlari[k - 1]!);
    if (birikim.equals(D)) {
      return {
        hukum: "BELIRSIZ",
        gerekce: `yalnız ilk ${k}/${g.cocukMetrajlari.length} kısmi sevk imzayı tutuyor — kod bu sevkler arasında güncellenmiş olabilir (eksik ${m(D.minus(I))})`,
      };
    }
  }
  const fark = I.minus(D);
  return {
    hukum: "BELIRSIZ",
    gerekce: fark.isPositive()
      ? `giriş metrajı sevk metrajından ${m(fark)} fazla — sevk öncesi metraj değişmiş, hasarlı mı temiz mi ayırt edilemiyor (temizse ${m(I)}, hasarlıysa ${m(I.plus(S))} olmalı)`
      : `giriş metrajı sevk metrajının ${m(fark.negated())} altında ama hasar imzası (Σ sevk ${m(S)}) bunu açıklamıyor`,
  };
}

export async function teshis(kapsam?: { dispatchIds: string[] }): Promise<TeshisRaporu> {
  const dsWhere: Prisma.DirectShipmentWhereInput = kapsam ? { dispatchId: { in: kapsam.dispatchIds } } : {};
  const [db] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const toplamTop = await prisma.roll.count();
  const directShipmentSayisi = await prisma.directShipment.count({ where: dsWhere });

  const sevkEdilenler = await prisma.roll.findMany({
    where: { directShipmentId: { not: null }, ...(kapsam ? { directShipment: dsWhere } : {}) },
    select: {
      id: true,
      barcode: true,
      parentRollId: true,
      initialQty: true,
      createdAt: true,
      directShipment: {
        select: {
          shipmentNo: true,
          shippedAt: true,
          customer: { select: { code: true, name: true } },
          dispatch: { select: { stepId: true, dispatchNo: true, workOrder: { select: { workOrderNumber: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const adayEbeveynIdleri = [...new Set(sevkEdilenler.map((r) => r.parentRollId).filter((x): x is string => x != null))];
  const kalemler = await prisma.subcontractorDispatchItem.findMany({
    where: { rollId: { in: [...sevkEdilenler.map((r) => r.id), ...adayEbeveynIdleri] } },
    select: {
      rollId: true,
      dispatchedQty: true,
      dispatch: {
        select: {
          stepId: true,
          dispatchNo: true,
          cancelledAt: true,
          workOrder: { select: { workOrderNumber: true } },
          subcontractor: { select: { name: true } },
        },
      },
    },
  });
  const kalemiOlanlar = new Set(kalemler.map((k) => k.rollId));

  let tamSevk = 0;
  const siraDisi: TeshisRaporu["siraDisi"] = [];
  const cocuklarByEbeveyn = new Map<string, typeof sevkEdilenler>();
  for (const r of sevkEdilenler) {
    const ds = r.directShipment!;
    if (kalemiOlanlar.has(r.id)) {
      tamSevk++;
      continue;
    }
    if (r.parentRollId == null || !kalemiOlanlar.has(r.parentRollId)) {
      siraDisi.push({
        rollId: r.id,
        barkod: r.barcode,
        sevkNo: ds.shipmentNo,
        neden: r.parentRollId == null ? "sevk kalemi değil ve ebeveyni yok" : "sevk kalemi değil ve ebeveyninin sevk kalemi yok",
      });
      continue;
    }
    const liste = cocuklarByEbeveyn.get(r.parentRollId) ?? [];
    liste.push(r);
    cocuklarByEbeveyn.set(r.parentRollId, liste);
  }

  const ebeveynIdleri = [...cocuklarByEbeveyn.keys()];
  const ebeveynSatirlari = await prisma.roll.findMany({
    where: { id: { in: ebeveynIdleri } },
    select: { id: true, barcode: true, status: true, initialQty: true, currentQty: true },
  });
  const kismiKabuller = await prisma.subcontractorReceiptItem.findMany({
    where: { newRollId: { in: ebeveynIdleri }, isPartial: true, receipt: { cancelledAt: null } },
    select: { newRollId: true, receivedQty: true },
  });
  const kabulByEbeveyn = new Map<string, Prisma.Decimal>();
  for (const k of kismiKabuller) {
    kabulByEbeveyn.set(k.newRollId, (kabulByEbeveyn.get(k.newRollId) ?? SIFIR).plus(k.receivedQty ?? SIFIR));
  }

  const ebeveynler: EbeveynBulgusu[] = [];
  let kismiSevkCocugu = 0;
  for (const p of ebeveynSatirlari) {
    const cocuklar = cocuklarByEbeveyn.get(p.id)!;
    kismiSevkCocugu += cocuklar.length;
    const adimlar = new Set(cocuklar.map((c) => c.directShipment!.dispatch.stepId));
    const ilkSevk = cocuklar[0]!.directShipment!.dispatch;
    const aktifKalemler =
      adimlar.size === 1
        ? kalemler.filter((k) => k.rollId === p.id && k.dispatch.stepId === ilkSevk.stepId && k.dispatch.cancelledAt == null)
        : [];
    const kalem = aktifKalemler.length === 1 ? aktifKalemler[0]! : null;
    const kismiSevkler: KismiSevk[] = cocuklar.map((c) => ({
      cocukId: c.id,
      barkod: c.barcode,
      metraj: c.initialQty,
      sevkNo: c.directShipment!.shipmentNo,
      sevkTarihi: c.directShipment!.shippedAt,
      musteri: `${c.directShipment!.customer.code} ${c.directShipment!.customer.name}`,
    }));
    const kismiKabulToplami = kabulByEbeveyn.get(p.id) ?? SIFIR;
    const karar =
      adimlar.size > 1
        ? { hukum: "BELIRSIZ" as const, gerekce: "kısmi sevkler birden çok fason adımına dağılmış" }
        : siniflandir({
            initialQty: p.initialQty,
            currentQty: p.currentQty,
            sevkMetraji: kalem?.dispatchedQty ?? null,
            cocukMetrajlari: kismiSevkler.map((s) => s.metraj),
            kismiKabul: kismiKabulToplami,
          });
    ebeveynler.push({
      rollId: p.id,
      barkod: p.barcode,
      durum: p.status,
      isEmriNo: (kalem?.dispatch ?? ilkSevk).workOrder?.workOrderNumber ?? "—",
      fasonSevkNo: (kalem?.dispatch ?? ilkSevk).dispatchNo,
      fasonFirma: kalem?.dispatch.subcontractor.name ?? "—",
      initialQty: p.initialQty,
      currentQty: p.currentQty,
      sevkMetraji: kalem?.dispatchedQty ?? null,
      kismiSevkToplami: kismiSevkler.reduce((a, s) => a.plus(s.metraj), SIFIR),
      kismiKabulToplami,
      kismiSevkler,
      ...karar,
    });
  }
  const sira: Record<Hukum, number> = { KESIN: 0, BELIRSIZ: 1, TEMIZ: 2 };
  ebeveynler.sort((a, b) => sira[a.hukum] - sira[b.hukum] || a.isEmriNo.localeCompare(b.isEmriNo));

  // DirectShipment kaydından ÖNCEKİ doğrudan sevkler `directShipmentId` taşımaz; imzanın kör noktası.
  let eskiDirectShipOp: number | null = null;
  let eskiBolunmeSekilli: TeshisRaporu["eskiBolunmeSekilli"] = null;
  if (!kapsam) {
    const eskiler = await prisma.$queryRaw<Array<{ id: string; barcode: string | null; tarih: Date }>>`
      SELECT r.id, r.barcode, MIN(ro."createdAt") AS tarih
      FROM roll_operations ro
      JOIN rolls r ON r.id = ro."rollId"
      WHERE ro."operationType" = 'SUBCONTRACTOR_RETURNED'
        AND ro.metadata->>'directShip' = 'true'
        AND r."directShipmentId" IS NULL
      GROUP BY r.id, r.barcode`;
    eskiDirectShipOp = eskiler.length;
    const eskiKalemli = new Set(
      (
        await prisma.subcontractorDispatchItem.findMany({
          where: { rollId: { in: eskiler.map((e) => e.id) } },
          select: { rollId: true },
        })
      ).map((k) => k.rollId),
    );
    eskiBolunmeSekilli = eskiler
      .filter((e) => !eskiKalemli.has(e.id))
      .map((e) => ({ rollId: e.id, barkod: e.barcode, tarih: e.tarih }));
  }

  return {
    veritabani: db?.db ?? "(okunamadı)",
    kapsamli: kapsam != null,
    toplamTop,
    directShipmentSayisi,
    sevkEdilenTop: sevkEdilenler.length,
    tamSevk,
    kismiSevkCocugu,
    siraDisi,
    eskiDirectShipOp,
    eskiBolunmeSekilli,
    ebeveynler,
  };
}

export interface OnarimSonucu {
  rollId: string;
  barkod: string | null;
  sonuc: "YAZILDI" | "YAZILDI_AUDIT_DUSTU" | "ATLANDI_DEGISMIS";
}

/** Yalnız KESİN hükümleri yazar; okunan üç alan hâlâ aynıysa (atomik claim). */
export async function onar(bulgular: EbeveynBulgusu[]): Promise<OnarimSonucu[]> {
  const sonuclar: OnarimSonucu[] = [];
  for (const b of bulgular) {
    if (b.hukum !== "KESIN" || b.sevkMetraji === null) continue;
    const yazim = await prisma.roll.updateMany({
      where: { id: b.rollId, initialQty: b.initialQty, currentQty: b.currentQty, status: b.durum },
      data: { initialQty: b.sevkMetraji },
    });
    if (yazim.count === 0) {
      sonuclar.push({ rollId: b.rollId, barkod: b.barkod, sonuc: "ATLANDI_DEGISMIS" });
      continue;
    }
    const auditHataOnce = AuditService.getHealth().failureCount;
    await AuditService.log({
      userId: undefined,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: b.rollId,
      oldData: { initialQty: Number(b.initialQty) },
      newData: {
        initialQty: Number(b.sevkMetraji),
        event: OLAY,
        source: KAYNAK,
        hataCommit: "5980ff06",
        isEmriNo: b.isEmriNo,
        fasonSevkNo: b.fasonSevkNo,
        sevkMetraji: Number(b.sevkMetraji),
        kismiSevkler: b.kismiSevkler.map((s) => ({ barkod: s.barkod, sevkNo: s.sevkNo, metraj: Number(s.metraj) })),
      },
    });
    const auditOk = AuditService.getHealth().failureCount === auditHataOnce;
    sonuclar.push({ rollId: b.rollId, barkod: b.barkod, sonuc: auditOk ? "YAZILDI" : "YAZILDI_AUDIT_DUSTU" });
  }
  return sonuclar;
}

// ── Yazdırma ─────────────────────────────────────────────────────────────────

function m(d: Prisma.Decimal): string {
  return `${d.toFixed(3).replace(/\.?0+$/, "")} m`;
}

function zaman(d: Date): string {
  return d.toLocaleString("tr-TR", { timeZone: FACTORY_TIMEZONE, dateStyle: "short", timeStyle: "short" });
}

const ETIKET: Record<Hukum, string> = { KESIN: "KESİN HASAR", BELIRSIZ: "BELİRSİZ", TEMIZ: "TEMİZ" };

function yazdir(r: TeshisRaporu): void {
  for (const b of r.ebeveynler) {
    const kimlik = `${b.barkod ?? `(barkodsuz ${b.rollId.slice(0, 8)})`} · ${b.isEmriNo} · ${b.fasonSevkNo} · ${b.durum}`;
    if (b.hukum === "TEMIZ") {
      console.log(`  [TEMİZ] ${kimlik} · giriş ${m(b.initialQty)}`);
      continue;
    }
    console.log(`\n  [${ETIKET[b.hukum]}] ${kimlik}`);
    if (b.hukum === "KESIN") {
      console.log(`     giriş metrajı ŞİMDİ ${m(b.initialQty)} → OLMALI ${m(b.sevkMetraji!)}   (eksik ${m(b.kismiSevkToplami)})`);
    } else {
      console.log(`     neden: ${b.gerekce}`);
      console.log(`     giriş metrajı ${m(b.initialQty)}`);
    }
    console.log(
      `     fasona sevk ${b.sevkMetraji ? m(b.sevkMetraji) : "—"} (${b.fasonFirma}) · kalan ${m(b.currentQty)} · kısmi kabul ${m(b.kismiKabulToplami)}`,
    );
    for (const s of b.kismiSevkler) {
      console.log(`       ${zaman(s.sevkTarihi)}  ${s.sevkNo}  ${s.barkod ?? "(barkodsuz)"}  ${m(s.metraj)} → ${s.musteri}`);
    }
  }

  const say = (h: Hukum): EbeveynBulgusu[] => r.ebeveynler.filter((b) => b.hukum === h);
  const kesin = say("KESIN");
  if (kesin.length > 0) {
    const isEmriEksik = new Map<string, Prisma.Decimal>();
    for (const b of kesin) isEmriEksik.set(b.isEmriNo, (isEmriEksik.get(b.isEmriNo) ?? SIFIR).plus(b.kismiSevkToplami));
    console.log("\n  İş emri başına geriye dönük düşen giriş metrajı:");
    for (const [no, eksik] of isEmriEksik) console.log(`     ${no}  −${m(eksik)}`);
  }

  if (r.siraDisi.length > 0) {
    console.log("\n  ⚠️  SIRA DIŞI doğrudan sevk topları (imzanın dışında — elle incele):");
    for (const s of r.siraDisi) console.log(`     ${s.barkod ?? s.rollId} · ${s.sevkNo} · ${s.neden}`);
  }
  if (r.eskiBolunmeSekilli && r.eskiBolunmeSekilli.length > 0) {
    console.log("\n  ⚠️  DirectShipment kaydı OLMAYAN, bölünmeyle doğmuş görünen doğrudan sevk topları (elle incele):");
    for (const e of r.eskiBolunmeSekilli) console.log(`     ${e.barkod ?? e.rollId} · ${zaman(e.tarih)}`);
  }

  const sonKismi = r.ebeveynler
    .filter((b) => b.hukum !== "BELIRSIZ")
    .flatMap((b) => b.kismiSevkler.map((s) => ({ tarih: s.sevkTarihi, hukum: b.hukum })))
    .sort((a, b) => b.tarih.getTime() - a.tarih.getTime())[0];

  const toplamEksik = kesin.reduce((a, b) => a.plus(b.kismiSevkToplami), SIFIR);
  console.log("\n=== TARAMA ZEMİNİ — \"0 bulgu\" ile \"hiç bakılmadı\" buradan ayırt edilir ===");
  console.log(`  Veritabanı            : ${r.veritabani}${r.kapsamli ? "  (KAPSAMLI koşum — yalnız verilen sevkler)" : ""}`);
  console.log(`  rolls tablosu         : ${r.toplamTop} top`);
  console.log(`  DirectShipment        : ${r.directShipmentSayisi} olay`);
  console.log(`  Doğrudan sevk edilen  : ${r.sevkEdilenTop} top  (tam sevk ${r.tamSevk} · kısmi-sevk çocuğu ${r.kismiSevkCocugu} · sıra dışı ${r.siraDisi.length})`);
  console.log(`  Taranan ebeveyn       : ${r.ebeveynler.length}`);
  console.log(`  Hüküm                 : KESİN ${kesin.length} · BELİRSİZ ${say("BELIRSIZ").length} · TEMİZ ${say("TEMIZ").length}`);
  console.log(`  Toplam eksik (KESİN)  : ${m(toplamEksik)}`);
  console.log(
    `  Eski imza taraması    : ${
      r.eskiDirectShipOp === null
        ? "atlandı (kapsamlı koşum)"
        : `${r.eskiDirectShipOp} DirectShipment'sız doğrudan sevk operasyonu · ${r.eskiBolunmeSekilli!.length} bölünme şekilli`
    }`,
  );
  if (sonKismi) {
    console.log(
      `  Son kısmi sevk        : ${zaman(sonKismi.tarih)} → ${sonKismi.hukum === "KESIN" ? "HASARLI (o an eski kod çalışıyordu)" : "TEMİZ (o an düzeltilmiş kod çalışıyordu)"}`,
    );
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function arg(ad: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${ad}=`))?.split("=").slice(1).join("=");
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const rapor = await teshis();
  console.log(`\n=== FASON KISMİ SEVK · initialQty HASAR TEŞHİSİ ${APPLY ? "(--apply)" : "(TEŞHİS — hiçbir şey yazılmaz)"} ===`);
  yazdir(rapor);

  const secim = arg("sec")?.split(",").map((s) => s.trim()).filter(Boolean);
  let hedef = rapor.ebeveynler.filter((b) => b.hukum === "KESIN");
  if (secim) {
    const bilinmeyen = secim.filter((s) => !hedef.some((b) => b.barkod === s || b.rollId === s));
    if (bilinmeyen.length > 0) {
      console.log(`\n⛔ --sec içinde KESİN listede olmayan kayıt: ${bilinmeyen.join(", ")} — hiçbir şey yazılmadı.`);
      process.exitCode = 1;
      return;
    }
    hedef = hedef.filter((b) => secim.includes(b.barkod ?? "") || secim.includes(b.rollId));
  }

  if (!APPLY) {
    if (hedef.length > 0) {
      console.log(
        `\n  → Onarmak için (backend 5980ff06'yı içeren sürümle yayındayken): npx tsx ${KAYNAK} --apply --onay=${hedef.length} --kod-yayinda` +
          `\n    Çıktıyı saklayın (| tee): audit best-effort'tur, bu liste onarımın ikinci izidir.\n`,
      );
    }
    return;
  }
  if (hedef.length === 0) {
    console.log("\nOnarılacak KESİN kayıt yok — hiçbir şey yazılmadı.");
    return;
  }
  if (!process.argv.includes("--kod-yayinda")) {
    console.log(
      "\n⛔ --kod-yayinda beyanı yok. Eski backend hasarı iş emri girdisinde telafi ediyor; onarım eski kodun" +
        "\n   üstünde koşarsa metraj ÇİFT sayılır. Önce 5980ff06'yı içeren sürümü yayınlayın. Hiçbir şey yazılmadı.",
    );
    process.exitCode = 1;
    return;
  }
  const onay = Number(arg("onay"));
  if (onay !== hedef.length) {
    console.log(`\n⛔ --onay=${arg("onay") ?? "(yok)"} ama onarılacak kayıt ${hedef.length} — veri değişmiş olabilir, listeyi yeniden okuyun. Hiçbir şey yazılmadı.`);
    process.exitCode = 1;
    return;
  }

  const sonuclar = await onar(hedef);
  console.log("\n=== ONARIM ===");
  for (const s of sonuclar) console.log(`  ${s.sonuc.padEnd(20)} ${s.barkod ?? s.rollId}`);
  const dusen = sonuclar.filter((s) => s.sonuc === "YAZILDI_AUDIT_DUSTU");
  if (dusen.length > 0) {
    console.log(`\n⚠️  ${dusen.length} kaydın audit satırı YAZILAMADI — yukarıdaki teşhis listesini onarım izi olarak saklayın.`);
    process.exitCode = 1;
  }

  const yazilan = new Set(sonuclar.filter((s) => s.sonuc !== "ATLANDI_DEGISMIS").map((s) => s.rollId));
  const sonra = (await teshis()).ebeveynler.filter((b) => yazilan.has(b.rollId));
  const temizlenmeyen = sonra.filter((b) => b.hukum !== "TEMIZ");
  console.log(
    `\n  Doğrulama: ${yazilan.size} yazımın ${sonra.length - temizlenmeyen.length}'i yeniden taramada TEMİZ` +
      (temizlenmeyen.length > 0 ? ` · TEMİZ OLMAYAN: ${temizlenmeyen.map((b) => b.barkod ?? b.rollId).join(", ")}` : ""),
  );
  if (temizlenmeyen.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
