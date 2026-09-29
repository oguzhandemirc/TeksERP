// Dağıtım (Faz 3d) tel türleri — satıcı sunucusunun `distribution-routes.ts` yanıtları. Belirteç yalnız
// oluşturma yanıtında gelir (`belirtec` · `yol` · `adres`); tekrar yanıtı `belirtecGosterilemez` taşır.

export interface DownloadLink {
  readonly id: string;
  readonly tur: "ILK_KURULUM" | "DOSYA";
  readonly musteriId: string;
  readonly kurulumId: string | null;
  readonly dosyaId: string | null;
  readonly derlemeAdi: string | null;
  readonly derlemeSha256: string | null;
  readonly derlemeBoyut: number | null;
  readonly belirtecSonu: string;
  readonly bitis: string;
  readonly azamiIndirme: number;
  readonly indirmeSayisi: number;
  readonly sonIndirme: string | null;
  readonly durum: "AKTIF" | "IPTAL";
  readonly aciklama: string | null;
  readonly olusturan: string;
  readonly createdAt: string;
}

export interface UploadRequest {
  readonly id: string;
  readonly musteriId: string;
  readonly belirtecSonu: string;
  readonly bitis: string;
  readonly kotaBayt: number;
  readonly kullanilanBayt: number;
  readonly azamiDosyaBayt: number;
  readonly durum: "AKTIF" | "IPTAL";
  readonly aciklama: string | null;
  readonly olusturan: string;
  readonly createdAt: string;
}

export interface SharedFile {
  readonly id: string;
  readonly musteriId: string;
  readonly yon: "GIDEN" | "GELEN";
  readonly ad: string;
  readonly mime: string;
  readonly boyut: number;
  readonly sha256: string;
  readonly saklamaBitis: string;
  readonly govdeBudandiAt: string | null;
  readonly yukleyen: string;
  readonly createdAt: string;
}

export interface LedgerRow {
  readonly id: string;
  readonly olay: string;
  readonly yapan: string;
  readonly ayrinti: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface BuildFile {
  readonly ad: string;
  readonly boyut: number;
  readonly degisti: string;
}

/** Oluşturma yanıtı: sır (belirteç) yalnız canlı yanıtta. */
export interface TokenIssued {
  readonly belirtec?: string;
  readonly yol?: string;
  readonly adres?: string | null;
  readonly belirtecGosterilemez?: boolean;
}

export interface UploadSession {
  readonly oturumId: string;
  readonly durum: "ACIK" | "TAMAMLANDI" | "TERK";
  readonly parcaBayt: number;
  readonly parcaSayisi: number;
  readonly alinanlar: readonly number[];
  readonly dosyaId: string | null;
}

export interface Publisher {
  readonly id: string;
  readonly kid: string;
  readonly ad: string;
  readonly acikAnahtar: string;
  readonly aktif: boolean;
  readonly createdAt: string;
}

export interface Notice {
  readonly id: string;
  readonly olay: "YAYIN" | "TERFI" | "TERFI_ATLANDI";
  readonly urun: string;
  readonly kanalKodu: string;
  readonly surum: string;
  readonly yayinciKid: string;
  readonly olayZamani: string;
  readonly ayrinti: Record<string, unknown> | null;
}

export interface Published {
  readonly surum: string | null;
  readonly degisti: string | null;
}

export interface ChannelRelease {
  readonly kod: string;
  readonly kayitli: { readonly ad: string; readonly tur: string; readonly guncelSurumler: Record<string, string | undefined> } | null;
  readonly yayinda: {
    readonly panel: Published | null;
    readonly tabletOta: readonly (Published & { readonly runtime: string })[];
    readonly tabletApk: (Published & { readonly vc: number | null }) | null;
  } | null;
  readonly defter: readonly { zaman: string; surum: string; yapan: string; sha16: string; boyut: string; not: string | null }[] | null;
  readonly bildirimler: readonly Notice[];
}

export interface ReleaseOverview {
  readonly yayinKoku: "OLCULDU" | "OKUNAMADI" | "BAGLI_DEGIL";
  readonly kanallar: readonly ChannelRelease[];
}

export const LEDGER_EVENT_LABEL: Record<string, string> = {
  BAGLANTI_VERILDI: "Bağlantı verildi",
  INDIRILDI: "İndirildi",
  BAGLANTI_IPTAL: "Bağlantı iptal",
  YUKLEME_ISTEGI_VERILDI: "Yükleme isteği verildi",
  YUKLEME_ISTEGI_IPTAL: "Yükleme isteği iptal",
  DOSYA_YUKLENDI: "Dosya yüklendi",
  YUKLEME_TERK: "Yarım yükleme terk",
  GOVDE_BUDANDI: "Gövde budandı (saklama)",
};

export const NOTICE_EVENT_LABEL: Record<string, string> = { YAYIN: "Yayın", TERFI: "Terfi", TERFI_ATLANDI: "Terfi atlandı" };
