// =============================================================================
// Lisans — tabletin SAF kararları (bant · kapı hatası · K5 · QR yanıtı)
// =============================================================================
// Tablet lisansı kendisi değerlendirmez: backend `GET /api/license/durum` UYGULANAN
// kademeyi ve bandı söyler, kapı reddi 403 `details.code` ile gelir. Tip aynası
// backend `services/license-view.service.ts` (sözleşme `docs/design/LISANS-PROTOKOLU.md` §14).
// Gözlem kipinde backend bandı null, kademeyi NORMAL döner; burada ayrıca kip
// bakılır — gözlemde tablet HİÇBİR ŞEY çizmez (sıfır fark).
// =============================================================================

export type LicenseTier = 'NORMAL' | 'UYARI' | 'EK_SURE' | 'KISITLI' | 'DURDURULMUS';
export type LicenseMode = 'gozlem' | 'zorla';
export type LicenseClass = 'URETIM' | 'TEST' | 'DR' | 'DEMO' | 'BAYI' | 'BARINDIRILAN';

export interface LicenseBanner {
  metin: string;
  ton: 'bilgi' | 'uyari' | 'tehlike';
}

export interface LicenseStatusSummary {
  ayrinti: true;
  kip: LicenseMode;
  kademe: LicenseTier;
  bant: LicenseBanner | null;
  ekSureKalanGun: number | null;
  kisitlamaKalanGun: number | null;
  guncellemeIzni: boolean;
  sinif: LicenseClass | null;
  lisansNo: string | null;
  lisansSahibi: { musteri: string; tesis: string } | null;
  surum: string;
}

export type LicenseStatusResponse = LicenseStatusSummary | { ayrinti: false };

/** Kapı reddinin tablette ayrışan dört anlamı (`details.code` → tür). */
export type LicenseBlock =
  | { kind: 'restricted' }
  | { kind: 'module'; moduleKey: string | null }
  | { kind: 'suspended' }
  | { kind: 'gate' };

const GATE_CODES: Readonly<Record<string, LicenseBlock['kind']>> = {
  LICENSE_RESTRICTED: 'restricted',
  LICENSE_MODULE: 'module',
  LICENSE_SUSPENDED: 'suspended',
  LICENSE_GATE: 'gate',
};

/**
 * Modül anahtarının Türkçe adı. Backend kapısı `modul`u DB anahtarıyla
 * (`finance.enabled`) ya da API alanıyla (`financeEnabled`) gönderebilir; ikisi
 * de tanınır. Küme backend `MODULE_SETTING_KEYS` ile birebir (bekçi `license.test.ts`).
 */
export const MODULE_LABELS: Readonly<Record<string, string>> = {
  'production.enabled': 'Üretim',
  'finance.enabled': 'Ön muhasebe',
  'ticaret.enabled': 'Ticaret',
  'iplik.enabled': 'İplik',
  'depo.multiEnabled': 'Çoklu depo',
  'kumasTeknik.enabled': 'Kumaş teknik kartı',
  'tezgah.enabled': 'Tezgah izleme',
  'devere.enabled': 'Devere / levent',
  'dokuma.enabled': 'Dokuma işi',
  'emanet.enabled': 'Emanet / konsinye mülkiyet',
};

function settingKeyFromFlag(key: string): string {
  if (key === 'depoMultiEnabled') return 'depo.multiEnabled';
  const m = /^([a-zA-Z]+)Enabled$/.exec(key);
  return m ? `${m[1]}.enabled` : key;
}

export function moduleLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return MODULE_LABELS[key] ?? MODULE_LABELS[settingKeyFromFlag(key)] ?? key;
}

/** 403 + lisans kapı kodu → tür; başka her yanıt null (kapı bu hatayı üretmedi). */
export function classifyLicenseError(
  status: number | undefined,
  details: unknown,
): LicenseBlock | null {
  if (status !== 403 || !details || typeof details !== 'object') return null;
  const d = details as { code?: unknown; modul?: unknown };
  const kind = typeof d.code === 'string' ? GATE_CODES[d.code] : undefined;
  if (!kind) return null;
  if (kind === 'module') {
    return { kind, moduleKey: typeof d.modul === 'string' && d.modul ? d.modul : null };
  }
  return { kind } as LicenseBlock;
}

