import { Router } from "express";
import { ShippingController } from "../controllers/shipping.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new ShippingController();
const router = Router();

// Okuma: web sevkiyat yetkisi veya mobil paket/sevkiyat ekranları
const READ = requireAnyPermission("shipping:read", "shipping:write", "mobile:tarti-paket", "mobile:sevkiyat");
// Yazma: web sevkiyat yazma veya mobil paket/sevkiyat ekranları
const WRITE = requireAnyPermission("shipping:write", "mobile:tarti-paket", "mobile:sevkiyat");
// Sevk partisi YÖNETİMİ (sil · ambalaj no ez) — çuval açan/okutan herkesin işi değil;
// belgeye basılan kimliği değiştirir. Tablet bu fazda dışarıda.
const LOT_MANAGE = requireAnyPermission("shipping:packing-lot");
// Muhasebe okuma: sevk fişi + Excel export (satış raporu izni de erişebilir).
const ACCOUNTING_READ = requireAnyPermission("shipping:read", "shipping:write", "report:sales");
// Fatura işareti: muhasebeciye `shipping:write` VERİLMEZ (o izin sevkiyat iptalini de
// açardı) → ayrı, dar kapsamlı izin. `shipping:write` de kabul edilir: sevkiyatçının
// mevcut yetkisi daralmasın.
const INVOICE_WRITE = requireAnyPermission("shipping:invoice", "shipping:write");
// Defter onarımı — `shipping:write` YETMEZ (geçmiş sevkiyatın defterini değiştirir
// ve irsaliyenin yeni sürümünü doğurur); `shipping:undo-dispatch` ile aynı aile.
const REPAIR = requireAnyPermission("shipping:repair-allocation");
// Sevki geri alma (storno): `shipping:write`ten AYRI ve onu KAPSAMAZ. Sevk eden
// herkesin resmi çıkış belgesini iptal edip stok/karşılanma defterini geri
// sarabilmesi istenmiyor. Önizleme de aynı izinle kapılı — göremeyeceği işlemin
// yıkım listesini okumasının anlamı yok.
const UNDO_DISPATCH = requireAnyPermission("shipping:undo-dispatch");

// ===========================================================================
// SİPARİŞ SEÇİM — açık siparişler + depo karşılaması (paketleme rehberi)
// ===========================================================================
/**
 * @openapi
 * /api/shipping/open-orders:
 *   get:
 *     tags: [Shipping]
 *     summary: Açık siparişler + depo karşılaması (paketleme rehberi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: customerId
 *         schema: { type: string }
 *       - in: query
 *         name: branchId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         description: Sipariş no / cari adı / kumaş adı / renk adı (SUNUCU tarafı süzme)
 *         schema: { type: string }
 *     responses: { 200: { description: Açık siparişler + satır bazlı karşılama } }
 */
router.get("/open-orders", verifyToken, READ, controller.openOrders);

// ===========================================================================
// ÇUVAL DEPO HAVUZU — çuval aç / okut / tart (sevkiyattan bağımsız)
// ===========================================================================
/**
 * @openapi
 * /api/shipping/pool:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval depo havuzu board'u (müşteri-gruplu)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Müşteri bazlı havuz özeti } }
 */
router.get("/pool", verifyToken, READ, controller.listPool);
router.get("/pool/sacks", verifyToken, READ, controller.listCustomerPoolSacks);

/**
 * @openapi
 * /api/shipping/sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Müşteriye havuz çuvalı aç
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Çuval açıldı } }
 */
router.post("/sacks", verifyToken, WRITE, controller.openSack);

// Çuval içeriği: barkod okut, kartela ekle, tart, sil
router.post("/sacks/:id/scan", verifyToken, WRITE, controller.scanIntoSack);
router.post("/sacks/:id/add-kartela", verifyToken, WRITE, controller.addKartelaToSack);
router.post("/sacks/:id/weigh", verifyToken, WRITE, controller.weighSack);
router.post("/sacks/:id/customer", verifyToken, WRITE, controller.reassignSackCustomer);
router.post("/sacks/:id/remove", verifyToken, WRITE, controller.removeSack);

