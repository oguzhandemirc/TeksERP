import apiClient from "@/services/apiClient";

// =============================================================================
// HAZIR SEBEP KATALOĞU — SERVİS (2026-08-19)
// =============================================================================
// Dört liste tek uçtan gelir. `createCrudService` KULLANILMADI: bu uç sayfalama
// döndürmüyor (liste onlarca satır, binlerce değil), silme YOK (gizleme var) ve
// "çoğalt" standart CRUD'da olmayan bir fiil.
// =============================================================================

export type ReasonPresetKind =
  | "ROLL_SCRAP"
  | "ROLL_RECORD_CORRECTION"
  | "ROLL_MANUAL_ENTRY"
  | "ROLL_CANCEL"
  | "WORK_ORDER_REWORK"
  | "ORDER_CANCEL"
  | "MACHINE_STOP"
  | "WARP_RETURN"
  // Faz 3 (devere): kalan düzeltmesi · hurda/artık dispozisyonu
  | "WARP_BEAM_ADJUST"
  | "WARP_BEAM_SCRAP"
  // Fason G1 (iplik): fasondan iplik dönüş sebebi
  | "YARN_SUBCONTRACT_RETURN";

export interface ReasonPreset {
  id: string;
  kind: ReasonPresetKind;
  code: string;
  label: string;
  fullText: string | null;
  requiresText: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  /** Eski adlar (salt-okunur, 2026-08-21) — etiket düzenlenince sunucu eski metni de koda çözsün diye tutulur. */
  legacyTexts?: string[];
  /** Yalnız `MACHINE_STOP`ta dolu (zorunlu; MINOR süre sınıfıdır, seçilemez). Duruşa kopyalanıp donar. */
  stopLossClass?: StopLossClass | null;
}

/** Sebebe verilebilen kayıp sınıfları — `MINOR` bilinçli dışarıda (süre sınıfı, sebep değil). */
export type StopLossClass = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED";
export const STOP_LOSS_CLASS_OPTIONS: { value: StopLossClass; label: string; hint: string }[] = [
  { value: "UNPLANNED", label: "Plansız", hint: "Arıza, kopuş, malzeme yok — kullanılabilirliği düşürür" },
  { value: "SETUP", label: "Kurulum", hint: "Levent/tahar değişimi, ayar — kurulum süresine yazılır" },
  { value: "PLANNED", label: "Planlı", hint: "Planlı bakım, mola dışı planlı duruş" },
  { value: "NON_SCHEDULED", label: "Çalışma dışı", hint: "Sipariş yok, vardiya dışı — POT'a hiç girmez" },
];

/**
 * true olan listelerde kayda METİN de yazılır (`Roll.entryReason` / `Roll.cancelReason`
 * — görünen kayıt); 2026-08-21'den beri KOD da yazılır (`entryReasonCode` /
 * `cancelReasonCode` — rapor anahtarı, sunucu metinden türetir). Metni düzenlemek
 * geçmişi BÖLMEZ (kod sabit); eski kayıt eski metni taşımaya devam eder.
 * Sunucudaki `KIND_STORES_TEXT` ile birebir aynı tablo.
 */
export const KIND_STORES_TEXT: Record<ReasonPresetKind, boolean> = {
  ROLL_SCRAP: false,
  ROLL_RECORD_CORRECTION: false,
  ROLL_MANUAL_ENTRY: true,
  ROLL_CANCEL: true,
  // Yeniden üretimde satır YOK: kod + metin iş emrinin `parameters.rework`una
  // yazılır, metin ayrıca fason çekisine talimat olur. Sunucudaki
  // `KIND_STORES_TEXT` ile birebir aynı tablo.
  WORK_ORDER_REWORK: false,
  // Sipariş iptalinde satıra GÖRÜNEN metin yazılır (`Order.cancelReason`) +
  // kod (`cancelReasonCode`) — top iptaliyle aynı sözleşme.
  ORDER_CANCEL: true,
  // Tezgah duruşunda satıra yalnız KOD yazılır (`MachineStopEvent.reasonCode`);
  // kayıp sınıfı preset'ten kopyalanıp donar. Sunucu tablosuyla birebir.
  MACHINE_STOP: false,
  WARP_RETURN: false,
  WARP_BEAM_ADJUST: false,
  WARP_BEAM_SCRAP: false,
  YARN_SUBCONTRACT_RETURN: false,
};

/**
 * ⚠️ `modul` alanı: sekme yalnız o modül AÇIKKEN çizilir. Dokuması KAPALI
 * fabrikada (referans profil) `MACHINE_STOP` satırları DB'ye düşer (boot job'ı
 * bayrağa bakmaz — izin kataloğu denklemi) ama bu sekme ÇİZİLMEZ: koşulsuz
 * eklenmesi beşinci bir sekme doğurur ve K3'ü (sıfır fark) ihlal ederdi.
 * Duruşlar `dokumaEnabled` altında yazılır (Tezgah Duruşları ekranı, tablet
 * Dokuma ekranı) — sekme aynı bayrağı okur; `tezgahEnabled` telemetrinindir.
 * Parite bekçisi sekmenin VARLIĞINI ister, GÖRÜNÜRLÜĞÜNÜ değil — ikisi ayrı.
 */