/** Sarılmış istemci hatası (`services/api.ts`) lisans kapısından mı döndü? Ekran kendi
 *  "kayıt başarısız" bildirimini bununla bastırır (`isWorkSessionLost` eşi). */
export function isLicenseBlocked(err: unknown): boolean {
  const e = err as { status?: number; details?: unknown } | null;
  return classifyLicenseError(e?.status, e?.details) !== null;
}

/**
 * Global uyarı metni. `suspended` tam ekranla, `gate` (kimliksiz istek — ayrıntı
 * bilinçli olarak yok) çağıranın kendi hata yoluyla karşılanır: ikisi de toast üretmez.
 */
export function licenseBlockToast(block: LicenseBlock): { text1: string; text2: string } | null {
  switch (block.kind) {
    case 'restricted':
      return {
        text1: 'Lisans kısıtlı kipte — yeni kayıt yapılamaz',
        text2: 'Kayıtlar okunabilir; yöneticinize başvurun.',
      };
    case 'module': {
      const name = moduleLabel(block.moduleKey);
      return {
        text1: name ? `${name} modülü lisansınızda kapalı` : 'Bu modül lisansınızda kapalı',
        text2: 'İşlem yapılmadı — yöneticinize başvurun.',
      };
    }
    default:
      return null;
  }
}

function isEnforced(status: LicenseStatusResponse | null | undefined): status is LicenseStatusSummary {
  return !!status && status.ayrinti === true && status.kip === 'zorla';
}

/** Çizilecek bant — yalnız zorlama kipinde ve backend bir bant döndüyse. */
export function bannerToShow(status: LicenseStatusResponse | null | undefined): LicenseBanner | null {
  if (!isEnforced(status) || !status.bant) return null;
  const metin = status.bant.metin?.trim();
  return metin ? { metin, ton: status.bant.ton } : null;
}

/** K5: sunucu durdurulmuş (yalnız zorlama kipinde anlamlı; gözlemde kademe hep NORMAL). */
export function isSuspendedStatus(status: LicenseStatusResponse | null | undefined): boolean {
  return isEnforced(status) && status.kademe === 'DURDURULMUS';
}

/** Ayarlar → Lisans özet satırları (yalnız görünür filigran: no · sahip · sürüm). */
export function licenseSummaryRows(
  status: LicenseStatusResponse | null | undefined,
): { label: string; value: string }[] {
  if (!status || status.ayrinti !== true) return [];
  const rows = [
    { label: 'Lisans no', value: status.lisansNo ?? 'Etkinleştirilmemiş' },
    {
      label: 'Lisans sahibi',
      value: status.lisansSahibi ? `${status.lisansSahibi.musteri} · ${status.lisansSahibi.tesis}` : '—',
    },
    { label: 'Sunucu sürümü', value: status.surum || '—' },
  ];
  if (isEnforced(status) && status.kademe !== 'NORMAL') {
    rows.push({ label: 'Durum', value: TIER_LABELS[status.kademe] });
  }
  return rows;
}

const TIER_LABELS: Readonly<Record<LicenseTier, string>> = {
  NORMAL: 'Normal',
  UYARI: 'Uyarı',
  EK_SURE: 'Ek süre',
  KISITLI: 'Kısıtlı kip',
  DURDURULMUS: 'Durduruldu',
};

const MAX_RESPONSE_CHARS = 64 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Okutulan QR bir lisans yanıtına BENZİYOR mu? Backend (`POST /cevrimdisi-yanit`) iki
 * biçim kabul eder: JSON metni ya da base64url(JSON). Bu kaba süzgeç yanlış etiketi
 * (top barkodu, adres) sunucuya göndermeden reddeder; imza ve bağ denetimi backend'de.
 */
export function normalizeScannedResponse(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 10 || text.length > MAX_RESPONSE_CHARS) return null;
  if (text.startsWith('{')) return text.endsWith('}') ? text : null;
  return BASE64URL.test(text) ? text : null;
}
