// Makine kartı (toplayıcı) tel tipleri — backend `COLLECTOR_PUBLIC_SELECT` izdüşümünün aynası.
// Sır bu tiplerde YOK: yalnız kayıt/yenileme cevabındaki `CollectorWithSecret.secret` taşır.

export interface CollectorMachine {
  machine: { id: string; code: string; name: string };
}

export interface MachineCollector {
  id: string;
  name: string;
  collectorType: string | null;
  status: string;
  isActive: boolean;
  secretIssuedAt: string | null;
  lastSeenAt: string | null;
  silentSince: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  machines: CollectorMachine[];
}

export interface CollectorWithSecret {
  collector: MachineCollector;
  /** 64 hex — kartın imza anahtarı; yalnız bu cevapta, bir kez. */
  secret: string;
}

/** Kayıt replay'i (aynı `clientToken`): kart kayıtlı, sır GÖSTERİLEMEZ — kurulum sır yenilemeyle yapılır. */
export interface CollectorSecretWithheld {
  collector: MachineCollector;
  secret: null;
  secretWithheld: true;
}

export type CollectorCreateResult = CollectorWithSecret | CollectorSecretWithheld;

export interface CollectorBody {
  name: string;
  collectorType: string;
  machineIds: string[];
}

/** Kayıt gövdesi — `clientToken` deneme başına (`useAttemptToken`), yalnız kayıtta. */
export interface CollectorCreateBody extends CollectorBody {
  clientToken: string;
}

export interface CollectorRevokeMachine {
  machineId: string;
  machineCode: string;
  machineName: string;
}

export interface CollectorRevokeStop extends CollectorRevokeMachine {
  stopId: string;
  startedAt: string;
  rawStopCode: string | null;
  reasonCode: string | null;
}

export interface CollectorRevokePending extends CollectorRevokeStop {
  endedAt: string | null;
  lateEndedAt: string | null;
}

/** `GET /:id/revoke/preview` — iptalin dokunacağı her kayıt, tezgah kodu sırasında, kırpılmaz. */
export interface CollectorRevokePreview {
  collector: MachineCollector;
  revocable: boolean;
  block: { code: string; message: string } | null;
  machines: CollectorRevokeMachine[];
  openStops: CollectorRevokeStop[];
  pendingEnds: CollectorRevokePending[];
}
