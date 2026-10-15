// =============================================================================
// dump-aktar — TABLO SINIFLARI ve kurulum-özel ayar politikası (tek kaynak).
//
// Bir fabrikanın İŞ verisini başka bir kurulumun KİMLİĞİ altına taşırken her public
// tablo burada TAM BİR sınıfa düşer; sınıfsız tablo (yeni migration) betiği DURDURUR
// (fail-closed). Sınıf yalnız "satırlar hangi DB'den gelir" sorusunu cevaplar.
// =============================================================================

/** Sınıflar — kaynak: KAYNAK = iş verisini veren döküm (göç ettirilmiş), DENEME = kimliği korunan kurulum. */
export const SINIF = {
  /** KAYNAK'tan aynen; DENEME'nin satırları alınmaz (eski uydurma veri gider). */
  IS: "IS",
  /** DENEME'den aynen; KAYNAK'ın satırları atılır (kimlik · oturum · yetki · lisans · donanım · kurulum telemetrisi). */
  KIMLIK: "KIMLIK",
  /** Birleşim: DENEME satırları aynen eklenir; KAYNAK satırları FK hedefi olduğu için KALIR ama girişsiz/sırsız/pasif. */
  BIRLESIM: "BIRLESIM",
  /** system_settings: kurulum-özel anahtarlar DENEME'den, kalan iş ayarları KAYNAK'tan. */
  AYAR: "AYAR",
  /** system_logs: DENEME'nin hash zinciri aynen + KAYNAK'ın zincir-öncesi İŞ ayak izi (kimlik/oturum satırları süzülür). */
  AUDIT: "AUDIT",
  /** Eşitleme konumu: boş başlar (yalnız tur sayacı DENEME'den) ⇒ ilk tur her projeksiyonu TAM gönderir, bulut işaretle-süpür yapar. */
  ESITLEME: "ESITLEME",
  /** Şema defteri: KAYNAK'ınki (göç sayısı DENEME ile eşit olmak ZORUNDA). */
  SEMA: "SEMA",
};

