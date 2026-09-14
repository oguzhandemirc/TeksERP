// =============================================================================
// TeksERP - Guarded Hard-Remove Handler Factory
// =============================================================================
// "Asla fiziksel DELETE" kuralının bilinçli istisnası: yalnız HİÇ KULLANILMAMIŞ
// (yanlışlıkla açılmış) master-data kaydı /:id/permanent ile kalıcı silinebilir.
// Ortak iskelet: 404 → bağımlılık guard'ları (409 + somut sayı + Türkçe mesaj)
// → tx içinde çocuk + ana kayıt silme → AuditService.log(DELETE) → 200.
//
// Eskiden station/route/product-recipe route dosyalarında ~60-100 satırlık üç
// neredeyse aynı kopya vardı (katman ihlali + senkron unutma riski). Yeni bir
// /permanent ucu eklerken BU factory kullanılmalı — guard listesi tek yerde.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { assertValidUuid } from "../../middlewares/uuid-param.middleware";

type Tx = Prisma.TransactionClient;

interface DependencyGuard {
  /** 409 yanıtının data alanına yazılacak sayaç anahtarı (örn. woStepCount) */
  key: string;
  /** Bağımlılık sayısı — >0 ise silme reddedilir */
  count: (id: string) => Promise<number>;
  /** Operatöre gösterilecek somut Türkçe mesaj */
  message: (n: number) => string;
}

interface GuardedHardRemoveConfig {
  /** AuditService.log tableName değeri (örn. "STATION") */
  tableName: string;
  /** 404 mesajı (örn. "İstasyon bulunamadı") */
  notFoundMessage: string;
  /** Ana kaydı yükler — bulunamazsa null */
  load: (id: string) => Promise<Record<string, unknown> | null>;
  /** Sıralı bağımlılık guard'ları — ilk takılan 409 döner */
  guards: DependencyGuard[];
  /** tx içinde çocuk kayıtlar + ana kayıt silinir. Kapsam dışı kalan FK
   *  referansı Restrict ile P2003'e düşer → error middleware temiz 400 verir. */
  deleteTx: (tx: Tx, id: string) => Promise<void>;
  /** 200 yanıt mesajı */
  successMessage: string;
}

export function makeGuardedHardRemove(config: GuardedHardRemoveConfig) {
  return async function guardedHardRemove(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id); // F46: geçersiz UUID → net 400 (P2023/500 değil)

      const record = await config.load(id);
      if (!record) {
        res.status(404).json({ success: false, data: null, message: config.notFoundMessage });
        return;
      }

      for (const guard of config.guards) {
        const n = await guard.count(id);
        if (n > 0) {
          res.status(409).json({
            success: false,
            data: { [guard.key]: n },
            message: guard.message(n),
          });
          return;
        }
      }

      await prisma.$transaction(async (tx) => {
        await config.deleteTx(tx, id);
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: "DELETE",
        tableName: config.tableName,
        recordId: id,
        oldData: record,
        newData: null,
      });

      res.status(200).json({ success: true, data: record, message: config.successMessage });
    } catch (error) {
      next(error);
    }
  };
}

// =============================================================================
// Konfigüre edilmiş handler'lar — route dosyaları yalnız bunları import eder
// (route katmanında prisma import'u yasak; bkz. Teks-Erp/CLAUDE.md katman kuralı)
// =============================================================================

/**
 * Station hard-delete. Guard gerekçeleri:
 * - workOrderStep: aktif iş emri adım zinciri delinmesin
 * - routeStep: rota şablonları kopmasın
 * - travelerCardScan / rollMovement(machine): üretim geçmişi olan istasyon silinmesin
 * - workSession: oturum geçmişi silinmez, olan istasyon pasife alınır
 * - device(machine): eşlenmiş cihaz yetim kalmasın
 */