/**
 * @openapi
 * /api/shipping/sacks/{id}/notes:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval notunu oku (iç serbest not)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Yorum }, 404: { description: Çuval bulunamadı } }
 *   post:
 *     tags: [Shipping]
 *     summary: Çuval notunu yaz/temizle
 *     description: >
 *       İç serbest not ("kendimiz için"). Çuvalın durumu FARK ETMEZ — sevkiyata atanmış
 *       veya sevk edilmiş çuvala da yazılabilir (annotation; dispatchNote ile aynı).
 *       Boş/whitespace veya null → not temizlenir. Gösterimi etiket/irsaliyede
 *       opsiyonel ve varsayılan kapalıdır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string, maxLength: 500, nullable: true }
 *     responses: { 200: { description: Kaydedildi }, 404: { description: Çuval bulunamadı } }
 */
router.get("/sacks/:id/notes", verifyToken, READ, controller.getSackNotes);
router.post("/sacks/:id/notes", verifyToken, WRITE, controller.setSackNotes);

// ===========================================================================
// ÇUVAL İZLERİ (ETİKET) — katalog + atama (2026-09-04)
// ===========================================================================
// YENİ İZİN KODU YOK (bilinçli): okuma `READ`, yazma `WRITE` — yani sevkiyat
// yetkisi olan zaten iz bırakabiliyor. Ayrı bir kod, sahada ATANMASI UNUTULACAK
// bir adım daha demekti (2026-08-01 kurşun bypass vakasının dersi).
//
// ⚠️ SIRA LOAD-BEARING: `/sacks/tags/...` yolları `/sacks/:id/...` KALIPLARINDAN
// ÖNCE gelmeli. Bugün çakışma yok (üçüncü segment literal), ama `/sacks/:id/tags`
// ile `/sacks/tags/bulk` bir yazım hatasında birbirine karışmaya açık — sıra
// bunun sigortası (`/sacks/mismatch-check` ile aynı gerekçe).

/**
 * @openapi
 * /api/shipping/sacks/tags/bulk:
 *   post:
 *     tags: [Shipping]
 *     summary: Toplu iz bırak/kaldır (seçili çuvallara)
 *     description: >
 *       Sonuç PARÇALIDIR: sevk EDİLMİŞ çuval `skipped[]` içinde döner, 409 ATILMAZ —
 *       karışık bir seçimde tek satır yüzünden tüm hamleyi düşürmek sahayı tıkar.
 *       PLANNED çuval etiketlenir (mal hâlâ binada). `removeAll` ile `remove`
 *       birlikte gönderilemez (400) — sunucu niyeti sessizce seçmez; `add` + `remove`
 *       aynı çağrıda serbesttir (yeniden etiketleme tek hamledir).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sackIds]
 *             properties:
 *               sackIds: { type: array, items: { type: string, format: uuid }, minItems: 1, maxItems: 200 }
 *               add: { type: array, items: { type: string, format: uuid } }
 *               remove: { type: array, items: { type: string, format: uuid } }
 *               removeAll: { type: boolean }
 *     responses:
 *       200: { description: "added/removed/skipped" }
 *       400: { description: "removeAll + remove birlikte, ya da boş seçim" }
 */
router.post("/sacks/tags/bulk", verifyToken, WRITE, controller.bulkSackTags);

/**
 * @openapi
 * /api/shipping/sacks/tags:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuval izi kataloğu
 *     description: >
 *       Varsayılan yalnız AKTİF satırları döner (operatör ekranı).
 *       `?includeInactive=true` düzenleme yüzeyi içindir.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Etiket listesi } }
 *   post:
 *     tags: [Shipping]
 *     summary: Yeni iz etiketi (kod addan türetilir, sonradan değişmez)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Oluşturuldu }, 409: { description: Aynı adla etiket var } }
 */
router.get("/sacks/tags", verifyToken, READ, controller.listSackTags);
router.post("/sacks/tags", verifyToken, WRITE, controller.createSackTag);

/**
 * @openapi
 * /api/shipping/sacks/tags/{id}:
 *   patch:
 *     tags: [Shipping]
 *     summary: Etiket düzenle (ad/renk/sıra/aktiflik — kod DEĞİŞMEZ)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Güncellendi }, 404: { description: Etiket bulunamadı } }
 *   delete:
 *     tags: [Shipping]
 *     summary: Etiketi sert sil (yalnız HİÇ kullanılmamışsa)
 *     description: >
 *       Kullanımdaki etiket silinemez (409) — listeden kaldırmanın yolu
 *       `isActive:false`; mevcut atamalar KALIR, rozet soluk çizilir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Silindi }, 409: { description: Kullanımda } }
 */
