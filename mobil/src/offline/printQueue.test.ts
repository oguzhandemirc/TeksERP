// =============================================================================
// Bekçi: kalıcı yazıcı kuyruğu (printQueue)
// =============================================================================
// Kapattığı delik (07.08 vakası): yazıcı kuyruğu + başarısızlar ekran
// state'indeydi; uygulama kapanınca liste siliniyordu ve kesintide biriken
// etiketlerin izi kayboluyordu → operatör topları yeniden girip stokta hayalet
// top üretiyordu. Bu testler store'un davranış sözleşmesini kilitler:
//   • dedup (çift dokunuş 2 kâğıt basmaz)
//   • at-least-once (aktif iş persist edilmez ama listede kalır)
//   • otomatik yeniden deneme YALNIZ retryable + tavanlı (sonsuz osilasyon yok)
//   • sınıflandırma: yalnız fetch + yanıtsız/5xx retryable
// =============================================================================

import {
  classifyPrintRetry,
  prunePrintJobs,
  pruneVerifies,
  usePrintQueue,
  PRINT_AUTO_RETRY_MAX,
  PRINT_JOB_TTL_MS,
  PRINT_QUEUE_MAX,
  VERIFY_MAX,
  type PrintJob,
  type VerifyItem,
} from './printQueue';
import type { Roll } from '../types/models';

const roll = (id: string): Roll =>
  ({ id, barcode: `T-${id}`, item: { name: 'KUMAS' } }) as unknown as Roll;

const job = (id: string, extra?: Partial<PrintJob>): PrintJob => ({
  roll: roll(id),
  queuedAt: Date.now(),
  autoRetries: 0,
  lastAuto: false,
  ...extra,
});

beforeEach(() => {
  usePrintQueue.setState({ jobs: [], verifies: [], activeId: null, hydrated: true });
});

describe('printQueue — kuyruk davranışı', () => {
  it('enqueue: aynı top bekliyorken İKİNCİ ekleme NO-OP (çift dokunuş = tek kâğıt)', () => {
    const s = usePrintQueue.getState();
    s.enqueue(roll('a'));
    s.enqueue(roll('a'));
    expect(usePrintQueue.getState().jobs).toHaveLength(1);
  });

  it('enqueue: BAŞARISIZ iş yeniden istenince bekleyene döner (sayaç sıfır)', () => {
    usePrintQueue.setState({
      jobs: [job('a', { error: 'BT hatası', failedAt: Date.now(), autoRetries: 2 })],
    });
    usePrintQueue.getState().enqueue(roll('a'));
    const j = usePrintQueue.getState().jobs[0];
    expect(j.error).toBeUndefined();
    expect(j.autoRetries).toBe(0);
  });

  it('pompa: startNext ilk BEKLEYENİ aktif yapar, başarısızı atlar', () => {
    usePrintQueue.setState({
      jobs: [job('x', { error: 'düştü' }), job('y')],
    });
    usePrintQueue.getState().startNext();
    expect(usePrintQueue.getState().activeId).toBe('y');
  });

  it('resolveActive(ok): iş düşer, aktif boşalır', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    const res = usePrintQueue.getState().resolveActive({ ok: true, cancelled: false });
    expect(res.failed).toBe(false);
    expect(usePrintQueue.getState().jobs).toHaveLength(0);
    expect(usePrintQueue.getState().activeId).toBeNull();
  });

  it('resolveActive(iptal): iş DÜŞER — iptal başarısızlık değildir (yanlış alarm yok)', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    usePrintQueue.getState().resolveActive({ ok: false, cancelled: true });
    expect(usePrintQueue.getState().jobs).toHaveLength(0);
  });

  it('resolveActive(hata): iş başarısız işaretlenir, retryable taşınır, aktif boşalır', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    const res = usePrintQueue
      .getState()
      .resolveActive({ ok: false, cancelled: false, retryable: true, error: 'timeout' });
    expect(res.failed).toBe(true);
    const j = usePrintQueue.getState().jobs[0];
    expect(j.error).toBe('timeout');
    expect(j.retryable).toBe(true);
    expect(usePrintQueue.getState().activeId).toBeNull();
  });

  it('finishActive: onResult ÇAĞRILMAYAN yol (barkodsuz top) aktif işi askıda bırakmaz', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    usePrintQueue.getState().finishActive('a');
    expect(usePrintQueue.getState().jobs).toHaveLength(0);
    expect(usePrintQueue.getState().activeId).toBeNull();
  });

  it('finishActive: onResult zaten çözdüyse NO-OP (başarısız iş listede KALIR)', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    usePrintQueue.getState().resolveActive({ ok: false, cancelled: false, error: 'x' });
    usePrintQueue.getState().finishActive('a'); // onDone güvenlik ağı
    expect(usePrintQueue.getState().jobs).toHaveLength(1); // başarısız satır durur
  });

  it('removeJob: aktif iş ÇIKARILAMAZ', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    usePrintQueue.getState().removeJob('a');
    expect(usePrintQueue.getState().jobs).toHaveLength(1);
  });

  it('retryAllFailed: tüm başarısızlar bekleyene döner (banttaki tek dokunuş)', () => {
    usePrintQueue.setState({
      jobs: [job('a', { error: 'x' }), job('b', { error: 'y' }), job('c')],
    });
    usePrintQueue.getState().retryAllFailed();
    expect(usePrintQueue.getState().jobs.every((j) => !j.error)).toBe(true);
  });
});

