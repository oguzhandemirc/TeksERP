// Tek koşum: saklı sonuç + iki adımlı "Sil" (kendi koşumu; sunucuda soft delete). Silinince liste ve son koşum
// `rapor` etiketiyle tazelenir, ekran geri döner.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { reportTitle } from "../../../lib/labels/finans";
import { raporHataIletisi } from "../../../lib/rapor-anlik";
import { invalidate } from "../../../state/changes";
import { useSession } from "../../../state/session";
import { useRemote } from "../../../state/useRemote";
import { Screen } from "../../Frame";
import { Banner, ConfirmButton } from "../../kit";
import { ErrorState, LoadingSkeleton } from "../../StateViews";
import { space } from "../../tokens";
import { KosumSonucu } from "./KosumSonucu";
import { RAPOR_TAGS } from "./Liste";
import { kosumKey } from "./RaporEkrani";

export function AnlikKosum() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { raporcu, offline } = useSession();
  const router = useRouter();
  const r = useRemote(id ? kosumKey(String(id)) : null, () => raporcu.kosum(String(id)), { tags: RAPOR_TAGS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = r.data;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await raporcu.sil(String(id));
      invalidate(RAPOR_TAGS);
      router.back();
    } catch (err) {
      setError(raporHataIletisi(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={d ? (d.baslik ?? reportTitle(d.raporAnahtari)) : "Rapor"} module="raporlar" back onRefresh={r.reload} refreshing={r.refreshing}>
      {r.loading && !d ? <LoadingSkeleton rows={4} /> : null}
      {r.error && !d ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {d ? (
        <>
          <KosumSonucu kosum={d} />
          {error ? <Banner tone="error" text={error} testID="kosum-sil-hata" /> : null}
          {d.durum !== "HESAPLANIYOR" ? (
            <View style={{ marginTop: space.l }}>
              <ConfirmButton label="Sil" question="Bu rapor silinsin mi?" busy={busy} disabled={offline} onConfirm={() => void remove()} testID="kosum-sil" />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