router.patch("/sacks/tags/:id", verifyToken, WRITE, controller.updateSackTag);
router.delete("/sacks/tags/:id", verifyToken, WRITE, controller.deleteSackTag);

/**
 * @openapi
 * /api/shipping/sacks/{id}/tags:
 *   get:
 *     tags: [Shipping]
 *     summary: Çuvalın ETKİN izleri
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Rozet listesi }, 404: { description: Çuval bulunamadı } }
 *   post:
 *     tags: [Shipping]
 *     summary: Çuvalın iz kümesini değiştir (replace)
 *     description: >
 *       Çuvalın DURUMU fark etmez — sevkiyata atanmış / sevk edilmiş çuvala da iz
 *       bırakılabilir (annotation; `Sack.notes` ile aynı gerekçe). Boş dizi tüm
 *       izleri kaldırır. Tartıya, çuval içeriğine ve etiket bayatlığına DOKUNMAZ.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tagIds: { type: array, items: { type: string, format: uuid } }
 *     responses: { 200: { description: Güncellendi }, 404: { description: Çuval bulunamadı } }
 */
router.get("/sacks/:id/tags", verifyToken, READ, controller.getSackTagsOfSack);
router.post("/sacks/:id/tags", verifyToken, WRITE, controller.setSackTagsOfSack);

// ===========================================================================
// PAKETLEME GRUBU — havuz çuvallarını "aynı sevke hazırlananlar" diye ayıran
// çalışma yaftası. Rezervasyon DEĞİL (bkz. `packing-group.service.ts` başlığı).
// ===========================================================================
// Yazma uçları `packing.groupsEnabled` bayrağına FAIL-CLOSED kapılıdır (kapı
// serviste, TEK nokta). Okuma kapılı değil: bayrak kapalıyken zaten boş döner.
/**
 * @openapi
 * /api/shipping/packing-groups:
 *   get:
 *     tags: [Shipping]
 *     summary: Bir carinin CANLI paketleme grupları (havuzda çuvalı olanlar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: customerId, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Grup listesi + sayaçlar } }
 *   post:
 *     tags: [Shipping]
 *     summary: '"Parti Ata" — seçili çuvallardan yeni grup kur'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Grup oluşturuldu }
 *       403: { description: "Özellik kapalı (PACKING_GROUPS_DISABLED)" }
 *       409: { description: "Ad çakıştı / çuval gruplanamadı" }
 */
router.get("/packing-groups", verifyToken, READ, controller.listPackingGroups);
router.post("/packing-groups", verifyToken, WRITE, controller.createPackingGroup);
/**
 * @openapi
 * /api/shipping/packing-groups/remove-sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuvalları gruptan çıkar ("Gruplanmamış"a döner)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Çıkarıldı } }
 */
// ⚠️ SIRA: sabit yol `/:id`li yollardan ÖNCE gelmeli, yoksa "remove-sacks" bir
// grup id'si sanılır ve uuid-param middleware'i 400 verir.
router.post("/packing-groups/remove-sacks", verifyToken, WRITE, controller.removeSacksFromPackingGroup);
/**
 * @openapi
 * /api/shipping/packing-groups/summary:
 *   get:
 *     tags: [Shipping]
 *     summary: Cari çalışma alanı özeti (partisiz havuz + açık/kapalı parti sayısı) — sevk partisi modu
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: customerId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Özet }
 *       400: { description: "Sevk partisi modu kapalı (PACKING_LOT_MODE_OFF)" }
 */
// ⚠️ SIRA: sabit yol `/:id`den ÖNCE (uuid-param middleware "summary"yi id sanmasın).
router.get("/packing-groups/summary", verifyToken, READ, controller.packingLotSummary);
/**
 * @openapi
 * /api/shipping/packing-groups/{id}/sacks:
 *   post:
 *     tags: [Shipping]
 *     summary: Var olan CANLI gruba çuval ekle
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Eklendi }
 *       409: { description: "Grup boşalmış (PACKING_GROUP_DEAD)" }
 */
