// =============================================================================
// beamLabelQueue — levent etiketi kuyruğu: başarısız iş SİLİNMEZ, tekrar bekleyene döner
// =============================================================================
//   §1 ekle tekildir; Tekrar bas (yeniden ekle) hatayı düşürür
//   §2 başarı işi düşürür; hata işi `error`la tutar, sıradaki bekleyen onu atlar
//   §3 TTL + tavan budaması
//   §4 depo: hydrate MERGE — hydrate'ten önce eklenen iş ezilmez; diske yazılır
//   §5 sarım yanıtı → levent + raşel kardeşleri kuyruğa
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BEAM_LABEL_QUEUE_MAX, BEAM_LABEL_TTL_MS, enqueueJob, enqueueWoundLabels, markJobDone, markJobFailed, nextPending, pruneJobs, useBeamLabelQueue } from './beamLabelQueue';

const T = 1_000_000_000;

describe('beamLabelQueue saf', () => {
  it('§1 aynı levent tek iş; yeniden ekleme hatayı düşürür', () => {
    let jobs = enqueueJob([], 'b1', 'LV-1', T);
    jobs = markJobFailed(jobs, 'b1', 'yazıcı yok');
    expect(nextPending(jobs)).toBeNull();
    jobs = enqueueJob(jobs, 'b1', 'LV-1', T + 1);
    expect(jobs).toEqual([{ beamId: 'b1', beamNo: 'LV-1', queuedAt: T + 1 }]);
    expect(nextPending(jobs)?.beamId).toBe('b1');
  });
  it('§2 başarı düşer; hata kalır ve sıradaki bekleyen seçilir', () => {
    let jobs = enqueueJob(enqueueJob([], 'b1', 'LV-1', T), 'b2', 'LV-2', T);
    jobs = markJobFailed(jobs, 'b1', '  ');
    expect(jobs[0]!.error).toBe('Yazıcıya gönderilemedi');
    expect(nextPending(jobs)?.beamId).toBe('b2');
    jobs = markJobDone(jobs, 'b2');
    expect(jobs.map((j) => j.beamId)).toEqual(['b1']);
  });
  it('§3 TTL dışı düşer, tavan en yenileri tutar', () => {
    expect(pruneJobs([{ beamId: 'o', beamNo: 'O', queuedAt: T - BEAM_LABEL_TTL_MS - 1 }], T)).toEqual([]);
    const many = Array.from({ length: BEAM_LABEL_QUEUE_MAX + 5 }, (_, i) => ({ beamId: `b${i}`, beamNo: `LV${i}`, queuedAt: T }));
    const kept = pruneJobs(many, T);
    expect(kept).toHaveLength(BEAM_LABEL_QUEUE_MAX);
    expect(kept[kept.length - 1]!.beamId).toBe(`b${BEAM_LABEL_QUEUE_MAX + 4}`);
  });
});

describe('beamLabelQueue depo', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useBeamLabelQueue.setState({ jobs: [], activeId: null, hydrated: false });
  });
  it('§4 hydrate MERGE: bellekteki yeni iş korunur, diskteki eklenir; değişiklik diske yazılır', async () => {
    await AsyncStorage.setItem('TEKSERP_BEAM_LABEL_QUEUE_V1', JSON.stringify({ jobs: [{ beamId: 'd1', beamNo: 'LV-D', queuedAt: Date.now(), error: 'x' }, { bozuk: true }] }));
    useBeamLabelQueue.getState().enqueue('m1', 'LV-M');
    await useBeamLabelQueue.getState().hydrate();
    expect(useBeamLabelQueue.getState().jobs.map((j) => j.beamId).sort()).toEqual(['d1', 'm1']);
    useBeamLabelQueue.getState().fail('m1', 'kâğıt bitti');
    await new Promise((r) => setTimeout(r, 0));
    const disk = JSON.parse((await AsyncStorage.getItem('TEKSERP_BEAM_LABEL_QUEUE_V1')) ?? '{}');
    expect(disk.jobs.find((j: { beamId: string }) => j.beamId === 'm1').error).toBe('kâğıt bitti');
  });

  it('§5 sarım yanıtı: levent + kardeşler, null yanıt hiçbir şey', () => {
    useBeamLabelQueue.setState({ hydrated: true });
    enqueueWoundLabels(null);
    expect(useBeamLabelQueue.getState().jobs).toEqual([]);
    enqueueWoundLabels({ id: 'b1', beamNo: 'LV-1', siblings: [{ id: 'b2', beamNo: 'LV-2' }] });
    expect(useBeamLabelQueue.getState().jobs.map((j) => j.beamNo)).toEqual(['LV-1', 'LV-2']);
  });
});
