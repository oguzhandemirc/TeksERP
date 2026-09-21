import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ShippingService } from "../services/shipping.service";
import { sackSearchService, type SackSearchScope } from "../services/sack-search.service";
import { buildDispatchAccountingExport } from "../services/accounting-export.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import { detectMismatchesForSacks } from "../services/helpers/sack-content-mismatch.helper";
import { SackTagService, MAX_BULK_TAG_SACKS } from "../services/sack-tag.service";
import { PackingGroupService } from "../services/packing-group.service";
import { PackingLotService } from "../services/packing-lot.service";
import { HEX_RE } from "../services/helpers/sack-tag.helper";
import "../types/express-augment";

// ---- Zod şemaları ----------------------------------------------------------
// Çuval aç — müşteri OPSİYONEL (depoda genel stok da olabilir).
const openSackSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID").nullable().optional(),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  weightKg: z.number().positive("Kg pozitif olmalı").max(999_999_999, "Kg çok büyük").optional().nullable(),
  sackNo: z.string().trim().min(1).max(64).optional().nullable(),
  // İdempotency (A4): istemci mantıksal deneme başına bir kez üretir; retry'de
  // aynı token → mevcut çuval cached döner. Opsiyonel (eski istemci geri uyumu).
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
  // Sevk partisi (2026-09-21): çuval partide doğar; `packageNo` yalnız ezme/elle modunda.
  packingGroupId: z.string().uuid("Geçersiz sevk partisi ID").nullable().optional(),
  packageNo: z.number().int("Ambalaj no tam sayı olmalı").min(0, "Ambalaj no negatif olamaz").max(999_999).nullable().optional(),
});
const scanSchema = z.object({ barcode: z.string().trim().min(1, "Barkod gerekli").max(64) });

// ---- Çuval izleri (etiket) -------------------------------------------------
const tagCreateSchema = z.object({
  name: z.string().trim().min(2, "Etiket adı en az 2 karakter").max(60),
  hex: z.string().trim().regex(HEX_RE, "Renk `#RRGGBB` biçiminde olmalı"),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
const tagUpdateSchema = z
  .object({
    name: z.string().trim().min(2, "Etiket adı en az 2 karakter").max(60).optional(),
    hex: z.string().trim().regex(HEX_RE, "Renk `#RRGGBB` biçiminde olmalı").optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
// ---- Paketleme grubu (çalışma yaftası) -------------------------------------
/** Tavan: tek seferde gruplanabilecek çuval sayısı (havuz tavanı 2000'in altında). */
const MAX_GROUP_SACKS = 500;
const packingGroupCreateSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  // Boş küme yalnız SEVK PARTİSİ modunda geçer (boş parti); grup modunda servis
  // "En az bir çuval seçin" der — kural iş kuralıdır, tek yerden söylenir.
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).max(MAX_GROUP_SACKS).default([]),
  /** Verilirse otomatik numara ÜRETİLMEZ (override) — sayaç da ilerlemez. */
  name: z.string().trim().min(1).max(64).optional(),
  note: z.string().trim().max(500).optional(),
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
});
const packingGroupSacksSchema = z.object({
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "En az bir çuval seçin").max(MAX_GROUP_SACKS),
});
const packingGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Grup adı boş olamaz").max(64).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const packingGroupListStatusSchema = z.enum(["OPEN", "CLOSED", "ALL"]).optional();
const sackPackageNoSchema = z.object({
  packageNo: z.number().int("Ambalaj no tam sayı olmalı").min(0, "Ambalaj no negatif olamaz").max(999_999),
});

/** Tekil: çuvalın iz kümesini DEĞİŞTİR (replace). Boş dizi = tüm izleri kaldır. */
const sackTagsSchema = z.object({ tagIds: z.array(z.string().uuid("Geçersiz etiket ID")).max(50) });
/**
 * Toplu iz bırakma/kaldırma.
 *
 * ⚠️ `removeAll` + `remove` çelişkisini Zod DEĞİL SERVİS reddeder (400): kural
 * bir iş kuralıdır ve tekil/toplu her çağıran için AYNI yerden söylenmeli;
 * şemaya `refine` olarak yazılsaydı servisi doğrudan çağıran yol (script, bekçi,
 * dahili çağrı) kapıyı ATLARDI.
 */