export const stationHardRemove = makeGuardedHardRemove({
  tableName: "STATION",
  notFoundMessage: "İstasyon bulunamadı",
  load: (id) => prisma.station.findUnique({ where: { id } }),
  guards: [
    {
      key: "woStepCount",
      count: (id) => prisma.workOrderStep.count({ where: { stationId: id } }),
      message: (n) =>
        `İstasyona bağlı ${n} iş emri adımı var — kalıcı silinemez. İstasyonu pasife alın.`,
    },
    {
      key: "routeStepCount",
      count: (id) => prisma.routeStep.count({ where: { stationId: id } }),
      message: (n) =>
        `İstasyon ${n} rota şablonu adımında kullanılıyor — önce rotalardan çıkarın.`,
    },
    {
      key: "scanCount",
      count: (id) => prisma.travelerCardScan.count({ where: { stationId: id } }),
      message: (n) =>
        `İstasyonda ${n} refakat kartı okutması kayıtlı — kalıcı silinemez. Pasife alın.`,
    },
    {
      key: "machineHistoryCount",
      // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): geri alınmış hareket de o makinede ÜRETİM
      // YAPILDIĞININ kanıtıdır; silme guard'ı daha muhafazakâr olmalı.
      count: (id) => prisma.rollMovement.count({ where: { machine: { stationId: id } } }),
      message: (n) =>
        `İstasyonun makinelerinde ${n} üretim hareketi kayıtlı — kalıcı silinemez. Pasife alın.`,
    },
    {
      key: "pairedDeviceCount",
      count: (id) => prisma.device.count({ where: { machine: { stationId: id } } }),
      message: (n) =>
        `İstasyonun makinelerine eşlenmiş ${n} cihaz var — önce cihaz eşleşmelerini kaldırın.`,
    },
    // F1/F38: RollOperation.machine / Roll.createdMachine / PeripheralDevice.machine
    // hepsi SetNull → guard olmadan makine silinince üretim atfı SESSİZCE NULL'lanır.
    {
      key: "machineOperationCount",
      // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): geri alınmış iz de o makinede ÜRETİM
      // YAPILDIĞININ kanıtıdır; silme guard'ı daha muhafazakâr olmalı.
      count: (id) => prisma.rollOperation.count({ where: { machine: { stationId: id } } }),
      message: (n) =>
        `İstasyonun makinelerine damgalı ${n} üretim işlemi (kurşun/QC2) var — kalıcı silinemez. Pasife alın.`,
    },
    {
      key: "machineRollCreatedCount",
      count: (id) => prisma.roll.count({ where: { createdMachine: { stationId: id } } }),
      message: (n) =>
        `İstasyonun makinelerinde ${n} top girişi (KK1) yapılmış — kalıcı silinemez. Pasife alın.`,
    },
    {
      // 2026-08-05: `Roll.entryStationId` de SetNull FK'sidir — yukarıdaki iki
      // guard'la AYNI sınıf. Bu satır olmadan istasyon kalıcı silindiğinde o
      // istasyonda doğmuş TÜM topların köken izi sessizce boşalırdı.
      //
      // ⚠️ `machineRollCreatedCount` bunu KAPSAMAZ: o, makine üzerinden dolaylı
      // sayar ve makine damgası yalnız oturumlu (tablet) girişlerde dolar.
      // Tambur kesimi / fason kabulü gibi yollarda istasyon damgası VARDIR ama
      // makine damgası YOKTUR — o toplar eski guard'a görünmezdi.
      key: "rollEntryStationCount",
      count: (id) => prisma.roll.count({ where: { entryStationId: id } }),
      message: (n) =>
        `Bu istasyonda ${n} top sisteme girmiş (giriş istasyonu kaydı) — kalıcı silinemez. Pasife alın.`,
    },
    {
      // Oturum geçmişi iş verisidir (kim, ne zaman, nerede çalıştı) ve audit arşivi
      // yerini tutmaz — silinmez, istasyonun kalıcı silinmesini engeller.
      key: "workSessionCount",
      count: (id) =>
        prisma.workSession.count({ where: { OR: [{ stationId: id }, { machine: { stationId: id } }] } }),
      message: (n) =>
        `İstasyonda/makinelerinde ${n} çalışma oturumu kaydı var — kalıcı silinemez. İstasyonu pasife alın.`,
    },
    {
      key: "peripheralCount",
      count: (id) =>
        prisma.peripheralDevice.count({
          where: { OR: [{ machine: { stationId: id } }, { stationId: id }] },
        }),
      message: (n) =>
        `İstasyona/makinelerine bağlı ${n} donanım var — önce donanımı taşıyın veya kaldırın.`,
    },
  ],
  deleteTx: async (tx, id) => {
    await tx.machine.deleteMany({ where: { stationId: id } });
    await tx.station.delete({ where: { id } });
  },
  successMessage: "İstasyon ve bağlı tüm veriler kalıcı olarak silindi",
});

