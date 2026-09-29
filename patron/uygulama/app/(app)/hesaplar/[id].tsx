// Hesap ayrıntısı: izinler (bulut kataloğundan), durum geçişi (onaylı), daveti yenile.
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";
import type { Account, AccountInviteResult } from "../../../src/api/wire";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Badge, Banner, Body, Button, Card, ConfirmButton, Loading, Muted, Title } from "../../../src/ui/kit";
import { InviteShown } from "../../../src/ui/InviteShown";
import { TOUCH, color } from "../../../src/ui/theme";
import { useWrite } from "../../../src/ui/useWrite";

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const list = useRemote("hesaplar", () => api.accountList());
  const catalog = useRemote("izinler", () => api.permissions());
  const [acc, setAcc] = useState<Account | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [invite, setInvite] = useState<AccountInviteResult | null>(null);
  useEffect(() => {
    const a = list.data?.find((x) => x.id === id) ?? null;
    setAcc(a);
    if (a) setPerms([...a.izinler]);
  }, [list.data, id]);

  const save = useWrite(useCallback((t: string) => api.accountUpdate(String(id), { clientToken: t, izinler: perms }), [api, id, perms]));
  // Hedef durum ref'te: aynı dokunuşta yazılıp okunur (state güncellemesi bir sonraki render'a kalır).
  const target = useRef<"AKTIF" | "KILITLI" | "PASIF">("KILITLI");
  const setTarget = (t: "AKTIF" | "KILITLI" | "PASIF") => { target.current = t; };
  const status = useWrite(useCallback((t: string) => api.accountStatus(String(id), { clientToken: t, durum: target.current }), [api, id]));
  const reset = useWrite(useCallback((t: string) => api.accountReset(String(id), t), [api, id]));
  const toggle = (p: string) => setPerms((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]));
  const apply = async <T,>(w: { run: (k?: string) => Promise<T | null> }, key: string, then: (r: T) => void) => { const r = await w.run(key); if (r) then(r); };

  if (list.loading && !list.data) return <Screen title="Hesap" module="hesaplar" back><Loading /></Screen>;
  if (list.error && !list.data) return <Screen title="Hesap" module="hesaplar" back><ErrorBox text={list.error} onRetry={list.reload} /></Screen>;
  if (!acc) return <Screen title="Hesap" module="hesaplar" back><Muted>Hesap bulunamadı</Muted></Screen>;
  const err = save.error ?? status.error ?? reset.error;
  return (
    <Screen title={acc.ad} module="hesaplar" back>
      <Card><Body>{acc.eposta}</Body><Badge status={acc.durum} /></Card>
      {invite ? <InviteShown r={invite} /> : null}
      {err ? <Banner tone="error" text={err} /> : null}
      <Title>İzinler</Title>
      {(catalog.data?.izinler ?? []).map((p) => (
        <Pressable key={p} accessibilityRole="checkbox" accessibilityState={{ checked: perms.includes(p) }} onPress={() => toggle(p)} style={{ minHeight: TOUCH, justifyContent: "center" }}>
          <Text style={{ fontSize: 16, color: color.text }}>{`${perms.includes(p) ? "☑" : "☐"}  ${p}`}</Text>
        </Pressable>
      ))}
      <Button label="İzinleri kaydet" busy={save.busy} disabled={save.disabled} onPress={() => void apply(save, JSON.stringify(perms), (r: Account) => { setAcc(r); list.reload(); })} />
      <Title>Durum</Title>
      {acc.durum !== "AKTIF" && acc.durum !== "DAVETLI" ? (
        <Button label="Etkinleştir" tone="plain" busy={status.busy} onPress={() => { setTarget("AKTIF"); void apply(status, "AKTIF", () => list.reload()); }} />
      ) : null}
      {acc.durum === "AKTIF" ? (
        <ConfirmButton label="Kilitle" question="Hesap kilitlensin mi? Açık oturumları düşer." busy={status.busy} onConfirm={() => { setTarget("KILITLI"); void apply(status, "KILITLI", () => list.reload()); }} />
      ) : null}
      {acc.durum !== "PASIF" ? (
        <ConfirmButton label="Arşive al" question="Hesap arşive alınsın mı? Giriş yapamaz." busy={status.busy} onConfirm={() => { setTarget("PASIF"); void apply(status, "PASIF", () => list.reload()); }} />
      ) : null}
      <ConfirmButton label="Daveti yenile / parola sıfırla" question="Yeni davet kodu üretilsin mi? Hesap yeniden kurulum yapar." busy={reset.busy} onConfirm={() => void apply(reset, "sifirla", (r: AccountInviteResult) => { setInvite(r); list.reload(); })} />
    </Screen>
  );
}
