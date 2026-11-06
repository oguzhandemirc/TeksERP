// =============================================================================
// İş Emirleri › Dokuma listesi — SAF mantık (testli): başlık anahtarı görünürlüğü, seçim, sorgu parametreleri, hücre metni
// =============================================================================
// Terbiye (WorkOrder) ve Dokuma (WeavingOrder) İKİ AYRI listedir (kullanıcı kararı 2026-11-06). Anahtar yalnız dokuma
// rejimi ETKİN (üretim ∧ dokuma) ve kullanıcı dokuma işini okuyabiliyorken görünür; aksi hâlde başlık bugünkü tek başlıktır.
// Süzme SUNUCUDADIR (`GET /api/weaving-orders` status CSV + search) — burada yalnız parametre kurulur.
// =============================================================================
import { resolveMobileModuleState } from '../../../../constants/screenModules';
import type { FeatureFlags } from '../../../../services/featureFlag.service';
import { TERIM } from '../../../../lib/terim';
import type { WeavingOrderListRow } from '../../../../services/weavingOrder.service';

export type IsEmriTuru = 'terbiye' | 'dokuma';

/** Cihazda hatırlanan seçim (kullanıcıdan bağımsız: tablet bir istasyonda bir işe bakar). */
export const IS_EMRI_TURU_KEY = 'device_is_emri_turu';

/** Liste + genel bakış ucunun kabul ettiği okuma izinleri (backend `requireAnyPermission` ikizi; `mobile:kk1` genel bakışı açmaz). */
export const DOKUMA_OKUMA_IZINLERI = ['weavingorder:read', 'mobile:dokuma'] as const;

type Flags = Partial<Pick<FeatureFlags, 'productionEnabled' | 'dokumaEnabled'>> | null | undefined;

/** Anahtar görünür mü: etkin dokuma rejimi (bayrak YÜKLENMEDEN kapalı — fail-closed) ∧ okuma izni. */
export function dokumaAnahtariGorunur(flags: Flags, has: (code: string) => boolean): boolean {
  if (!flags || typeof flags.dokumaEnabled !== 'boolean') return false;
  return resolveMobileModuleState(flags).dokumaEnabled && DOKUMA_OKUMA_IZINLERI.some((p) => has(p));
}

/** Kayıt yalnız birebir 'dokuma' ise dokuma; yok/bozuk → terbiye (bugünkü ekran). */
export function parseIsEmriTuru(raw: string | null | undefined): IsEmriTuru {
  return raw === 'dokuma' ? 'dokuma' : 'terbiye';
}

/** Etkin liste: anahtar görünmüyorsa (dokuma kapandı / izin gitti) kayıtlı seçim ne olursa olsun terbiye. */
export function etkinIsEmriTuru(secili: IsEmriTuru, gorunur: boolean): IsEmriTuru {
  return gorunur ? secili : 'terbiye';
}

/** Anahtarın iki adı, sabit sırada (başlıklar yer değiştirmez, yalnız vurgu değişir). `kisa` dar ekran içindir
 *  (telefon dikeyde iki tam ad üst çubuğa sığmaz, kesik ad yasak): TERIM adının ayırt edici ilk kelimesi. */
export function anahtarAdlari(): { tur: IsEmriTuru; ad: string; kisa: string }[] {
  const kur = (tur: IsEmriTuru, ad: string) => ({ tur, ad, kisa: ad.split(' ')[0] });
  return [kur('terbiye', TERIM.terbiyeIsEmri.cogul), kur('dokuma', TERIM.dokumaIsEmri.cogul)];
}

// ── Süzgeç → sorgu ───────────────────────────────────────────────────────────
export type DokumaDurum = 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ALL';