const bulkTagsSchema = z.object({
  // Grup kapsamı verilirse `sackIds` BOŞ gelebilir — id'leri sunucu çözer
  // (ekrandaki sayfa grubun tamamı olmayabilir; bkz. `bulkTags` başlığı).
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).max(MAX_BULK_TAG_SACKS).default([]),
  packingGroupId: z.string().uuid("Geçersiz grup ID").optional(),
  add: z.array(z.string().uuid("Geçersiz etiket ID")).max(50).optional(),
  remove: z.array(z.string().uuid("Geçersiz etiket ID")).max(50).optional(),
  removeAll: z.boolean().optional(),
})
  .refine((v) => v.sackIds.length > 0 || v.packingGroupId, {
    message: "Çuval seçin ya da bir grup belirtin",
  });
const addKartelaSchema = z.object({
  itemId: z.string().uuid("Geçersiz ürün ID"),
  colorId: z.string().uuid("Geçersiz renk ID").nullable().optional(),
  count: z.number().int().positive("Adet pozitif tam sayı olmalı").max(10000),
});
const weighSackSchema = z.object({
  weightKg: z.number().positive("Kg pozitif olmalı").max(999_999_999, "Kg çok büyük"),
  /**
   * Tartının KAYNAĞI. Verilmezse `MANUAL` varsayılır (eski istemci geri uyumu).
   * İstemci beyanı SCALE için tek sinyal DEĞİL: mobil oturumda backend cihazı
   * `getStampContext` ile kendi çözüp `simulate`'i çapraz kontrol eder. Electron'da
   * kantar yerel tercihlerden gelebildiği (DB kaydı yok) için orada beyan TEK sinyaldir.
   */
  source: z.enum(["SCALE", "MANUAL", "SIMULATED"]).optional(),
});
// Çuval müşterisi değiştir — müşteri/şube OPSİYONEL (null = müşterisiz genel stok).
// ⚠️ `.strict()` LOAD-BEARING (2026-09-01). Her iki alan da opsiyonel ve
// controller `body.customerId ?? null` yazıyor → alan GELMEZSE çuvalın müşterisi
// SİLİNİR. Katı olmayan şemada bir yazım hatası (`{ id }`, `{ musteriId }`)
// sessizce "müşteriyi kaldır"a dönüşür ve uç 200 döner: ölçüldü, `{ id }`
// gövdesiyle 200 alındı. Niyet ("ata") ile sonuç ("kaldır") ters; katı şemada
// aynı çağrı 400 verir. Boşaltma MEŞRU bir işlemdir (çuval depo nesnesidir,
// müşteri opsiyonel) — o yüzden alan `null` ile AÇIKÇA gönderilmeye devam eder.
const reassignSackCustomerSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID").nullable().optional(),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
}).strict();
const removeSackSchema = z.object({ withContents: z.boolean().optional() });
// Çuval notu — iç serbest not; boş/whitespace veya null → temizle.
const sackNotesSchema = z.object({ notes: z.string().trim().max(500, "Not en fazla 500 karakter").nullable().optional() });
const distributeSackSchema = z.object({
  rollIds: z.array(z.string().uuid()).optional(),
  swatchIds: z.array(z.string().uuid()).optional(),
});
// Toplu dağıtma — listeden seçilen çuvalların İÇERİĞİ depoya çıkar (çuval SİLİNMEZ).
// Tavan 200: yıkıcı bir işlemin tek istekte sınırsız kayda dokunması, önizlemenin
// "etkilenen HER kaydı listele" sözünü de kullanışsız kılardı.
const bulkSackIdsSchema = z.object({
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "En az bir çuval seçilmeli").max(200),
});
const moveRollsSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçilmeli"),
  targetSackId: z.string().uuid(),
});
// Çuval böl — seçili toplar YENİ çuvala ayrılır (hedef çuval verilmez, açılır).
const splitSackSchema = z.object({
  rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top seçilmeli").max(500),
});
const moveSackSchema = z.object({ sackId: z.string().uuid("Geçersiz çuval ID") });

