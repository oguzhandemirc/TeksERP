// =============================================================================
// TeksERP - LabelKind Zod şeması (TEK KAYNAK)
// =============================================================================
// NEDEN bu dosya var (2026-07-31 denetimi — "sessizce kırılan" bulgu):
// `LabelKind` DÖRT ayrı Zod şemasında elle yazılmış string listesi olarak
// tekrarlanıyordu:
//   1) controllers/label.controller.ts          → previewSchema.kind
//   2) controllers/label-template.controller.ts → canvasPreviewSchema.kind
//   3) controllers/label-template.controller.ts → contextDefaultSchema.kind
//   4) routes/customer-template-route.routes.ts → setSchema.kind
// Prisma'ya yeni bir LabelKind eklendiğinde (en son SACK — çuval etiketi) bu dört
// listeden birini güncellemeyi unutmak SESSİZ bir kırılmadır: yeni tür şemadan
// geçemez, uç "Geçersiz değer" der ve hatanın kaynağı hiçbir log'da görünmez.
// Zod v4 Prisma'nın ürettiği enum NESNESİNİ doğrudan kabul ediyor
// (`z.enum(LabelKind)`) → dört yer tek kaynağa bağlandı, yeni tür kendiliğinden
// dördünde de geçerli olur.
//
// NEDEN AYRI (yaprak) MODÜL — `z.enum(LabelKind)`'i doğrudan controller'a yazmak
// yerine: bu repoda "modül ÜST KAPSAMINDA Prisma enum deref'i yapma" kuralı var
// (TDZ kuralı). Döngülü import yükü sırasında `Cannot access 'client_1' before
// initialization` boot crash'i fiilen yaşandı (bkz. inventory.service.ts
// `ROLL_LIST_INCLUDE` notu + label-elements.ts başlığı). Bu dosya SADECE `zod` ve
// `@prisma/client` import eder; hiçbir uygulama modülüne bağlı değildir → bir
// import döngüsüne giremez, dolayısıyla yüklendiğinde `LabelKind` her zaman
// hazırdır. Deref tek bir güvenli yerde yapılır, çağıran modüller yalnız hazır
// şemayı import eder.
//
// KURAL: yeni bir etiket bağlamı eklerken schema.prisma `enum LabelKind`'a değer
// eklemek YETER — buradaki şema ve yukarıdaki dört tüketici kendiliğinden
// güncellenir. Geri kalan aynalar İKİ SINIFA ayrılır; farkı bilmek önemli:
//
//   A) DERLEME HATASI VERİR (güvenli — unutulamaz):
//      `config/label-fields.ts` FIELD_CATALOG `Record<LabelKind, ...>` tipinde,
//      yeni üye eklenince "Property 'X' is missing" ile tsc DÜŞER. Yani yeni
//      bağlamın alan kataloğunu yazmayı atlamak MÜMKÜN değil.
//
//   B) SESSİZ KALIR (elle güncelle — bu dosyanın var oluş sebebi):
//      Electron `services/labelTemplateService.ts` (kendi `LabelKind` const'u +
//      `labelKindLabels`) ve mobil `src/types/models.ts` `LabelKind` union'ı.
//      İkisi de AYRI projedir, bu enum'u import EDEMEZ ve eksik kaldığında
//      hiçbir derleyici uyarmaz — yeni tür panelde/telefonda basitçe yoktur.
// =============================================================================

import { z } from "zod";
import { LabelKind } from "@prisma/client";

/**
 * Etiket bağlamı şeması — Prisma `LabelKind` enum'undan türer.
 * Çıktı tipi `LabelKind`; ayrıca `as LabelKind` cast'i GEREKMEZ.
 */
export const labelKindSchema = z.enum(LabelKind);

/** Aynı kaynaktan düz değer dizisi (döngü/örnek gerektiren yerler için). */
export const LABEL_KINDS = labelKindSchema.options;
