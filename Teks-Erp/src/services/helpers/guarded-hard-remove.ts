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
      const id = String(req.params.id);

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
  ],
  deleteTx: async (tx, id) => {
    await tx.routeStep.deleteMany({ where: { routeId: id } });
    await tx.route.delete({ where: { id } });
  },
  successMessage: "Rota ve tüm adımları kalıcı olarak silindi",
});

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