// Sevkiyat kur — depodan çuval seç + müşteri/şube ata + (opsiyonel) sipariş seç.
const createShipmentSchema = z.object({
  // .max(500) — önizleme (previewShipmentSchema) ve sackIdsSchema zaten 500'de
  // sınırlıydı, YAZAN yol sınırsızdı: express.json({limit:"1mb"}) ≈ 26.000 UUID
  // geçirir ve createShipment çuval-BAŞINA sıralı updateMany + tahsis +
  // freezeForSource (tüm sevkiyat ağacının snapshot'ı) yapar → hepsi TEK
  // transaction'da, yani bir havuz bağlantısını 20sn Prisma tavanına kadar tutar.
  // Uygulamanın en uzun tx'i buydu; asimetri kapatıldı.
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "En az bir çuval seçilmeli").max(500),
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).optional(),
  destination: z.enum(["DOMESTIC", "EXPORT"]).optional(),
  procedureCode: z.string().trim().max(64).nullable().optional(),
  // Sevk onayı kapalıyken (varsayılan) doğrudan sevk → araç bilgisi opsiyonel.
  plateNumber: z.string().trim().max(32).nullable().optional(),
  driverName: z.string().trim().max(100).nullable().optional(),
  carrier: z.string().trim().max(100).nullable().optional(),
  // İdempotency (A4): timeout-retry aynı token'la kurulmuş sevkiyatı geri alır
  // (kör 409 yerine). Opsiyonel (eski istemci geri uyumu).
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
  // Siparişsiz sevk NİYETİ (BULGU-T3-002). Beyan edilmezse yanıt uyarı taşır —
  // 400 DEĞİL: sahadaki tabletler `orderIds` göndermiyor ve backend önce deploy
  // edildiği için sert red hepsini aynı anda sevk yapamaz hâle getirirdi.
  orderless: z.boolean().optional(),
});
const shipmentOrdersSchema = z.object({
  // Boş dizi MEŞRU: "sipariş bağını kaldır".
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).max(50),
});
// HIZLI SEVK — çuval YOK, doğrudan top listesi. Barkod İSTEMEZ (rollIds):
// etiket basmayan kullanıcı birinci sınıf. 500 tavanı createShipment ile aynı
// gerekçe (tek tx'in uzunluğu).
const quickShipmentSchema = z.object({
  rollIds: z.array(z.string().uuid("Geçersiz top ID")).min(1, "En az bir top seçilmeli").max(500),
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).optional(),
  destination: z.enum(["DOMESTIC", "EXPORT"]).optional(),
  procedureCode: z.string().trim().max(64).nullable().optional(),
  plateNumber: z.string().trim().max(32).nullable().optional(),
  driverName: z.string().trim().max(100).nullable().optional(),
  carrier: z.string().trim().max(100).nullable().optional(),
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
  // Siparişsiz sevk NİYETİ — `createShipmentSchema` ile AYNI sözleşme (Dilim 2).
  // Alan burada YOKKEN `z.object` onu sessizce düşürüyordu: hızlı sevkte niyet
  // beyan etmenin hiçbir yolu yoktu ve `block` rejiminde tek çıkış kapanırdı.
  orderless: z.boolean().optional(),
});
// FIFO öneri sorgusu — `itemId` ZORUNLU: kumaşsız çağrı "depodaki en eski 20 top"
// demek olurdu ve karışık spec'li bir öneri sevk edilemez (tek irsaliye tek müşteri
// ama operatör neyi sattığını bilir). Renk opsiyonel (renksiz ham kumaş meşru).
const shippableRollsSchema = z.object({
  itemId: z.string().uuid("Geçersiz kumaş ID"),
  colorId: z.string().uuid("Geçersiz renk ID").optional(),
  warehouseId: z.string().uuid("Geçersiz depo ID").optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
// Sevk önizleme — çuval + (opsiyonel) müşteri/şube/sipariş; salt-okunur.
const previewShipmentSchema = z.object({
  sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "Çuval seçilmeli").max(500),
  customerId: z.string().uuid("Geçersiz müşteri ID").nullable().optional(),
  branchId: z.string().uuid("Geçersiz şube ID").nullable().optional(),
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).optional(),
});
const sackIdsSchema = z.object({ sackIds: z.array(z.string().uuid("Geçersiz çuval ID")).min(1, "Çuval seçilmeli").max(500) });
const removeShipmentSackSchema = z.object({ sackId: z.string().uuid("Geçersiz çuval ID") });
const destinationSchema = z.object({ destination: z.enum(["DOMESTIC", "EXPORT"]) });
const procedureCodeSchema = z.object({ procedureCode: z.string().trim().max(64).nullable().optional() });
const dispatchNoteSchema = z.object({ dispatchNote: z.string().trim().max(500).nullable().optional() });
// Araca yüklenen gerçek çuval adedi (operatör beyanı). `null` = beyanı kaldır.
const manualSackCountSchema = z.object({
  manualSackCount: z.number().int().min(1).max(9999).nullable().optional(),
});
// Fatura işareti — `invoiceNo: null` (ya da boş) işareti KALDIRIR; tarih verilmezse
// servis "şimdi"yi damgalar. Tutar/KDV alanı YOK (muhasebe yüzeyi miktar-odaklı).
const invoiceSchema = z.object({
  invoiceNo: z.string().trim().max(64).nullable().optional(),
  invoicedAt: z.coerce.date().nullable().optional(),
});
const dispatchSchema = z.object({
  plateNumber: z.string().trim().max(32).optional().nullable(),
  driverName: z.string().trim().max(100).optional().nullable(),
  carrier: z.string().trim().max(100).optional().nullable(),
});
// Sevki geri al (storno) — gerekçe ZORUNLU: resmi çıkış belgesi iptal ediliyor,
// "neden" audit'te ve belgenin voidReason'ında yazılı kalmalı.
const undoDispatchSchema = z.object({
  reason: z.string().trim().min(3, "Geri alma gerekçesi zorunlu (en az 3 karakter)").max(500),
  // Storno + kapanış aynı tx'te (sevkiyat PLANNED'da beklemez, çuvallar depoya döner).
  // Sevk onayı KAPALI rejimin olağan yolu; varsayılanı istemci önizlemeden kurar.
  releaseSacks: z.boolean().optional(),
});

