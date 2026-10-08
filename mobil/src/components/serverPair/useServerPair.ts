// Sunucu ekleme akışının durumu ve eylemleri (görünümden ayrı; ServerPairFlow yalnız adımları çizer).
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import { INTERNET_HOST_NOT_PINNABLE, decideQrAddressPin, pairViaQrHosts, parsePairAddress, parseTlsQr, type PairDecision } from '../../lib/lan-tls';
import { decideInternetPair, kipFor, type WebPkiObserved } from '../../lib/internet-tls';
import { completeInternetPairing, probeInternetServer } from '../../services/internetServers';
import type { DiscoveredServer } from '../../lib/discovery';
import { discoverServers } from '../../services/discovery.service';
import { completePairing } from '../../services/serverPairing';
import { probeTlsDetailed, type TlsProbed } from '../../services/tlsProbe';
import { useBaseUrlStore } from '../../store/baseUrlStore';

const PROBE_TIMEOUT_MS = 5000;
/** QR'daki her adres için (v2): cevap vermeyen adres ağ aramasını uzun bekletmesin. */
const QR_HOST_TIMEOUT_MS = 3000;

export type Step =
  | { kind: 'choose' }
  | { kind: 'address' }
  | { kind: 'qrSearch'; qrText: string; port: number }
  | { kind: 'qrAddress'; qrText: string; port: number }
  | { kind: 'confirm'; server: TlsProbed }
  | { kind: 'internetConfirm'; server: WebPkiObserved };

/** Ağda QR'daki izi taşıyan sunucu (ekleme kipi: sabit yönlendirmesi kapalı, QR'daki port). */
async function findQrServer(fingerprint: string, port: number, recentUrls: string[]): Promise<DiscoveredServer | undefined> {
  try {
    const res = await discoverServers({ mode: 'explicit', fullSweep: true, tlsRoute: false, tlsPort: port, preferredUrls: recentUrls });
    return res.candidates.find((c) => c.tls?.fingerprint === fingerprint);
  } catch {
    return undefined;
  }
}

function qrMatchDecision(qrText: string, match: DiscoveredServer): PairDecision {
  return decideQrAddressPin({
    qrText,
    observed: {
      host: match.host,
      port: match.port,
      fingerprint: match.tls?.fingerprint ?? '',
      installationId: match.identity?.installationId ?? null,
    },
    now: new Date().toISOString(),
  });
}