/** Sınıfı IS olmayan tablolar — gerekçeli. */
export const OZEL_TABLOLAR = {
  _prisma_migrations: [SINIF.SEMA, "migration defteri; iki uçta aynı göç kümesi şart"],
  users: [SINIF.BIRLESIM, "iş verisinin createdBy/updatedBy FK'leri KAYNAK kullanıcılarını gösterir (32 tablo, çoğu RESTRICT) — silinemez; girişsiz arşiv kimliği olarak kalır"],
  devices: [SINIF.BIRLESIM, "work_sessions → devices RESTRICT; KAYNAK tabletleri pasif + kanıt tuzu silinir"],
  system_settings: [SINIF.AYAR, "anahtar bazlı: kurulum-özel (rezerve küme + önekler) DENEME'den, modül/iş ayarları KAYNAK'tan"],
  system_logs: [SINIF.AUDIT, "audit hash zinciri DENEME'nindir; KAYNAK satırları zincir-öncesi (chainSeq NULL) ve zincir başından ESKİ"],
  sync_watermarks: [SINIF.ESITLEME, "DENEME'nin filigranı yeni veriyi göndermez (updatedAt < filigran) — sıfırlanır, tur sayacı korunur"],
  sync_marks: [SINIF.ESITLEME, "silme işaretleri telemetri; boş başlar"],
  system_log_archives: [SINIF.KIMLIK, "audit arşivi zincirin parçasıdır — DENEME'nin"],
  sessions: [SINIF.KIMLIK, "oturumlar DENEME'nin JWT sırrı ve kullanıcılarına bağlı"],
  user_permissions: [SINIF.KIMLIK, "DENEME kullanıcılarının yetkileri"],
  user_preferences: [SINIF.KIMLIK, "kullanıcı tercihleri"],
  user_recovery_codes: [SINIF.KIMLIK, "TOTP kurtarma kodları (DURUM beyanı)"],
  totp_enrollments: [SINIF.KIMLIK, "TOTP kayıtları"],
  login_lockout_buckets: [SINIF.KIMLIK, "giriş kilidi kovaları"],
  credential_reset_requests: [SINIF.KIMLIK, "kimlik sıfırlama talepleri"],
  permissions: [SINIF.KIMLIK, "izin kataloğu (açılış işi uzlaştırır); user_permissions ile aynı kaynaktan"],
  permission_templates: [SINIF.KIMLIK, "rol şablonları"],
  permission_template_items: [SINIF.KIMLIK, "rol şablonu kalemleri"],
  license_acceptances: [SINIF.KIMLIK, "lisans metni kabulü (DURUM beyanı)"],
  update_approvals: [SINIF.KIMLIK, "güncelleme onayı (DURUM beyanı)"],
  short_credential_key_escrows: [SINIF.KIMLIK, "LICENSE_DIR HMAC anahtar emaneti — kurulumun anahtarı"],
  support_tickets: [SINIF.KIMLIK, "satıcı destek talepleri kuruluma bağlı"],
  support_ticket_replies: [SINIF.KIMLIK, "satıcı destek yanıtları"],
  cloud_inbox_receipts: [SINIF.KIMLIK, "bulut gelen kutusu makbuzları DENEME'nin bulut tesisine ait"],
  error_report_entries: [SINIF.KIMLIK, "satıcıya hata raporu telemetrisi"],
  endpoint_latency_daily: [SINIF.KIMLIK, "uç gecikme telemetrisi — kurulumun ölçümü"],
  factory_timezone_periods: [SINIF.KIMLIK, "kurulum saat dilimi dönemleri (company.timezone ile birlikte)"],
  peripheral_devices: [SINIF.KIMLIK, "yazıcı/tartı — KAYNAK fabrikasının LAN donanımı (adres taşır)"],
  device_peripherals: [SINIF.KIMLIK, "cihaz↔çevre birim bağı"],
  peripheral_template_routes: [SINIF.KIMLIK, "yazıcı↔şablon yönlendirmesi (donanıma bağlı)"],
  machine_collectors: [SINIF.KIMLIK, "makine veri toplayıcı ajanları (anahtar taşır)"],
  machine_collector_machines: [SINIF.KIMLIK, "toplayıcı↔makine bağı"],
};

/**
 * İŞ verisi tabloları — KAYNAK'tan aynen (cari, sipariş, top, çuval, sevk, finans, ürün, rota, fason, makine,
 * etiket şablonu, numara serisi, iş oturumu …). Açık liste: iki listede de olmayan tablo betiği durdurur.
 */
