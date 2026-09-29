// Rapor isteği: aralık + (varsa) ek parametre → BEKLIYOR; fabrika hesaplayıp sonucu yollar.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { catalogEntries, buildReportParams, extraParamNames, requestable } from "../../../src/lib/reports";
import { humanize } from "../../../src/lib/present";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button, Field, Muted, Title } from "../../../src/ui/kit";
import { useWrite } from "../../../src/ui/useWrite";

export default function NewReport() {
  const params = useLocalSearchParams<Record<string, string>>();
  const key = String(params.anahtar ?? "");
  const { api, permissions } = useSession();
  const router = useRouter();
  const catalog = useRemote("anlik:rapor-katalogu", () => api.snapshot("rapor-katalogu"));
  const entry = catalogEntries(catalog.data?.veri).find((e) => e.anahtar === key);
  const prefill = Object.fromEntries(Object.entries(params).filter(([k, v]) => k !== "anahtar" && typeof v === "string")) as Record<string, string>;
  const names = [...new Set([...extraParamNames(entry?.parametreler), ...Object.keys(prefill)])];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>(prefill);
  const built = buildReportParams(from, to, extra);
  const send = useCallback((id: string) => (built.ok ? api.reportCreate(id, key, built.params) : Promise.reject(new Error(built.error))), [api, built, key]);
  const w = useWrite(send);
  const allowed = requestable(key, permissions);

  async function submit() {
    if (!built.ok) return w.setError(built.error);
    const r = await w.run(JSON.stringify(built.params));
    if (r) router.replace({ pathname: "/raporlar/[id]", params: { id: r.id } } as never);
  }

  return (
    <Screen title="Rapor iste" module="raporlar" back>
      <Title>{entry?.baslik ?? key}</Title>
      {!allowed ? <Banner tone="error" text="Bu raporu isteme yetkiniz yok" /> : null}
      <Muted>Boş bırakılan aralıkta raporun kendi varsayılan dönemi kullanılır.</Muted>
      <Field label="Başlangıç (GG.AA.YYYY)" value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" testID="rapor-baslangic" />
      <Field label="Bitiş (GG.AA.YYYY)" value={to} onChangeText={setTo} keyboardType="numbers-and-punctuation" testID="rapor-bitis" />
      {names.map((n) => (
        <Field key={n} label={humanize(n)} value={extra[n] ?? ""} onChangeText={(t) => setExtra((o) => ({ ...o, [n]: t }))} autoCapitalize="none" />
      ))}
      {w.error ? <Banner tone="error" text={w.error} /> : null}
      <Button label="İste" busy={w.busy} disabled={w.disabled || !allowed} onPress={() => void submit()} testID="rapor-iste" />
    </Screen>
  );
}