describe('printQueue — otomatik yeniden deneme (ağ dönüşü)', () => {
  it('yalnız retryable işler döner; BT/yapılandırma hatası ELLE bekler', () => {
    usePrintQueue.setState({
      jobs: [
        job('net', { error: 'timeout', retryable: true }),
        job('bt', { error: 'BT soketi', retryable: false }),
      ],
    });
    const n = usePrintQueue.getState().requeueRetryable();
    expect(n).toBe(1);
    const jobs = usePrintQueue.getState().jobs;
    expect(jobs.find((j) => j.roll.id === 'net')!.error).toBeUndefined();
    expect(jobs.find((j) => j.roll.id === 'net')!.lastAuto).toBe(true);
    expect(jobs.find((j) => j.roll.id === 'bt')!.error).toBe('BT soketi');
  });

  it(`tavan: ${PRINT_AUTO_RETRY_MAX} otomatik denemeden sonra iş elle bekler (osilasyon kesici)`, () => {
    usePrintQueue.setState({
      jobs: [job('net', { error: 'timeout', retryable: true, autoRetries: PRINT_AUTO_RETRY_MAX })],
    });
    expect(usePrintQueue.getState().requeueRetryable()).toBe(0);
    expect(usePrintQueue.getState().jobs[0].error).toBe('timeout');
  });

  it('otomatik denemenin düşüşü wasAuto=true döner (online-only modal spam kilidi)', () => {
    usePrintQueue.setState({
      jobs: [job('net', { error: 'timeout', retryable: true })],
    });
    usePrintQueue.getState().requeueRetryable();
    usePrintQueue.setState({ activeId: 'net' }); // pompa aldı
    const res = usePrintQueue
      .getState()
      .resolveActive({ ok: false, cancelled: false, retryable: true, error: 'yine timeout' });
    expect(res.wasAuto).toBe(true);
    // Elle denemenin düşüşü ise wasAuto=false olmalı:
    usePrintQueue.getState().retryJob('net');
    usePrintQueue.setState({ activeId: 'net' });
    const res2 = usePrintQueue
      .getState()
      .resolveActive({ ok: false, cancelled: false, error: 'BT' });
    expect(res2.wasAuto).toBe(false);
  });
});

describe('printQueue — scan-back (etiket geri-okutma)', () => {
  it('resolveActive(ok) printedRoll döner; İPTAL borç doğurmaz (printedRoll null)', () => {
    usePrintQueue.setState({ jobs: [job('a')], activeId: 'a' });
    const ok = usePrintQueue.getState().resolveActive({ ok: true, cancelled: false });
    expect(ok.printedRoll?.id).toBe('a');
    usePrintQueue.setState({ jobs: [job('b')], activeId: 'b' });
    const cancel = usePrintQueue.getState().resolveActive({ ok: false, cancelled: true });
    expect(cancel.printedRoll).toBeNull();
  });

  it('addVerify: rollId ile dedup; BARKODSUZ top borç doğurmaz', () => {
    const s = usePrintQueue.getState();
    s.addVerify(roll('a'));
    s.addVerify(roll('a')); // yeniden basım — ikinci borç yok
    s.addVerify({ id: 'x', barcode: null } as unknown as Roll); // açık kumaş
    expect(usePrintQueue.getState().verifies).toHaveLength(1);
  });

  it('confirmVerify: doğru kod borcu düşürür, yanlış kod dokunmaz', () => {
    usePrintQueue.getState().addVerify(roll('a')); // barcode T-a
    expect(usePrintQueue.getState().confirmVerify('YANLIS-KOD')).toBe('unknown');
    expect(usePrintQueue.getState().verifies).toHaveLength(1);
    expect(usePrintQueue.getState().confirmVerify('  T-a  ')).toBe('ok'); // trim
    expect(usePrintQueue.getState().verifies).toHaveLength(0);
  });

  it(`pruneVerifies: TTL + tavan (${VERIFY_MAX})`, () => {
    const now = Date.now();
    const v = (id: string, printedAt: number): VerifyItem => ({
      rollId: id,
      barcode: `T-${id}`,
      printedAt,
    });
    const out = pruneVerifies(
      [v('old', now - PRINT_JOB_TTL_MS - 1), v('new', now)],
      now,
    );
    expect(out.map((x) => x.rollId)).toEqual(['new']);
    const many = Array.from({ length: VERIFY_MAX + 3 }, (_, i) => v(`v${i}`, now - (VERIFY_MAX + 3 - i)));
    expect(pruneVerifies(many, now)).toHaveLength(VERIFY_MAX);
  });
});

describe('printQueue — budama + sınıflandırma', () => {
  it('TTL: bayat iş budanır, taze kalır', () => {
    const now = Date.now();
    const out = prunePrintJobs(
      [job('old', { queuedAt: now - PRINT_JOB_TTL_MS - 1 }), job('new', { queuedAt: now })],
      now,
    );
    expect(out.map((j) => j.roll.id)).toEqual(['new']);
  });

  it(`tavan: en eski işler düşer (${PRINT_QUEUE_MAX})`, () => {
    const now = Date.now();
    const many = Array.from({ length: PRINT_QUEUE_MAX + 5 }, (_, i) =>
      job(`j${i}`, { queuedAt: now - (PRINT_QUEUE_MAX + 5 - i) }),
    );
    const out = prunePrintJobs(many, now);
    expect(out).toHaveLength(PRINT_QUEUE_MAX);
    expect(out[0].roll.id).toBe('j5'); // en eskiler düştü
  });

  it('sınıflandırma: yalnız fetch + yanıtsız/5xx retryable', () => {
    expect(classifyPrintRetry('fetch', new Error('timeout'))).toBe(true); // status yok
    expect(classifyPrintRetry('fetch', Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(classifyPrintRetry('fetch', Object.assign(new Error('x'), { status: 404 }))).toBe(false);
    expect(classifyPrintRetry('output', new Error('BT soketi'))).toBe(false); // ağla düzelmez
    expect(classifyPrintRetry('prep', new Error('dil çözülemedi'))).toBe(false);
  });
});
