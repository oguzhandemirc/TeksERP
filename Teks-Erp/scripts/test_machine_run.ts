// =============================================================================
// Bekçi: `machine_runs` — dokuma Faz 1 · P2 sed (2026-09-13) + P2b yazma yüzeyi
// Çalıştır: npx tsx scripts/run-all-tests.ts machine_run
// =============================================================================
// NE ÖLÇÜYOR:
//
//   §1 SED KAPSAMI     hat başına tek açık koşum; ve sed FAZLA GENİŞ DEĞİL
//                      (aynı makinede İKİNCİ hat meşru — çift enli tezgah).
//   §2 GERİ ALMA       `revokedAt` dolu koşum sedde yer İŞGAL ETMEZ.
//   §3 DOĞAL ANAHTAR   aynı (makine, hat, başlangıç) ikinci kez yazılamaz.
//   §4 CHECK           `productionLineNo >= 1`.
//   §5 TOCTOU PENCERESİ (servis yolu) — gate-tx ile KURULUR (`pg_blocking_pids`
//                      kanıtı), sonra kaybedenin HATA KODU okunur: precheck
//                      `PRODUCTION_LINE_OCCUPIED`, sed `MACHINE_RUN_RACE`. Kod
//                      ayırt edicidir: `MACHINE_RUN_RACE` yalnız precheck GEÇİP
//                      sed yakaladığında üretilir ⇒ "pencere vardı ve kapalıydı".
//                      Pencere kurulamazsa "ölçülmedi" kırmızıdır, yeşil değil.
//   §6 SİLME GUARD'I   koşumu olan makine kalıcı silinemez — GERİ ALINMIŞ da bloklar.
//   §7 YÜKLEM ÇAĞRISI  `assertProductionLineValid` koşum açan YOLDAN çağrılıyor
//                      (P4b borcunun kapanışı: "yüklem var, çağrı yok" → var).
//   §8 PRECHECK        açık koşum varken servis okunabilir 409 verir (§5'in
//                      körlük zemini: iki kod gerçekten ayrı üretiliyor).
//   §9 KAPANIŞ         terimler donar; ikinci kapanış 409; bitiş<başlangıç 400.
//   §10 GERİ ALMA      damga; ileri satır DEĞİŞMEDİ; ikinci geri alma 409; hat boşaldı.
//   §11 TOKEN REPLAY   dört durum: yok · aynı yük · başka yük · geri alınmış.
//   §12 DOKUMA İŞİ     fason iş 400 · iptal iş 409 · item/color işten ön-dolu ·
//                      iptal ile yarış: claim gate-tx arkasında bekler → 409.
//
// ⚠️ Bu bekçi DB'ye YAZAR → `hedefDbEngeli()` ilk adımdır.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType, Prisma, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { machineHardRemove } from "../src/services/helpers/guarded-hard-remove";
import { closeMachineRun, openMachineRun, revokeMachineRun } from "../src/services/machine-run.service";
import { AppError } from "../src/utils/app-error";
import type { Request, Response, NextFunction } from "express";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function isP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
/** CHECK ihlali — PG 23514, Prisma'da P2010 ham koduyla gelir. */
function isCheckViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2010" || String((e.meta as { code?: string })?.code ?? "") === "23514" ||
      JSON.stringify(e.meta ?? {}).includes("23514"))
  );
}

/**
 * "Başarılı olmalı" yazımlarını da try/catch'e alır.
 *
 * ⚠️ NEDEN: sed FAZLA GENİŞ kurulduğunda (ör. `productionLineNo` anahtardan
 * düşerse) geçmesi gereken bir INSERT P2002 fırlatır. Çıplak `await` ile bekçi
 * o noktada ÖLÜR: ❌ satırı basılmaz, sonraki bölümler ölçülmez ve `=== Sonuç`
 * hiç yazılmaz — çıkış kodu 1 olsa bile koşucu NEYİN bozulduğunu söyleyemez.
 * Negatif sondada (N2/N3) tam bu görüldü ve bekçi buna göre düzeltildi.
 */