/**
 * Route (rota şablonu) hard-delete. Guard: bu şablondan üretilmiş WO varsa
 * soy izi (WO.routeTemplateId) kopmasın — normal yol pasife almak.
 */
export const routeHardRemove = makeGuardedHardRemove({
  tableName: "ROUTE",
  notFoundMessage: "Rota bulunamadı",
  load: (id) => prisma.route.findUnique({ where: { id } }),
  guards: [
    {
      key: "woCount",
      count: (id) => prisma.workOrder.count({ where: { routeTemplateId: id } }),
      message: (n) =>
        `Bu rotadan üretilmiş ${n} iş emri var — kalıcı silinemez (soy izi korunur). Rotayı pasife alın.`,
    },
    // F211: rotayı kullanan reçete varsa silme — ProductRecipe.routeId SetNull olur
    // (reçete rotasını sessizce kaybeder).
    {
      key: "recipeCount",
      count: (id) => prisma.productRecipe.count({ where: { routeId: id } }),
      message: (n) =>
        `Bu rotayı kullanan ${n} üretim reçetesi var — kalıcı silinemez (reçete rotasını kaybeder). Rotayı pasife alın.`,
    },
  ],
  deleteTx: async (tx, id) => {
    await tx.routeStep.deleteMany({ where: { routeId: id } });
    await tx.route.delete({ where: { id } });
  },
  successMessage: "Rota ve tüm adımları kalıcı olarak silindi",
});

