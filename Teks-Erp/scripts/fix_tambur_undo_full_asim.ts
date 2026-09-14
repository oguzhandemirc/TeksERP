// =============================================================================
// ONARIM — `TAMBUR_UNDO_FULL` dağıtım penceresinde doğan `currentQty > initialQty`
// Çalıştır: npx tsx scripts/fix_tambur_undo_full_asim.ts                (TEŞHİS — hiçbir şey yazmaz)
//           npx tsx scripts/fix_tambur_undo_full_asim.ts --apply --onay=<N> --hedef=<db> [--sec=<id|barkod>,...]
// =============================================================================
// HATA: Tambur tümden geri alma (`applyFull`) geri konan metrajı iptal edilen
// ÇOCUKLARIN toplamından türetip `currentQty: restored` olarak MUTLAK yazıyordu.
// Aşımlı kesimde (`overQuantityEnabled` açık) ebeveyn `currentQty: 0`'a çekilir
// ama çocuk TAM istenen metrajla doğar; çocuk toplamı ebeveynin `initialQty`sini
// geçince geri alma `currentQty > initialQty` gibi imkânsız bir satır bırakıyordu.
//
// DÜZELTMESİ ZATEN VAR (`e1437eb3` · 2026-08-10): aşımda `initialQty` YUKARI çekilir
// ve fark deftere OVERAGE olarak yazılır (`tambur-undo.service.ts` §"METRAJ GERİ
// KOYMA"; kural: `docs/kurallar/tambur.md` — "restore > initialQty ise initialQty
// yukarı + deftere OVERAGE"). Bu onarım YENİ bir semantik icat ETMEZ; bugünkü
// kodun kendiliğinden yapacağı şeyi GEÇ uygular.
//
// NEDEN İKİ SATIR KALDI — KOD BOŞLUĞU DEĞİL, DAĞITIM PENCERESİ:
//   koruma commit'lendi 2026-08-10 · sapma defterinin sahadaki İLK satırı
//   2026-08-15 13:18 (`min(roll_variances."createdAt")`, `TAMBUR_OVERCUT` ilk
//   satır da aynı gün). İki sapma olayı 2026-08-08 ve 2026-08-14 → ikisi de
//   defter sahaya inmeden ÖNCE. Sonrasında aynı sınıf ihlal ÜRETİLMEDİ.
//
// İMZA — ÜÇ BAĞIMSIZ ÇAPA; üçü birden tutmazsa `--apply` DOKUNMAZ:
//   ① `currentQty > initialQty` (ihlalin kendisi)
//   ② audit'te `event=TAMBUR_UNDO_FULL` satırı var ve `restoredQty` = `currentQty`
//      BİREBİR (geri almanın yazdığı değer hâlâ satırda duruyor)
//   ③ o audit satırı topun SON ROLL audit'i ve `updatedAt` ile eşzamanlı (≤5 sn)
//      → geri almadan SONRA başka yazar geçmemiş
//   + koruma o gün koşmamış olmalı: toptaki `source=TAMBUR_UNDO_FULL` sapma
//     satırı sayısı 0 (bu aynı zamanda İDEMPOTENSİ kapısıdır — ikinci koşumda
//     satır zaten var ve/veya ① düşer).
//
// ONARIM: `initialQty := currentQty` + `RollVariance(OVERAGE, source=TAMBUR_UNDO_FULL,
//   qty = currentQty − initialQty, workOrderStepId = topun currentStepId)` — İKİSİ TEK TX'TE
//   (sapma defteri kuralı: sapma, onu doğuran yazımla ya BİRLİKTE olur ya HİÇ).
//   `createdById` NULL: bu satırı SİSTEM yazdı, o günkü operatör değil; kimin
//   geri aldığı audit izinde (`orijinalUndoUserId`) durur.
//
// ⚠️ `initialQty` ARTIŞI PANİK SİNYALİ DEĞİLDİR: bugünkü kodda aşımlı geri alma
// zaten `initialQty`yi yukarı çeker ve yanında sapma satırı gelir. Bu DB'de çocuk
// toplamı `initialQty`yi aşan 114 ebeveyn daha var (111 TAMBUR_CONSUMED + 2
// WAREHOUSE + 1 IN_PRODUCTION, toplam ~7.623 m); bunlar İHLAL DEĞİL, ama
// herhangi birine bugün FULL geri alma yapılırsa `initialQty` tasarım gereği
// yükselecek. Sapma satırıyla birlikte geliyorsa normaldir.
//
// SON ADIM AYRI: veri temizlenip 0 ihlal ÖLÇÜLDÜKTEN sonra DB seddi açılır —
//   ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial;
//   sonra `convalidated`ın f → t olduğu TEKRAR ölçülür. Bu script o adımı
//   KENDİLİĞİNDEN ATMAZ (kapıyı açmak ayrı karardır), yalnız hazır olduğunu söyler.
//   Envanter: `scripts/test_db_invariants.ts` `rolls_qty_le_initial` girdisi —
//   temizlik yapılınca oradaki `notValid` şerhi de güncellenir.
// =============================================================================
import { Prisma, RollStatus, RollVarianceKind } from "@prisma/client";

