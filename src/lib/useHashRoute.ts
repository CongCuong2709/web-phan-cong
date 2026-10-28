import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveAppTab } from '../types';

/**
 * Router tối giản dựa trên hash: `#/<trang>[/<trang-con>][?khoá=giá-trị]`.
 * Hash không cần cấu hình server cho deep link; mọi URL đều chia sẻ được.
 *
 * - Đổi trang: thêm mục lịch sử (nút Back của trình duyệt quay lại trang trước).
 * - Đổi bộ lọc: thay mục hiện tại — Back không phải bấm qua từng lần lọc.
 */

const PATH_OF: Record<ActiveAppTab, string> = {
  'cay-gantt-4-tang': 'cay-cong-viec',
  'giao-viec-nhom': 'giao-viec',
  'viec-cua-toi': 'viec-cua-toi',
  'bao-cao': 'bao-cao',
};
const TAB_OF = Object.fromEntries(Object.entries(PATH_OF).map(([tab, path]) => [path, tab])) as Record<
  string,
  ActiveAppTab
>;

export interface Route {
  /** null khi URL không khớp trang nào (hash rỗng hoặc gõ sai). */
  tab: ActiveAppTab | null;
  sub: string | null;
  params: Record<string, string>;
}

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [page = '', sub = null] = path.split('/').filter(Boolean);
  return {
    tab: TAB_OF[page] ?? null,
    sub,
    params: Object.fromEntries(new URLSearchParams(query)),
  };
}

function format(route: Route): string {
  const path = [route.tab ? PATH_OF[route.tab] : '', route.sub].filter(Boolean).join('/');
  const query = new URLSearchParams(
    Object.entries(route.params).filter(([, v]) => v !== '' && v != null),
  ).toString();
  return `#/${path}${query ? `?${query}` : ''}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const current = useRef(route);
  current.current = route;

  useEffect(() => {
    const sync = () => setRoute(parse(window.location.hash));
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  const write = useCallback((next: Route, mode: 'push' | 'replace') => {
    const url = format(next);
    if (url === window.location.hash) return;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    const parsed = parse(url);
    // Cập nhật ngay để lần ghi kế tiếp trong cùng lượt xử lý không dùng URL cũ.
    current.current = parsed;
    setRoute(parsed);
  }, []);

  /** Sang trang khác; bộ lọc của trang cũ không mang theo. */
  const navigate = useCallback(
    (tab: ActiveAppTab, sub: string | null = null, mode: 'push' | 'replace' = 'push') => {
      write({ tab, sub, params: {} }, mode);
      if (mode === 'push') window.scrollTo(0, 0);
    },
    [write],
  );

  const setSub = useCallback(
    (sub: string) => write({ ...current.current, sub, params: {} }, 'push'),
    [write],
  );

  /** Đặt/xoá tham số trên URL (giá trị rỗng = xoá). Mặc định thay mục lịch sử hiện tại. */
  const setParam = useCallback(
    (key: string, value: string | null, mode: 'push' | 'replace' = 'replace') =>
      write({ ...current.current, params: { ...current.current.params, [key]: value ?? '' } }, mode),
    [write],
  );

  /** Như setParam nhưng nhiều khoá trong 1 lần ghi (1 mục lịch sử). */
  const setParams = useCallback(
    (patch: Record<string, string | null>, mode: 'push' | 'replace' = 'replace') => {
      const params = { ...current.current.params };
      for (const [k, v] of Object.entries(patch)) params[k] = v ?? '';
      write({ ...current.current, params }, mode);
    },
    [write],
  );

  return { route, navigate, setSub, setParam, setParams };
}
