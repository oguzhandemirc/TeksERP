// Liste başka ekrandan dönünce tazelenir (ilk odak hariç); okutmadan dönüş bütün süzgeç varyantlarını bayatlatır.
import { act, renderHook } from '@testing-library/react-native';
import { useWorkOrderList, WORK_ORDER_LIST_KEY } from './useWorkOrderList';
import { DEFAULT_FILTERS } from './workOrderRow';

let mockFocus: (() => void) | null = null;
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: () => void) => { mockFocus = cb; } }));
const mockInvalidate = jest.fn(() => Promise.resolve());
jest.mock('@tanstack/react-query', () => ({
  keepPreviousData: undefined,
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useInfiniteQuery: () => ({ data: undefined, isLoading: false, isRefetching: false, isFetchingNextPage: false, isFetching: false, isPlaceholderData: false, hasNextPage: false, refetch: jest.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

beforeEach(() => { mockInvalidate.mockClear(); mockFocus = null; });

describe('useWorkOrderList — dönüşte tazeleme', () => {
  it('ilk odak sorgunun kendi yüklemesi; sonraki her odak listeyi bayatlatır', () => {
    const h = renderHook(() => useWorkOrderList(DEFAULT_FILTERS));
    act(() => mockFocus!());
    expect(mockInvalidate).not.toHaveBeenCalled();
    act(() => mockFocus!());
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: WORK_ORDER_LIST_KEY });
    void h.result.current.refreshAll();
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
  });
});