router.post("/packing-groups/:id/sacks", verifyToken, WRITE, controller.addSacksToPackingGroup);
/**
 * @openapi
 * /api/shipping/packing-groups/{id}/release:
 *   post:
 *     tags: [Shipping]
 *     summary: Partinin havuzdaki TÜM çuvallarını çıkar — sevk partisi modu (kapsam sunucuda; planlı sevkteki atlanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { target: { type: string, enum: [CUSTOMER, GENERAL] } } } } }
 *     responses:
 *       200: { description: "{released, skippedPlanned, target}" }
 *       400: { description: "Sevk partisi modu kapalı (PACKING_LOT_MODE_OFF)" }
 */
router.post("/packing-groups/:id/release", verifyToken, WRITE, controller.releasePackingGroupSacks);
/**
 * @openapi
 * /api/shipping/packing-groups/{id}:
 *   patch:
 *     tags: [Shipping]
 *     summary: Grup adını (override) ve notunu güncelle
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Güncellendi } }
 */
router.patch("/packing-groups/:id", verifyToken, WRITE, controller.updatePackingGroup);
/**
 * @openapi
 * /api/shipping/packing-groups/{id}:
 *   get:
 *     tags: [Shipping]
 *     summary: Tek paketleme grubu / sevk partisi (özet)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Grup } }
 *   delete:
 *     tags: [Shipping]
 *     summary: Hiç çuvalı olmamış sevk partisini sil (taslak)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Silindi }
 *       400: { description: "Sevk partisi modu kapalı (PACKING_LOT_MODE_OFF)" }
 *       409: { description: "Çuvalı olan parti silinmez (PACKING_LOT_NOT_EMPTY)" }
 */
router.get("/packing-groups/:id", verifyToken, READ, controller.getPackingGroup);
router.delete("/packing-groups/:id", verifyToken, LOT_MANAGE, controller.deletePackingGroup);
/**
 * @openapi
 * /api/shipping/sacks/{id}/package-no:
 *   patch:
 *     tags: [Shipping]
 *     summary: Çuvalın ambalaj numarasını ez (mod otomatik-ezilebilir / elle)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Yazıldı }
 *       409: { description: "Numara dolu (PACKAGE_NO_TAKEN) / çuval havuzda değil" }
 */
router.patch("/sacks/:id/package-no", verifyToken, LOT_MANAGE, controller.setSackPackageNo);
// Çuval içeriği düzeltme (rol/kartela çıkar/taşı)
router.post("/rolls/:rollId/remove-from-sack", verifyToken, WRITE, controller.removeRollFromSack);
router.post("/rolls/:rollId/move-sack", verifyToken, WRITE, controller.moveRollToSack);
router.post("/swatches/:swatchId/remove-from-sack", verifyToken, WRITE, controller.removeSwatchFromSack);
// Toplu: çuvalı dağıt (seçili/tüm içerik → depo) + seçili topları başka çuvala taşı
router.post("/sacks/:id/distribute", verifyToken, WRITE, controller.distributeSack);
/**
 * @swagger
 * /api/shipping/sacks/distribute/preview:
 *   post:
 *     summary: Toplu dağıtma önizlemesi (yazma yok) — etkilenen her top listelenir
 *     tags: [Shipping]
 */
/**
 * @swagger
 * /api/shipping/repair/allocations:
 *   get:
 *     summary: Siparişe yazılamamış sevkiyatlar (yazma yok) — onarım adayları
 *     tags: [Shipping]
 */
router.get(
  "/repair/allocations",
  verifyToken,
  REPAIR,
  controller.listRepairableShipments,
);
/**
 * @swagger
 * /api/shipping/repair/allocations/{id}/preview:
 *   get:
 *     summary: Onarım önizlemesi — hangi sipariş satırına kaç metre yazılacak (yazma yok)
 *     tags: [Shipping]
 */
router.get(
  "/repair/allocations/:id/preview",
  verifyToken,
  REPAIR,
  controller.previewRepairAllocation,
);
/**
 * @swagger
 * /api/shipping/repair/allocations/{id}:
 *   post:
 *     summary: Tek sevkiyatın sipariş defterini onar (irsaliye v+1 doğurur)
 *     tags: [Shipping]
 */
