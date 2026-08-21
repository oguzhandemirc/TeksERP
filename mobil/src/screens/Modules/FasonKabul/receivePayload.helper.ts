/**
 * Fason kabul payload üretimi — saf (test edilebilir) mantık.
 *
 * FasonKabulScreen closure'ından çıkarıldı ki ekranı render etmeden, birim testle
 * "doğru payload üretiliyor mu" kanıtlanabilsin. Saha bug'ı (kısmi kabulde fazla
 * top doğması) tam burada — returns (işaretli/gelen toplar) ile newRolls (dönen
 * açık-kumaş parçaları) ayrı kaynaklardan gelir; rebuildPrefilledNewRolls (bkz.
 * ./newRolls.helper) ✓ değişince newRolls'u senkronlar, bu fonksiyon ise ikisini
 * payload'a birleştirir.
 */
import type {
  FabricProperty,
  PendingReturnGroup,
  PendingReturnParty,
  ReceiveNewRollInput,
  ReceiveRequest,
} from '../../../types/models';
import type { NewRollRow } from './newRolls.helper';
import { generateClientUuid } from '../../../offline/barcode';

/** buildReceivePayload'ın satırlardan (rows) ihtiyaç duyduğu minimal şekil. */
export interface PayloadRollRow {
  rollId: string;
  checked: boolean;
  notes: string;
  /**
   * KISMİ KABUL (2026-08-19): operatörün beyan ettiği GELEN metraj (ham metin,
   * virgül serbest). Kalanın (remainingQty) ALTINDAYSA payload'a `receivedQty`
   * yazılır → backend topu tüketmez, kalan fasonda bekler. Kalana eşit/üstünde
   * ya da parse edilemezse alan GÖNDERİLMEZ → TAM kabul (eski davranış birebir;
   * eski backend'ler bilinmeyen alanı zaten atar).
   */
  receivedQtyStr?: string;
  /** Topun fasondaki KALANI (currentQty) — kısmi kararının kıyas tabanı. */
  remainingQty?: number;
}

