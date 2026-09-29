// Test kayıtları — sunucu yanıt biçimleri (src/shared/types.ts) ile aynı.
import type { Catalog, InstallationDetail } from "../shared/types";

export const INSTALLATION_DB_ID = "5b0c6a4e-1111-4000-8000-000000000001";
export const LICENSE_NO = "TKS-2026-0042";

export const CATALOG: Catalog = {
  moduller: ["production.enabled", "finance.enabled", "dokuma.enabled"],
  varsayilanModuller: ["production.enabled"],
  siniflar: ["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"],
  kademeler: ["K0", "K1", "K2", "K3", "K4", "K5"],
  kisitlamaGunSecenekleri: [0, 7, 15, 30],
  roller: ["SATICI_YONETICI", "SATICI_OPERATOR", "BAYI"],
};

export function installationDetail(over: Partial<InstallationDetail> = {}): InstallationDetail {
  const hak = { id: "5b0c6a4e-2222-4000-8000-000000000002", lisansNo: LICENSE_NO, guncelSurum: 1, moduller: ["production.enabled"], kalici: true, bakimBitis: "2027-09-29T00:00:00.000Z", gecerlilikBitis: null };
  return {
    kurulum: {
      id: INSTALLATION_DB_ID,
      tesisId: "5b0c6a4e-3333-4000-8000-000000000003",
      kurulumId: "9e8d7c6b-0000-4000-8000-00000000abcd",
      ad: "Merkez sunucu",
      sinif: "URETIM",
      kanalKodu: "testfabrika",
      durum: "ETKIN",
      anahtarKimligi: "kurulum-abc",
      zorlama: false,
      yoklamaAraligiDk: 60,
      platform: "win32",
      sonOrtam: null,
      sonSaglik: null,
      sonYoklamaZamani: null,
      etkinlesmeZamani: "2026-09-20T08:00:00.000Z",
      aktif: true,
      createdAt: "2026-09-01T08:00:00.000Z",
      kabulEdilenParmakIzi: null,
      tesis: { id: "5b0c6a4e-3333-4000-8000-000000000003", ad: "Ana tesis", musteri: { id: "5b0c6a4e-4444-4000-8000-000000000004", ad: "Örnek Tekstil", bayiId: null } },
      haklar: [hak],
      _count: { kopyaUyarilari: 0, tasimalar: 0 },
    },
    hak,
    hakSurumleri: [],
    etkinlestirmeKodlari: [],
    yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false },
    yaptirimDefteri: [],
    kiralar: [],
    yoklamalar: [],
    kopyaUyarilari: [],
    tasimaTalepleri: [],
    planliEylemler: [],
    taksitPlanlari: [],
    kurulumKaydi: [],
    ...over,
  };
}