router.post(
  "/repair/allocations/:id",
  verifyToken,
  REPAIR,
  controller.repairShipmentAllocation,
);
router.post("/sacks/distribute/preview", verifyToken, WRITE, controller.previewDistributeSacks);
/**
 * @swagger
 * /api/shipping/sacks/distribute/bulk:
 *   post:
 *     summary: Seçili çuvalların içeriğini TOPLU depoya çıkar (çuval silinmez)
 *     tags: [Shipping]
 */
router.post("/sacks/distribute/bulk", verifyToken, WRITE, controller.distributeSacksBulk);
router.post("/sacks/:id/move-rolls", verifyToken, WRITE, controller.moveRollsToSack);

/**
 * @openapi
 * /api/shipping/sacks/{id}/split:
 *   post:
 *     tags: [Shipping]
 *     summary: Çuvalı böl — seçili topları YENİ çuvala ayır (atomik)
 *     description: >
 *       Tek transaction: yeni çuval açılır (kaynağın müşteri/şubesini devralır),
 *       seçili toplar atomik claim ile taşınır, İKİ çuvalın brüt tartısı sıfırlanır
 *       (bayat kg irsaliyeye gitmesin). Kaynakta en az bir top KALMALI — hepsi
 *       seçilirse 400. Kaynak sevkiyatta ise 409. Hiç top claim edilemezse yeni
 *       çuval da YARATILMAZ (tx geri alınır).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni çuval oluştu (sackId/sackNo/moved) }
 *       400: { description: Seçim geçersiz / kaynak boş kalır }
 *       409: { description: Çuval sevkiyatta veya toplar bu sırada taşınmış }
 */
router.post("/sacks/:id/split", verifyToken, WRITE, controller.splitSack);

// ===========================================================================
// ÇUVAL/TOP ARAMA + salt-okunur raporlar
// ===========================================================================
router.get("/sack-search", verifyToken, READ, controller.searchSacks);
/**
 * @openapi
 * /api/shipping/sack-search/customers:
 *   get:
 *     tags: [Shipping]
 *     summary: Cari kapısı — TÜM cariler (varsayılan) veya yalnız çuvalı olanlar
 *     description: >
 *       Paketleme/Çuvallar ekranının giriş adımı ("Tüm Çuvallar / Cariye Göre").
 *       VARSAYILAN tüm aktif carileri döner (çuvalı olanlar ÜSTTE, `sackCount desc`
 *       sonra ad); `withSacksOnly=1` eski davranışı süzgeç olarak verir.
 *       `customerId: null` satırı = müşterisiz (genel stok) kovası ve İLK sırada
 *       gelir (arama terimi verilirse dönmez). Kapsam varsayılanı `/sack-search`
 *       ile aynıdır (POOL+PLANNED). Salt-okunur; top adedi ve (sevk partisi modunda)
 *       açık parti sayısı da döner, metraj DÖNMEZ. İki modda da SAYFALI (`nextCursor`,
 *       keyset); sıralama `sortBy`/`sortOrder` ile SUNUCUDA, kapsamın tamamı üstünde
 *       (tek toplulaştırma sorgusu; kesme yok).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: scope, schema: { type: string, enum: [POOL, PLANNED, DISPATCHED, ALL] } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: withSacksOnly, schema: { type: string, enum: ["0", "1"] } }
 *       - { in: query, name: sortBy, schema: { type: string, enum: [name, sackCount, rollCount, openLotCount] }, description: "Sunucu sıralaması (kapsamın tamamı); tanınmayan 400" }
 *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc] } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 200 } }
 *     responses:
 *       200: { description: "{ items: [{customerId,name,code,sackCount,rollCount,openLotCount?}], nextCursor }" }
 *       400: { description: "Geçersiz sortBy / sortOrder" }
 */
router.get("/sack-search/customers", verifyToken, READ, controller.listSackCustomers);
router.post("/sack-search/pick-list", verifyToken, READ, controller.getPickList);
/**
 * @openapi
 * /api/shipping/sack-search/content-dump:
 *   post:
 *     tags: [Shipping]
 *     summary: İçerik dökümü — seçili çuvalların TOP BAZLI dökümü
 *     description: >
 *       Çeki listesinden (`/sack-search/pick-list`) farkı: orası ürün·renk·en bazında
 *       GRUPLU özet döner (sahada çuval ararken doğru olan), bu uç her topu ayrı satır
 *       olarak verir (barkod dahil) — Excel/PDF/yazdır içerik dökümünün kaynağı.
 *       Salt-okunur; en fazla 200 çuval. Çuval notu TAM metin döner (iç döküm) —
 *       basılıp basılmayacağına istemci karar verir (opt-in).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sackIds]
 *             properties:
 *               sackIds: { type: array, items: { type: string, format: uuid }, minItems: 1, maxItems: 200 }
 *     responses:
 *       200: { description: "Çuval başına meta + rolls[] + swatches[]" }
 *       400: { description: Seçim boş veya 200 çuvalı aşıyor }
 */