export const IS_TABLOLARI = [
  "bank_accounts", "batches", "cari_accounts", "cari_balances", "cari_period_closes", "cari_transactions",
  "cash_boxes", "cash_period_closes", "cash_transactions", "cheque_delivery_note_items",
  "cheque_delivery_notes", "cheque_events", "cheques", "colors", "customer_branches",
  "customer_color_aliases", "customer_item_aliases", "customer_item_color_aliases",
  "customer_standalone_labels", "customer_template_routes", "customers", "defect_types", "direct_shipments",
  "document_profiles", "doff_events", "duplicate_reviews", "exchange_rates", "fabric_properties",
  "fabric_property_values", "free_documents", "goods_receipts", "hall_shift_duty_overrides",
  "hall_shift_responsibles", "import_run_lines", "import_runs", "invoice_lines", "invoice_to_goods_receipts",
  "invoices", "item_allowed_colors", "item_allowed_properties", "item_prices", "items",
  "kartela_dispatch_items", "kartela_dispatches", "kartela_receipt_items", "kartela_receipts",
  "kursun_bypass_assignments", "label_context_defaults", "label_template_variants", "label_templates",
  "loom_alarm_events", "loom_alarm_recipients", "loom_alarm_tier_rules", "loom_alarms", "machine_runs",
  "machine_shift_line_stats", "machine_shift_stat_seals", "machine_shift_stats",
  "machine_shift_stop_breakdowns", "machine_specs", "machine_stop_code_maps", "machine_stop_events",
  "machine_stop_reclasses", "machines", "manifests", "merge_operation_refs", "merge_operation_sources",
  "merge_operations", "number_series", "number_series_counters", "number_series_lines",
  "order_line_required_properties", "order_lines", "orders", "packing_groups", "payment_allocations",
  "payments", "printed_documents", "product_recipe_properties", "product_recipes", "purchase_order_lines",
  "purchase_orders", "quality_grades", "reason_presets", "reconciliation_letters", "return_reasons",
  "roll_barcode_counters", "roll_errors", "roll_movements", "roll_operations", "roll_plan_deviations",
  "roll_properties", "roll_returns", "roll_status_events", "roll_variances", "rolls",
  "route_step_properties", "route_steps", "routes", "sack_allocations", "sack_tag_assignments", "sack_tags",
  "sack_weighings", "sacks", "shift_definitions", "shift_instances", "shipment_events", "shipment_orders",
  "shipments", "station_colors", "station_properties", "stations", "stock_count_lines", "stock_counts",
  "subcontractor_categories", "subcontractor_category_links", "subcontractor_direct_ship_allocations",
  "subcontractor_dispatch_items", "subcontractor_dispatches", "subcontractor_receipt_items",
  "subcontractor_receipt_properties", "subcontractor_receipts", "subcontractors", "swatch_events",
  "swatch_stock_reduction_items", "swatch_stock_reductions", "swatches", "traveler_card_scans",
  "traveler_card_templates", "traveler_cards", "warehouse_movements", "warehouse_transfers", "warehouses",
  "warp_beam_events", "warp_beams", "warp_specs", "weaving_order_to_order_lines", "weaving_orders",
  "work_order_close_snapshot_lines", "work_order_close_snapshots", "work_order_events", "work_order_steps",
  "work_order_target_properties", "work_order_to_order_lines", "work_orders", "work_sessions", "yarn_lots",
  "yarn_movements", "yarn_stocks",
];

/** Ayar anahtarı kurulum-özel mi — rezerve küme (koddan okunur) ∪ bu önekler/tam adlar. */
export const KURULUM_AYAR_ONEKLERI = [
  "security.", // sır satırları (ayar şifresi özeti)
  "system.", // kurulum kimliği, profil damgası
  "license.", // lisans izi / iptal belgesi
  "patronBulutu.", // bulut teknik kullanıcısı
  "errorReports.", // satıcıya hata raporu onayı
  "audit.", // zincir doğrulama başı + arşiv filigranı — DENEME'nin zinciri
  "auth.", // giriş yöntemleri / oturum politikası — DENEME'nin web paneli testleri buna bağlı
  "backup.", // makine dışı yedek hedefi — KAYNAK'ın uzak yedek adresi GİRMEZ
  "device.", // cihaz eşleme politikası
];
export const KURULUM_AYAR_TAM = ["company.name", "company.timezone"];

/** KAYNAK audit satırlarından YALNIZ bunlar taşınır (pozitif liste; bilinmeyen kategori düşer). */
export const AUDIT_KIMLIK_ETIKETLERI = [
  "SYSTEM_SETTING", "users", "USER_PASSWORD", "USER_QUICK_PIN", "USER_PERMISSION", "USER_PERMISSION_SET",
  "devices", "PERIPHERAL_DEVICE", "PERIPHERAL_TEMPLATE_ROUTE",
  "SYSTEM", "system_settings", "permissions", "permission_templates",
];

/** Rezerve ayar anahtarlarını kodun TEK kaynağından okur (Teks-Erp/src/constants/reserved-settings.ts). */
export function rezerveAnahtarlar(kaynakMetni) {
  const out = [];
  for (const m of kaynakMetni.matchAll(/export const [A-Z_]+_(?:KEY|PREFIX)\s*=\s*"([^"]+)"/g)) out.push(m[1]);
  if (!out.includes("system.installationId") || !out.includes("security.")) {
    throw new Error("reserved-settings.ts beklenen anahtarları taşımıyor (system.installationId · security.) — ayrıştırma bayat");
  }
  return out;
}
