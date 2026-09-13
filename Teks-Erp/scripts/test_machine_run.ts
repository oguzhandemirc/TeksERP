// =============================================================================
// Bekçi: `machine_runs` — dokuma Faz 1 · P2 (2026-09-13)
// Çalıştır: npx tsx scripts/run-all-tests.ts machine_run
// =============================================================================
// NE ÖLÇÜYOR — ve NE ÖLÇMÜYOR:
//
//   §1 SED KAPSAMI     hat başına tek açık koşum; ve sed FAZLA GENİŞ DEĞİL
//                      (aynı makinede İKİNCİ hat meşru — çift enli tezgah).
//   §2 GERİ ALMA       `revokedAt` dolu koşum sedde yer İŞGAL ETMEZ.
//   §3 DOĞAL ANAHTAR   aynı (makine, hat, başlangıç) ikinci kez yazılamaz.
//   §4 CHECK           `productionLineNo >= 1`.
//   §5 EŞZAMANLILIK    iki eşzamanlı INSERT → tam biri kazanır, kaybeden P2002.
//   §6 SİLME GUARD'I   koşumu olan makine kalıcı silinemez — ve GERİ ALINMIŞ
//                      koşum da bloklar (guard'ın `revokedAt` süzmediği kanıtı).
//
// ⛔ NE ÖLÇMÜYOR — §5 bir TOCTOU PENCERESİ ölçümü DEĞİLDİR ve öyle okunmamalı.
//   Bugün koşum açan bir SERVİS YOK; iki INSERT doğrudan sede çarpıyor, yani
//   "önce oku sonra yaz" aralığı hiç yok. Bir partial unique'te sıralı iki INSERT
//   de P2002 verir ⇒ `p2002 === 1` sedin çalıştığını kanıtlar, ÖRTÜŞMEYİ değil.
//   Pencere sorusu koşum açma ucu P2b'de doğduğunda açılır; o gün bu bölüm ya
//   kaybedenin hata KODUNU tanık alır (precheck farklı kod basıyorsa) ya da
//   gate-tx + `pg_blocking_pids` ile ölçülür. ⇒ Bu bekçinin §5'i "sed
//   eşzamanlılık altında da tekil" der, "yarış penceresi kuruldu" DEMEZ.
//
// ⚠️ Bu bekçi DB'ye YAZAR → `hedefDbEngeli()` ilk adımdır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { machineHardRemove } from "../src/services/helpers/guarded-hard-remove";
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

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }

  const ek = Date.now().toString(36);
  const T0 = new Date("2026-01-02T03:04:05.000Z");
  const T1 = new Date("2026-01-02T06:07:08.000Z");

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

    // ── §5 EŞZAMANLILIK (sed ölçümü — pencere ölçümü DEĞİL, başlığa bak) ──────
    const yarisBaslangic = new Date("2026-03-03T03:03:03.000Z");
    const sonuclar = await Promise.allSettled([
      prisma.machineRun.create({
        data: { machineId: makine2.id, productionLineNo: 9, startedAt: yarisBaslangic },
      }),
      prisma.machineRun.create({
        data: {
          machineId: makine2.id,
          productionLineNo: 9,
          startedAt: new Date("2026-03-03T04:04:04.000Z"),
        },
      }),
    ]);
    const kazanan = sonuclar.filter((r) => r.status === "fulfilled").length;
    const p2002 = sonuclar.filter((r) => r.status === "rejected" && isP2002(r.reason)).length;
    check(
      "§5 eşzamanlı iki açılıştan tam biri kazanır, kaybeden P2002",
      kazanan === 1 && p2002 === 1,
      `kazanan=${kazanan} p2002=${p2002} (SED ölçümü; pencere ölçümü değil)`,
    );

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
    // FK sırası: koşum → makine → istasyon.
    await prisma.machineRun.deleteMany({ where: { machine: { stationId: station.id } } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
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