router.post("/sack-search/content-dump", verifyToken, READ, controller.getContentDump);
router.get("/sacks/:id/contents", verifyToken, READ, controller.getSackContents);

/**
 * @swagger
 * /api/shipping/sacks/mismatch-check:
 *   post:
 *     summary: Çuval içeriği uyuşmazlık denetimi (salt-okunur, ENGELLEMEZ)
 *     description: >
 *       *"Bu topun etiketi, gideceği müşteri için bugün basılsaydı İÇERİĞİ farklı
 *       çıkar mıydı?"* sorusunu yanıtlar. Düz "basıldığı müşteri ≠ gideceği
 *       müşteri" karşılaştırması YAPILMAZ — o çoğu meşru gönderimde de yanar ve
 *       operatörü körleştirir. Ayrıca 2. kalite (A1) topu müşteri çuvalında
 *       işaretler. Hiçbir sinyal sevki engellemez.
 *     tags: [Shipping]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "sackId → sinyal listesi (boş çuvallar dönmez)" }
 */
// ⚠️ Bu satır `/sacks/:id/...` route'larından SONRA gelemez mi diye bakma —
// Express 5'te statik segment (`mismatch-check`) parametreli segmentle (`:id`)
// çakışmaz; sıra sorun değildir. READ izni yeterli: hiçbir şey yazmaz.
router.post("/sacks/mismatch-check", verifyToken, READ, controller.checkSackMismatches);
router.get("/locate-roll", verifyToken, READ, controller.locateRoll);

// ===========================================================================
// SEVK KAPISI board + muhasebe
// ===========================================================================
router.get("/sack-store/board", verifyToken, READ, controller.listSackStoreBoard);
router.get("/shipments/:id/sack-contents", verifyToken, READ, controller.getShipmentSackContents);
router.get("/shipments/:id/dispatch-report", verifyToken, ACCOUNTING_READ, controller.getDispatchReport);
router.get("/direct-shipments/:id/dispatch-report", verifyToken, ACCOUNTING_READ, controller.getDirectShipmentDispatchReport);
router.get("/accounting-export", verifyToken, ACCOUNTING_READ, controller.getAccountingExport);

/**
 * @openapi
 * /api/shipping/shipments/{id}/invoice:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyatı faturalandı olarak işaretle (muhasebe)
 *     description: >
 *       Dış muhasebe programındaki fatura no + tarihini sevkiyata iliştirir. ERP fatura
 *       KESMEZ, yalnız izini tutar. `invoiceNo` null/boş gönderilirse işaret kaldırılır.
 *       Yalnız DISPATCHED sevkiyat faturalandırılabilir.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               invoiceNo: { type: string, nullable: true, maxLength: 64 }
 *               invoicedAt: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Sevkiyat henüz sevk edilmedi }
 *       403: { description: Yetki yok }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.post("/shipments/:id/invoice", verifyToken, INVOICE_WRITE, controller.setShipmentInvoice);

/**
 * @openapi
 * /api/shipping/direct-shipments/{id}/invoice:
 *   post:
 *     tags: [Shipping]
 *     summary: Fasondan doğrudan sevki faturalandı olarak işaretle (muhasebe)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncellendi }
 *       403: { description: Yetki yok }
 *       404: { description: Kayıt bulunamadı }
 */
router.post("/direct-shipments/:id/invoice", verifyToken, INVOICE_WRITE, controller.setDirectShipmentInvoice);

