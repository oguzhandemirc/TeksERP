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

/** buildReceivePayload'ın satırlardan (rows) ihtiyaç duyduğu minimal şekil. */
export interface PayloadRollRow {
  rollId: string;
  checked: boolean;
  notes: string;
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
  } = args;

  if (!selectedGroup) return null;
  const subId =
    selectedParty?.subcontractorId ?? selectedGroup.lastDispatch?.subcontractorId;
  if (!subId) return null;

  const returns = rows
    .filter((r) => r.checked)
    .map((r) => ({ rollId: r.rollId, notes: r.notes.trim() || null }));
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
  };
}