export const DOKUMA_DURUM_SECENEKLERI: { value: DokumaDurum; label: string }[] = [
  { value: 'OPEN', label: 'Açık (planlı + devam eden)' },
  { value: 'IN_PROGRESS', label: 'Devam ediyor' },
  { value: 'PLANNED', label: 'Planlandı' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal edildi' },
  { value: 'ALL', label: 'Tümü' },
];

const STATUS_PARAM: Record<DokumaDurum, string | null> = {
  OPEN: 'PLANNED,IN_PROGRESS',
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ALL: null,
};

export interface DokumaFiltre {
  search: string;
  durum: DokumaDurum;
}

export const DOKUMA_VARSAYILAN_FILTRE: DokumaFiltre = { search: '', durum: 'OPEN' };
export const DOKUMA_SAYFA = 40;
/** Bundan kısa aramada sunucuya gidilmez. */
export const DOKUMA_MIN_ARAMA = 2;

export interface DokumaSorgu {
  status?: string;
  search?: string;
}

/** Süzgeç → liste ucu parametreleri (aynı nesne sorgu anahtarıdır). */
export function dokumaSorgusu(f: DokumaFiltre): DokumaSorgu {
  const q: DokumaSorgu = {};
  const st = STATUS_PARAM[f.durum];
  if (st) q.status = st;
  const s = f.search.trim();
  if (s.length >= DOKUMA_MIN_ARAMA) q.search = s;
  return q;
}

// ── Hücre metinleri ──────────────────────────────────────────────────────────
const m = (n: number) => `${Math.round(n).toLocaleString('tr-TR')}`;

/** Kumaş satırı (ana) + desen · renk (alt). */
export function kumasMetni(r: Pick<WeavingOrderListRow, 'item' | 'weaveDesign' | 'color'>): { ana: string; alt: string } {
  return { ana: r.item?.name ?? '—', alt: [r.weaveDesign?.name, r.color?.name].filter(Boolean).join(' · ') };
}

/** Açık koşumun tezgahı; birden çoksa "+N". Alan yoksa (eski sunucu) koşum sayısı, o da yoksa "—". */
export function tezgahMetni(r: Pick<WeavingOrderListRow, 'openRunMachines' | 'openRunCount' | 'executionKind' | 'subcontractor'>): string {
  if (r.executionKind === 'SUBCONTRACTED') return r.subcontractor?.name ? `Fason · ${r.subcontractor.name}` : 'Fason';
  const list = r.openRunMachines;
  if (!list) return (r.openRunCount ?? 0) > 0 ? `${r.openRunCount} açık koşum` : '—';
  if (list.length === 0) return '—';
  return list.length > 1 ? `${list[0].name} +${list.length - 1}` : list[0].name;
}

/** "üretilen / planlanan m": ölçülmemiş üretim "—" (0 uydurulmaz), hedefsiz iş "açık uçlu". */
export function metreMetni(r: Pick<WeavingOrderListRow, 'plannedM' | 'producedM'>): string {
  const done = r.producedM == null ? '—' : m(r.producedM);
  const plan = r.plannedM == null ? 'açık uçlu' : `${m(r.plannedM)} m`;
  return `${done} / ${plan}`;
}

/** Boş liste başlığı + çıkış eylemi (terbiye listesinin kalıbı). */
export function dokumaBosDurum(f: DokumaFiltre): { title: string; text: string; action: 'clearFilters' | 'showAllStatuses' | null } {
  if (f.search.trim().length >= DOKUMA_MIN_ARAMA) return { title: 'Bu aramaya uyan kayıt yok', text: 'Aramayı değiştirin ya da temizleyin.', action: 'clearFilters' };
  if (f.durum !== 'ALL') {
    const label = DOKUMA_DURUM_SECENEKLERI.find((o) => o.value === f.durum)?.label.replace(/ \(.*\)$/, '') ?? f.durum;
    return { title: `"${label}" durumunda ${TERIM.dokumaIsEmri.tekilKucuk} yok`, text: 'Diğer durumlardaki kayıtlar için tüm durumları gösterin.', action: 'showAllStatuses' };
  }
  return { title: `Henüz ${TERIM.dokumaIsEmri.tekilKucuk} yok`, text: `${TERIM.dokumaIsEmri.cogul} yönetim panelinden açılır.`, action: null };
}
