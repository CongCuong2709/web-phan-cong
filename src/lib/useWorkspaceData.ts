import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  describeApiError,
  type DailyLogRowDto,
  type TaskApiRowDto,
  type TeamMemberDto,
} from './apiClient';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface WorkspaceData {
  tasks: TaskApiRowDto[];
  logs: DailyLogRowDto[];
  members: TeamMemberDto[];
}

const EMPTY: WorkspaceData = { tasks: [], logs: [], members: [] };

/**
 * Dữ liệu dùng chung của app — backend là nguồn sự thật duy nhất.
 *
 * - Lần tải đầu: `status` = 'loading' → 'ready' | 'error'. View không được
 *   kết luận gì ("không có việc gấp", "đang thuận lợi") khi chưa 'ready'.
 * - Sau mỗi lần ghi thành công, gọi `reload()` để lấy lại trạng thái thật
 *   (rollup tiến độ, status sau state machine, audit) thay vì tự đoán ở client.
 *   Reload không đưa app về 'loading' — dữ liệu cũ vẫn hiển thị trong lúc tải.
 */
export function useWorkspaceData(userId: string) {
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++loadSeq.current;
    const [tasksRes, logRes, memRes] = await Promise.all([
      api.listTasks(),
      api.listDailyLogs(),
      api.listTeamMembers(),
    ]);
    // Bỏ kết quả của lần tải cũ nếu đã có lần tải mới hơn.
    if (seq !== loadSeq.current) return false;

    if (!tasksRes.ok || !logRes.ok) {
      const failed = !tasksRes.ok ? tasksRes : logRes;
      setError(failed.ok ? null : describeApiError(failed));
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
      return false;
    }

    setData((prev) => ({
      tasks: tasksRes.data.items,
      logs: logRes.data.items,
      // Team members là phụ: lỗi thì giữ bản cũ thay vì xoá trắng.
      members: memRes.ok ? memRes.data.members : prev.members,
    }));
    setError(null);
    setStatus('ready');
    return true;
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    void load();
  }, [load]);

  useEffect(() => {
    setStatus('loading');
    void load();
  }, [userId, load]);

  return { data, status, error, reload: load, retry };
}
