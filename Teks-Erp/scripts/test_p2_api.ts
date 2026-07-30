// =============================================================================
// P2 api-misc bucket testi — F221 (istasyon-türü izin enforcement) + F59 (WO
// width null yazımı).  Koşum:
//   DATABASE_URL="...adnansahin_p2_test..." npx tsx scripts/test_p2_api.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkSessionService } from "../src/services/work-session.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { AuthService } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
/**
 * 403 bekle — GELEN durum kodunu da döndür. Eski hâli her non-403'ü sessizce
 * `false`'a çeviriyordu; 409 (MACHINE_OCCUPIED) geldiğinde "izin kontrolü
 * çalışmıyor" gibi görünüyordu.
 */
async function expectForbidden(fn: () => Promise<unknown>): Promise<{ ok: boolean; got: string }> {
  try { await fn(); return { ok: false, got: "hata atılmadı" }; }
  catch (e) {
    if (e instanceof AppError) return { ok: e.statusCode === 403, got: `${e.statusCode} ${e.message}` };
    return { ok: false, got: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * open() BAŞARILI bekleniyor. Hata fırlarsa main() reddedilip test opak "HATA:"
 * ile ölmesin — gerçek nedeni (statusCode + mesaj) etikete yaz, check'i düşür.
 */
async function expectOpen(label: string, fn: () => Promise<{ data: unknown }>): Promise<void> {
  try {
    const res = await fn();
    check(label, !!(res.data as { id?: string }).id);
  } catch (e) {
    const code = e instanceof AppError ? `${e.statusCode} ` : "";
    check(label, false, `beklenmeyen hata: ${code}${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const created: { users: string[]; devices: string[]; wos: string[]; machines: string[]; stations: string[] } =
    { users: [], devices: [], wos: [], machines: [], stations: [] };

  try {
    // --- F221: RAW_QC (KK1) makinesinde oturum izin enforcement ---
    // İZOLASYON: eskiden seed'in TEK aktif RAW_QC makinesi (KK1-M1) findFirst ile
    // çözülüyordu. O makine PAYLAŞIMLI: canlı Electron/Expo istemcisi ya da yarıda
    // kesilmiş bir test_work_session koşumu orada AÇIK oturum bırakırsa teyitsiz
    // open() 409 MACHINE_OCCUPIED atar (work-session.service MACHINE_OCCUPIED
    // ön-kontrolü + work_sessions_active_machine_uq partial unique'i) — ilk open
    // korumasız olduğu için main() reddedilir ve test opak "HATA:" ile düşerdi.
    // Tam-suite koşumunda görüldü, tek başına yeşildi: kalıntı sonradan
    // test_work_session'ın NEW_LOGIN süpürmesiyle kapandığı için 2. koşum geçti.
    // F221 istasyon TÜRÜ→izin eşlemesini test ediyor (station.kind'ın saf
    // fonksiyonu) → hangi RAW_QC makinesi olduğu ÖNEMSİZ, kendi fixture'ımızı kur.
    // confirmTakeover KULLANILMADI: o, canlı bir operatörün KK1 oturumunu sessizce
    // öldürürdü ve devralma kapsamı zaten test_work_session'a ait.
    //
    // Yarıda kesilmiş önceki koşumun kalıntısını süpür (SIGINT finally'yi atlar):
    // arda kalan AKTİF RAW_QC istasyonu, başka testlerin orderBy'sız
    // station.findFirst({kind:"RAW_QC"}) çözümünü bulandırır.
    const stale = await prisma.machine.findMany({
      where: { code: { startsWith: "TEST-P2-M-" } }, select: { id: true },
    });
    if (stale.length > 0) {
      const ids = stale.map((m) => m.id);
      await prisma.workSession.deleteMany({ where: { machineId: { in: ids } } }).catch(() => {});
      await prisma.machine.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    }
    await prisma.station.deleteMany({ where: { code: { startsWith: "TEST-P2-KK1-" } } }).catch(() => {});

    const station = await prisma.station.create({
      data: { code: `TEST-P2-KK1-${ts}`, name: "TEST P2 KK1", type: "INTERNAL", kind: "RAW_QC" },
      select: { id: true },
    });
    created.stations.push(station.id);
    const rawqcMachine = await prisma.machine.create({
      data: { stationId: station.id, code: `TEST-P2-M-${ts}`, name: "TEST P2 KK1 Makine" },
      select: { id: true, stationId: true },
    });
    created.machines.push(rawqcMachine.id);
    // Taze makinede teyitsiz open()'ın 409'a düşmesi İMKANSIZ olmalı — dolu
    // çıkarsa sebep fixture değil DIŞ bir yazımdır, sayı ile söylensin.
    const busy = await prisma.workSession.count({ where: { machineId: rawqcMachine.id, endedAt: null } });
    check("fixture makinesi boş (teyitsiz open güvenli)", busy === 0, `açık oturum=${busy}`);

    const user = await prisma.user.create({
      data: { username: `TEST-op-${ts}`, passwordHash: await AuthService.hashPassword("test123"), fullName: "TEST Operatör" },
      select: { id: true },
    });
    created.users.push(user.id);
    // status APPROVED EKSPLİSİT: şema varsayılanı PENDING ve open() cihaz onayına
    // BAKMIYOR — F221 bu tesadüfe yaslanmasın (onay enforcement'ı eklenirse bu test
    // yine izni test etsin, cihaz onayını değil).
    const mkDevice = async (n: number) => {
      const d = await prisma.device.create({
        data: { deviceId: `TEST-dev-${ts}-${n}`, name: `TEST Tablet ${n}`, status: "APPROVED" },
        select: { id: true },
      });
      created.devices.push(d.id);
      return d.id;
    };
    const dev1 = await mkDevice(1), dev2 = await mkDevice(2), dev3 = await mkDevice(3);

    // Doğru izinle (mobile:kk1) → açılır.
    await expectOpen("F221: mobile:kk1 izniyle RAW_QC oturumu açıldı", () =>
      WorkSessionService.open({
        userId: user.id, deviceRowId: dev1, machineId: rawqcMachine.id, permissions: ["mobile:kk1"],
      }),
    );
    // auditUserId geç: closeForDevice audit'i userId=null yazarsa finally'nin
    // systemLog temizliği onu YAKALAMAZ (koşum başına kalıntı satır).
    await WorkSessionService.closeForDevice(dev1, "LOGOUT", user.id);

    // Yanlış türden izinle (mobile:tambur, kk1 YOK) → 403.
    const denied = await expectForbidden(() =>
      WorkSessionService.open({
        userId: user.id, deviceRowId: dev2, machineId: rawqcMachine.id, permissions: ["mobile:tambur"],
      }),
    );
    check("F221: yalnız mobile:tambur izinli kullanıcı RAW_QC açamaz (403)", denied.ok, denied.got);

    // mobile:* wildcard → açılır (matchesPermission domain wildcard).
    await expectOpen("F221: mobile:* wildcard ile açılır", () =>
      WorkSessionService.open({
        userId: user.id, deviceRowId: dev3, machineId: rawqcMachine.id, permissions: ["mobile:*"],
      }),
    );
    await WorkSessionService.closeForDevice(dev3, "LOGOUT", user.id);

    // permissions OMIT → güvenilen dahili çağrı, enforcement atlanır.
    await expectOpen("F221: permissions verilmezse enforcement atlanır (dahili çağrı)", () =>
      WorkSessionService.open({
        userId: user.id, deviceRowId: dev1, machineId: rawqcMachine.id,
      }),
    );
    await WorkSessionService.closeForDevice(dev1, "LOGOUT", user.id);

    // --- F59: WO width null yazımı (?? undefined null'ı yutuyordu) ---
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WO-${ts}`, width: 150 },
      select: { id: true, width: true },
    });
    created.wos.push(wo.id);
    check("F59: WO width=150 ile oluştu", Number(wo.width) === 150);

    const svc = new WorkOrderService();
    await svc.update(wo.id, { width: null });
    const after = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { width: true } });
    check("F59: update({width:null}) width'i NULL yazdı (yutmadı)", after?.width === null,
      `width=${after?.width}`);

    // targetQuantity null yazımı da (kilit guard'ı yok, düz yazım).
    await prisma.workOrder.update({ where: { id: wo.id }, data: { targetQuantity: 500 } });
    await svc.update(wo.id, { targetQuantity: null });
    const after2 = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetQuantity: true } });
    check("F59: update({targetQuantity:null}) NULL yazdı", after2?.targetQuantity === null);
  } finally {
    // FK sırası: oturum → cihaz/WO → makine → istasyon → log → kullanıcı.
    await prisma.workSession.deleteMany({
      where: { OR: [{ deviceId: { in: created.devices } }, { machineId: { in: created.machines } }] },
    }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: { in: created.devices } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: { in: created.machines } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: created.stations } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: { in: created.users } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
  }
}

main()
  .catch((err) => {
    // Fixture/beklenmeyen hata: sayaca yaz — özet satırı ve exit kodu finally'de.
    // (Eskiden burada process.exit(1) vardı ve "=== Sonuç ===" satırı HİÇ basılmıyordu;
    // runner'ın özetinde neden görünmüyordu.)
    fail++;
    console.error("HATA (fixture/beklenmeyen):", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
