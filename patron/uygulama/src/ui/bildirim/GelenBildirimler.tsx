// Gelen bildirimler (ERP kipi, `yetenek().bildirimKutusu`): fabrikanın kişisel gelen kutusu — Okunmamış/Tümü, okunmamış
// sayısı, dokununca okundu, tümünü okundu. Satır biçimi bulut "Geçmiş"iyle aynı (`BildirimSatiri`). Süzme SUNUCUDA.
// Canlılık: `useRemote` (odak, öne gelme, aşağı çek) + odakta ve ön plandayken `/ozet` 60 sn'de bir; sürüm
// (`epoch:rev`) değişince liste tazelenir.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import type { BildirimSekmesi, GelenBildirim } from "../../api/bildirim";
import { errorMessage } from "../../api/client";
import { erpBildirimGorunusu, okunmamisRozeti } from "../../lib/erp-bildirim";
import { formatAgo } from "../../lib/format";
import { invalidate } from "../../state/changes";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";
import { GroupNote } from "../diger/parts";
import { useSettlePoll } from "../diger/useSettlePoll";
import { Screen } from "../Frame";
import { EMPTY_ICON } from "../icons";
import { Banner, Button } from "../kit";
import { ListGroup } from "../ListRow";
import { SegmentedControl } from "../SegmentedControl";
import { Empty, ErrorState, LoadingSkeleton } from "../StateViews";
import { StatusBadge } from "../StatusBadge";
import { space } from "../tokens";
import { BildirimSatiri } from "./BildirimSatiri";

/** Geçersizleştirme etiketi: liste, özet ve Diğer rozeti birlikte tazelenir. */
export const BILDIRIM_TAG = "bildirim-kutusu";
/** Özet yoklaması: 60 sn aralık, odak başına 30 dk bütçe (yeniden odakta baştan). */
export const BILDIRIM_YOKLAMA_MS: readonly number[] = Array.from({ length: 30 }, () => 60_000);
const SAYFA = 30;

const EMPTY: Readonly<Record<BildirimSekmesi, string>> = {
  okunmamis: "Okunmamış bildirim yok",
  tumu: "Henüz bildirim yok",
};

function rozet(n: GelenBildirim) {
  if (n.okunduAn === null) return <StatusBadge kind="bilgi" label="Okunmadı" size="sm" />;
  if (n.cozulduAn !== null) return <StatusBadge kind="iyi" label="Çözüldü" size="sm" />;
  return null;
}

export function GelenBildirimler() {
  const { bildirimci, offline } = useSession();
  const [sekme, setSekme] = useState<BildirimSekmesi>("okunmamis");
  const ozet = useRemote("bildirim-ozet", () => bildirimci.ozet(), { tags: [BILDIRIM_TAG] });
  const list = useRemote(`${BILDIRIM_TAG}:${sekme}`, () => bildirimci.liste({ sekme, limit: SAYFA }), { tags: [BILDIRIM_TAG] });
  const [more, setMore] = useState<{ items: GelenBildirim[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setMore(null), [list.data]);

  useSettlePoll(true, ozet.reload, BILDIRIM_YOKLAMA_MS);
  const surum = ozet.data ? `${ozet.data.epoch ?? ""}:${ozet.data.rev ?? ""}` : null;
  const seen = useRef<string | null>(null);
  const reloadList = useRef(list.reload);
  reloadList.current = list.reload;
  useEffect(() => {
    if (surum === null) return;
    if (seen.current !== null && seen.current !== surum) reloadList.current();
    seen.current = surum;
  }, [surum]);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    if (offline) return setError("Çevrimdışısınız; değişiklik yapılamaz");
    setBusy(key);
    setError(null);
    try {
      await fn();
      setMore(null);
      invalidate([BILDIRIM_TAG]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [offline]);

  async function loadMore(cursor: string) {
    setBusy("daha");
    try {
      const p = await bildirimci.liste({ sekme, cursor, limit: SAYFA });
      setMore((o) => ({ items: [...(o?.items ?? []), ...p.items], next: p.nextCursor }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const okunmamis = okunmamisRozeti(ozet.data?.okunmamis);
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])];
  const next = more ? more.next : list.offline ? null : (list.data?.nextCursor ?? null);
  const reload = () => {
    ozet.reload();
    list.reload();
  };
  const shell = (children: ReactNode) => (
    <Screen module="bildirimler" onRefresh={reload} refreshing={list.refreshing}>{children}</Screen>
  );
  if (ozet.data?.enabled === false) {
    return shell(<Empty icon={EMPTY_ICON.bildirim} text="Fabrikada bildirimler kapalı; yönetici panelden açınca burada görünür" testID="bildirim-kapali" />);
  }
  const tabs = [
    { key: "okunmamis" as const, label: okunmamis ? `Okunmamış (${okunmamis})` : "Okunmamış" },
    { key: "tumu" as const, label: "Tümü" },
  ];
  return shell(
    <>
      <View style={{ marginBottom: space.m }}>
        <SegmentedControl items={tabs} value={sekme} onChange={setSekme} testIDPrefix="bildirim-sekme-" accessibilityLabel="Bildirim süzgeci" />
      </View>
      <GroupNote>{okunmamis ? `${okunmamis} okunmamış bildirim. Okundu saymak için bildirime dokunun.` : "Fabrikanın size gönderdiği bildirimler."}</GroupNote>
      {list.loading && !list.data ? <LoadingSkeleton rows={4} /> : null}
      {list.error && !list.data ? <ErrorState text={list.error} onRetry={reload} /> : null}
      {list.data && items.length === 0 ? <Empty icon={EMPTY_ICON.bildirim} text={EMPTY[sekme]} testID="bildirim-bos" /> : null}
      {items.length > 0 ? (
        <ListGroup testID="bildirim-kutusu">
          {items.map((n) => {
            const unread = n.okunduAn === null;
            return (
              <BildirimSatiri key={n.id} look={erpBildirimGorunusu(n.tur)} title={n.baslik} body={n.govde} badge={rozet(n)}
                time={n.sayac > 1 ? `${formatAgo(n.sonAn)} · ${n.sayac} kez` : formatAgo(n.sonAn)}
                onPress={unread && !offline && busy === null ? () => void run(n.id, () => bildirimci.okundu(n.id)) : undefined}
                accessibilityRole="button" accessibilityLabel={unread ? `${n.baslik}, okunmadı; okundu saymak için dokunun` : undefined}
                testID={`bildirim-${n.id}`} />
            );
          })}
        </ListGroup>
      ) : null}
      {error ? <Banner tone="error" text={error} testID="bildirim-kutusu-hata" /> : null}
      {next ? <Button label="Daha fazla" tone="plain" icon="chevron-down" busy={busy === "daha"} disabled={offline} onPress={() => void loadMore(next)} testID="bildirim-daha" /> : null}
      {okunmamis ? (
        <Button label="Tümünü okundu say" tone="plain" icon="checkmark-done-outline" busy={busy === "hepsi"} disabled={offline || busy !== null}
          onPress={() => void run("hepsi", () => bildirimci.tumunuOkundu())} testID="tumunu-okundu" />
      ) : null}
    </>,
  );
}
