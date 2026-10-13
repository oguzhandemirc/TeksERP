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

export interface CollectorBody {
  name: string;
  collectorType: string;
  machineIds: string[];
}
