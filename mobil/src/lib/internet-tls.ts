// İnternet kipi (docs/design/TABLET-GENEL-CA-BAGLANTI.md §2): izinli üst alanın altındaki ad, kod karşılaştırmadan
// Android'in SİSTEM güven deposu + ad eşleşmesiyle doğrulanır. Kip adresin biçiminden türer, seçilmez; kayda yazılır,
// değişimi yeniden ekleme ister (düşüş yok). IP, tek parçalı ad ve yerel adlar daima sabitli kiptedir.

/** İnternet kipine giren üst alanlar — TEK KAYNAK (kullanıcı kararı KA 2026-10-08); bekçi başka yerde literal arar. */
export const INTERNET_PARENT_DOMAINS: readonly string[] = ['etkiliyazilim.com'];

/** İnternet kipinin varsayılan portu (sabitli kipte `LAN_TLS_DEFAULT_PORT` = 4443). */
export const INTERNET_TLS_PORT = 443;

export type ServerKip = 'sabitli' | 'internet';

const LOCAL_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa', '.localhost'];
const LABEL = /^[0-9a-z]([0-9a-z-]{0,61}[0-9a-z])?$/;

function normHost(host: string): string {
  return (host ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Adresin kipi. İnternet: yalnız izinli üst alanın ALTINDAKİ geçerli ad (üst alanın kendisi değil). Geri kalan her
 * şey (IPv4/IPv6, tek etiket, yerel son ek, izinli üst alan dışı ad, bozuk ad) sabitlidir.
 */
export function kipFor(host: string, parents: readonly string[] = INTERNET_PARENT_DOMAINS): ServerKip {
  const h = normHost(host);
  if (!h || h.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return 'sabitli';
  const labels = h.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return 'sabitli';
  if (LOCAL_SUFFIXES.some((s) => h.endsWith(s))) return 'sabitli';
  return parents.some((p) => h.endsWith(`.${normHost(p)}`)) ? 'internet' : 'sabitli';
}

/** Kayıtlı internet sunucusu: ad + port + (ekleme anında okunan) kurulum kimliği. */
export interface InternetServer {
  host: string;
  port: number;
  installationId: string | null;
  addedAt: string;
}

/** Güvenli depo anahtarı (expo-secure-store); sabit deposunun (`TLS_PINS_KEY`) yanında. */
export const INTERNET_SERVERS_KEY = 'api_server_internet';

export function parseInternetServers(raw: string | null | undefined): InternetServer[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: InternetServer[] = [];
    for (const r of arr as Record<string, unknown>[]) {
      if (!r || typeof r !== 'object' || typeof r.host !== 'string' || typeof r.port !== 'number') continue;
      // Biçimi artık internet kipine uymayan kayıt yok sayılır (üst alan listesi daralırsa yeniden ekleme ister).
      if (kipFor(r.host) !== 'internet') continue;
      out.push({
        host: normHost(r.host),
        port: r.port,
        installationId: typeof r.installationId === 'string' && r.installationId ? r.installationId : null,
        addedAt: typeof r.addedAt === 'string' ? r.addedAt : '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function withInternetServer(list: readonly InternetServer[], rec: InternetServer): InternetServer[] {
  return [...list.filter((s) => s.host !== rec.host), rec];
}

/** `https://host:port[/api]` → internet kaydı (yalnız ad + port tutuyorsa). */
export function internetServerFor(url: string, list: readonly InternetServer[]): InternetServer | null {
  const m = /^https:\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? '').trim());
  if (!m) return null;
  const host = normHost(m[1] ?? '');
  const port = m[2] ? Number(m[2]) : INTERNET_TLS_PORT;
  if (kipFor(host) !== 'internet') return null;
  return list.find((s) => s.host === host && s.port === port) ?? null;
}

/** Native `probeWebPki` sonucu: sistem doğrulaması geçti mi, geçmediyse hangi sınıf. */
export type WebPkiFailure = 'clock_behind' | 'clock_ahead' | 'untrusted' | 'name' | 'network' | 'tls';

const FAILURE_TEXT: Record<WebPkiFailure, string> = {
  clock_behind: 'Tablet saati geride görünüyor — sunucunun sertifikası tabletin tarihine göre henüz geçerli değil. Tablet tarih ve saatini düzeltip yeniden deneyin.',
  clock_ahead: 'Tablet saati ileride görünüyor ya da sunucunun sertifikasının süresi dolmuş. Tablet tarih ve saatini düzeltip yeniden deneyin; düzelmezse sistem yöneticisine haber verin.',
  untrusted: 'Bu ağ bağlantıyı denetliyor (güvenilmeyen sertifika) — bağlanılmadı. BT bölümünden ilgili alan adı için istisna isteyin.',
  name: 'Sunucunun sertifikası bu adla eşleşmiyor — bağlanılmadı. Adresi kontrol edin.',
  network: 'Sunucuya ulaşılamadı. Adres doğru mu, tablette internet var mı?',
  tls: 'Şifreli bağlantı kurulamadı — bu adreste uygun bir sunucu yok.',
};

export function webPkiFailureText(kind: WebPkiFailure, host: string): string {
  return kind === 'untrusted' ? FAILURE_TEXT.untrusted.replace('ilgili alan adı', `“${host}”`) : FAILURE_TEXT[kind];
}

/** İnternet yoklamasının JS'e dönen sonucu (sistem doğrulaması geçmiş; kimlik doğrulanmış kanaldan okunmuş). */
export interface WebPkiObserved {
  host: string;
  port: number;
  installationId: string | null;
  companyName: string | null;
}

export type InternetDecision = { ok: true; record: InternetServer; baseUrl: string } | { ok: false; reason: string };

/**
 * İnternet kipinde ekleme: ad izinli üst alanda olmalı, kimlik ucu TeksERP kurulum kimliği vermeli ve kullanıcı
 * onaylamış olmalı. Kod yoktur; güven sistem deposundan gelir.
 */
export function decideInternetPair(input: { observed: WebPkiObserved; confirmed: boolean; now: string }): InternetDecision {
  const o = input.observed;
  const host = normHost(o.host);
  if (kipFor(host) !== 'internet') return { ok: false, reason: 'Bu adres internet sertifikasıyla eklenemez — doğrulama koduyla ekleyin.' };
  if (!o.installationId) return { ok: false, reason: 'Bu adreste TeksERP sunucusu yanıt vermedi.' };
  if (!input.confirmed) return { ok: false, reason: 'Onaylanmadı — bağlanılmadı.' };
  return {
    ok: true,
    record: { host, port: o.port, installationId: o.installationId, addedAt: input.now },
    baseUrl: `https://${host}:${o.port}`,
  };
}

export const SERVER_CHANGED_REASON = 'Sunucu değişti — bu sunucuya bağlanılmadı. Ayarlar → Sunucu’dan kaldırıp yeniden ekleyin.';

/** Kayıtlı internet sunucusunun kimliği değişti mi (kimlik okunamadıysa hüküm yok → false; bağlantı zaten kurulmaz). */
export function internetIdentityChanged(rec: InternetServer, observedId: string | null): boolean {
  return !!rec.installationId && !!observedId && rec.installationId !== observedId;
}