import { FACTORY_TIMEZONE } from "../src/constants/time";
import { VARIANCE_SOURCES } from "../src/constants/variance-reasons";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { recordVarianceTx } from "../src/services/helpers/roll-variance.helper";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const KAYNAK = "scripts/fix_tambur_undo_full_asim.ts";
const OLAY = "TAMBUR_UNDO_FULL_ASIM_GEC_UYGULAMA";
const KISIT = "rolls_qty_le_initial";
/** ③ toleransı — audit tx DIŞINDA ve commit'ten SONRA yazılır. */
const ESZAMAN_SN = 5;

export type Hukum = "KESIN" | "BELIRSIZ";

export interface Ihlal {
  rollId: string;
  barkod: string | null;
  durum: RollStatus;
  initialQty: Prisma.Decimal;
  currentQty: Prisma.Decimal;
  /** currentQty − initialQty; onarımda yazılacak OVERAGE metrajı. */
  asim: Prisma.Decimal;
  currentStepId: string | null;
  updatedAt: Date;
  /** ② — audit'teki `restoredQty`; null: TAMBUR_UNDO_FULL satırı yok. */
  restoredQty: Prisma.Decimal | null;
  undoZamani: Date | null;
  orijinalUndoUserId: string | null;
  /** ③ — TAMBUR_UNDO_FULL topun SON ROLL audit satırı mı. */
  sonAudit: boolean;
  mevcutAsimSatiri: number;
  hukum: Hukum;
  gerekce: string;
}

export interface TeshisRaporu {
  veritabani: string;
  toplamTop: number;
  ihlalSayisi: number;
  /** Kör nokta zemini: defterin sahadaki ilk satırı (dağıtım sınırı). */
  defterIlkSatir: Date | null;
  defterSatirSayisi: number;
  /** İhlal DEĞİL ama çocuk toplamı girişi aşan ebeveynler (bilgi). */
  latentAsimEbeveyn: number;
  latentAsimToplam: Prisma.Decimal;
  kisitDogrulandi: boolean | null;
  ihlaller: Ihlal[];
}