export const KIND_TABS: { kind: ReasonPresetKind; title: string; hint: string; modul?: "dokumaEnabled" | "devereEnabled" | "iplikEnabled" }[] = [
  {
    kind: "ROLL_SCRAP",
    title: "Fire",
    hint: "Tambur'da 'fire diye gir' kararının sebebi. Mal vardı, kullanılamaz — fire oranına girer.",
  },
  {
    kind: "ROLL_RECORD_CORRECTION",
    title: "Kayıt Düzeltmesi",
    hint: "'Bu metraj fiziksel olarak hiç yoktu' kararının sebebi. Fire DEĞİLDİR.",
  },
  {
    kind: "ROLL_MANUAL_ENTRY",
    title: "Elle Top Ekleme",
    hint: "Tambur Manuel Mod ve 'Manuel Top Ekle' — topun nereden geldiği.",
  },
  {
    kind: "ROLL_CANCEL",
    title: "Top İptali",
    hint: "KK1 / Depo / Tambur iptal ekranındaki hazır sebepler.",
  },
  {
    kind: "WORK_ORDER_REWORK",
    title: "Yeniden Üretim",
    hint: "Depodaki bitmiş topu tekrar üretime/boyahaneye alma sebebi. Seçilen metin fason çeki listesine talimat olarak basılır.",
  },
  {
    kind: "ORDER_CANCEL",
    title: "Sipariş İptali",
    hint: "Müşteri neden vazgeçti. İlk satırlar MÜŞTERİ kararıdır (satışın bakması gereken sinyal), son ikisi bizim kayıt/tedarik sorunumuzdur — rapor ikisini ayırır.",
  },
  {
    kind: "MACHINE_STOP",
    title: "Tezgah Duruşu",
    hint: "Tezgah neden durdu. Her sebep bir KAYIP SINIFI taşır (plansız / kurulum / planlı / çalışma dışı) ve randıman raporu o sınıfa göre gruplar; sınıf sebepten kopyalanıp duruşa donar. Kısa kopuşlar buraya girmez — onlar süre sınıfıdır, sebep değil.",
    modul: "dokumaEnabled",
  },
  {
    kind: "WARP_RETURN",
    title: "Levent Dibi İadesi",
    hint: "Sarım bitince bobinde kalan iplik nereye gitti: depoya iade, atkılığa aktarım, telef. Her iade satırında sebep ZORUNLUDUR (brüt çıkış + ayrı iade).",
    modul: "devereEnabled",
  },
  {
    kind: "WARP_BEAM_ADJUST",
    title: "Levent Kalan Düzeltmesi",
    hint: "Leventte kalan metre elle düzeltilirken (+/−) sebep ZORUNLUDUR — sayaç yanlış, ölçüm farkı, kayıt hatası. Yanlış düzeltme silinmez, karşı düzeltmeyle kapanır.",
    modul: "devereEnabled",
  },
  {
    kind: "WARP_BEAM_SCRAP",
    title: "Levent Hurda / Artık",
    hint: "Levent hurdaya ayrılırken sebep ZORUNLU, bittiğinde (levent dibi) isteğe bağlı dispozisyon: telef, atkılığa aktarım, kopuk çözgü, yanlış sarım. Telef satışı kapsam dışıdır.",
    modul: "devereEnabled",
  },
  {
    kind: "YARN_SUBCONTRACT_RETURN",
    title: "Fasondan İplik Dönüşü",
    hint: "Fasona giden iplik geri dönerken sebep ZORUNLUDUR: kalan iplik, kalite, iş iptali. Çıkış brüt yazılır, dönüş ayrı satırla kapanır.",
    modul: "iplikEnabled",
  },
];

export const reasonPresetService = {
  list: (includeInactive = true): Promise<ReasonPreset[]> =>
    apiClient
      .get<ReasonPreset[]>(`/api/reason-presets${includeInactive ? "?includeInactive=true" : ""}`)
      .then((r) => r.data),

  create: (input: {
    kind: ReasonPresetKind;
    label: string;
    fullText?: string | null;
    stopLossClass?: StopLossClass | null;
  }): Promise<ReasonPreset> =>
    apiClient.post<ReasonPreset>("/api/reason-presets", input).then((r) => r.data),

  update: (
    id: string,
    input: { label?: string; fullText?: string | null; isActive?: boolean; stopLossClass?: StopLossClass | null },
  ): Promise<ReasonPreset> =>
    apiClient.patch<ReasonPreset>(`/api/reason-presets/${id}`, input).then((r) => r.data),

  duplicate: (id: string, label?: string): Promise<ReasonPreset> =>
    apiClient
      .post<ReasonPreset>(`/api/reason-presets/${id}/duplicate`, label ? { label } : {})
      .then((r) => r.data),

  reorder: (kind: ReasonPresetKind, ids: string[]): Promise<ReasonPreset[]> =>
    apiClient.patch<ReasonPreset[]>("/api/reason-presets/reorder", { kind, ids }).then((r) => r.data),
};