// Makine silme guard'ları — ÜRETİM İZİ, ÇALIŞMA OTURUMU ve TABLET EŞLEŞMESİ engeller;
// DONANIM (peripheral) ETMEZ. İzi olan makine silinmez, pasife alınır: üretim atfı
// da oturum geçmişi de iş verisidir (audit 6 ayda arşivlenir, yerini tutmaz).
// DONANIM BLOKLAMAZ: silmede machineId=null'a çekilir (donanım kaydı + ayarı korunur,
// atamasız "boşa çıkar"). Şema zaten onDelete:SetNull; deleteTx'te açıkça da yapılır.
const MACHINE_DELETE_GUARDS: DependencyGuard[] = [
  {
    key: "warpBeamEventCount",
    // Devere 1b: WOUND.machineId — geri alınmış (WOUND_CANCEL) satırlar DAHİL sayılır (iş yapıldı).
    count: (id) => prisma.warpBeamEvent.count({ where: { machineId: id } }),
    message: (n) => `Bu makinede ${n} levent sarım kaydı var — kalıcı silinemez. Pasife alın.`,
  },
  {
    // Devere Faz 3: tezgahta BAĞLI levent ("şu an ne" kolonu, FK RESTRICT) — bağlı levent varken makine
    // silinemez; önce sökülür (söküm defter olayıdır, sessizce koparılmaz).
    key: "mountedWarpBeamCount",
    count: (id) => prisma.warpBeam.count({ where: { currentMachineId: id } }),
    message: (n) => `Bu makinede ${n} bağlı levent var — önce leventleri sökün.`,
  },
  {
    key: "rollOperationCount",
    // ⚠️ `revokedAt` SÜZÜLMEZ — yukarıdaki istasyon guard'ıyla aynı gerekçe.
    count: (id) => prisma.rollOperation.count({ where: { machineId: id } }),
    message: (n) => `Bu makineye damgalı ${n} üretim işlemi var — kalıcı silinemez. Pasife alın.`,
  },
  {
    key: "rollMovementCount",
    // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): istasyon guard'ıyla aynı gerekçe — geri alınmış hareket de üretim kanıtı.
    count: (id) => prisma.rollMovement.count({ where: { machineId: id } }),
    message: (n) => `Bu makinede ${n} üretim hareketi kayıtlı — kalıcı silinemez. Pasife alın.`,
  },
  {
    key: "rollCreatedCount",
    count: (id) => prisma.roll.count({ where: { createdMachineId: id } }),
    message: (n) => `Bu makinede ${n} top girişi (KK1) yapılmış — kalıcı silinemez. Pasife alın.`,
  },
  {
    key: "workSessionCount",
    count: (id) => prisma.workSession.count({ where: { machineId: id } }),
    message: (n) => `Bu makinede ${n} çalışma oturumu kaydı var — kalıcı silinemez. Makineyi pasife alın.`,
  },
  {
    key: "deviceCount",
    count: (id) => prisma.device.count({ where: { machineId: id } }),
    message: (n) => `Bu makineye ${n} cihaz (tablet) atanmış — önce cihaz atamasını kaldırın.`,
  },
  {
    // ⚠️ `revokedAt` SÜZÜLMEZ — ve bu, `machine_runs`ın İKİ PARTIAL UNIQUE'indeki
    // TERS yönle çelişmez; ikisi AYRI SORU sorar ve gerekçeleri bilerek yan yana:
    //   • sed  (`machine_runs_one_open_per_prod_line_uq`, `…_natural_uq`):
    //     `revokedAt IS NULL` ŞART — soru "şu an açık mı". Geri alınmış koşum yer
    //     işgal etmemeli, yoksa aynı hatta yeni koşum hiç açılamaz.
    //   • guard (burası): süzülmez — soru "bu makinede iş yapıldı mı". Geri
    //     alınmış koşum da o makinenin üretim geçmişinin kanıtıdır ve silme
    //     guard'ı daha muhafazakâr olmalıdır.
    // Birini ötekine bakarak "tutarlı" yapmak ya sedi tıkar ya guard'ı gevşetir.
    key: "machineRunCount",
    count: (id) => prisma.machineRun.count({ where: { machineId: id } }),
    message: (n) => `Bu makinede ${n} dokuma koşumu kayıtlı — kalıcı silinemez. Pasife alın.`,
  },
  {
    // `revokedAt` SÜZÜLMEZ — machineRunCount ile aynı soru: "bu makinede iş yapıldı mı".
    // Geri alınmış indirme de o makinenin geçmişinin kanıtıdır; FK RESTRICT'tir,
    // guard yalnız ham P2003 yerine hangi kaydın engellediğini söyler.
    key: "doffEventCount",
    count: (id) => prisma.doffEvent.count({ where: { machineId: id } }),
    message: (n) => `Bu makinede ${n} top indirme kaydı var — kalıcı silinemez. Pasife alın.`,
  },
  {
    // Vardiya karnesi İŞ VERİSİDİR (budanmaz, mühürlü satır resmî rakam); mühür durumu
    // süzülmez — OPEN karne de o makinede vardiya çalışıldığının kanıtıdır. FK RESTRICT.
    key: "machineShiftStatCount",
    count: (id) => prisma.machineShiftStat.count({ where: { machineId: id } }),
    message: (n) => `Bu makinede ${n} vardiya karnesi var — kalıcı silinemez. Pasife alın.`,
  },
  {
    // Künye Cascade ile ölür (makinesiz anlamsız) — AMA `baselineRunHours` ERP öncesi ELLE
    // girilmiş çalışma saati bakiyesidir, sessizce ölemez: bakiyesi dolu künye silmeyi durdurur
    // ("önce bakiyeyi not alın"). Guard yazma yüzeyiyle doğdu (B3, 2026-09-14) — P4 muafı düştü.
    key: "machineSpecBaselineCount",
    count: (id) => prisma.machineSpec.count({ where: { machineId: id, baselineRunHours: { not: null } } }),
    message: (n) => `Bu makinenin künyesinde ERP öncesi çalışma saati bakiyesi var (${n}) — önce bakiyeyi not alın, sonra künyeden silin.`,
  },
  {
    // `KursunBypassAssignment.machineId` RESTRICT'tir, yani silme zaten P2003'e
    // düşer — ama operatör jenerik "bağlı kayıt var" yerine HANGİ izin engellediğini
    // görmeli; atama satırı append-only bypass izidir, silinmez.
    key: "kursunBypassCount",
    count: (id) => prisma.kursunBypassAssignment.count({ where: { machineId: id } }),
    message: (n) =>
      `Bu makineye ${n} kurşun bypass ataması yapılmış — kalıcı silinemez. Pasife alın.`,
  },
];

export const machineHardRemove = makeGuardedHardRemove({
  tableName: "MACHINE",
  notFoundMessage: "Makine bulunamadı",
  load: (id) => prisma.machine.findUnique({ where: { id } }),
  guards: MACHINE_DELETE_GUARDS,
  deleteTx: async (tx, id) => {
    // Donanım (peripheral) OTOMATİK boşa çıkar (bloklamaz): machineId=null — donanım
    // kaydı + ayarı (COM/adres/kalibrasyon) korunur, atamasız kalır; sonra başka
    // makineye atanabilir. Şema onDelete:SetNull ile de garanti; burada açık + auditable.
    await tx.peripheralDevice.updateMany({ where: { machineId: id }, data: { machineId: null } });
    await tx.machine.delete({ where: { id } });
  },
  successMessage: "Makine kalıcı olarak silindi",
});

