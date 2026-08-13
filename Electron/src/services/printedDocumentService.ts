// =============================================================================
// Resmi belge defteri (PrintedDocument) — client servisi + tipleri
// =============================================================================
// Backend /api/printed-documents ile konuşur. Üç irsaliye/çeki belgesi ortak:
// güncel belge (snapshot dahil) + versiyon geçmişi + gerekçeli revizyon.
// Snapshot, freeze anında DONMUŞ içeriği + şablon override'ını + firma künyesini
// taşır; belge bileşeni canlı feature-flag yerine bu donmuş ayardan render eder.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { CompanyLetterhead, DocumentConfig } from "@/services/documentConfig";

export type PrintedDocType =
  | "SHIPMENT_DISPATCH"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_DIRECT_SHIP"
  | "KARTELA_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT"
  | "QUALITY_CERTIFICATE"
  | "RETURN_DISPATCH"
  // Ticaret paketi (2026-08-13) — iç depo belgeleri. ⚠️ Electron backend enum'unu
  // IMPORT EDEMEZ (ayrı proje): bu union `PrintedDocType` ile ELLE senkron tutulur,
  // tıpkı `DOC_TYPE_TO_KEY` aynası gibi.
  | "TRANSFER_DISPATCH"
  | "GOODS_RECEIPT";

export type PrintedDocStatus = "ACTIVE" | "SUPERSEDED" | "VOIDED";

/** Freeze anında donan snapshot zarfı. `doc` belge-tipine özel payload. */
export interface PrintedDocSnapshot<TDoc = Record<string, unknown>> {
  schemaVersion: 1;
  frozenAt: string;
  company: { name: string; letterhead: CompanyLetterhead };
  /** Ham (kısmi) şablon override — client resolveDocConfig ile çözer. */
  docConfigOverride: DocumentConfig | null;
  doc: TDoc;
}

/** Tam belge kaydı (snapshot dahil) — getCurrent / getVersion döner. */
export interface PrintedDocument<TDoc = Record<string, unknown>> {
  id: string;
  docType: PrintedDocType;
  sourceId: string;
  version: number;
  status: PrintedDocStatus;
  documentNo: string;
  snapshot: PrintedDocSnapshot<TDoc>;
  reissueReason: string | null;
  supersededAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reconstructed: boolean;
  printedById: string | null;
  createdAt: string;
  updatedAt: string;
  /** Yalnız getCurrent döner: donmuş görünüm güncel şablondan farklı mı — "Güncel
   *  görünüm" tuşunu yalnız gerçekten farklıysa göstermek için (backend hesaplar). */
  templateStale?: boolean;
}

/** Hafif versiyon satırı (snapshot içeriği olmadan) — geçmiş listesi. */
export interface PrintedDocVersion {
  id: string;
  version: number;
  status: PrintedDocStatus;
  documentNo: string;
  reissueReason: string | null;
  supersededAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reconstructed: boolean;
  createdAt: string;
  printedBy: { id: string; fullName: string } | null;
}

const base = "/api/printed-documents";

export const printedDocumentService = {
  /** Güncel belge (en yüksek versiyon). data=null → kaynak TASLAK aşamasında. */
  getCurrent: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
  ): Promise<ApiResponse<PrintedDocument<TDoc> | null>> =>
    apiClient
      .get<ApiResponse<PrintedDocument<TDoc> | null>>(
        `${base}/${docType}/${sourceId}/current`,
      )
      .then((r) => r.data),

  /** Versiyon geçmişi (yeniden eskiye). */
  listVersions: (
    docType: PrintedDocType,
    sourceId: string,
  ): Promise<ApiResponse<PrintedDocVersion[]>> =>
    apiClient
      .get<ApiResponse<PrintedDocVersion[]>>(
        `${base}/${docType}/${sourceId}/versions`,
      )
      .then((r) => r.data),

  /** Tek versiyonu snapshot'ıyla getir. */
  getVersion: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
    version: number,
  ): Promise<ApiResponse<PrintedDocument<TDoc>>> =>
    apiClient
      .get<ApiResponse<PrintedDocument<TDoc>>>(
        `${base}/${docType}/${sourceId}/versions/${version}`,
      )
      .then((r) => r.data),

  /** Baskı-hazır HTML (TEK KAYNAK) — backend render eder; mobil + Electron aynısını
   *  basar. version verilirse o versiyonun HTML'i. opts.draft → donmuş belge yoksa
   *  canlı TASLAK önizlemesi (sevk öncesi). opts.currentTemplate → içerik donuk
   *  kalır, görünüm (şablon+künye) güncel ayardan çözülür. text/html döner. */
  getHtml: (
    docType: PrintedDocType,
    sourceId: string,
    version?: number,
    opts?: {
      draft?: boolean;
      currentTemplate?: boolean;
      printNote?: string;
      rowNotes?: boolean;
      /** Tek seferlik liste seçimi (ör. ["cuval"]) — kalıcı bölüm ayarını EZER. */
      sections?: string[];
      /** Listeleri aynı sayfada akıt. Varsayılan: her liste kendi sayfasında. */
      merge?: boolean;
    },
  ): Promise<string> =>
    apiClient
      .get<string>(`${base}/${docType}/${sourceId}/html`, {
        params: {
          ...(version != null ? { version } : {}),
          ...(opts?.draft ? { draft: 1 } : {}),
          ...(opts?.currentTemplate ? { currentTemplate: 1 } : {}),
          // Tek seferlik baskı notu — persist edilmez, yalnız bu render'a girer.
          ...(opts?.printNote?.trim() ? { printNote: opts.printNote.trim() } : {}),
          // Tek seferlik "satır notlarını (çuval yorumu) göster" — kalıcı kolon
          // ayarını EZER (OR); ayara/snapshot'a YAZILMAZ, versiyon doğurmaz.
          ...(opts?.rowNotes ? { rowNotes: 1 } : {}),
          // Tek seferlik liste seçimi / sayfa birleştirme — ikisi de persist EDİLMEZ.
          ...(opts?.sections?.length ? { sections: opts.sections.join(",") } : {}),
          ...(opts?.merge ? { merge: 1 } : {}),
        },
        responseType: "text",
        headers: { Accept: "text/html" },
      })
      .then((r) => r.data),

  /** Belge Şablonu canlı önizlemesi — örnek veri + DÜZENLENEN taslak config ile
   *  gerçek backend renderHtml çıktısı (TASLAK filigranlı). Kaydetmeden, anlık.
   *  Önizleme = gerçek baskı (tek kaynak). */
  getSampleHtml: (docType: PrintedDocType, config: DocumentConfig): Promise<string> =>
    apiClient
      .post<string>(
        `${base}/${docType}/sample-html`,
        { config },
        { responseType: "text", headers: { Accept: "text/html" } },
      )
      .then((r) => r.data),

  /** Gerekçeli revizyon → yeni versiyon (eskisi SUPERSEDED). */
  reissue: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
    reason: string,
  ): Promise<ApiResponse<PrintedDocument<TDoc>>> =>
    apiClient
      .post<ApiResponse<PrintedDocument<TDoc>>>(
        `${base}/${docType}/${sourceId}/reissue`,
        { reason },
      )
      .then((r) => r.data),
};