// ===========================================================================
// SEVKİYAT — havuzdan çuval seçerek kur + yaşam döngüsü
// ===========================================================================
/**
 * @openapi
 * /api/shipping/shipments:
 *   post:
 *     tags: [Shipping]
 *     summary: Depodan seçilen çuvallarla sevkiyat kur (varsayılan doğrudan sevk)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Sevkiyat kuruldu } }
 *   get:
 *     tags: [Shipping]
 *     summary: Sevkiyat listesi (içerik/iade/hedef filtresi + sıralama + eşleşme rozeti + cursor)
 *     description: >
 *       Shipment + fasondan doğrudan sevk (DirectShipment) birleşik liste. İçerik filtresi
 *       filter[itemId]/filter[colorId] (csv) TEK TOP eşleşmesi kurar (aynı topun itemId VE
 *       colorId koşulu). filter[hasReturns]=true iptalsiz iade taşıyan sevkleri süzer;
 *       filter[destination]=DOMESTIC|EXPORT hedefe göre süzer (ikisi de doğrudan sevkleri
 *       union'dan düşürür). sortBy=createdAt|shipmentNo + sortOrder=asc|desc. İçerik filtresi
 *       aktifken her satırda matchRollCount (eşleşen top sayısı) döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: mode, schema: { type: string, enum: [cursor] }, description: cursor sayfalama }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
 *       - { in: query, name: withTotal, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: sortBy, schema: { type: string, enum: [createdAt, shipmentNo] } }
 *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc] } }
 *       - { in: query, name: "filter[status]", schema: { type: string } }
 *       - { in: query, name: "filter[customerId]", schema: { type: string } }
 *       - { in: query, name: "filter[destination]", schema: { type: string, enum: [DOMESTIC, EXPORT] } }
 *       - { in: query, name: "filter[hasReturns]", schema: { type: string, enum: ["true"] } }
 *       - { in: query, name: "filter[itemId]", schema: { type: string }, description: CSV çoklu ürün ID }
 *       - { in: query, name: "filter[colorId]", schema: { type: string }, description: CSV çoklu renk ID }
 *     responses: { 200: { description: Sevkiyatlar } }
 */
router.post("/shipments", verifyToken, WRITE, controller.createShipment);
router.get("/shipments", verifyToken, READ, controller.listShipments);
router.post("/shipments/preview", verifyToken, READ, controller.previewCreateShipment);
/**
 * @openapi
 * /api/shipping/shipments/from-rolls:
 *   post:
 *     tags: [Shipping]
 *     summary: HIZLI SEVK — topları doğrudan sevk et (çuval otomatik)
 *     description: >
 *       Çuval kullanıcıya görünmez: tek transaction içinde otomatik açılır,
 *       toplar bağlanır ve normal sevkiyat çekirdeği koşar (tahsis/irsaliye/
 *       iade zinciri birebir aynı). Girdi rollIds — BARKOD İSTEMEZ.
 *       İhracat çuval tartısı istediği için bu yoldan yapılamaz (400).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Sevk edildi / sevkiyat kuruldu }
 *       400: { description: Uygun olmayan top / farklı depo / ihracat }
 *       409: { description: Toplar bu sırada başka akışa girdi }
 */
router.post("/shipments/from-rolls", verifyToken, WRITE, controller.createShipmentFromRolls);
/**
 * @openapi
 * /api/shipping/shippable-rolls:
 *   get:
 *     tags: [Shipping]
 *     summary: HIZLI SEVK — FIFO önerisi (kumaş+renk ver, en eski topları öner)
 *     description: >
 *       "3 top patos sattım, hangileri umurumda değil" akışı. Uygunluk yüklemi
 *       sevk claim'iyle AYNI kaynaktan gelir — önerilen top sevkte reddedilmez.
 *       Sıra: statusChangedAt (rafta bekleme) → createdAt → id (deterministik).
 *       Öneri bağlayıcı değildir; kullanıcı listeden çıkarabilir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: itemId, required: true, schema: { type: string } }
 *       - { in: query, name: colorId, schema: { type: string } }
 *       - { in: query, name: warehouseId, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 200 } }
 *     responses:
 *       200: { description: FIFO sıralı uygun toplar }
 */
router.get("/shippable-rolls", verifyToken, READ, controller.findShippableRolls);

