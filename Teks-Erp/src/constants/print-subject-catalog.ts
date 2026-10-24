// =============================================================================
// YAZDIRMA GEÇMİŞİ KATALOĞU — `print_jobs` satırının kapalı kümeleri (izlenebilirlik A1)
// =============================================================================
// `subjectKind` DB'de CHECK taşımaz (yeni tür migration istemesin); kapı BURASIDIR:
// tanınmayan tür `POST /api/print-jobs`te 400 `PRINT_SUBJECT_UNKNOWN` alır (fail-closed)
// ve bekçi (`test_print_jobs` §2) katalog dışı değeri yakalar. Diğer kümeler DB CHECK'iyle
// ikizdir (migration `20261024025542_print_jobs`) — birini değiştiren ikisini birlikte değiştirir.
// =============================================================================

/** Basılan şeyin türü. Ekrandaki ad `PRINT_SUBJECT_LABELS`. */
export const PRINT_SUBJECT_KINDS = [
  "ETIKET_TOP",
  "ETIKET_CUVAL",
  "ETIKET_NUMUNE",
  "ETIKET_TEZGAH",
  "ETIKET_LEVENT",
  "ETIKET_SERBEST",
  "ETIKET_TOPLU",
  "BELGE",
  "REFAKAT_KARTI",
  "CEKI_LISTESI",
  "FASON_CEKI",
  "SERBEST_BELGE",
  "RAPOR",
  "LISTE",
  "KIMLIK_KARTI",
  "TEST",
] as const;
export type PrintSubjectKind = (typeof PRINT_SUBJECT_KINDS)[number];

export const PRINT_SUBJECT_LABELS: Record<PrintSubjectKind, string> = {
  ETIKET_TOP: "Top etiketi",
  ETIKET_CUVAL: "Çuval etiketi",
  ETIKET_NUMUNE: "Kartela etiketi",
  ETIKET_TEZGAH: "Tezgah etiketi",
  ETIKET_LEVENT: "Levent etiketi",
  ETIKET_SERBEST: "Serbest etiket",
  ETIKET_TOPLU: "Toplu top etiketi",
  BELGE: "Belge",
  REFAKAT_KARTI: "Refakat kartı",
  CEKI_LISTESI: "Çeki listesi",
  FASON_CEKI: "Fason çekisi",
  SERBEST_BELGE: "Serbest belge",
  RAPOR: "Rapor",
  LISTE: "Liste",
  KIMLIK_KARTI: "Kimlik kartı",
  TEST: "Deneme baskısı",
};

/**
 * İçeriği satıra HİÇ yazılmayan türler: `meta` tamamen düşer (kimlik kartı PIN/kart kodu
 * taşıyabilir — sır hijyeni). Satır yalnız "kim, kimin kartını, ne zaman" der.
 */
export const PRINT_SUBJECT_META_DROPPED: ReadonlySet<PrintSubjectKind> = new Set(["KIMLIK_KARTI"]);

/** Basımı kim bildirdi — yalnız etiket, güvenlik sınırı değil. */
export const PRINT_SOURCES = ["PANEL_MASAUSTU", "PANEL_WEB", "TABLET", "TELEFON", "SUNUCU"] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];

/** Çıktı türü (K-A3: PDF'e kaydetme AYRI türdür ve süzülebilir). DB CHECK ikizi. */
export const PRINT_OUTPUT_KINDS = ["PRINTER", "PDF"] as const;
export type PrintOutputKind = (typeof PRINT_OUTPUT_KINDS)[number];

/**
 * Ölçülebilen sonuç — DB CHECK ikizi. `ILETILDI` baytları spooler/yazıcı kabul etti demektir
 * ("basıldı" değil); `SIMULE` başarı SAYILMAZ (`label.nativeSendEnabled` kapalı).
 */
export const PRINT_STATUSES = ["ILETILDI", "HATA", "IPTAL", "BELIRSIZ", "SIMULE"] as const;
export type PrintStatus = (typeof PRINT_STATUSES)[number];

/** Baytların gittiği yol. */
export const PRINT_TRANSPORTS = [
  "SISTEM_PENCERESI",
  "SESSIZ_OS",
  "SERI",
  "TCP_9100",
  "CUPS",
  "WINSPOOL",
  "BLUETOOTH",
  "SUNUCU_TCP",
  "PDF_DOSYA",
] as const;
export type PrintTransport = (typeof PRINT_TRANSPORTS)[number];

/**
 * İstemci raporunda `subjectId` verilebilen tablolar — varlık bu tabloda doğrulanır
 * (yoksa 400). Kapalı küme: tanınmayan tablo 400 `PRINT_SUBJECT_TABLE_UNKNOWN`.
 */
export const PRINT_SUBJECT_TABLES = [
  "rolls",
  "sacks",
  "swatches",
  "machines",
  "warp_beams",
  "traveler_cards",
  "printed_documents",
  "shipments",
  "manifests",
  "work_orders",
  "users",
  "label_templates",
  "subcontractor_dispatches",
] as const;
export type PrintSubjectTable = (typeof PRINT_SUBJECT_TABLES)[number];

/** Toplu basımın tavanı — DB CHECK `print_jobs_subject_ids_max_check` ikizi. */
export const PRINT_SUBJECT_IDS_MAX = 200;
/** `meta` alanının bayt tavanı (servis kırpar). */
export const PRINT_META_MAX_BYTES = 2048;

export function isPrintSubjectKind(v: unknown): v is PrintSubjectKind {
  return typeof v === "string" && (PRINT_SUBJECT_KINDS as readonly string[]).includes(v);
}