/** Satırın kısmi olup olmadığı + payload'a yazılacak gelen metraj (yoksa null). */
export function partialReceivedQty(row: PayloadRollRow): number | null {
  if (row.receivedQtyStr == null || row.remainingQty == null) return null;
  const n = parseFloat(row.receivedQtyStr.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  // 0.01 m eşiği — FARK bantlarıyla aynı hassasiyet (yüzer-nokta gürültüsü
  // "kısmi" sayılmasın; kalana eşit giriş TAM kabuldür).
  return n < row.remainingQty - 0.01 ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// KALAN DAĞITIMI (2026-08-21) — "fasonda N metre kaldı" tek sayısı
// ─────────────────────────────────────────────────────────────────────────────
// SAHA VAKASI: 5 top (30/40/50/60/70 m) boyahaneye gitti, 220 m döndü ve bir
// miktarı da orada kaldı. Eski ekran soruyu TOP BAZINDA soruyordu ("bu toptan
// kaç metre geldi?") — boyahanenin parçaları dikip tek parça boyadığı bir işte
// bu sorunun fiziksel bir cevabı YOKTUR. Operatör 5 alanı kafadan bölüştürmeye
// çalışıyor, her düşürdüğü satır ayrı bir "yarım top" doğuruyordu.
//
// Yeni sözleşme: operatör TEK sayı verir (fasonda kalan toplam metre); dağıtımı
// sistem yapar ve BÜYÜK TOPTAN başlar. Gerekçe: kalan mümkün olan EN AZ topa
// yığılsın — orantılı bölüştürme 5 topun beşini birden yarım bırakır, yani beş
// ayrı hayalet üretirdi (ve kalan geldiğinde beş ayrı ikinci kabul isterdi).
// Tamamı kalan top ise dönüş listesine HİÇ girmez (backend'de dokunulmadan
// AT_SUBCONTRACTOR kalır) — "0 metre kabul ettim" diye bir kayıt yoktur.
//
// ⚠️ Dağıtım bir KURGUDUR ve öyle olmak zorundadır: hangi metrenin hangi topta
// kaldığı bilinmiyor. Doğru olan tek şey TOPLAMDIR ve o korunur.

/** Dağıtımın tabanı — işaretli topun fasondaki kalanı. */
export interface RemainderRow {
  rollId: string;
  remainingQty: number;
}

export interface EffectiveReturn {
  rollId: string;
  /** Payload'a yazılacak metraj; `null` → TAM kabul (alan hiç GÖNDERİLMEZ). */
  receivedQty: number | null;
  /** Bu topta fasonda kalacak metraj (0 = kalmıyor). */
  leftQty: number;
  /** true → top bu kabulde HİÇ gelmedi; dönüş listesine girmez. */
  dropped: boolean;
  /** Fasonun hesabından bu kabulde DÜŞÜLEN metraj (dropped ise 0). */
  consumedQty: number;
}

/** Metraj karşılaştırmalarının ortak hassasiyeti (FARK bantlarıyla aynı). */
export const QTY_EPSILON = 0.01;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * İşaretli topları, beyan edilen KALAN metrajına göre dönüş satırlarına çevirir.
 *
 * `remainderQty` verilmemişse (basit yol: "fasonda kalan yok") satır başına
 * girilen "Gelen (m)" değerleri kullanılır — top bazlı giriş kaçış kapısıdır ve
 * eski davranışı birebir korur.
 */
export function resolveReturns(
  rows: readonly PayloadRollRow[],
  remainderQty?: number | null,
): EffectiveReturn[] {
  const checked = rows.filter((r) => r.checked);
  const remainder =
    remainderQty != null && Number.isFinite(remainderQty) && remainderQty > QTY_EPSILON
      ? remainderQty
      : null;

  if (remainder == null) {
    // TOP BAZLI yol (kaçış kapısı) — satırdaki beyan neyse o.
    return checked.map((r) => {
      const partial = partialReceivedQty(r);
      const remaining = Number(r.remainingQty ?? 0);
      return {
        rollId: r.rollId,
        receivedQty: partial,
        leftQty: partial == null ? 0 : round2(remaining - partial),
        dropped: false,
        consumedQty: partial ?? remaining,
      };
    });
  }

  // BÜYÜK TOPTAN başlayarak kalanı yığ. Sıra deterministik olmalı: eşit
  // metrajlı toplarda rollId ikinci anahtardır, yoksa aynı ekran aynı girdiyle
  // farklı payload üretir (offline replay'de aynı token, farklı içerik demek).
  const order = [...checked].sort((a, b) => {
    const d = Number(b.remainingQty ?? 0) - Number(a.remainingQty ?? 0);
    return d !== 0 ? d : a.rollId.localeCompare(b.rollId);
  });

  let left = remainder;
  const byId = new Map<string, EffectiveReturn>();
  for (const r of order) {
    const remaining = Number(r.remainingQty ?? 0);
    const take = Math.min(Math.max(left, 0), remaining);
    left = round2(left - take);
    const consumed = round2(remaining - take);
    byId.set(r.rollId, {
      rollId: r.rollId,
      // Tamamı kalanla eşitse top hiç dönmedi; azıysa KISMİ; hiç kalmadıysa TAM.
      receivedQty: take > QTY_EPSILON && consumed > QTY_EPSILON ? consumed : null,
      leftQty: round2(take),
      dropped: consumed <= QTY_EPSILON,
      consumedQty: consumed <= QTY_EPSILON ? 0 : consumed,
    });
  }
  // Ekran sırası korunur (dağıtım sırası yalnız hesabın içindedir).
  return checked.map((r) => byId.get(r.rollId)!);
}

/** Bu kabulde fasonun hesabından düşülen toplam metraj. */
export function consumedTotalOf(returns: readonly EffectiveReturn[]): number {
  return round2(returns.reduce((s, r) => s + r.consumedQty, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// ÇEKME (giden ↔ dönen farkı)
// ─────────────────────────────────────────────────────────────────────────────
// Fark bir HATA DEĞİL, üretim gerçeğidir: boyahanede kumaş çeker. Eski ekran onu
// "EKSİK DÖNEN / giden-gelen uyuşmuyor" diye kırmızı bir onay modalıyla
// karşılıyordu ve operatör normal işi hata sanıyordu. Yeni kural: farkı ADIYLA
// göster, uyarıyı yalnız fabrikanın belirlediği toleransın ÜSTÜNDE çıkar.

export interface ShrinkInfo {
  /** dönen − düşülen. Eksi = çekme, artı = fazla dönen. */
  diff: number;
  /** |diff| anlamlı mı (yüzer-nokta gürültüsü değil). */
  significant: boolean;
  /** Çekme mi (diff < 0)? */
  shrink: boolean;
  /** Düşülen metrajın yüzdesi olarak |diff|; taban 0 ise 0. */
  pct: number;
}

export function shrinkInfo(consumedTotal: number, returnedTotal: number): ShrinkInfo {
  const diff = round2(returnedTotal - consumedTotal);
  const significant = Math.abs(diff) > QTY_EPSILON;
  const pct =
    consumedTotal > QTY_EPSILON
      ? Math.round((Math.abs(diff) / consumedTotal) * 1000) / 10
      : 0;
  return { diff, significant, shrink: diff < 0, pct };
}

/**
 * Uyarı çıkmalı mı? Bayrak kapalıysa ASLA; açıksa yalnız tolerans AŞILDIĞINDA.
 *
 * ⚠️ Artı yön (fazla dönen) de aynı toleransa tabidir ve bu bilinçli: fazla
 * dönen mal da bir uyuşmazlıktır (yanlış partiden parça karışmış olabilir),
 * yalnız yönü farklıdır. Toleransı tek yöne uygulamak, +80 metrelik bir
 * karışıklığı sessizce kabul ettirirdi.
 */
export function shrinkExceedsTolerance(
  info: ShrinkInfo,
  opts: { enabled: boolean; tolerancePct: number },
): boolean {
  if (!opts.enabled || !info.significant) return false;
  return info.pct > opts.tolerancePct;
}

/**
 * "Dönen açık kumaş" form satırlarını backend payload'ına (ReceiveNewRollInput[])
 * çevirir: qty parse (virgül→nokta), sonlu/pozitif olmayanlar atlanır, notes trim.
 */
export function parseNewRolls(newRolls: NewRollRow[]): ReceiveNewRollInput[] {
  const out: ReceiveNewRollInput[] = [];
  for (const r of newRolls) {
    const qty = parseFloat(r.qty.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ qty, notes: r.notes.trim() || null });
  }
  return out;
}

/**
 * Kabulde ÖLÇÜLEN en (cm) — ham metinden sayıya. Metraj ile aynı sözleşme:
 * virgül→nokta, sonlu ve pozitif değilse "girilmedi" sayılır (null).
 *
 * `0` bilinçli olarak null'a düşer: 0 cm'lik kumaş yoktur, 0 "ölçmedim" demektir.
 * Backend de aynı süzgeci uygular (`appliedWidth > 0`) — iki katman aynı şeyi söyler.
 */
export function parseAppliedWidth(raw: string): number | null {
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface BuildReceivePayloadArgs {
  selectedGroup: PendingReturnGroup | null;
  selectedParty: PendingReturnParty | null;
  rows: PayloadRollRow[];
  newRolls: NewRollRow[];
  manifestNo: string;
  notes: string;
  appliesColor: boolean;
  /** Seçili rengin ID'si. Ad/hex ekranda `ColorSelectField` tarafından çözülür —
   *  burada kimlik yeter ve tam da backend'e giden şeydir. */
  appliedColorId: string | null;
  appliedProperties: FabricProperty[];
  /** Kabulde ölçülen en — HAM metin (NumpadInput değeri); burada parse edilir. */
  appliedWidth: string;
  /**
   * Plandan FARKLI renk seçildiğinde operatörün kararı (2026-08-21): iş emri de
   * bu renge dönsün (APPLY_TO_PLAN) ya da sadece bu toplar (ROLLS_ONLY — sapma
   * kabulde deftere düşer). Renk planla aynıysa ya da karar yoksa gönderilmez.
   */
  planColorAction?: 'APPLY_TO_PLAN' | 'ROLLS_ONLY' | null;
  /**
   * FASONDA KALAN toplam metraj (2026-08-21). Verilirse dağıtımı `resolveReturns`
   * yapar ve satırlardaki `receivedQtyStr` YOK SAYILIR — ikisi aynı şeyi iki
   * farklı dille söyler, ikisini birden okumak çelişkiyi sessizce çözmek olurdu.
   */
  remainderQty?: number | null;
}

/**
 * Fason kabul payload'ını ekran state'inden SAF olarak kurar. Geçersizse null:
 *   - grup yok,
 *   - fason firma (subId) çözülemiyor (seçili parti ya da son sevkten),
 *   - hiçbir top işaretli değil (returns boş),
 *   - geçerli açık-kumaş parçası yok (parseNewRolls boş).
 * Bu sözleşme ekranın canSubmit + subId guard'larıyla birebir aynıdır; yan etki
 * (Toast) ekranda kalır.
 *
 * KRİTİK: returns = YALNIZ işaretli (gelen) toplar; newRolls = parseNewRolls
 * sonucu. Bu ikisi BAĞIMSIZDIR (boyahane merge/split yapabilir) — bu yüzden katı
 * parite yoktur; doğruluk, ✓ değişince newRolls'u resync eden ekran mantığından gelir.
 */
export function buildReceivePayload(args: BuildReceivePayloadArgs): ReceiveRequest | null {
  const {
    selectedGroup,
    selectedParty,
    rows,
    newRolls,
    manifestNo,
    notes,
    appliesColor,
    appliedColorId,
    appliedProperties,
    appliedWidth,
    remainderQty,
    planColorAction,
  } = args;

  if (!selectedGroup) return null;
  const subId =
    selectedParty?.subcontractorId ?? selectedGroup.lastDispatch?.subcontractorId;
  if (!subId) return null;

  // Dönüş satırları TEK yerden çözülür (kalan dağıtımı ya da top bazlı beyan) —
  // ekran ile payload aynı fonksiyonu okur, "ekranda gördüğüm ile gönderilen
  // farklı" sınıfı hatalar böyle kapanır.
  const notesByRoll = new Map(rows.map((r) => [r.rollId, r.notes.trim() || null]));
  const returns = resolveReturns(rows, remainderQty)
    // Tamamı fasonda kalan top dönüş listesine GİRMEZ: backend'de dokunulmadan
    // AT_SUBCONTRACTOR kalır. "0 metre kabul ettim" diye bir kayıt yoktur.
    .filter((r) => !r.dropped)
    .map((r) => ({
      rollId: r.rollId,
      notes: notesByRoll.get(r.rollId) ?? null,
      ...(r.receivedQty != null ? { receivedQty: r.receivedQty } : {}),
    }));
  if (returns.length === 0) return null;

  const parsed = parseNewRolls(newRolls);
  if (parsed.length === 0) return null;

  return {
    workOrderId: selectedGroup.workOrder.id,
    stepId: selectedGroup.step.id,
    subcontractorId: subId,
    manifestNo: manifestNo.trim() || null,
    notes: notes.trim() || undefined,
    // Refactor 9 — "renk veren" kategori için receipt seviyesi renk/özellik
    ...(appliesColor
      ? {
          appliedColorId,
          // Ekranı açarken görülen iş emri hedef rengi (2026-08-21): sunucu kilit
          // altında taze hedefle karşılaştırır; planlamacı arada rengi
          // değiştirdiyse 409 `TARGET_COLOR_CHANGED` — eski renk sessizce yazılmaz.
          // Tablet `appliedColorId`yi DAİMA gönderdiği için (override yolu) tek
          // koruma budur; grup nesnesi yükleme anının görüntüsüdür.
          expectedTargetColorId: selectedGroup.workOrder.targetColor?.id ?? null,
          // Plandan farklı renk + operatör kararı (yalnız gerçekten farklıysa).
          ...(planColorAction &&
          appliedColorId !== (selectedGroup.workOrder.targetColor?.id ?? null)
            ? { planColorAction }
            : {}),
          appliedPropertyIds: appliedProperties.map((p) => p.id),
        }
      : {}),
    // EN kategoriye BAKMAZ — renkten ayrıldığı tek yer burası. Renk yalnız "renk
    // veren" fasonda (boyahane) sorulur; en HER fason dönüşünde sorulur, çünkü
    // topun enini ilk kez burada öğreniyoruz (ham girişte en yazılmıyor). Yalnız
    // appliesColor'a bağlansaydı zımparadan dönen top sonsuza dek ensiz kalırdı.
    // Girilmediyse alan hiç GÖNDERİLMEZ (undefined) — `null` göndermek ile aynı
    // sonucu verir ama "ölçtüm ve boş" gibi okunur; sözleşme sessiz kalmayı seçer.
    ...(parseAppliedWidth(appliedWidth) != null
      ? { appliedWidth: parseAppliedWidth(appliedWidth) as number }
      : {}),
    returns,
    newRolls: parsed,
    // İdempotency: payload kurulurken BİR KEZ üretilir — offline kuyruk replay'i
    // aynı token'ı taşır. Kısmi teslimatta replay'in tek kimliği budur.
    clientToken: generateClientUuid(),
  };
}