/** Saf yüklem — sonda aynı fonksiyonu sentetik veriyle sınar. */
export function siniflandir(g: {
  initialQty: Prisma.Decimal;
  currentQty: Prisma.Decimal;
  restoredQty: Prisma.Decimal | null;
  sonAudit: boolean;
  undoZamani: Date | null;
  updatedAt: Date;
  mevcutAsimSatiri: number;
}): { hukum: Hukum; gerekce: string } {
  if (!g.currentQty.greaterThan(g.initialQty)) {
    return { hukum: "BELIRSIZ", gerekce: "ihlal yok (currentQty <= initialQty)" };
  }
  if (g.restoredQty === null) {
    return {
      hukum: "BELIRSIZ",
      gerekce: "audit'te TAMBUR_UNDO_FULL satırı YOK — ihlali başka bir yol üretmiş, imza kurulamadı",
    };
  }
  if (!g.restoredQty.equals(g.currentQty)) {
    return {
      hukum: "BELIRSIZ",
      gerekce: `geri almanın yazdığı metraj (${m(g.restoredQty)}) şimdiki kalanla (${m(g.currentQty)}) aynı değil — sonradan başka yazar geçmiş`,
    };
  }
  if (!g.sonAudit) {
    return {
      hukum: "BELIRSIZ",
      gerekce: "TAMBUR_UNDO_FULL topun SON audit satırı değil — geri almadan sonra başka bir işlem var",
    };
  }
  const fark = g.undoZamani ? Math.abs(g.undoZamani.getTime() - g.updatedAt.getTime()) / 1000 : Infinity;
  if (fark > ESZAMAN_SN) {
    return {
      hukum: "BELIRSIZ",
      gerekce: `geri alma (${g.undoZamani ? zaman(g.undoZamani) : "—"}) ile satırın son değişimi (${zaman(g.updatedAt)}) eşzamanlı değil (${Math.round(fark)} sn) — audit'siz bir yazar geçmiş`,
    };
  }
  if (g.mevcutAsimSatiri > 0) {
    return {
      hukum: "BELIRSIZ",
      gerekce: `toptaki TAMBUR_UNDO_FULL sapma satırı zaten var (${g.mevcutAsimSatiri}) — koruma koşmuş, ihlalin sebebi başka`,
    };
  }
  return {
    hukum: "KESIN",
    gerekce: "üç çapa da tutuyor: restoredQty = currentQty · son audit · eşzamanlı; koruma o gün koşmamış",
  };
}

export async function teshis(): Promise<TeshisRaporu> {
  const [db] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const toplamTop = await prisma.roll.count();

  // Kör nokta zemini — defterin ilk satırı dağıtım sınırını verir.
  const defterAgg = await prisma.rollVariance.aggregate({ _count: { _all: true }, _min: { createdAt: true } });

  const [kisit] = await prisma.$queryRaw<Array<{ dogrulandi: boolean }>>`
    SELECT convalidated AS dogrulandi FROM pg_constraint
    WHERE conrelid = 'rolls'::regclass AND conname = ${KISIT}`;

  const ihlalSatirlari = await prisma.$queryRaw<
    Array<{
      id: string;
      barcode: string | null;
      status: RollStatus;
      initialQty: Prisma.Decimal;
      currentQty: Prisma.Decimal;
      currentStepId: string | null;
      updatedAt: Date;
    }>
  >`
    SELECT id, barcode, status, "initialQty", "currentQty", "currentStepId", "updatedAt"
    FROM rolls WHERE "currentQty" > "initialQty" ORDER BY "createdAt"`;

  // Bilgi satırı — ihlal DEĞİL, ama okuyucu `initialQty` artışını panik sanmasın.
  const [latent] = await prisma.$queryRaw<Array<{ ebeveyn: bigint; toplam: Prisma.Decimal | null }>>`
    SELECT COUNT(*) AS ebeveyn, COALESCE(SUM(s.cocuk_toplam - p."initialQty"), 0) AS toplam
    FROM rolls p
    JOIN LATERAL (SELECT SUM(c."initialQty") AS cocuk_toplam FROM rolls c WHERE c."parentRollId" = p.id) s ON TRUE
    WHERE s.cocuk_toplam > p."initialQty" AND p."currentQty" <= p."initialQty"`;

  const ihlaller: Ihlal[] = [];
  for (const r of ihlalSatirlari) {
    const auditler = await prisma.systemLog.findMany({
      where: { tableName: "ROLL", recordId: r.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, userId: true, newData: true },
    });
    const son = auditler[0];
    const full = auditler.find((a) => (a.newData as { event?: string } | null)?.event === "TAMBUR_UNDO_FULL");
    const ham = (full?.newData as { restoredQty?: number } | null)?.restoredQty;
    const restoredQty = ham == null ? null : new Prisma.Decimal(ham);
    const mevcutAsimSatiri = await prisma.rollVariance.count({
      where: { rollId: r.id, source: VARIANCE_SOURCES.TAMBUR_UNDO_FULL },
    });
    const asim = r.currentQty.minus(r.initialQty);
    const karar = siniflandir({
      initialQty: r.initialQty,
      currentQty: r.currentQty,
      restoredQty,
      sonAudit: full != null && son != null && full.createdAt.getTime() === son.createdAt.getTime(),
      undoZamani: full?.createdAt ?? null,
      updatedAt: r.updatedAt,
      mevcutAsimSatiri,
    });
    ihlaller.push({
      rollId: r.id,
      barkod: r.barcode,
      durum: r.status,
      initialQty: r.initialQty,
      currentQty: r.currentQty,
      asim,
      currentStepId: r.currentStepId,
      updatedAt: r.updatedAt,
      restoredQty,
      undoZamani: full?.createdAt ?? null,
      orijinalUndoUserId: full?.userId ?? null,
      sonAudit: full != null && son != null && full.createdAt.getTime() === son.createdAt.getTime(),
      mevcutAsimSatiri,
      ...karar,
    });
  }
  ihlaller.sort((a, b) => (a.hukum === b.hukum ? 0 : a.hukum === "KESIN" ? -1 : 1));

  return {
    veritabani: db?.db ?? "(okunamadı)",
    toplamTop,
    ihlalSayisi: ihlalSatirlari.length,
    defterIlkSatir: defterAgg._min.createdAt ?? null,
    defterSatirSayisi: defterAgg._count._all,
    latentAsimEbeveyn: Number(latent?.ebeveyn ?? 0),
    latentAsimToplam: latent?.toplam ?? new Prisma.Decimal(0),
    kisitDogrulandi: kisit?.dogrulandi ?? null,
    ihlaller,
  };
}