export class ShippingController {
  private service = new ShippingService();

  // ---- ÇUVAL DEPO (çuval aç / okut / tart) --------------------------------
  openSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = openSackSchema.parse(req.body);
      const result = await this.service.openSack(
        {
          customerId: body.customerId ?? null, branchId: body.branchId ?? null, weightKg: body.weightKg, sackNo: body.sackNo, clientToken: body.clientToken ?? null,
          packingGroupId: body.packingGroupId ?? null, packageNo: body.packageNo ?? null,
        },
        req.user?.userId,
        // Elle-tartı kısıtı yalnız HTTP yolunda uygulanır (F221) — izin listesi
        // buradan geçer, dahili çağrılar (script/job/servis) etkilenmez.
        { permissions: req.user?.permissions },
      );
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  scanIntoSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = scanSchema.parse(req.body);
      const result = await this.service.scanIntoSack({ sackId: req.params.id as string, barcode: body.barcode }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  addKartelaToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = addKartelaSchema.parse(req.body);
      const result = await this.service.addKartelaToSack({ sackId: req.params.id as string, itemId: body.itemId, colorId: body.colorId ?? null, count: body.count }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  weighSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = weighSackSchema.parse(req.body);
      // Oturumun makine/istasyonu — simüle kantar çapraz kontrolü için (mobil).
      // Web/Electron'da `req.device` yoksa null döner ve guard yalnız istemci
      // beyanına bakar (o platformda kantar yerel tercih olabilir, DB'de yoktur).
      const stamp = await getStampContext(req);
      const result = await this.service.weighSack(
        { sackId: req.params.id as string, weightKg: body.weightKg, ...(body.source ? { source: body.source } : {}) },
        req.user?.userId,
        stamp ? { machineId: stamp.machineId, stationId: stamp.stationId } : undefined,
        { permissions: req.user?.permissions },
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  reassignSackCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = reassignSackCustomerSchema.parse(req.body);
      const result = await this.service.reassignSackCustomer(
        req.params.id as string,
        { customerId: body.customerId ?? null, branchId: body.branchId ?? null },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  splitSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = splitSackSchema.parse(req.body);
      const result = await this.service.splitSack(
        { sackId: req.params.id as string, rollIds: body.rollIds },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  setSackNotes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackNotesSchema.parse(req.body ?? {});
      const result = await this.service.setSackNotes(req.params.id as string, body.notes ?? null, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getSackNotes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSackNotes(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- Paketleme grubu (çalışma yaftası) -----------------------------------

  listPackingGroups = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = z.string().uuid("Geçersiz müşteri ID").parse(req.query.customerId);
      const status = packingGroupListStatusSchema.parse(req.query.status);
      res.status(200).json(await PackingGroupService.list(customerId, { status }));
    } catch (e) { next(e); }
  };

  packingLotSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = z.string().uuid("Geçersiz müşteri ID").parse(req.query.customerId);
      res.status(200).json(await PackingLotService.customerSummary(customerId));
    } catch (e) { next(e); }
  };

  getPackingGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await PackingGroupService.get(req.params.id as string));
    } catch (e) { next(e); }
  };

  // ---- Sevk partisi (yaşam döngüsü + ambalaj no) ------------------------------

  deletePackingGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await PackingLotService.remove(req.params.id as string, req.user?.userId));
    } catch (e) { next(e); }
  };

  setSackPackageNo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackPackageNoSchema.parse(req.body ?? {});
      res.status(200).json(await PackingLotService.setPackageNo(req.params.id as string, body.packageNo, req.user?.userId));
    } catch (e) { next(e); }
  };

  createPackingGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = packingGroupCreateSchema.parse(req.body ?? {});
      res.status(201).json(await PackingGroupService.createWithSacks({ ...body, userId: req.user?.userId }));
    } catch (e) { next(e); }
  };

  addSacksToPackingGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = packingGroupSacksSchema.parse(req.body ?? {});
      res.status(200).json(
        await PackingGroupService.addSacks(req.params.id as string, body.sackIds, req.user?.userId),
      );
    } catch (e) { next(e); }
  };

  removeSacksFromPackingGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = packingGroupSacksSchema.parse(req.body ?? {});
      res.status(200).json(await PackingGroupService.removeSacks(body.sackIds, req.user?.userId));
    } catch (e) { next(e); }
  };

  updatePackingGroup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = packingGroupUpdateSchema.parse(req.body ?? {});
      res.status(200).json(
        await PackingGroupService.update(req.params.id as string, body, req.user?.userId),
      );
    } catch (e) { next(e); }
  };

  // ---- Çuval izleri (etiket) -----------------------------------------------

  listSackTags = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(
        await SackTagService.listTags({ includeInactive: req.query.includeInactive === "true" }),
      );
    } catch (e) { next(e); }
  };

  createSackTag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = tagCreateSchema.parse(req.body);
      res.status(201).json(await SackTagService.createTag(body, req.user?.userId));
    } catch (e) { next(e); }
  };

  updateSackTag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = tagUpdateSchema.parse(req.body);
      res.status(200).json(await SackTagService.updateTag(req.params.id as string, body, req.user?.userId));
    } catch (e) { next(e); }
  };

  deleteSackTag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await SackTagService.deleteTag(req.params.id as string, req.user?.userId));
    } catch (e) { next(e); }
  };

  getSackTagsOfSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await SackTagService.getSackTags(req.params.id as string));
    } catch (e) { next(e); }
  };

  setSackTagsOfSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackTagsSchema.parse(req.body ?? {});
      res.status(200).json(
        await SackTagService.setSackTags(req.params.id as string, body.tagIds, req.user?.userId),
      );
    } catch (e) { next(e); }
  };

  bulkSackTags = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = bulkTagsSchema.parse(req.body ?? {});
      res.status(200).json(await SackTagService.bulkTags(body, req.user?.userId));
    } catch (e) { next(e); }
  };

  removeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeSackSchema.parse(req.body ?? {});
      const result = await this.service.removeSack(req.params.id as string, req.user?.userId, body.withContents ?? false);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeRollFromSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.removeRollFromSack({ rollId: req.params.rollId as string }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeSwatchFromSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.removeSwatchFromSack({ swatchId: req.params.swatchId as string }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  moveRollToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = moveSackSchema.parse(req.body);
      const result = await this.service.moveRollToSack({ rollId: req.params.rollId as string, sackId: body.sackId }, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Çuvalı dağıt — seçili (rollIds/swatchIds) veya tüm içeriği depoya çıkar. */
  distributeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = distributeSackSchema.parse(req.body ?? {});
      const result = await this.service.distributeSackContents(
        { sackId: req.params.id as string, rollIds: body.rollIds, swatchIds: body.swatchIds },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Onarılabilir sevkiyatlar — yazma yok. */
  listRepairableShipments = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await this.service.listRepairableShipments());
    } catch (e) { next(e); }
  };

  /** Tek sevkiyatın defterini onar — irsaliye v+1 doğurur. */
  /** Onarım ÖNİZLEMESİ — hangi sipariş satırına kaç metre. Yazma YOK. */
  previewRepairAllocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await this.service.previewRepairAllocation(req.params.id as string));
    } catch (error) {
      next(error);
    }
  };

  repairShipmentAllocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(
        await this.service.repairShipmentAllocation(req.params.id as string, req.user?.userId),
      );
    } catch (e) { next(e); }
  };

  /** Toplu dağıtma ÖNİZLEME — yazma yok; etkilenen her top listelenir. */
  previewDistributeSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = bulkSackIdsSchema.parse(req.body);
      res.status(200).json(await this.service.previewDistributeSacks(body.sackIds));
    } catch (e) { next(e); }
  };

  /** Toplu dağıtma UYGULA — engelli çuval atlanır ve sebebi yanıtta döner. */
  distributeSacksBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = bulkSackIdsSchema.parse(req.body);
      res.status(200).json(await this.service.distributeSacksBulk({ sackIds: body.sackIds }, req.user?.userId));
    } catch (e) { next(e); }
  };

  /** Seçili topları başka depo çuvalına toplu taşı. */
  moveRollsToSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = moveRollsSchema.parse(req.body);
      const result = await this.service.moveRollsToSack(
        { sackId: req.params.id as string, rollIds: body.rollIds, targetSackId: body.targetSackId },
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  listPool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listPool({ customerId: (req.query.customerId as string | undefined) || undefined, search: (req.query.search as string | undefined) || undefined });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  listCustomerPoolSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = z.string().uuid("Geçersiz müşteri ID").parse(req.query.customerId);
      const result = await this.service.listCustomerPoolSacks(customerId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- SEVKİYAT (depodan çuval seçerek kur + yaşam döngüsü) -----------------
  createShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createShipmentSchema.parse(req.body);
      const result = await this.service.createShipment({ sackIds: body.sackIds, customerId: body.customerId, branchId: body.branchId ?? null, orderIds: body.orderIds, destination: body.destination, procedureCode: body.procedureCode ?? null, plateNumber: body.plateNumber ?? null, driverName: body.driverName ?? null, carrier: body.carrier ?? null, clientToken: body.clientToken ?? null, orderless: body.orderless }, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  /** Sevkiyatı siparişe bağla / bağı değiştir — sevk EDİLDİKTEN sonra da. */
  setShipmentOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = shipmentOrdersSchema.parse(req.body);
      const result = await this.service.setShipmentOrders(req.params.id as string, body.orderIds, req.user?.userId);
      res.json(result);
    } catch (e) { next(e); }
  };

  createShipmentFromRolls = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = quickShipmentSchema.parse(req.body);
      const result = await this.service.createShipmentFromRolls(
        {
          rollIds: body.rollIds,
          customerId: body.customerId,
          branchId: body.branchId ?? null,
          orderIds: body.orderIds,
          orderless: body.orderless,
          destination: body.destination,
          procedureCode: body.procedureCode ?? null,
          plateNumber: body.plateNumber ?? null,
          driverName: body.driverName ?? null,
          carrier: body.carrier ?? null,
          clientToken: body.clientToken ?? null,
        },
        req.user?.userId,
      );
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  findShippableRolls = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = shippableRollsSchema.parse(req.query);
      const result = await this.service.findShippableRolls({
        itemId: q.itemId,
        colorId: q.colorId ?? null,
        warehouseId: q.warehouseId ?? null,
        limit: q.limit ?? 20,
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  previewCreateShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = previewShipmentSchema.parse(req.body);
      const result = await this.service.previewCreateShipment({ sackIds: body.sackIds, customerId: body.customerId ?? null, branchId: body.branchId ?? null, orderIds: body.orderIds });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  addSacksToShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackIdsSchema.parse(req.body);
      const result = await this.service.addSacksToShipment(req.params.id as string, body.sackIds, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  removeSackFromShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeShipmentSackSchema.parse(req.body);
      const result = await this.service.removeSackFromShipment(req.params.id as string, body.sackId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setDestination = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = destinationSchema.parse(req.body);
      const result = await this.service.setDestination(req.params.id as string, body.destination, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setProcedureCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = procedureCodeSchema.parse(req.body);
      const result = await this.service.setProcedureCode(req.params.id as string, body.procedureCode ?? null, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setDispatchNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchNoteSchema.parse(req.body);
      const result = await this.service.setDispatchNote(req.params.id as string, body.dispatchNote ?? null, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setManualSackCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = manualSackCountSchema.parse(req.body);
      const result = await this.service.setManualSackCount(
        req.params.id as string,
        body.manualSackCount ?? null,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getDispatchNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDispatchNote(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setShipmentInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = invoiceSchema.parse(req.body);
      const result = await this.service.setShipmentInvoice(
        req.params.id as string,
        body.invoiceNo ?? null,
        body.invoicedAt ?? null,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setDirectShipmentInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = invoiceSchema.parse(req.body);
      const result = await this.service.setDirectShipmentInvoice(
        req.params.id as string,
        body.invoiceNo ?? null,
        body.invoicedAt ?? null,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  dispatchShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatchShipment(req.params.id as string, body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  cancelPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  cancelShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.cancelShipment(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- SEVKİ GERİ AL (STORNO) ----------------------------------------------
  undoDispatchPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getUndoDispatchPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  undoDispatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = undoDispatchSchema.parse(req.body);
      const result = await this.service.undoDispatch(req.params.id as string, body.reason, req.user?.userId, {
        releaseSacks: body.releaseSacks,
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- LİSTE / DETAY / RAPOR -----------------------------------------------
  listShipments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listShipments(req);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getDirectShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDirectShipmentById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  listSackStoreBoard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limitRaw = parseInt(req.query.limit as string, 10);
      const result = await this.service.listSackStoreBoard({
        status: (req.query.status as string | undefined) || undefined,
        search: (req.query.search as string | undefined) || undefined,
        destination: (req.query.destination as string | undefined) || undefined,
        cursor: (req.query.cursor as string | undefined) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getShipmentSackContents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentSackContents(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getDispatchReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDispatchReport(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getDirectShipmentDispatchReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDirectShipmentDispatchReport(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getAccountingExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await buildDispatchAccountingExport(req);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- ÇUVAL/TOP ARAMA — salt-okunur ---------------------------------------
  // useDataTable uyumlu: filter[*] + search + sortBy/sortOrder + withTotal + cursor/limit.
  searchSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filt = (k: string): string | undefined => {
        const v = req.query[`filter[${k}]`];
        return typeof v === "string" && v.trim() ? v.trim() : undefined;
      };
      // Çoklu seçim: FilterBar multi-lookup virgülle ayrılmış ID gönderir → liste.
      const filtIds = (k: string): string[] | undefined => {
        const ids = filt(k)?.split(",").map((s) => s.trim()).filter(Boolean);
        return ids?.length ? ids : undefined;
      };
      const num = (v: string | undefined): number | undefined => {
        if (v == null || v === "") return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      // Üç-durumlu bayrak süzgeci: "true"/"false" → boolean, yoksa undefined
      // (= filtre YOK). `=== "true"` yazımı yasak: seçilmemiş filtreyi "false"
      // sayıp listeyi sessizce daraltırdı.
      const bool = (v: string | undefined): boolean | undefined =>
        v === "true" ? true : v === "false" ? false : undefined;
      const date = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || !v) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const scopeRaw = filt("scope");
      const scope = (["POOL", "PLANNED", "DISPATCHED", "ALL"] as const).includes(scopeRaw as SackSearchScope)
        ? (scopeRaw as SackSearchScope)
        : undefined;
      const sortOrderRaw = req.query.sortOrder;
      const result = await sackSearchService.searchSacks({
        itemId: filtIds("itemId"),
        colorId: filtIds("colorId"),
        widthMin: num(filt("widthMin")),
        widthMax: num(filt("widthMax")),
        customerId: filtIds("customerId"),
        branchId: filtIds("branchId"),
        weighed: bool(filt("weighed")),
        hasNote: bool(filt("hasNote")),
        // Not METNİ araması — `hasNote` kardeşi, serbest `search` kutusundan AYRI.
        noteText: filt("noteText") || undefined,
        empty: bool(filt("empty")),
        // ⚠️ `dateField` YOKSA createdAt: `applyDateRange` alan adı olmayan bir
        // aralığı SESSİZCE yok sayar (2026-08-12 dersi). Panel alanı her zaman
        // gönderir; bu varsayılan uçtan doğrudan çağıran yolları korur.
        dateField:
          typeof req.query.dateField === "string" && req.query.dateField ? req.query.dateField : "createdAt",
        dateFrom: date(req.query.dateFrom),
        dateTo: date(req.query.dateTo),
        // Kalite KODU taşır (uuid değil) — `filtIds` yalnız virgülle böler,
        // tip varsaymaz; servis kanonikleştirip OR'a çevirir.
        qualityGrade: filtIds("qualityGrade"),
        // ÇUVAL İZİ — `multi-lookup` + "izsiz" sentineli ("none"). Servis
        // sentineli UUID listesinden AYIRIR (`splitTagFilter`); ham geçirilseydi
        // `@db.Uuid` kolonda P2007 → 400 olurdu.
        tagId: filtIds("tagId"),
        hasTag: bool(filt("hasTag")),
        // PAKETLEME GRUBU — iz filtresiyle AYNI kalıp: `multi-lookup` +
        // "gruplanmamış" sentineli ("none"), sentineli servis ayırıyor.
        packingGroupId: filtIds("packingGroupId"),
        scope,
        search: typeof req.query.search === "string" ? req.query.search.trim() || undefined : undefined,
        sortBy: typeof req.query.sortBy === "string" ? req.query.sortBy : undefined,
        sortOrder: sortOrderRaw === "asc" ? "asc" : sortOrderRaw === "desc" ? "desc" : undefined,
        withTotal: req.query.withTotal === "true",
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        limit: num(typeof req.query.limit === "string" ? req.query.limit : undefined),
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * GET /api/shipping/sack-search/customers — cari kapısı (Paketleme/Çuvallar
   * ekranının giriş adımı). Kapsam varsayılanı `searchSacks` ile AYNI kaynaktan
   * (POOL+PLANNED) gelir; ayrışırsa kapı ile liste farklı sayı basar.
   *
   * ⚠️ `withSacksOnly=1` → yalnız çuvalı olan cariler (eski davranış, kesmeli).
   *    Verilmezse TÜM cariler döner, sayfalı (`cursor` + `limit`).
   */
  listSackCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scopeRaw = typeof req.query.scope === "string" ? req.query.scope : undefined;
      const scope = (["POOL", "PLANNED", "DISPATCHED", "ALL"] as const).includes(scopeRaw as SackSearchScope)
        ? (scopeRaw as SackSearchScope)
        : undefined;
      // ⚠️ ÜÇ DEĞERLİ DEĞİL, İKİ: bayrak yalnız "1"/"true" ile AÇILIR. Varsayılan
      //    TÜM CARİLER (2026-09-04 kullanıcı kararı) — `!== "0"` yazımı, parametre
      //    hiç gelmediğinde eski davranışı geri getirirdi.
      const bayrak = req.query.withSacksOnly;
      const withSacksOnly = bayrak === "1" || bayrak === "true";
      const limitRaw = Number(req.query.limit);
      const result = await sackSearchService.listSackCustomers({
        scope,
        search: typeof req.query.search === "string" ? req.query.search.trim() || undefined : undefined,
        withSacksOnly,
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  getSackContents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await sackSearchService.getSackContents(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /**
   * POST /api/shipping/sacks/mismatch-check — çuval içeriği uyuşmazlık denetimi.
   *
   * SALT-OKUNUR ve HİÇBİR ŞEYİ ENGELLEMEZ (saha kararı: *"uyar ama engel olma"*).
   * Aynı motoru hem çuval kartı hem sevkiyat kurma özeti çağırır — tek kaynak,
   * yoksa iki yüzey aynı çuval için farklı şey söyler.
   */
  checkSackMismatches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 200 tavanı `getPickList` ile aynı — sevkiyat kurmada seçilebilecek en
      // büyük küme; tavansız sorgu perf kuralı ihlali olurdu.
      const body = z.object({ sackIds: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
      const map = await detectMismatchesForSacks(body.sackIds);
      res.status(200).json({
        success: true,
        data: Object.fromEntries(map),
      });
    } catch (e) { next(e); }
  };

  getPickList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = z.object({ sackIds: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
      const result = await sackSearchService.getPickList(body.sackIds);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** İçerik dökümü — çeki listesinin GRUPLU özeti değil, TOP BAZLI döküm. */
  getContentDump = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Grup kapsamı verilirse `sackIds` BOŞ gelebilir — id'leri sunucu çözer
      // (ekrandaki sayfa grubun tamamı olmayabilir; bkz. servis başlığı).
      const body = z
        .object({
          sackIds: z.array(z.string().uuid()).max(200).default([]),
          packingGroupId: z.string().uuid("Geçersiz grup ID").optional(),
        })
        .refine((v) => v.sackIds.length > 0 || v.packingGroupId, {
          message: "Çuval seçin ya da bir grup belirtin",
        })
        .parse(req.body);
      const result = await sackSearchService.getContentDump(body.sackIds, body.packingGroupId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  locateRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const barcode = z.string().trim().min(1, "Barkod gerekli").max(64).parse(req.query.barcode);
      const result = await sackSearchService.locateRoll(barcode);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- SİPARİŞ SEÇİM (paketleme rehberi) -----------------------------------
  openOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const branchRaw = req.query.branchId as string | undefined;
      const result = await this.service.listOpenOrdersWithCoverage({
        customerId: (req.query.customerId as string | undefined) || undefined,
        branchId: branchRaw === undefined ? undefined : branchRaw || null,
        // Sipariş arama — sevkiyat kur modalındaki kutu. Boş string `undefined`e
        // düşer (süzgeç YOK); `?search=` yazan istemci tüm listeyi almalı.
        search: (req.query.search as string | undefined) || undefined,
      });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
