// =============================================================================
// EKSİK KAYDI BURADAN YARAT — hangi varlık, hangi izinle, hangi asgari yükle
// =============================================================================
// "'MAVI' ile eşleşen renk bulunamadı" hatasının yanındaki düğme bu defterden
// beslenir. Veri, bileşen değil.
//
// ⚠️ İZİN, VARLIĞIN YARATMA ROTASININ İZNİDİR — içe aktarım adaptörünün
// `writePermission`'ı değil. İkisi 2026-08-19'da iki varlıkta ayrışmıştı ve
// düğmeyi adaptörün iznine bağlamak, tam da onu gören kullanıcıya 403 verirdi.
// Bekçi: `Teks-Erp/scripts/test_import_permissions.ts`.
//
// ⚠️ `code` GÖNDERİLMEZ — bu beş varlıkta da kodu sunucu üretir (RNK/MUS/HATA/
// IADE/STK). İstemci kodu göndermek en iyi ihtimalle sessizce düşer.
//
// KAPSAM BİLİNÇLİ DAR (kullanıcı kararı): yalnız addan (ya da ad + tek bir
// zorunlu alandan) yaratılabilen varlıklar. Dışarıda kalanlar ve SEBEPLERİ:
//   • rota            → adımsız rota API'de açılır ama aşağı akışta tuzaktır
//   • istasyon/kalite → ek zorunlu alan (tip / hedef statü + elle kod)
//   • makine/özellik  → İLİŞKİ seçimi ister (istasyon / istasyonlar)
//   • fason firma/kat.→ kod ELLE verilir; addan kod uydurmak kimlik uydurmaktır
// Bu varlıklarda düğme yerine sebebi yazan bir cümle gösterilir (gri düğme,
// tıklanabilir gibi görünüp hiçbir şey yapmayan bir vaattir).

import { colorService } from "@/pages/Colors/service";
import { customerService } from "@/pages/Customers/service";
import { defectTypeService } from "@/pages/DefectTypes/service";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { itemService } from "@/pages/Items/service";

/** Yaratılan kaydın panelin ihtiyaç duyduğu asgari şekli. */
export interface CreatedLookup {
  id: string;
  code: string | null;
  name: string;
}

export interface LookupExtraField {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

export interface LookupCreateConfig {
  /** Mesajlarda geçen Türkçe ad ("renk"). */
  label: string;
  /** Yaratma rotasının izni (adaptörünki DEĞİL). */
  permission: string;
  /** `SimilarNamesWarning`'in kullandığı API yol parçası. */
  apiEntity: string;
  /** Başarıdan sonra tazelenecek react-query anahtarları. */
  queryKeys: string[][];
  /** Ad dışında zorunlu tek alan (varsa) — küçük bir seçim kutusu çizilir. */
  extraField?: LookupExtraField;
  create: (name: string, extra?: string) => Promise<CreatedLookup>;
}

/** `isActive: true` AÇIKÇA yazılır: pasif doğan kayıt, "düzelttim" sanılan satırı
 *  farklı bir hataya (PASİF kayıt) düşürürdü. */
const shape = (r: { id: string; code?: string | null; name: string }): CreatedLookup => ({
  id: r.id,
  code: r.code ?? null,
  name: r.name,
});

export const LOOKUP_CREATE: Record<string, LookupCreateConfig> = {
  color: {
    label: "renk",
    permission: "property:write",
    apiEntity: "colors",
    queryKeys: [["colors"]],
    // Müşteri ataması BİLİNÇLİ olarak yok: atanmış renk o müşteriye ÖZEL hale
    // gelir (QuickAddColor aynı gerekçeyi taşıyor).
    create: async (name) => shape((await colorService.create({ name, isActive: true } as never)).data as never),
  },
  customer: {
    label: "cari",
    permission: "customer:write",
    apiEntity: "customers",
    queryKeys: [["customers"]],
    create: async (name) => shape((await customerService.create({ name, isActive: true } as never)).data as never),
  },
  defectType: {
    label: "hata tipi",
    permission: "quality:write",
    apiEntity: "defect-types",
    queryKeys: [["defect-types"]],
    create: async (name) => shape((await defectTypeService.create({ name, isActive: true } as never)).data as never),
  },
  returnReason: {
    label: "iade sebebi",
    permission: "return:write",
    apiEntity: "return-reasons",
    queryKeys: [["return-reasons"]],
    create: async (name) =>
      shape((await returnReasonService.create({ name, isActive: true } as never)).data as never),
  },
  item: {
    label: "kumaş",
    permission: "item:write",
    apiEntity: "items",
    queryKeys: [["items"]],
    // `itemType`ın DB varsayılanı yok — göndermezsek 400. Varsayılan "Kumaş"
    // çünkü içe aktarımda eksik çıkan referansların neredeyse tamamı kumaştır.
    extraField: {
      key: "itemType",
      label: "Tür",
      defaultValue: "FABRIC",
      options: [
        { value: "FABRIC", label: "Kumaş" },
        { value: "YARN", label: "İplik" },
        { value: "CONSUMABLE", label: "Sarf" },
      ],
    },
    create: async (name, extra) =>
      shape(
        (await itemService.create({ name, itemType: extra ?? "FABRIC", isActive: true } as never))
          .data as never,
      ),
  },
};

/** Bu varlık için yaratma düğmesi çizilebilir mi? */
export function canCreateLookup(entity: string): boolean {
  return entity in LOOKUP_CREATE;
}

/**
 * Düğme çizilemeyen varlıklar için EKRANDA gösterilecek sebep. Boş dönmek
 * "sessizce yok say" demek olurdu; kullanıcı neden yapamadığını bilmeli.
 */
export const LOOKUP_CREATE_BLOCKED: Record<string, string> = {
  route: "Rota, adımları olmadan açılamaz — Tanımlar → Rotalar'dan oluşturun.",
  station: "İstasyon için tip (İç/Dış) de gerekir — Tanımlar → Üretim İstasyonları'ndan açın.",
  machine: "Makine bir istasyona bağlanmalı — Tanımlar → Makineler'den açın.",
  fabricProperty:
    "Özellik en az bir istasyona bağlanmalı (bağsız özellik hiçbir ekranda görünmez) — Tanımlar → Üretim Özellikleri'nden açın.",
  qualityGrade: "Kalite için kod ve hedef statü de gerekir — Tanımlar → Kalite Sınıfları'ndan açın.",
  subcontractor: "Fason firma kodu elle verilir — Tanımlar → Fason Firmalar'dan açın.",
  subcontractorCategory:
    "Fason kategorisi kodu elle verilir — Tanımlar → Fason Kategorileri'nden açın.",
};