function usePairCore(onDone: () => void) {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const go = useCallback((next: Step) => {
    searchSeq.current += 1; // süren QR araması sonucunu artık uygulamaz
    setError(null);
    setStep(next);
  }, []);

  const finish = useCallback(
    async (decision: PairDecision) => {
      if (!decision.ok) {
        setError(decision.reason);
        return;
      }
      setBusy('Şifreli bağlantı kuruluyor…');
      try {
        const r = await completePairing(decision);
        if (!r.ok) {
          setError(r.reason);
          return;
        }
        Toast.show({ type: 'success', text1: 'Sunucu eklendi', text2: 'Bağlantı şifreli ve doğrulanmış.' });
        onDone();
      } finally {
        setBusy(null);
      }
    },
    [onDone],
  );

  const probe = useCallback(async (host: string, port: number, label: string): Promise<TlsProbed | null> => {
    setError(null);
    setBusy(label);
    try {
      const r = await probeTlsDetailed(host, port, PROBE_TIMEOUT_MS);
      if (r.ok) return r.server;
      setError(r.reason);
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  /** İnternet kipi: onaylı kayıt (kod yok; güven sistem deposundan). */
  const finishInternet = useCallback(
    async (server: WebPkiObserved, confirmed: boolean) => {
      const decision = decideInternetPair({ observed: server, confirmed, now: new Date().toISOString() });
      if (!decision.ok) {
        setError(decision.reason);
        return;
      }
      setBusy('Bağlantı kuruluyor…');
      try {
        const r = await completeInternetPairing(decision);
        if (!r.ok) {
          setError(r.reason);
          return;
        }
        Toast.show({ type: 'success', text1: 'Sunucu eklendi', text2: 'Bağlantı şifreli; internet sertifikasıyla doğrulandı.' });
        onDone();
      } finally {
        setBusy(null);
      }
    },
    [onDone],
  );

  return { step, busy, setBusy, error, setError, go, finish, finishInternet, probe, searchSeq };
}

export function useServerPair(onDone: () => void) {
  const recentUrls = useBaseUrlStore((s) => s.recentUrls);
  const core = usePairCore(onDone);
  const { go, finish, probe, setError, searchSeq } = core;
  const [address, setAddressRaw] = useState('');

  const setAddress = (v: string) => {
    setAddressRaw(v);
    setError(null);
  };

  // (b) adres → yoklama → kod onayı
  const probeAddress = useCallback(
    async (host: string, port: number) => {
      const server = await probe(host, port, 'Sunucunun doğrulama kodu okunuyor…');
      if (server) go({ kind: 'confirm', server });
    },
    [probe, go],
  );

  // (b') izinli üst alandaki ad → sistem doğrulaması → onay (kod yok)
  const probeInternet = useCallback(
    async (host: string, port: number) => {
      setError(null);
      core.setBusy('Sunucu internet sertifikasıyla doğrulanıyor…');
      try {
        const r = await probeInternetServer(host, port, PROBE_TIMEOUT_MS);
        if (r.ok) go({ kind: 'internetConfirm', server: r.server });
        else setError(r.reason);
      } finally {
        core.setBusy(null);
      }
    },
    [core, go, setError],
  );

  const submitAddress = () => {
    const a = parsePairAddress(address);
    if (!a.ok) setError(a.reason);
    else if (kipFor(a.host) === 'internet') void probeInternet(a.host, a.port);
    else void probeAddress(a.host, a.port);
  };

  // (a) QR → QR'daki adresler (v2) → ağda bu izi taşıyan sunucu → yoksa adres
  const onQr = async (text: string) => {
    const qr = parseTlsQr(text);
    if (!qr) {
      go({ kind: 'choose' });
      setError("Bu bir şifreli bağlantı QR'ı değil. Panelde Cihazlar → “Tablet için şifreli bağlantı” QR'ını okutun.");
      return;
    }
    go({ kind: 'qrSearch', qrText: text, port: qr.advert.port });
    const seq = searchSeq.current;
    const direct = await pairViaQrHosts({
      qrText: text,
      probe: async (host, port) => {
        const r = await probeTlsDetailed(host, port, QR_HOST_TIMEOUT_MS);
        return r.ok ? r.server : null;
      },
      now: () => new Date().toISOString(),
      stillWanted: () => seq === searchSeq.current,
    });
    if (seq !== searchSeq.current) return;
    if (direct) {
      await finish(direct);
      return;
    }
    const match = await findQrServer(qr.advert.fingerprint, qr.advert.port, recentUrls);
    if (seq !== searchSeq.current) return;
    if (!match) go({ kind: 'qrAddress', qrText: text, port: qr.advert.port });
    else await finish(qrMatchDecision(text, match));
  };

  const submitQrAddress = async (qrText: string, port: number) => {
    const a = parsePairAddress(address, port);
    if (!a.ok) {
      setError(a.reason);
      return;
    }
    if (kipFor(a.host) === 'internet') {
      setError(INTERNET_HOST_NOT_PINNABLE);
      return;
    }
    const server = await probe(a.host, port, 'Sunucu doğrulanıyor…');
    if (server) await finish(decideQrAddressPin({ qrText, observed: server, now: new Date().toISOString() }));
  };

  return { ...core, recentUrls, address, setAddress, probeAddress, submitAddress, onQr, submitQrAddress };
}
