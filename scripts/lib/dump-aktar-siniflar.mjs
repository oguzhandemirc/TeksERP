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
  /** system_settings: kurulum-özel + bayrak anahtarları DENEME'den (modüller açılır), kalan iş ayarları KAYNAK'tan. */
  AYAR: "AYAR",
  /** system_logs: yalnız DENEME'nin satırları (hash zinciri aynen); KAYNAK audit'i taşınmaz. */
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
  devices: [SINIF.BIRLESIM, "work_sessions → devices RESTRICT; KAYNAK tabletleri onaysız + pasif, kanıt tuzu silinir, adı 'as. ' önekli"],
  system_settings: [SINIF.AYAR, "anahtar bazlı: kurulum-özel + modül/bayrak/özellik ayarları DENEME'den (modüller AÇIK), belge tasarımı ve kalan iş ayarları KAYNAK'tan"],
  system_logs: [SINIF.AUDIT, "audit DENEME'nindir: hash zinciri aynen, KAYNAK'ın hiçbir satırı taşınmaz (kullanıcı kararı 2026-10-16)"],
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

/** Rezerve ayar anahtarlarını kodun TEK kaynağından okur (Teks-Erp/src/constants/reserved-settings.ts). */
export function rezerveAnahtarlar(kaynakMetni) {
  const out = [];
  for (const m of kaynakMetni.matchAll(/export const [A-Z_]+_(?:KEY|PREFIX)\s*=\s*"([^"]+)"/g)) out.push(m[1]);
  if (!out.includes("system.installationId") || !out.includes("security.")) {
    throw new Error("reserved-settings.ts beklenen anahtarları taşımıyor (system.installationId · security.) — ayrıştırma bayat");
  }
  return out;
}

/**
 * Belge TASARIMI ayarları — `PATCH /feature-flags` yükünde yaşar ama bayrak değil İŞ verisidir (belge-etiket.md):
 * belge/etiket şablonları ve belge profilleriyle birlikte KAYNAK'tan gelir. Ad kodda bulunamazsa DUR (yeniden adlandırma).
 */
export const BELGE_TASARIM_AYARLARI = ["documents.config", "company.letterhead", "traveler.cardConfig"];

/** `SETTING_KEYS` sabitini (ad → DB anahtarı) servis kaynağından okur. */
function settingKeysOku(servis) {
  const a = servis.indexOf("export const SETTING_KEYS = {");
  const b = servis.indexOf("\n} as const", a);
  if (a < 0 || b < 0) throw new Error("system-setting.service.ts: SETTING_KEYS bloğu bulunamadı — ayrıştırma bayat");
  return new Map([...servis.slice(a, b).matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
}

/** `{ ... }`/`[ ... ]` bloğunu açılış ayracından itibaren eşleşen kapanışa kadar keser (dize içi ayraç yok sayılmaz — kaynaklar düz). */
function blok(metin, bas, ac, kapa) {
  const i = metin.indexOf(ac, bas);
  let d = 0;
  for (let j = i; j < metin.length; j++) {
    if (metin[j] === ac) d++;
    else if (metin[j] === kapa && --d === 0) return metin.slice(i, j + 1);
  }
  throw new Error("blok kapanmadı — ayrıştırma bayat");
}

/**
 * Modül/bayrak/özellik ayarlarının DB anahtarları — kodun TEK kaynaklarından türetilir (elle liste yok):
 *   • bayrak = `setFeatureFlags` gövdesinin yazdığı her `SETTING_KEYS.X` (panelin `PATCH /api/feature-flags` yüzeyi)
 *              ∪ `SETTINGS_SCOPES[].settingKeys` (panelin ham ayar satırları) − BELGE_TASARIM_AYARLARI
 *   • modül  = `MODULE_SETTING_KEYS` (constants/module-flags.ts) — `MODULE_SETTING_KEY_BY_FLAG` ile birebir olmalı
 *   • bağımlılık = `MODULE_DEPENDENCIES` (alan adı) → DB anahtarı çiftleri
 */
export function bayrakAnahtarlari({ servis, kapsamlar, moduller }) {
  const sk = settingKeysOku(servis);
  const i = servis.indexOf("  async setFeatureFlags(");
  if (i < 0) throw new Error("system-setting.service.ts: setFeatureFlags bulunamadı — ayrıştırma bayat");
  const govde = blok(servis, servis.indexOf("): Promise<ApiResponse<FeatureFlags>> {", i), "{", "}");
  const adlar = [...new Set([...govde.matchAll(/SETTING_KEYS\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
  const bilinmeyen = adlar.filter((a) => !sk.has(a));
  if (bilinmeyen.length) throw new Error(`setFeatureFlags bilinmeyen SETTING_KEYS adı: ${bilinmeyen.join(", ")}`);
  const ham = [...kapsamlar.matchAll(/settingKeys:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  if (ham.length === 0) throw new Error("settings-scopes.ts: settingKeys bulunamadı — ayrıştırma bayat");

  const modulBlok = blok(moduller, moduller.indexOf("export const MODULE_SETTING_KEYS"), "[", "]");
  const modul = [...modulBlok.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const esBlok = blok(servis, servis.indexOf("const MODULE_SETTING_KEY_BY_FLAG"), "{", "}");
  const alanDb = new Map([...esBlok.matchAll(/(\w+):\s*SETTING_KEYS\.([A-Z0-9_]+)/g)].map((m) => [m[1], sk.get(m[2])]));
  const esDb = new Set(alanDb.values());
  if (modul.length < 2 || modul.length !== esDb.size || modul.some((k) => !esDb.has(k))) {
    throw new Error("MODULE_SETTING_KEYS ↔ MODULE_SETTING_KEY_BY_FLAG birebir değil — ayrıştırma bayat");
  }
  const bagBlok = blok(moduller, moduller.indexOf("export const MODULE_DEPENDENCIES"), "{", "}");
  const bagimlilik = [...bagBlok.matchAll(/(\w+):\s*"(\w+)"/g)].map(([, b, o]) => {
    if (!alanDb.has(b) || !alanDb.has(o)) throw new Error(`MODULE_DEPENDENCIES bilinmeyen modül: ${b} → ${o}`);
    return [alanDb.get(b), alanDb.get(o)];
  });
  if (bagimlilik.length === 0) throw new Error("MODULE_DEPENDENCIES boş okundu — ayrıştırma bayat");

  const tum = new Set([...adlar.map((a) => sk.get(a)), ...ham]);
  for (const k of [...modul, ...BELGE_TASARIM_AYARLARI]) if (!tum.has(k)) throw new Error(`'${k}' bayrak yüzeyinde yok — ayrıştırma bayat ya da anahtar yeniden adlandırıldı`);
  for (const k of BELGE_TASARIM_AYARLARI) tum.delete(k);
  return { bayrak: [...tum].sort(), modul: [...modul].sort(), bagimlilik };
}