/** Önizlemede engel olarak dökülen en yeni oturum sayısı; toplam `workSessionCount`ta. */
const PREVIEW_SESSION_LIMIT = 5;

/**
 * Makine silme ÖNİZLEMESİ — frontend onay modalında ne olacağını gösterir:
 * engeller (oturum geçmişi dahil, dökümüyle) + boşa çıkacak donanımlar tek tek.
 */
export async function machineDeletePreview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = assertValidUuid(req.params.id); // F46: geçersiz UUID → net 400
    const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!machine) {
      res.status(404).json({ success: false, data: null, message: "Makine bulunamadı" });
      return;
    }

    const blockers: { key: string; count: number; message: string }[] = [];
    for (const guard of MACHINE_DELETE_GUARDS) {
      const n = await guard.count(id);
      if (n > 0) blockers.push({ key: guard.key, count: n, message: guard.message(n) });
    }
    // Sayı guard'ın kendisinden okunur — ikinci bir sayım yüzeyi açılmaz.
    const workSessionCount = blockers.find((b) => b.key === "workSessionCount")?.count ?? 0;
    const recentWorkSessions =
      workSessionCount > 0
        ? await prisma.workSession.findMany({
            where: { machineId: id },
            orderBy: { startedAt: "desc" },
            take: PREVIEW_SESSION_LIMIT,
            select: { id: true, startedAt: true, endedAt: true, user: { select: { fullName: true } } },
          })
        : [];
    // Silmede bu makineden çözülecek (machineId=null) donanım — bloklamaz ama etkilenen
    // kayıttır; onay modalı her birini adıyla listeler.
    const peripheralsToDetach = await prisma.peripheralDevice.findMany({
      where: { machineId: id },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    });

    res.status(200).json({
      success: true,
      data: {
        machineId: id,
        machineName: machine.name,
        deletable: blockers.length === 0,
        workSessionCount,
        recentWorkSessions: recentWorkSessions.map((s) => ({
          id: s.id,
          userName: s.user.fullName,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        })),
        peripheralDetachCount: peripheralsToDetach.length,
        peripheralsToDetach,
        blockers,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * ProductRecipe hard-delete — properties pivot'u tx içinde silinir
 * (onDelete: Cascade'e ek güvence).
 */
export const recipeHardRemove = makeGuardedHardRemove({
  tableName: "PRODUCT_RECIPE",
  notFoundMessage: "Reçete bulunamadı",
  load: (id) => prisma.productRecipe.findUnique({ where: { id } }),
  guards: [],
  deleteTx: async (tx, id) => {
    await tx.productRecipeProperty.deleteMany({ where: { recipeId: id } });
    await tx.productRecipe.delete({ where: { id } });
  },
  successMessage: "Reçete kalıcı olarak silindi",
});

/**
 * F39: DefectType (hata kataloğu) hard-delete guard'ı. Kullanılmış hata tipi
 * silinirse RollError.defectTypeId SetNull olur → defectTypeId bazlı rapor/filtre
 * kırılır + (rollId,startMeter,defectTypeId) partial-unique mükerrer-hata guard'ı
 * o satırlarda devre dışı kalır. Kullanılmışsa 409; normal yol pasife almak.
 */
export const defectTypeHardRemove = makeGuardedHardRemove({
  tableName: "DEFECT_TYPE",
  notFoundMessage: "Hata tipi bulunamadı",
  load: (id) => prisma.defectType.findUnique({ where: { id } }),
  guards: [
    {
      key: "rollErrorCount",
      count: (id) => prisma.rollError.count({ where: { defectTypeId: id } }),
      message: (n) =>
        `Bu hata tipi ${n} hata kaydında kullanılmış — kalıcı silinemez. Pasife alın.`,
    },
    // K3: VARSAYILAN tip silinemez — kurulum sessizce varsayılansız kalırdı (tipsiz giriş 400).
    { key: "isDefault", count: (id) => prisma.defectType.count({ where: { id, isDefault: true } }),
      message: () => "Bu hata tipi VARSAYILAN — silinemez. Önce başka bir tipi varsayılan yapın." },
  ],
  deleteTx: async (tx, id) => {
    await tx.defectType.delete({ where: { id } });
  },
  successMessage: "Hata tipi kalıcı olarak silindi",
});
