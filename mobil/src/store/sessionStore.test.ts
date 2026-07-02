import { useSessionStore } from './sessionStore';
import { workSessionService } from '../services/workSession.service';

jest.mock('../services/workSession.service', () => ({
  workSessionService: {
    current: jest.fn(),
    open: jest.fn(),
    close: jest.fn(),
  },
}));

const svc = workSessionService as jest.Mocked<typeof workSessionService>;

const session = (id: string) => ({
  id,
  machineId: 'm1',
  stationId: 's1',
  startedAt: '2026-07-02T08:00:00Z',
  machine: { id: 'm1', code: 'MAK-1', name: 'Makine 1' },
  station: { id: 's1', code: 'ST1', name: 'İstasyon 1', kind: 'TAMBUR' },
});

beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.setState({ active: null, lastPlace: null, isLoaded: false });
});

describe('sessionStore', () => {
  it('init → current sonucunu yükler', async () => {
    svc.current.mockResolvedValue({ active: session('a'), lastPlace: null });
    await useSessionStore.getState().init();
    expect(useSessionStore.getState().active?.id).toBe('a');
    expect(useSessionStore.getState().isLoaded).toBe(true);
  });

  it('init ağ hatasında da isLoaded=true (gate kilitlenmez)', async () => {
    svc.current.mockRejectedValue(new Error('offline'));
    await useSessionStore.getState().init();
    expect(useSessionStore.getState().isLoaded).toBe(true);
    expect(useSessionStore.getState().active).toBeNull();
  });

  it('openSession → active + lastPlace güncellenir', async () => {
    svc.open.mockResolvedValue(session('b'));
    const s = await useSessionStore.getState().openSession({ machineId: 'm1' });
    expect(s.id).toBe('b');
    expect(useSessionStore.getState().active?.id).toBe('b');
    expect(useSessionStore.getState().lastPlace?.machine?.id).toBe('m1');
  });

  it('openSession hatası state bozmaz ve ÇAĞIRANA fırlar (MACHINE_OCCUPIED akışı)', async () => {
    svc.open.mockRejectedValue(Object.assign(new Error('dolu'), { details: { code: 'MACHINE_OCCUPIED' } }));
    await expect(useSessionStore.getState().openSession({ machineId: 'm1' })).rejects.toThrow('dolu');
    expect(useSessionStore.getState().active).toBeNull();
  });

  it('closeSession offline olsa da yerel state temizlenir', async () => {
    useSessionStore.setState({ active: session('c') as never });
    svc.close.mockRejectedValue(new Error('offline'));
    await useSessionStore.getState().closeSession();
    expect(useSessionStore.getState().active).toBeNull();
  });

  it('clearActive yalnız aktifken state değiştirir; reset her şeyi sıfırlar', async () => {
    useSessionStore.setState({ active: session('d') as never, isLoaded: true });
    useSessionStore.getState().clearActive();
    expect(useSessionStore.getState().active).toBeNull();
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().isLoaded).toBe(false);
  });
});