router.get("/direct-shipments/:id", verifyToken, READ, controller.getDirectShipment);
router.get("/shipments/:id", verifyToken, READ, controller.getShipment);
/**
 * @openapi
 * /api/shipping/shipments/{id}/orders:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevkiyatı siparişe bağla (sevk edildikten SONRA da)
 *     description: >
 *       Tahsissiz çıkmış sevkiyatı sipariş defterine işler. Tahsisler yeniden
 *       hesaplanır, sipariş durumu güncellenir, sevk edilmişse irsaliye yeni
 *       sipariş kümesiyle v+1 olarak dondurulur. Boş dizi bağı kaldırır.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Sipariş bağı güncellendi }
 *       409: { description: İptal edilmiş sevkiyat ya da sipariş }
 */
router.post("/shipments/:id/orders", verifyToken, WRITE, controller.setShipmentOrders);
router.post("/shipments/:id/add-sacks", verifyToken, WRITE, controller.addSacksToShipment);
router.post("/shipments/:id/remove-sack", verifyToken, WRITE, controller.removeSackFromShipment);
router.post("/shipments/:id/destination", verifyToken, WRITE, controller.setDestination);
router.post("/shipments/:id/procedure-code", verifyToken, WRITE, controller.setProcedureCode);
router.get("/shipments/:id/dispatch-note", verifyToken, READ, controller.getDispatchNote);
router.post("/shipments/:id/dispatch-note", verifyToken, WRITE, controller.setDispatchNote);
// Araca yüklenen gerçek çuval adedi — operatör beyanı (bayrak kapalıyken 400).
router.post("/shipments/:id/manual-sack-count", verifyToken, WRITE, controller.setManualSackCount);
router.post("/shipments/:id/dispatch", verifyToken, WRITE, controller.dispatchShipment);
router.get("/shipments/:id/cancel-preview", verifyToken, READ, controller.cancelPreview);
router.post("/shipments/:id/cancel", verifyToken, WRITE, controller.cancelShipment);

/**
 * @openapi
 * /api/shipping/shipments/{id}/undo-dispatch-preview:
 *   get:
 *     tags: [Shipping]
 *     summary: Sevki geri alma (storno) önizlemesi
 *     description: |
 *       Geri dönecek çuval/top/sipariş + topların döneceği raflar + engel varsa
 *       SEBEBİ (`blockReason`). Engel kuralları mutasyonla AYNI kaynaktan gelir:
 *       faturalanmış · bu sevkiyattan iade alınmış · (ayar açıksa) aynı gün değil.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önizleme (canUndo + blockReason) }
 *       404: { description: Sevkiyat bulunamadı }
 */
router.get("/shipments/:id/undo-dispatch-preview", verifyToken, UNDO_DISPATCH, controller.undoDispatchPreview);

/**
 * @openapi
 * /api/shipping/shipments/{id}/undo-dispatch:
 *   post:
 *     tags: [Shipping]
 *     summary: Sevki geri al (storno) — İADE DEĞİL
 *     description: |
 *       "Mal hiç çıkmadı" durumu (araç kapıda, yanlış sevkiyat onaylandı): sevkiyat
 *       DISPATCHED → PLANNED, toplar sevk ÖNCESİ rafına döner, sipariş karşılanması
 *       geri hesaplanır, sevk irsaliyesi VOIDED'e çekilir (silinmez). İade defterine
 *       KAYIT GİRMEZ — mal müşteriye ulaşıp dönmedi.
 *       `releaseSacks: true` → storno + KAPANIŞ aynı tx'te: sevkiyat PLANNED'da
 *       beklemez, CANCELLED olur, çuvallar + toplar depoya (havuza) döner, tahsis
 *       silinir. Sevk onayı KAPALI rejimin olağan yolu (Sevk Kapısı ekranı o rejimde
 *       görünmez); yeniden çıkış Paketleme'den yeni sevkiyatla yapılır. Storno izni
 *       kapanışı da kapsar.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 3 }
 *               releaseSacks:
 *                 type: boolean
 *                 description: "true → sevkiyat da iptal edilir, çuvallar depoya döner (varsayılan false: PLANNED bekler)"
 *     responses:
 *       200: { description: Sevk geri alındı (releaseSacks ile sevkiyat kapatıldı) }
 *       400: { description: Gerekçe eksik }
 *       409: { description: Faturalanmış / iade alınmış / aynı gün değil / durum değişti }
 */
router.post("/shipments/:id/undo-dispatch", verifyToken, UNDO_DISPATCH, controller.undoDispatch);

export default router;
