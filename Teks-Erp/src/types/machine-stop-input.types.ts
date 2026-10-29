// =============================================================================
// Tezgah duruşu — yazma yollarının GİRDİ tipleri (machine-stop.service boyut tavanı)
// =============================================================================
import type { MachineDataSource, MachineSignalKind, MachineStopEndSource } from "@prisma/client";
import type { ReplayAlani } from "../services/helpers/idempotent-replay.helper";
import type { StampResolution } from "../services/helpers/machine-run-open.helper";
import type { MachineStopDto } from "../services/helpers/machine-stop-context.helper";

export interface OpenManualStopInput {
  machineId: string;
  /** İstemci damgası; yoksa sunucu saati. Aralık dışı: OPERATÖR → sunucu saati + uyarı, AMİR → 400 (`resolveStopStamp`). */
  startedAt?: Date | null;
  /** Açılışta sebep verilebilir; verilmezse sınıflandırma borcu (`requiresReason`) doğar. */
  reasonCode?: string | null;
  reasonNote?: string | null;
  beamSlot?: number | null;
  /** Elle girişte KİMLİK: replay aynı anahtarla aynı satırı döner. Yoksa sunucu üretir. */
  clientToken?: string | null;
  /** Kim giriyor — operatör (tablet) mı, vardiya amiri (panel) mi. */
  source?: Extract<MachineDataSource, "OPERATOR" | "SUPERVISOR">;
}

export interface ClassifyStopInput {
  reasonCode: string;
  reasonNote?: string | null;
  beamSlot?: number | null;
}

export interface ReclassifyStopInput {
  /** Beklenen mevcut kod — claim'in çıpası (yarışta bayat karar üzerine yazılmasın). */
  fromReasonCode: string;
  toReasonCode: string;
  /** Değişikliğin gerekçesi — reclass satırına yazılır. */
  reason?: string | null;
  /** Olayın YENİ notu (verilirse). Eski not yerinde ezilmez: reclass satırında saklanır (F3). */
  reasonNote?: string | null;
}

export interface OpenManualStopOptions {
  /** Geçmiş saatle açılışta kapanmış duruşla örtüşmeyi tx içinde reddet (toplu açılış; tekli uç bugünkü davranışta). */
  rejectOverlap?: boolean;
  /** Yalnız `mobile:makine-durus` taşıyan istek: kurşun/brode/tambur dışı makine 403 (D4-A1). */
  generalKindsOnly?: boolean;
}

/** Makine kaynaklı alanlar — yalnız sinyal yolu (`machine-stop-signal.service`) doldurur; insan yolu HİÇ yazmaz. */
export interface StopSignalFields {
  signalKind: MachineSignalKind | null;
  rawStopCode: string | null;
  collectorId: string | null;
}

/** Açılış çekirdeğinin girdisi — damga ve kaynak giriş fonksiyonunda çözülmüş gelir. */
export interface OpenStopCoreInput {
  machineId: string;
  stopKey: string;
  started: StampResolution;
  source: MachineDataSource;
  reasonCode?: string | null;
  reasonNote?: string | null;
  beamSlot?: number | null;
  /** Açan kişi (insan yolu); makine yolunda NULL — `openedById` gövdeden ya da sinyalden yazılmaz. */
  actorId: string | null;
  signal?: StopSignalFields;
  /** Aynı `stopKey` ile gelen yükün kimlik alanları — farklıysa 409 `CLIENT_TOKEN_COLLISION`. */
  fingerprint: (existing: MachineStopDto) => ReplayAlani[];
}

/** Kapanışı kim yaptı — insan (`OPERATOR`, kişi zorunlu değil) ya da makine sinyali (`SIGNAL`, kişi yok). */
export interface StopCloser {
  /** WATCHDOG yalnız watchdog job'u (geçici kapanış, `provisionalEndedAt` aynı değerle damgalanır). */
  endSource: Extract<MachineStopEndSource, "OPERATOR" | "SIGNAL" | "WATCHDOG">;
  actorId: string | null;
}