export interface OnarimSonucu {
  rollId: string;
  barkod: string | null;
  sonuc: "YAZILDI" | "YAZILDI_AUDIT_DUSTU" | "ATLANDI_DEGISMIS";
  varianceId?: string | null;
}

/** Yalnız KESİN hükümleri yazar; okunan üç alan hâlâ aynıysa (atomik claim). */
export async function onar(bulgular: Ihlal[]): Promise<OnarimSonucu[]> {
  const sonuclar: OnarimSonucu[] = [];
  for (const b of bulgular) {
    if (b.hukum !== "KESIN") continue;

    // Sapma + giriş metrajı TEK TX — defter kuralı: sapma, onu doğuran yazımla
    // ya BİRLİKTE olur ya HİÇ.
    const yazim = await prisma.$transaction(async (tx) => {
      const claim = await tx.roll.updateMany({
        where: { id: b.rollId, initialQty: b.initialQty, currentQty: b.currentQty, status: b.durum },
        data: { initialQty: b.currentQty },
      });
      if (claim.count === 0) return null;
      const varianceId = await recordVarianceTx(tx, {
        rollId: b.rollId,
        workOrderStepId: b.currentStepId,
        kind: RollVarianceKind.OVERAGE,
        qty: b.asim,
        source: VARIANCE_SOURCES.TAMBUR_UNDO_FULL,
        // Bu satırı SİSTEM yazdı; o günkü operatör audit izinde.
        userId: null,
      });
      return { varianceId };
    });

    if (yazim === null) {
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
        initialQty: Number(b.currentQty),
        event: OLAY,
        source: KAYNAK,
        asim: Number(b.asim),
        korumaCommit: "e1437eb3",
        orijinalUndoZamani: b.undoZamani?.toISOString() ?? null,
        orijinalUndoUserId: b.orijinalUndoUserId,
        varianceId: yazim.varianceId,
      },
    });
    const auditOk = AuditService.getHealth().failureCount === auditHataOnce;
    sonuclar.push({
      rollId: b.rollId,
      barkod: b.barkod,
      sonuc: auditOk ? "YAZILDI" : "YAZILDI_AUDIT_DUSTU",
      varianceId: yazim.varianceId,
    });
  }
  return sonuclar;
}

// ── Yazdırma ─────────────────────────────────────────────────────────────────

function m(d: Prisma.Decimal): string {
  return `${d.toFixed(3).replace(/\.?0+$/, "")} m`;
}

function zaman(d: Date): string {
  return d.toLocaleString("tr-TR", { timeZone: FACTORY_TIMEZONE, dateStyle: "short", timeStyle: "medium" });
}

function kimlik(b: Ihlal): string {
  return `${b.barkod ?? `(barkodsuz ${b.rollId.slice(0, 8)})`} · ${b.durum}`;
}