async function yazmayiDene<T>(fn: () => Promise<T>): Promise<{ satir: T | null; hata: unknown }> {
  try {
    return { satir: await fn(), hata: null };
  } catch (e) {
    return { satir: null, hata: e };
  }
}
function hataOzeti(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `beklenmedik ${e.code}`;
  return e ? String(e).slice(0, 120) : "";
}
/** Servis hatasının `{statusCode, details.code}` ikilisi — fırlatma bir SONUÇTUR. */
function hataKodu(e: unknown): { status: number; code: string | null } {
  if (e instanceof AppError) {
    return { status: e.statusCode, code: String((e.details as { code?: unknown } | undefined)?.code ?? "") || null };
  }
  return { status: 0, code: null };
}
async function servisiDene<T>(fn: () => Promise<T>): Promise<{ ok: T | null; status: number; code: string | null; ham: unknown }> {
  try {
    return { ok: await fn(), status: 200, code: null, ham: null };
  } catch (e) {
    return { ok: null, ...hataKodu(e), ham: e };
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Captured {
  status: number;
  body: { success: boolean; data: unknown; message: string };
}
/**
 * ⚠️ `next(err)` REDDETMEZ, 0 durum koduyla ÇÖZER — ve bu bilinçlidir.
 *
 * Guard'a sessizce `revokedAt: null` süzgeci girerse makine guard'ı geçer, DELETE
 * Restrict FK'ya çarpar ve **P2003 `next()`e düşer**: operatör okunabilir bir 409
 * yerine generic bir hata görür. Tam olarak korunan kusur budur. Reddeden bir
 * `invoke` bekçiyi o noktada ÖLDÜRÜR ve ❌ satırı hiç basılmaz — negatif sondada
 * (N6) görüldü. Hata artık bir SONUÇTUR ve kendi satırında adıyla raporlanır.
 */
function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  id: string,
): Promise<Captured> {
  return new Promise((resolve) => {
    const res = {
      status(code: number) {
        return {
          json(body: Captured["body"]) {
            resolve({ status: code, body });
          },
        };
      },
    } as unknown as Response;
    const req = { params: { id }, user: { userId: undefined } } as unknown as Request;
    const next = (err?: unknown): void => {
      const kod =
        err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "bilinmeyen";
      resolve({
        status: 0,
        body: { success: false, data: null, message: `next(${kod}) — guard tutmadı, ham DB hatası` },
      });
    };
    void handler(req, res, next as NextFunction);
  });
}

/** Bu DB'de gate-tx'in arkasında bekleyen arka uç sayısı (kendi bağlantımız hariç). */
async function bekleyenSayisi(gatePid: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM pg_stat_activity a
    WHERE a.datname = current_database()
      AND a.pid <> pg_backend_pid()
      AND ${gatePid} = ANY(pg_blocking_pids(a.pid))`;
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }

  const ek = Date.now().toString(36);
  const T0 = new Date("2026-01-02T03:04:05.000Z");
  const T1 = new Date("2026-01-02T06:07:08.000Z");
  // Servis yolu için makul aralıkta (≤36 sa geçmiş) damgalar — eski damga
  // sunucu saatine düşer ve bazı bölümlerin sorusunu bulandırır.
  const S0 = new Date(Date.now() - 3 * 3600_000);
  const S1 = new Date(Date.now() - 2 * 3600_000);

  const station = await prisma.station.create({
    data: {
      name: `TEST-MR-IST-${ek}`,
      code: `TEST-MR-S-${ek}`.toUpperCase().slice(0, 32),
      type: "INTERNAL",
      kind: "PROCESS_QC",
      isActive: true,
    },
  });
  const makine = await prisma.machine.create({
    data: {
      stationId: station.id,
      name: `TEST-MR-MAK-${ek}`,
      code: `TEST-MR-M-${ek}`.toUpperCase().slice(0, 32),
      isActive: true,
    },
  });
  // İkinci makine: sedin makineler ARASINDA sızmadığını ölçmek için.
  const makine2 = await prisma.machine.create({
    data: {
      stationId: station.id,
      name: `TEST-MR-MAK2-${ek}`,
      code: `TEST-MR-M2-${ek}`.toUpperCase().slice(0, 32),
      isActive: true,
    },
  });
  // Üçüncü makine (çift hatlı): servis bölümleri ve pencere ölçümü için.
  const makine3 = await prisma.machine.create({
    data: {
      stationId: station.id,
      name: `TEST-MR-MAK3-${ek}`,
      code: `TEST-MR-M3-${ek}`.toUpperCase().slice(0, 32),
      isActive: true,
      productionLineCount: 2,
    },
  });
  const item = await prisma.item.create({
    data: { code: `TEST-MR-I-${ek}`.toUpperCase().slice(0, 32), name: `TEST-MR KUMAS ${ek}`, itemType: ItemType.FABRIC },
  });
  const color = await prisma.color.create({
    data: { code: `TEST-MR-C-${ek}`.toUpperCase().slice(0, 32), name: `TEST-MR RENK ${ek}` },
  });
  const weavingOrderIds: string[] = [];

  try {
    // ── §1 SED KAPSAMI ───────────────────────────────────────────────────────
    const r1a = await yazmayiDene(() =>
      prisma.machineRun.create({ data: { machineId: makine.id, productionLineNo: 1, startedAt: T0 } }),
    );
    check("§1a açık koşum yazılabiliyor", Boolean(r1a.satir), hataOzeti(r1a.hata));
    if (!r1a.satir) throw new Error("§1a yazılamadı — sonraki bölümler ölçülemez");
    const acik1 = r1a.satir;

    let ikinciHata: unknown = null;
    try {
      await prisma.machineRun.create({
        data: { machineId: makine.id, productionLineNo: 1, startedAt: T1 },
      });
    } catch (e) {
      ikinciHata = e;
    }
    check("§1b aynı hatta İKİNCİ açık koşum reddedilir", isP2002(ikinciHata));

    // Sed FAZLA GENİŞ olmamalı: aynı makinenin 2. hattı ayrı bir kumaş koşar.
    // Bu kontrol olmasaydı `(machineId)` yalnız yazılmış bir sed de §1b'yi
    // geçerdi ve çift enli tezgahı yapısal olarak imkânsız kılardı.
    const r1c = await yazmayiDene(() =>
      prisma.machineRun.create({ data: { machineId: makine.id, productionLineNo: 2, startedAt: T0 } }),
    );
    check("§1c aynı makinenin İKİNCİ hattı meşru (çift enli)", Boolean(r1c.satir), hataOzeti(r1c.hata));

    const r1d = await yazmayiDene(() =>
      prisma.machineRun.create({ data: { machineId: makine2.id, productionLineNo: 1, startedAt: T0 } }),
    );
    check("§1d başka makinede aynı hat no meşru", Boolean(r1d.satir), hataOzeti(r1d.hata));

    // ── §2 GERİ ALMA sedde yer işgal etmez ───────────────────────────────────
    await prisma.machineRun.update({
      where: { id: acik1.id },
      data: { revokedAt: new Date(), revokeReason: "TEST-MR geri alma" },
    });
    const r2 = await yazmayiDene(() =>
      prisma.machineRun.create({ data: { machineId: makine.id, productionLineNo: 1, startedAt: T1 } }),
    );
    check(
      "§2 geri alınmış koşum sedde yer İŞGAL ETMEZ (yeni koşum açılabilir)",
      Boolean(r2.satir),
      hataOzeti(r2.hata),
    );
    const revokeSonrasi = r2.satir;

    // ── §3 DOĞAL ANAHTAR ─────────────────────────────────────────────────────
    // Kapalı koşum `one_open_per_prod_line` seddine girmez; doğal anahtar ONU
    // yakalar. İkisi ayrı sed, ayrı soru.
    if (revokeSonrasi) {
      await prisma.machineRun.update({
        where: { id: revokeSonrasi.id },
        data: { endedAt: new Date("2026-01-02T09:00:00.000Z") },
      });
      const r3 = await yazmayiDene(() =>
        prisma.machineRun.create({ data: { machineId: makine.id, productionLineNo: 1, startedAt: T1 } }),
      );
      check("§3 aynı (makine, hat, başlangıç) ikinci kez yazılamaz", isP2002(r3.hata));
    } else {
      check("§3 aynı (makine, hat, başlangıç) ikinci kez yazılamaz", false, "ÖLÇÜLEMEDİ — §2 satırı doğmadı");
    }

    // ── §4 CHECK ─────────────────────────────────────────────────────────────
    let checkHata: unknown = null;
    try {
      await prisma.machineRun.create({
        data: { machineId: makine2.id, productionLineNo: 0, startedAt: T1 },
      });
    } catch (e) {
      checkHata = e;
    }
    check("§4 productionLineNo = 0 reddedilir (CHECK)", isCheckViolation(checkHata));

    // ── §5 TOCTOU PENCERESİ — servis yolu, gate-tx ile KURULUR ───────────────
    // Gate-tx aynı hatta bir koşum yazar ve COMMIT ETMEZ. Servisin precheck'i
    // (READ COMMITTED) o satırı GÖREMEZ → geçer → INSERT'i sedde bekler. Gate
    // commit edince servis P2002 alır ve `MACHINE_RUN_RACE` üretir. Precheck
    // satırı görseydi `PRODUCTION_LINE_OCCUPIED` üretirdi — iki kod ayırt eder.
    let gateAc: () => void = () => undefined;
    const gateKapisi = new Promise<void>((r) => (gateAc = r));
    gateKapisi.catch(() => undefined);
    let gatePid = 0;
    const gateTx = prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        gatePid = rows[0]?.pid ?? 0;
        await tx.machineRun.create({ data: { machineId: makine3.id, productionLineNo: 1, startedAt: S0 } });
        await gateKapisi;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    gateTx.catch(() => undefined);
    const sonAn0 = Date.now() + 10_000;
    while (gatePid === 0 && Date.now() < sonAn0) await sleep(20);
    // Gate'in INSERT'i commit'siz bile olsa hâlâ bekleniyor olabilir — kısa pay.
    await sleep(100);
    const yarisan = servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1 }),
    );
    let bekleyen = 0;
    const sonAn = Date.now() + 20_000;
    while (Date.now() < sonAn) {
      bekleyen = gatePid ? await bekleyenSayisi(gatePid) : 0;
      if (bekleyen >= 1) break;
      await sleep(50);
    }
    check(
      "§5a PENCERE KURULDU — servisin INSERT'i gate-tx'in arkasında bekliyor (pg_blocking_pids)",
      bekleyen >= 1,
      bekleyen >= 1 ? `gatePid=${gatePid}, bekleyen=${bekleyen}` : `YARIŞ ÖLÇÜLMEDİ: gatePid=${gatePid}, bekleyen=${bekleyen} — §5b yorumlanamaz`,
    );
    gateAc();
    await gateTx.catch(() => undefined);
    const yarisSonucu = await yarisan;
    check(
      "§5b kaybeden MACHINE_RUN_RACE aldı — precheck GEÇTİ, sed yakaladı (pencere vardı ve KAPALIYDI)",
      yarisSonucu.status === 409 && yarisSonucu.code === "MACHINE_RUN_RACE",
      `status=${yarisSonucu.status} code=${yarisSonucu.code ?? hataOzeti(yarisSonucu.ham)}`,
    );
    const gateSatiri = await prisma.machineRun.findFirst({
      where: { machineId: makine3.id, productionLineNo: 1, endedAt: null, revokedAt: null },
      select: { id: true, startedAt: true },
    });
    check("§5c hatta TEK açık koşum kaldı (gate'inki)", Boolean(gateSatiri) && gateSatiri?.startedAt.getTime() === S0.getTime());

    // ── §8 PRECHECK — §5'in körlük zemini: commit'li satırı precheck GÖRÜR ─────
    const dolu = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1 }),
    );
    check(
      "§8 açık koşum varken servis PRODUCTION_LINE_OCCUPIED verir (sed'e hiç ulaşmaz)",
      dolu.status === 409 && dolu.code === "PRODUCTION_LINE_OCCUPIED",
      `status=${dolu.status} code=${dolu.code}`,
    );

    // ── §7 YÜKLEM ÇAĞRISI — P4b borcunun kapanışı ─────────────────────────────
    const asan = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 3, startedAt: S1 }),
    );
    check(
      "§7a hat sayısını AŞAN numara servis yolundan 400 PRODUCTION_LINE_OUT_OF_RANGE (yüklem ÇAĞRILIYOR)",
      asan.status === 400 && asan.code === "PRODUCTION_LINE_OUT_OF_RANGE",
      `status=${asan.status} code=${asan.code}`,
    );
    const ikinciHat = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 2, startedAt: S1 }),
    );
    check("§7b hat sayısı İÇİNDEKİ numara (2/2) kabul", Boolean(ikinciHat.ok), `status=${ikinciHat.status} code=${ikinciHat.code}`);
    const tekHatli = await servisiDene(() =>
      openMachineRun({ machineId: makine2.id, productionLineNo: 2, startedAt: S1 }),
    );
    check(
      "§7c tek hatlı makinede 2. hat 400 (varsayılan productionLineCount=1 yüklemden geçiyor)",
      tekHatli.status === 400 && tekHatli.code === "PRODUCTION_LINE_OUT_OF_RANGE",
      `status=${tekHatli.status} code=${tekHatli.code}`,
    );

    // ── §9 KAPANIŞ — terimler donar ──────────────────────────────────────────
    const kosum = ikinciHat.ok?.data;
    if (kosum) {
      const bitis = new Date(S1.getTime() + 3600_000);
      const kapat = await servisiDene(() =>
        closeMachineRun(kosum.id, { endedAt: bitis, picksAtClose: 12345, producedM: 87.5, observedSecAtClose: 3600 }),
      );
      const k = kapat.ok?.data;
      check(
        "§9a kapanış terimleri DONDU (picks · producedM · observedSec · closedTermsAt · endedAt)",
        Boolean(k) &&
          k?.picksAtClose === 12345 &&
          new Prisma.Decimal(k?.producedM ?? 0).equals(new Prisma.Decimal("87.5")) &&
          k?.observedSecAtClose === 3600 &&
          Boolean(k?.closedTermsAt) &&
          k?.endedAt?.getTime() === bitis.getTime(),
        kapat.ok ? "" : `status=${kapat.status} code=${kapat.code} ${hataOzeti(kapat.ham)}`,
      );
      check("§9b duruş terimleri bu dilimde NULL (ölçülmedi ≠ 0)", k?.stopSecAtClose === null && k?.stopCountAtClose === null);
      const tekrar = await servisiDene(() => closeMachineRun(kosum.id, { picksAtClose: 1 }));
      check(
        "§9c ikinci kapanış 409 RUN_ALREADY_CLOSED (claim `closedTermsAt IS NULL`)",
        tekrar.status === 409 && tekrar.code === "RUN_ALREADY_CLOSED",
        `status=${tekrar.status} code=${tekrar.code}`,
      );
      const donmus = await prisma.machineRun.findUnique({ where: { id: kosum.id }, select: { picksAtClose: true } });
      check("§9d ikinci kapanış donmuş terimi DEĞİŞTİRMEDİ", donmus?.picksAtClose === 12345);
      // bitiş < başlangıç: claim WHERE'inde `startedAt <= endedAt`; tanı 400.
      const geri = await servisiDene(() =>
        openMachineRun({ machineId: makine2.id, productionLineNo: 1, startedAt: S1 }),
      );
      // makine2/hat1'de §1d'nin açık koşumu var (T0) → önce onu geri al ki yer açılsın.
      if (geri.status === 409) {
        const eski = await prisma.machineRun.findFirst({
          where: { machineId: makine2.id, productionLineNo: 1, endedAt: null, revokedAt: null },
          select: { id: true },
        });
        if (eski) await prisma.machineRun.update({ where: { id: eski.id }, data: { revokedAt: new Date(), revokeReason: "TEST-MR yer aç" } });
      }
      const geri2 = geri.ok ? geri : await servisiDene(() => openMachineRun({ machineId: makine2.id, productionLineNo: 1, startedAt: S1 }));
      const g = geri2.ok?.data;
      if (g) {
        const ters = await servisiDene(() => closeMachineRun(g.id, { endedAt: new Date(S1.getTime() - 60_000) }));
        check(
          "§9e bitiş < başlangıç 400 RUN_END_BEFORE_START — koşum AÇIK kaldı",
          ters.status === 400 && ters.code === "RUN_END_BEFORE_START",
          `status=${ters.status} code=${ters.code}`,
        );
        const halaAcik = await prisma.machineRun.findUnique({ where: { id: g.id }, select: { endedAt: true, closedTermsAt: true } });
        check("§9f reddedilen kapanış hiçbir şey yazmadı", halaAcik?.endedAt === null && halaAcik?.closedTermsAt === null);
      } else {
        check("§9e bitiş < başlangıç 400", false, `ÖLÇÜLEMEDİ — koşum açılamadı: ${geri2.status} ${geri2.code}`);
      }

      // ── §10 GERİ ALMA — damga, ileri satır değişmez ──────────────────────────
      const once = await prisma.machineRun.findUniqueOrThrow({ where: { id: kosum.id } });
      const geriAl = await servisiDene(() => revokeMachineRun(kosum.id, "TEST-MR yanlış koşum"));
      const ga = geriAl.ok?.data;
      check("§10a kapanmış koşum geri alınabilir (revokedAt + reason)", Boolean(ga?.revokedAt) && ga?.revokeReason === "TEST-MR yanlış koşum", geriAl.ok ? "" : `status=${geriAl.status} code=${geriAl.code}`);
      const sonra = await prisma.machineRun.findUniqueOrThrow({ where: { id: kosum.id } });
      check(
        "§10b ileri satır DEĞİŞMEDİ (startedAt · endedAt · picksAtClose · producedM · closedTermsAt aynı)",
        sonra.startedAt.getTime() === once.startedAt.getTime() &&
          sonra.endedAt?.getTime() === once.endedAt?.getTime() &&
          sonra.picksAtClose === once.picksAtClose &&
          String(sonra.producedM) === String(once.producedM) &&
          sonra.closedTermsAt?.getTime() === once.closedTermsAt?.getTime(),
      );
      const tekrarGeri = await servisiDene(() => revokeMachineRun(kosum.id, "TEST-MR ikinci"));
      check("§10c ikinci geri alma 409 RUN_ALREADY_REVOKED", tekrarGeri.status === 409 && tekrarGeri.code === "RUN_ALREADY_REVOKED", `status=${tekrarGeri.status} code=${tekrarGeri.code}`);
      check("§10d ikinci geri alma sebebi EZMEDİ", (await prisma.machineRun.findUnique({ where: { id: kosum.id }, select: { revokeReason: true } }))?.revokeReason === "TEST-MR yanlış koşum");
      const kapaliGeri = await servisiDene(() => closeMachineRun(kosum.id, {}));
      check("§10e geri alınmış koşum kapatılamaz 409 RUN_REVOKED", kapaliGeri.status === 409 && kapaliGeri.code === "RUN_REVOKED", `status=${kapaliGeri.status} code=${kapaliGeri.code}`);
    } else {
      check("§9/§10 ÖLÇÜLEMEDİ — §7b koşumu açılamadı", false);
    }

    // ── §11 TOKEN REPLAY — dört durum ─────────────────────────────────────────
    // makine3/hat1'de §5'in gate koşumu açık; onu geri alıp hattı boşalt.
    await prisma.machineRun.updateMany({
      where: { machineId: makine3.id, productionLineNo: 1, endedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "TEST-MR §11 yer aç" },
    });
    const token = randomUUID();
    const ilk = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, clientToken: token }),
    );
    check("§11a token'lı ilk açılış yazıldı", Boolean(ilk.ok), `status=${ilk.status} code=${ilk.code}`);
    const ayni = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, clientToken: token }),
    );
    check(
      "§11b aynı token + aynı yük → ÖZGÜN koşum döner (409 değil)",
      Boolean(ayni.ok) && ayni.ok?.data.id === ilk.ok?.data.id,
      ayni.ok ? "" : `status=${ayni.status} code=${ayni.code}`,
    );
    const baska = await servisiDene(() =>
      openMachineRun({ machineId: makine2.id, productionLineNo: 1, startedAt: S1, clientToken: token }),
    );
    check("§11c aynı token + BAŞKA yük → 409 CLIENT_TOKEN_COLLISION", baska.status === 409 && baska.code === "CLIENT_TOKEN_COLLISION", `status=${baska.status} code=${baska.code}`);
    if (ilk.ok) await revokeMachineRun(ilk.ok.data.id, "TEST-MR §11 replay sondası");
    const olu = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, clientToken: token }),
    );
    check("§11d aynı token + GERİ ALINMIŞ koşum → 409 RUN_REVOKED (canlıymış gibi dönmez)", olu.status === 409 && olu.code === "RUN_REVOKED", `status=${olu.status} code=${olu.code}`);
    const sayim = await prisma.machineRun.count({ where: { clientToken: token } });
    check("§11e token'la TEK satır doğdu", sayim === 1, `n=${sayim}`);

    // ── §12 DOKUMA İŞİ BAĞI ───────────────────────────────────────────────────
    const fason = await ensureTestDyeHouse();
    const fasonIs = await prisma.weavingOrder.create({
      data: {
        weavingOrderNumber: `TEST-MR-WO-F-${ek}`,
        itemId: item.id,
        executionKind: WeavingExecutionKind.SUBCONTRACTED,
        subcontractorId: fason.id,
      },
      select: { id: true },
    });
    weavingOrderIds.push(fasonIs.id);
    const iptalIs = await prisma.weavingOrder.create({
      data: {
        weavingOrderNumber: `TEST-MR-WO-C-${ek}`,
        itemId: item.id,
        colorId: color.id,
        executionKind: WeavingExecutionKind.IN_HOUSE,
        status: WeavingOrderStatus.CANCELLED,
        cancelledAt: new Date(),
      },
      select: { id: true },
    });
    weavingOrderIds.push(iptalIs.id);
    const acikIs = await prisma.weavingOrder.create({
      data: {
        weavingOrderNumber: `TEST-MR-WO-A-${ek}`,
        itemId: item.id,
        colorId: color.id,
        executionKind: WeavingExecutionKind.IN_HOUSE,
      },
      select: { id: true },
    });
    weavingOrderIds.push(acikIs.id);

    const f = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, weavingOrderId: fasonIs.id }),
    );
    check("§12a fasona verilmiş işe koşum 400 WEAVING_ORDER_SUBCONTRACTED", f.status === 400 && f.code === "WEAVING_ORDER_SUBCONTRACTED", `status=${f.status} code=${f.code}`);
    const c = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, weavingOrderId: iptalIs.id }),
    );
    check("§12b iptal edilmiş işe koşum 409 WEAVING_ORDER_NOT_OPEN", c.status === 409 && c.code === "WEAVING_ORDER_NOT_OPEN", `status=${c.status} code=${c.code}`);
    const a = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, weavingOrderId: acikIs.id }),
    );
    check(
      "§12c açık işe koşum yazıldı; item/color İŞTEN ön-dolu",
      Boolean(a.ok) && a.ok?.data.itemId === item.id && a.ok?.data.colorId === color.id,
      a.ok ? "" : `status=${a.status} code=${a.code}`,
    );
    // İş emri geçişi koşumdan tetiklenir ve TEK yazarı iş emri helper'ıdır
    // (markWeavingOrderInProgressTx) — burada davranışı ölçülür, yazarı değil.
    const isDurumu = await prisma.weavingOrder.findUniqueOrThrow({ where: { id: acikIs.id }, select: { status: true } });
    check("§12c2 ilk koşum işi PLANNED → IN_PROGRESS geçirdi (tetikleyici koşum)", isDurumu.status === WeavingOrderStatus.IN_PROGRESS, `status=${isDurumu.status}`);
    if (a.ok) await revokeMachineRun(a.ok.data.id, "TEST-MR §12 yer aç");
    const a2 = await servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, weavingOrderId: acikIs.id }),
    );
    check("§12c3 IN_PROGRESS işe İKİNCİ koşum meşru (durum değişmedi)", Boolean(a2.ok), a2.ok ? "" : `status=${a2.status} code=${a2.code}`);
    if (a2.ok) await revokeMachineRun(a2.ok.data.id, "TEST-MR §12 yer aç 2");

    // §12d İPTAL İLE YARIŞ — claim satır kilidinde bekler. Gate-tx işi iptal eder
    // ve commit etmez; servisin dış okuması PLANNED görür (READ COMMITTED),
    // tx içindeki claim ise kilitte bekler → gate commit → count 0 → 409.
    let gate2Ac: () => void = () => undefined;
    const gate2Kapisi = new Promise<void>((r) => (gate2Ac = r));
    gate2Kapisi.catch(() => undefined);
    let gate2Pid = 0;
    const gate2Tx = prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        gate2Pid = rows[0]?.pid ?? 0;
        await tx.weavingOrder.updateMany({
          where: { id: acikIs.id, status: { in: [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS] } },
          data: { status: WeavingOrderStatus.CANCELLED, cancelledAt: new Date() },
        });
        await gate2Kapisi;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    gate2Tx.catch(() => undefined);
    const sonAn2a = Date.now() + 10_000;
    while (gate2Pid === 0 && Date.now() < sonAn2a) await sleep(20);
    await sleep(100);
    const yarisan2 = servisiDene(() =>
      openMachineRun({ machineId: makine3.id, productionLineNo: 1, startedAt: S1, weavingOrderId: acikIs.id }),
    );
    let bekleyen2 = 0;
    const sonAn2 = Date.now() + 20_000;
    while (Date.now() < sonAn2) {
      bekleyen2 = gate2Pid ? await bekleyenSayisi(gate2Pid) : 0;
      if (bekleyen2 >= 1) break;
      await sleep(50);
    }
    check(
      "§12d PENCERE KURULDU — servisin iş claim'i iptal tx'inin satır kilidinde bekliyor",
      bekleyen2 >= 1,
      bekleyen2 >= 1 ? `gatePid=${gate2Pid}` : `YARIŞ ÖLÇÜLMEDİ: bekleyen=${bekleyen2} — §12e yorumlanamaz`,
    );
    gate2Ac();
    await gate2Tx.catch(() => undefined);
    const yaris2 = await yarisan2;
    check(
      "§12e iptalle yarışan açılış 409 WEAVING_ORDER_NOT_OPEN (iptal edilmiş işe koşum sızmadı)",
      yaris2.status === 409 && yaris2.code === "WEAVING_ORDER_NOT_OPEN",
      `status=${yaris2.status} code=${yaris2.code ?? hataOzeti(yaris2.ham)}`,
    );
    const sizdi = await prisma.machineRun.count({ where: { weavingOrderId: acikIs.id, revokedAt: null } });
    check("§12f iptal edilmiş işte canlı koşum YOK", sizdi === 0, `n=${sizdi}`);

    // ── §6 SİLME GUARD'I — ve `revokedAt`in TERS yönü ────────────────────────
    const g1 = await invoke(machineHardRemove, makine2.id);
    const blokMesaji = String(g1.body.message ?? "");
    check(
      "§6a koşumu olan makine kalıcı silinemez (409)",
      g1.status === 409 && blokMesaji.includes("dokuma koşumu"),
      `status=${g1.status} mesaj="${blokMesaji}"`,
    );

    // TERS YÖN KANITI: makinenin TÜM koşumlarını geri al. Sed artık boş görür
    // (§2'de ölçüldü) ama guard HÂLÂ bloklamalı — "bu makinede iş yapıldı mı"
    // sorusu "hâlâ geçerli mi" sorusundan farklıdır. Bu kontrol düşerse guard'a
    // sessizce `revokedAt: null` süzgeci girmiş demektir.
    await prisma.machineRun.updateMany({
      where: { machineId: makine2.id },
      data: { revokedAt: new Date(), revokeReason: "TEST-MR ters yön sondası" },
    });
    const g2 = await invoke(machineHardRemove, makine2.id);
    check(
      "§6b TÜM koşumları geri alınmış makine DE silinemez (guard revokedAt süzmez)",
      g2.status === 409,
      g2.status === 0
        ? `${g2.body.message} ⇒ guard'a revokedAt süzgeci girmiş: operatör 409 yerine ham FK hatası görür`
        : `status=${g2.status}`,
    );

    // Körlük zemini: koşumsuz bir makine gerçekten silinebiliyor mu? Bu olmadan
    // §6'nın iki yeşili "guard her şeyi bloklar" ile ayırt edilemezdi.
    const bosMakine = await prisma.machine.create({
      data: {
        stationId: station.id,
        name: `TEST-MR-BOS-${ek}`,
        code: `TEST-MR-B-${ek}`.toUpperCase().slice(0, 32),
        isActive: true,
      },
    });
    const g3 = await invoke(machineHardRemove, bosMakine.id);
    check("§6c körlük zemini: koşumsuz makine silinebiliyor", g3.status === 200, `status=${g3.status}`);
  } finally {
    // FK sırası: koşum → dokuma işi → makine → istasyon → item/renk.
    await prisma.machineRun.deleteMany({ where: { machine: { stationId: station.id } } });
    if (weavingOrderIds.length) await prisma.weavingOrder.deleteMany({ where: { id: { in: weavingOrderIds } } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