function yazdir(r: TeshisRaporu): void {
  for (const b of r.ihlaller) {
    console.log(`\n  [${b.hukum === "KESIN" ? "KESİN" : "BELİRSİZ"}] ${kimlik(b)}`);
    console.log(`     giriş ${m(b.initialQty)} · kalan ${m(b.currentQty)} · AŞIM ${m(b.asim)}`);
    if (b.hukum === "KESIN") {
      console.log(`     → giriş metrajı ${m(b.initialQty)} → ${m(b.currentQty)} YAZILACAK`);
      console.log(`     → sapma satırı YAZILACAK: OVERAGE ${m(b.asim)} · source=${VARIANCE_SOURCES.TAMBUR_UNDO_FULL} · adım ${b.currentStepId ?? "(yok)"}`);
    } else {
      console.log(`     neden: ${b.gerekce}`);
    }
    console.log(
      `     geri alma ${b.undoZamani ? zaman(b.undoZamani) : "—"} · restoredQty ${b.restoredQty ? m(b.restoredQty) : "—"}` +
        ` · son değişim ${zaman(b.updatedAt)} · son audit ${b.sonAudit ? "evet" : "HAYIR"} · mevcut aşım satırı ${b.mevcutAsimSatiri}`,
    );
  }

  const kesin = r.ihlaller.filter((b) => b.hukum === "KESIN");
  const belirsiz = r.ihlaller.filter((b) => b.hukum === "BELIRSIZ");
  const toplamAsim = kesin.reduce((a, b) => a.plus(b.asim), new Prisma.Decimal(0));

  console.log('\n=== TARAMA ZEMİNİ — "0 bulgu" ile "hiç bakılmadı" buradan ayırt edilir ===');
  // İKİ KAYNAK BİLEREK: `hedefDbAdi()` `DATABASE_URL` metnini, `current_database()`
  // AÇIK BAĞLANTIYI söyler. Normalde aynıdırlar; ayrıştıklarında okunan şey
  // beyan edilenden başkasıdır ve bunu görmeden `--apply` verilmemeli.
  const beyan = hedefDbAdi();
  console.log(`  HEDEF VERİTABANI        : ${beyan}`);
  console.log(
    `  Bağlı veritabanı        : ${r.veritabani}` +
      (beyan === r.veritabani ? "  (beyanla aynı)" : `  ⚠️ BEYANDAN FARKLI (${beyan})`),
  );
  console.log(`  rolls tablosu           : ${r.toplamTop} top`);
  console.log(`  currentQty > initialQty : ${r.ihlalSayisi} satır`);
  console.log(`  Hüküm                   : KESİN ${kesin.length} · BELİRSİZ ${belirsiz.length}`);
  console.log(`  Onarılacak toplam aşım  : ${m(toplamAsim)}`);
  console.log(
    `  Sapma defteri           : ${r.defterSatirSayisi} satır · ilk satır ${r.defterIlkSatir ? zaman(r.defterIlkSatir) : "(hiç yok)"}` +
      `  ← korumanın sahaya indiği sınır`,
  );
  console.log(`  Latent aşım (ihlal DEĞİL): ${r.latentAsimEbeveyn} ebeveyn · ${m(r.latentAsimToplam)} — bkz. başlık notu`);
  console.log(
    `  ${KISIT}    : ${r.kisitDogrulandi === null ? "KISIT YOK (!)" : r.kisitDogrulandi ? "convalidated=t (sed AÇIK)" : "convalidated=f (NOT VALID — sed kapalı)"}`,
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function arg(ad: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${ad}=`))?.split("=").slice(1).join("=");
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const rapor = await teshis();
  console.log(`\n=== TAMBUR_UNDO_FULL AŞIMI · ONARIM ${APPLY ? "(--apply)" : "(TEŞHİS — hiçbir şey yazılmaz)"} ===`);
  yazdir(rapor);

  const secim = arg("sec")?.split(",").map((s) => s.trim()).filter(Boolean);
  let hedef = rapor.ihlaller.filter((b) => b.hukum === "KESIN");
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
        `\n  → Onarmak için: npx tsx ${KAYNAK} --apply --onay=${hedef.length} --hedef=${rapor.veritabani}` +
          `\n    Çıktıyı saklayın (| tee): audit best-effort'tur, bu liste onarımın ikinci izidir.\n`,
      );
    } else if (rapor.ihlalSayisi === 0) {
      console.log(
        `\n  ✅ İhlal yok.${
          rapor.kisitDogrulandi === false
            ? `\n  → Sed hâlâ NOT VALID. Açmak için:  ALTER TABLE rolls VALIDATE CONSTRAINT ${KISIT};` +
              `\n    Sonra convalidated'ın f → t olduğunu ÖLÇÜN (bu script tekrar koşturulabilir).`
            : ""
        }\n`,
      );
    }
    return;
  }

  if (hedef.length === 0) {
    console.log("\nOnarılacak KESİN kayıt yok — hiçbir şey yazılmadı.");
    return;
  }
  const hedefDb = arg("hedef");
  if (hedefDb !== rapor.veritabani) {
    console.log(
      `\n⛔ --hedef=${hedefDb ?? "(yok)"} ama bağlı veritabanı "${rapor.veritabani}". Yanlış DB'ye yazmamak için` +
        `\n   hedef AÇIKÇA beyan edilir. Hiçbir şey yazılmadı.`,
    );
    process.exitCode = 1;
    return;
  }
  const onay = Number(arg("onay"));
  if (onay !== hedef.length) {
    console.log(
      `\n⛔ --onay=${arg("onay") ?? "(yok)"} ama onarılacak kayıt ${hedef.length} — veri değişmiş olabilir, listeyi yeniden okuyun. Hiçbir şey yazılmadı.`,
    );
    process.exitCode = 1;
    return;
  }

  const sonuclar = await onar(hedef);
  console.log("\n=== ONARIM ===");
  for (const s of sonuclar) {
    console.log(`  ${s.sonuc.padEnd(20)} ${s.barkod ?? s.rollId}${s.varianceId ? `  sapma=${s.varianceId.slice(0, 8)}` : ""}`);
  }
  const dusen = sonuclar.filter((s) => s.sonuc === "YAZILDI_AUDIT_DUSTU");
  if (dusen.length > 0) {
    console.log(`\n⚠️  ${dusen.length} kaydın audit satırı YAZILAMADI — yukarıdaki teşhis listesini onarım izi olarak saklayın.`);
    process.exitCode = 1;
  }

  // Doğrulama — yazdıktan SONRA yeniden ölç.
  const sonra = await teshis();
  console.log(
    `\n  Doğrulama: currentQty > initialQty ${rapor.ihlalSayisi} → ${sonra.ihlalSayisi} satır` +
      ` · sapma defteri ${rapor.defterSatirSayisi} → ${sonra.defterSatirSayisi} satır`,
  );
  if (sonra.ihlalSayisi > 0) {
    console.log(`  ⚠️  Kalan ihlal var — sed AÇILMAZ. Kalanlar BELİRSİZ hükmündeyse elle incelenir.`);
    process.exitCode = 1;
    return;
  }
  // ── SEDDİ AÇ — ÖN KOŞULU SAĞLAYAN ARAÇ KAPIYI DA KAPATIR ────────────────
  // Migration BİR KEZ koşar: kurulum o gün kirliyse koşullu VALIDATE no-op'a
  // düşer ve onarım sonradan koşsa bile kısıt SONSUZA DEK `NOT VALID` kalırdı
  // (bekçi orada kalıcı kırmızı → birkaç hafta içinde biri satırı siler).
  // Ön koşulu sağlayan burasıdır, kapıyı da burası kapatır.
  if (sonra.kisitDogrulandi === true) {
    console.log(`\n  ✅ 0 ihlal ölçüldü. ${KISIT} zaten doğrulanmış (convalidated=t) — sed açık.`);
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE rolls VALIDATE CONSTRAINT ${KISIT}`);
  // ⚠️ Komutun hata vermemesi kısıtın VALID OLDUĞUNU söylemez — iddiayı
  // komutun başarısıyla değil DURUMUN ÖLÇÜMÜYLE kapat.
  const sedSonra = (await teshis()).kisitDogrulandi;
  if (sedSonra !== true) {
    console.log(`\n  ⛔ VALIDATE koştu ama convalidated hâlâ ${sedSonra === null ? "KISIT YOK" : "f"} — sed AÇILMADI.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  ✅ 0 ihlal ölçüldü ve ${KISIT} DOĞRULANDI (convalidated f → t) — sed artık tüm satırları zorluyor.`);
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
