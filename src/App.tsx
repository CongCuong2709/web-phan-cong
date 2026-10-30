import React, { useState, useEffect, useMemo } from 'react';
import {
  ActiveAppTab,
  TierItem,
  TeamMember,
  TeamLeadTask,
  EmployeeTask,
  User,
  ROLE_LABEL,
  DailyLog,
} from './types';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { canAcceptTierItem, canAddDailyLog, isDeptScoped, isHead, visibleTabsFor, writesWeeklyReport } from './auth/permissions';
import { api, describeApiError, type ApiResponse } from './lib/apiClient';
import {
  apiToTierItem,
  apiToTeamLeadTask,
  apiToDailyLog,
  apiToTeamMember,
  buildEmployeeTasks,
  extractBackendId,
  isPriority,
  viStatusToEnum,
} from './lib/transforms';
import { useWorkspaceData } from './lib/useWorkspaceData';
import { useHashRoute } from './lib/useHashRoute';
import { SEED_USERS } from './data/users';
import { Header } from './components/Header';
import { Gantt4TangView } from './components/Gantt4TangView';
import { GiaoViecNhomView } from './components/GiaoViecNhomView';
import { ViecCuaToiView, type SaveLogEntry } from './components/ViecCuaToiView';
import { BaoCaoTongQuanView } from './components/BaoCaoTongQuanView';
import { WeeklyReportView } from './components/WeeklyReportView';
import { WeeklyReportTeamView } from './components/WeeklyReportTeamView';
import { TaskDetailDialog, type DetailTab } from './components/TaskDetailDialog';
import { NewItemModal } from './components/NewItemModal';
import { ToastStack, useToasts } from './components/Toast';
import LoginPage from './components/LoginPage';

function AppShell() {
  const { user, restoreStatus, retryRestore } = useAuth();

  if (!user) {
    if (restoreStatus === 'checking') return <LoadingState />;
    if (restoreStatus === 'failed') {
      return <LoadErrorState message="Không kết nối được máy chủ để khôi phục phiên đăng nhập." onRetry={retryRestore} />;
    }
    return <LoginPage />;
  }

  return <AuthenticatedApp key={user.id} user={user} />;
}

interface AuthenticatedAppProps {
  user: User;
}

/** Composite id "<tier>-<num>" → tier + id số để gọi API. */
function parseTaskId(id: string): { tier: 1 | 2 | 3 | 4; num: number } | null {
  const tier = Number(id.split('-')[0]);
  const num = extractBackendId(id);
  if (![1, 2, 3, 4].includes(tier) || !Number.isFinite(num)) return null;
  return { tier: tier as 1 | 2 | 3 | 4, num };
}

const STALE_ITEM_MESSAGE = 'Không xác định được công việc này. Hãy tải lại trang.';

function AuthenticatedApp({ user }: AuthenticatedAppProps) {
  const { route, navigate, setSub, setParam, setParams } = useHashRoute();
  const allowedTabs = useMemo(() => visibleTabsFor(user), [user]);
  // URL trống / sai / trang không được phép → về trang đầu của vai trò (thay URL, không thêm lịch sử).
  const activeTab: ActiveAppTab =
    route.tab && allowedTabs.includes(route.tab) ? route.tab : allowedTabs[0];
  useEffect(() => {
    if (route.tab !== activeTab) navigate(activeTab, null, 'replace');
  }, [route.tab, activeTab, navigate]);

  const { data, status: loadStatus, error: loadError, reload, retry } = useWorkspaceData(user.id);
  const toast = useToasts();
  const showToast = toast.show;

  // Mọi view đọc từ một danh sách gốc (GET /api/tasks) — không có state song song.
  // Nhánh đã lưu trữ (dự án / giai đoạn + mọi mục con) ẩn khỏi mọi view; chỉ hiện trên
  // Cây công việc khi bật "Mục lưu trữ" (?luutru=1) để xem / khôi phục.
  const liveRows = useMemo(() => data.tasks.filter((t) => !t.archived), [data.tasks]);
  const liveTaskIds = useMemo(() => new Set(liveRows.filter((t) => t.tier === 4).map((t) => t.id)), [liveRows]);
  const liveLogs = useMemo(() => data.logs.filter((l) => liveTaskIds.has(l.task_id)), [data.logs, liveTaskIds]);
  const tierItems = useMemo<TierItem[]>(() => liveRows.map(apiToTierItem), [liveRows]);
  const archivedTierItems = useMemo<TierItem[]>(
    () => data.tasks.filter((t) => t.archived).map(apiToTierItem),
    [data.tasks],
  );
  const teamTasks = useMemo<TeamLeadTask[]>(
    () => liveRows.filter((t) => t.tier === 4).map(apiToTeamLeadTask),
    [liveRows],
  );
  const employeeTasks = useMemo<EmployeeTask[]>(
    () => buildEmployeeTasks(liveRows, liveLogs),
    [liveRows, liveLogs],
  );
  const dailyLogs = useMemo<DailyLog[]>(() => liveLogs.map(apiToDailyLog), [liveLogs]);
  const teamMembers = useMemo<TeamMember[]>(() => data.members.map(apiToTeamMember), [data.members]);

  // Danh bạ từ backend để chọn người phụ trách: HĐQT chọn Điều hành, Điều hành chọn
  // Trưởng phòng, Trưởng phòng chọn nhân viên cùng phòng. Nhân viên thường không cần (403).
  const [directoryUsers, setDirectoryUsers] = useState<User[]>(SEED_USERS);

  useEffect(() => {
    if (user.role === 'employee' && !isHead(user)) {
      setDirectoryUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await api.listUsers();
      if (cancelled || !r.ok) return;
      setDirectoryUsers(
        r.data.users.map((u) => ({
          id: String(u.id),
          username: u.username,
          fullname: u.fullname,
          email: u.email ?? undefined,
          role: u.role,
          departments: (u.departments ?? '').split(',').map((s) => s.trim()).filter(Boolean) as User['departments'],
          headOf: (u.head_of ?? '').split(',').filter(Boolean) as User['headOf'],
          jobTitle: u.job_title ?? undefined,
          initial: u.initial ?? u.fullname.charAt(0),
          avatar: u.avatar_url ?? undefined,
        })),
      );
    })();
    return () => { cancelled = true; };
  }, [user.id, user.role]);

  // Chỉ người có id thật từ /api/users — danh bạ dự phòng (SEED_USERS) không có id dùng được.
  const assignableUsers = useMemo(() => directoryUsers.filter((u) => /^\d+$/.test(u.id)), [directoryUsers]);

  // ---------------- Role-based data slicing ----------------
  // Server đã lọc đầu việc theo quyền xem (policy `task:read`); dự án / giai đoạn / hạng mục
  // ai cũng nhận được. HĐQT, Điều hành, Trưởng phòng xem cả cây.
  // Nhân viên: chỉ T4 của chính mình + chuỗi cha (T3 → T2 → T1) làm ngữ cảnh chỉ đọc.
  const visibleTierItems = useMemo<TierItem[]>(() => {
    if (user.role !== 'employee' || isHead(user)) return tierItems;
    const byId = new Map(tierItems.map((t) => [t.id, t]));
    const roots = tierItems.filter((t) => t.tier === 4 && t.ownerUserId === user.id);
    const seen = new Set<string>();
    const result: TierItem[] = [];
    for (const r of roots) {
      let cur: TierItem | undefined = r;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        result.push(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return result;
  }, [tierItems, user]);

  const visibleTeamMembers = useMemo<TeamMember[]>(() => {
    if (user.role === 'admin') return teamMembers;
    // Trưởng phòng (kể cả Điều hành kiêm nhiệm): thành viên các phòng mình làm trưởng.
    if (isHead(user)) {
      return teamMembers.filter((m) => !m.department || user.headOf.includes(m.department));
    }
    if (user.role === 'board' || user.role === 'director') return teamMembers;
    return [];
  }, [teamMembers, user]);

  // "Giao việc nhóm": đầu việc trong các hạng mục mình phụ trách (cả việc mình tự làm).
  const visibleTeamTasks = useMemo<TeamLeadTask[]>(() => {
    if (user.role === 'admin') return teamTasks;
    return teamTasks.filter((t) => t.bundleOwnerUserId === user.id);
  }, [teamTasks, user]);

  // "Việc của tôi" luôn là việc mà chính user là owner — kể cả Trưởng phòng / admin.
  const visibleEmployeeTasks = useMemo<EmployeeTask[]>(() => {
    if (user.role === 'board' || user.role === 'director') return [];
    const me = user.username.toLowerCase();
    return employeeTasks.filter((t) => t.ownerUsername?.toLowerCase() === me);
  }, [employeeTasks, user]);

  // ---------------- Modals & chi tiết công việc ----------------
  // Mục đang mở nằm trên URL (?muc=4-12&tab=trao-doi) → chia sẻ được link tới đúng 1 mục, đúng tab.
  const drawerItemId = route.params.muc ?? null;
  // Xem mục lưu trữ trên Cây công việc: admin, HĐQT, Điều hành (người lưu trữ được).
  const canViewArchive = user.role === 'admin' || user.role === 'board' || user.role === 'director';
  const showArchived = canViewArchive && route.params.luutru === '1';
  const drawerItem = useMemo(
    () =>
      drawerItemId
        ? tierItems.find((t) => t.id === drawerItemId) ?? archivedTierItems.find((t) => t.id === drawerItemId) ?? null
        : null,
    [drawerItemId, tierItems, archivedTierItems],
  );
  const [drawerPushed, setDrawerPushed] = useState(false);
  const openDrawer = (id: string, tab?: DetailTab) => {
    setParams({ muc: id, tab: tab ?? null }, 'push');
    setDrawerPushed(true);
  };
  // Mở bằng click → Back đóng chi tiết; mở từ link dán vào → đóng thì chỉ bỏ tham số.
  const closeDrawer = () => {
    if (drawerPushed) window.history.back();
    else setParams({ muc: null, tab: null });
    setDrawerPushed(false);
  };
  useEffect(() => {
    if (!drawerItemId) setDrawerPushed(false);
  }, [drawerItemId]);
  useEffect(() => {
    if (loadStatus === 'ready' && drawerItemId && !drawerItem) {
      showToast('Không tìm thấy mục này, hoặc bạn không có quyền xem.', 'warning');
      setParams({ muc: null, tab: null });
    }
  }, [loadStatus, drawerItemId, drawerItem, showToast, setParams]);
  const [newItemMode, setNewItemMode] = useState<'plan' | 'assign' | null>(null);

  // Nghiệm thu mục cha đang mở: cần mọi con trực tiếp đã xong (server kiểm tra lại).
  const drawerAcceptance = useMemo(() => {
    if (!drawerItem || drawerItem.tier === 4) return undefined;
    const children = tierItems.filter((t) => t.parentId === drawerItem.id);
    return {
      allowed: canAcceptTierItem(user, drawerItem),
      openChildren: children.filter((c) => c.status !== 'Đã xong').length,
      childLabel: drawerItem.tier === 1 ? 'giai đoạn' : drawerItem.tier === 2 ? 'hạng mục' : 'đầu việc',
      deniedReason:
        drawerItem.tier === 3
          ? 'Trưởng phòng phụ trách sẽ nghiệm thu hạng mục này.'
          : 'Điều hành phụ trách dự án sẽ nghiệm thu giai đoạn / dự án.',
    };
  }, [drawerItem, tierItems, user]);
  // Tab con của Báo cáo: Tổng quan, Báo cáo tuần (tổng hợp), Báo cáo tuần của tôi (người viết báo cáo).
  // URL không chỉ rõ → HĐQT / Điều hành mở "Tổng quan", Trưởng phòng cấp nhân viên mở "Báo cáo tuần".
  type BaoCaoSub = 'tong-quan' | 'tuan' | 'cua-toi';
  const baoCaoSubs: BaoCaoSub[] = writesWeeklyReport(user) ? ['tong-quan', 'tuan', 'cua-toi'] : ['tong-quan', 'tuan'];
  const baoCaoSubTab: BaoCaoSub = baoCaoSubs.includes(route.sub as BaoCaoSub)
    ? (route.sub as BaoCaoSub)
    : isDeptScoped(user) ? 'tuan' : 'tong-quan';
  const BAO_CAO_LABEL: Record<BaoCaoSub, string> = {
    'tong-quan': 'Tổng quan',
    tuan: 'Báo cáo tuần',
    'cua-toi': 'Báo cáo tuần của tôi',
  };

  // Lọc mức ưu tiên dùng chung cho "Việc của tôi" và "Giao việc nhóm" (?uu=critical).
  const priorityFilter = isPriority(route.params.uu) ? route.params.uu : null;

  // ---------------- Ghi dữ liệu ----------------
  /** Tải lần lượt từng tệp lên mục (đầu việc: gắn vào tin `messageId` nếu có). Trả mô tả các tệp lỗi. */
  async function uploadFiles(tier: number, num: number, files: File[], messageId?: number | null): Promise<string[]> {
    const failed: string[] = [];
    for (const f of files) {
      const r = await api.uploadAttachment(tier, num, f, messageId);
      if (!r.ok) failed.push(`${f.name} (${describeApiError(r)})`);
    }
    return failed;
  }

  /**
   * Mọi thao tác ghi đi qua đây: chờ server trả lời, lỗi thì báo đúng lý do và
   * KHÔNG đổi gì trên UI; thành công thì tải lại dữ liệu thật rồi mới báo.
   *
   * `attach`: tệp tải lên SAU khi thao tác chính thành công — gắn vào tin trao đổi
   * mà thao tác đó tạo (`message_id` trong response) nếu có, không thì gắn vào mục.
   * `tier` mặc định 4 (đầu việc).
   * Tệp lỗi không huỷ thao tác chính (đã lưu) mà được báo riêng.
   */
  async function commit<T>(
    request: Promise<ApiResponse<T>>,
    successMessage?: string | ((data: T) => string),
    attach?: { files: File[]; taskNum: number | ((data: T) => number); tier?: number },
  ) {
    const r = await request;
    if (!r.ok) {
      showToast(describeApiError(r), 'error');
      return null;
    }
    let failed: string[] = [];
    if (attach && attach.files.length > 0) {
      const taskNum = typeof attach.taskNum === 'function' ? attach.taskNum(r.data) : attach.taskNum;
      const messageId = (r.data as { message_id?: number | null } | undefined)?.message_id ?? null;
      failed = await uploadFiles(attach.tier ?? 4, taskNum, attach.files, messageId);
    }
    const refreshed = await reload();
    if (successMessage) {
      showToast(typeof successMessage === 'function' ? successMessage(r.data) : successMessage);
    }
    if (failed.length > 0) {
      showToast(`Đã lưu, nhưng chưa tải lên được: ${failed.join('; ')}`, 'warning');
    }
    if (!refreshed) {
      showToast('Đã lưu, nhưng chưa tải lại được dữ liệu mới nhất. Hãy tải lại trang.', 'warning');
    }
    return r.data;
  }

  /** Composite id → tham chiếu T4; báo lỗi và trả null nếu id hỏng hoặc không phải đầu việc. */
  function taskRef(taskId: string) {
    const ref = parseTaskId(taskId);
    if (!ref || ref.tier !== 4) {
      showToast(STALE_ITEM_MESSAGE, 'error');
      return null;
    }
    return ref;
  }

  const handleUpdateTierItem = async (updated: TierItem): Promise<boolean> => {
    const ref = parseTaskId(updated.id);
    if (!ref) {
      showToast(STALE_ITEM_MESSAGE, 'error');
      return false;
    }
    const saved = await commit(
      api.updateTask(ref.tier, ref.num, {
        title: updated.title,
        status: viStatusToEnum(updated.status),
        start_date: updated.startDate,
        end_date: updated.endDate,
        description: updated.description,
        // Chỉ gửi trường mà tầng đó có cột: progress/priority ở T4, management_notes ở T2.
        ...(ref.tier === 4 ? { progress: updated.progress, priority: updated.priority } : {}),
        ...(ref.tier === 2 ? { management_notes: updated.managementNotes } : {}),
      }),
      `Đã lưu thay đổi cho ${updated.code}.`,
    );
    return saved !== null;
  };

  /**
   * Tạo mục mới. Người phụ trách: T1 Điều hành, T3 Trưởng phòng (+ phòng của hạng mục),
   * T4 người làm; T2 luôn là Điều hành phụ trách dự án (server tự gán). Tệp gắn vào mục vừa tạo.
   */
  const handleAddTierItem = async (item: Partial<TierItem>, files: File[] = []): Promise<boolean> => {
    const tier = item.tier ?? 4;
    const parent = item.parentId ? parseTaskId(item.parentId) : null;
    const created = await commit(
      api.createTask({
        tier,
        title: item.title?.trim() || 'Đầu việc mới',
        parent_id: parent?.num ?? null,
        department_code: tier === 3 ? item.department ?? null : null,
        owner_user_id: tier === 2 || !item.ownerUserId ? null : Number(item.ownerUserId),
        progress: 0,
        status: 'pending',
        priority: item.priority ?? 'normal',
        description: item.description ?? '',
        management_notes: item.managementNotes ?? '',
        start_date: item.startDate,
        end_date: item.endDate,
      }),
      (res) => `Đã tạo ${res.item.code}: ${res.item.title}`,
      { files, tier, taskNum: (res) => res.item.id },
    );
    return created !== null;
  };

  const handleSetArchived = async (itemId: string, archived: boolean): Promise<boolean> => {
    const ref = parseTaskId(itemId);
    if (!ref) {
      showToast(STALE_ITEM_MESSAGE, 'error');
      return false;
    }
    const message = archived
      ? 'Đã lưu trữ — mục này và các mục con không còn hiện trong cây công việc và báo cáo.'
      : 'Đã khôi phục từ lưu trữ.';
    return (await commit(api.setArchived(ref.tier, ref.num, archived), message)) !== null;
  };

  /** Duyệt (T4, kèm ghi chú / tệp tuỳ chọn) hoặc nghiệm thu mục cha (T1–T3). */
  const handleApproveTeamTask = async (taskId: string, note = '', files: File[] = []): Promise<boolean> => {
    const ref = parseTaskId(taskId);
    if (!ref) {
      showToast(STALE_ITEM_MESSAGE, 'error');
      return false;
    }
    if (ref.tier !== 4) {
      return (await commit(api.approveTask(ref.tier, ref.num), 'Đã nghiệm thu — mục này đã đóng.')) !== null;
    }
    return (
      (await commit(
        api.approveTask(4, ref.num, { note, with_files: files.length > 0 }),
        'Đã duyệt nghiệm thu công việc.',
        { files, taskNum: ref.num },
      )) !== null
    );
  };

  const handleReturnTask = async (taskId: string, reason: string, files: File[] = []): Promise<boolean> => {
    const ref = taskRef(taskId);
    if (!ref) return false;
    return (
      (await commit(api.returnTask(ref.num, reason, files.length > 0), 'Đã trả việc về cho nhân viên làm lại.', {
        files,
        taskNum: ref.num,
      })) !== null
    );
  };

  const handleUnblockTask = async (taskId: string, note: string, files: File[] = []): Promise<boolean> => {
    const ref = taskRef(taskId);
    if (!ref) return false;
    return (
      (await commit(api.unblockTask(ref.num, note, files.length > 0), 'Đã gỡ vướng mắc.', { files, taskNum: ref.num })) !==
      null
    );
  };

  /** Ghi chú / báo vướng mắc trong luồng trao đổi của 1 đầu việc. */
  const handlePostMessage = async (
    taskId: string,
    body: string,
    kind: 'note' | 'blocker',
    files: File[],
  ): Promise<boolean> => {
    const ref = taskRef(taskId);
    if (!ref) return false;
    return (
      (await commit(
        api.postMessage(ref.num, body, kind, files.length > 0),
        kind === 'blocker' ? 'Đã báo vướng mắc cho Trưởng phòng.' : 'Đã gửi ghi chú.',
        { files, taskNum: ref.num },
      )) !== null
    );
  };

  /** Bổ sung tệp cho 1 mục bất kỳ tầng (không gắn vào tin trao đổi). */
  const handleUploadTaskFiles = async (itemId: string, files: File[]): Promise<boolean> => {
    const ref = parseTaskId(itemId);
    if (!ref) {
      showToast(STALE_ITEM_MESSAGE, 'error');
      return false;
    }
    if (files.length === 0) return false;
    const failed = await uploadFiles(ref.tier, ref.num, files);
    const refreshed = await reload();
    const done = files.length - failed.length;
    if (done > 0) showToast(`Đã tải lên ${done} tệp.`);
    if (failed.length > 0) showToast(`Chưa tải lên được: ${failed.join('; ')}`, 'error');
    if (!refreshed) showToast('Chưa tải lại được dữ liệu mới nhất. Hãy tải lại trang.', 'warning');
    return failed.length === 0;
  };

  const handleDeleteAttachment = async (attachmentId: number): Promise<boolean> =>
    (await commit(api.deleteAttachment(attachmentId), 'Đã xoá tệp.')) !== null;

  /** Dời hạn và/hoặc đổi người làm — chỉ gửi trường thực sự thay đổi. */
  const handleAdjustTask = async (
    taskId: string,
    changes: { ownerUserId?: string; endDate?: string },
  ): Promise<boolean> => {
    const ref = parseTaskId(taskId);
    if (!ref) {
      showToast(STALE_ITEM_MESSAGE, 'error');
      return false;
    }
    const newOwner = changes.ownerUserId ? assignableUsers.find((u) => u.id === changes.ownerUserId) : undefined;
    const message = [newOwner && `giao lại cho ${newOwner.fullname}`, changes.endDate && `dời hạn sang ${changes.endDate.split('-').reverse().join('/')}`]
      .filter(Boolean)
      .join(', ');
    return (
      (await commit(
        api.updateTask(ref.tier, ref.num, {
          ...(changes.ownerUserId ? { owner_user_id: Number(changes.ownerUserId) } : {}),
          ...(changes.endDate ? { end_date: changes.endDate } : {}),
        }),
        `Đã ${message}.`,
      )) !== null
    );
  };

  /**
   * Chuyển task sang bước kế tiếp do server quyết định: Chưa bắt đầu → Đang làm → Chờ duyệt.
   * Ghi chú / tệp (khi báo xong) thành 1 tin trong luồng trao đổi.
   */
  const handleAdvanceEmployeeTask = async (taskId: string, note = '', files: File[] = []): Promise<boolean> => {
    const ref = taskRef(taskId);
    if (!ref) return false;
    const res = await commit(
      api.toggleTask(ref.tier, ref.num, { note, with_files: files.length > 0 }),
      (r) =>
        r.item.status === 'pending_approval'
          ? 'Đã báo xong — đang chờ Trưởng phòng duyệt.'
          : r.item.status === 'done'
            ? 'Đã hoàn thành công việc.'
            : 'Đã chuyển sang Đang làm.',
      { files, taskNum: ref.num },
    );
    return res !== null;
  };

  /**
   * Lưu nhật ký cho nhiều task. Trả về id các task đã lưu thành công — view chỉ
   * xoá bản nháp của những task này, task lỗi giữ nguyên nháp để người dùng sửa lại.
   * Vướng mắc mới được gửi qua /blocker để Trưởng phòng thấy (nhật ký chỉ lưu lịch sử).
   */
  const handleSaveLogs = async (entries: SaveLogEntry[]): Promise<string[]> => {
    const saved: string[] = [];
    const failures: string[] = [];

    await Promise.all(
      entries.map(async (e) => {
        const item = tierItems.find((t) => t.id === e.taskId);
        const ref = parseTaskId(e.taskId);
        if (!item || !ref) {
          failures.push(STALE_ITEM_MESSAGE);
          return;
        }
        if (!canAddDailyLog(user, item)) {
          failures.push(`${item.code}: bạn không có quyền ghi nhật ký.`);
          return;
        }
        const logRes = await api.addDailyLog({
          taskId: ref.num,
          description: e.desc,
          result: e.result,
          obstacle: e.obstacle,
          progress: e.progress,
        });
        if (!logRes.ok) {
          failures.push(`${item.code}: ${describeApiError(logRes)}`);
          return;
        }
        const currentBlocker = data.tasks.find((t) => t.tier === 4 && t.id === ref.num)?.blocker_note ?? '';
        if (e.obstacle && e.obstacle !== currentBlocker) {
          const blockerRes = await api.setTaskBlocker(ref.tier, ref.num, e.obstacle);
          if (!blockerRes.ok) {
            failures.push(`${item.code}: đã lưu nhật ký nhưng chưa gửi được vướng mắc — ${describeApiError(blockerRes)}`);
          }
        }
        saved.push(e.taskId);
      }),
    );

    if (saved.length > 0) {
      const refreshed = await reload();
      showToast(saved.length === 1 ? 'Đã lưu nhật ký.' : `Đã lưu ${saved.length} nhật ký.`);
      if (!refreshed) showToast('Chưa tải lại được dữ liệu mới nhất. Hãy tải lại trang.', 'warning');
    }
    if (failures.length > 0) {
      const more = failures.length > 1 ? ` (và ${failures.length - 1} lỗi khác — nháp vẫn được giữ)` : ' — nháp vẫn được giữ';
      showToast(`${failures[0]}${more}`, 'error');
    }
    return saved;
  };

  const handleAddDrawerLog = async (
    taskId: string,
    desc: string,
    result: string | undefined,
    obstacle: string | undefined,
    progress: number,
  ): Promise<boolean> => {
    const saved = await handleSaveLogs([
      { taskId, desc, result: result ?? '', obstacle: obstacle ?? '', progress },
    ]);
    return saved.length > 0;
  };

  const renderTab = () => {
    if (loadStatus === 'loading') return <LoadingState />;
    if (loadStatus === 'error') return <LoadErrorState message={loadError} onRetry={retry} />;

    switch (activeTab) {
      case 'cay-gantt-4-tang':
        return (
          <Gantt4TangView
            tierItems={showArchived ? [...visibleTierItems, ...archivedTierItems] : visibleTierItems}
            showArchived={showArchived}
            onToggleArchived={canViewArchive ? () => setParam('luutru', showArchived ? null : '1') : undefined}
            currentUser={user}
            onSelectItem={(item) => openDrawer(item.id)}
            onOpenNewModal={() => setNewItemMode('plan')}
            month={route.params.thang ?? null}
            onMonthChange={(m) => setParam('thang', m)}
          />
        );
      case 'giao-viec-nhom':
        return !allowedTabs.includes('giao-viec-nhom') ? (
          <ForbiddenView role={user.role} />
        ) : (
          <GiaoViecNhomView
            teamMembers={visibleTeamMembers}
            tasks={visibleTeamTasks}
            assignees={assignableUsers.map((u) => ({
              id: u.id,
              username: u.username,
              fullname: u.fullname,
              role: u.role,
              departments: u.departments,
            }))}
            onApproveTask={handleApproveTeamTask}
            onReturnTask={handleReturnTask}
            onUnblockTask={handleUnblockTask}
            onAdjustTask={handleAdjustTask}
            onOpenTask={openDrawer}
            onAssignTask={() => setNewItemMode('assign')}
            filter={route.params.loc}
            onFilterChange={(f) => setParam('loc', f === 'open' ? null : f)}
            memberFilter={route.params.nv ?? null}
            onMemberFilterChange={(u) => setParam('nv', u)}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={(p) => setParam('uu', p)}
          />
        );
      case 'viec-cua-toi':
        return !allowedTabs.includes('viec-cua-toi') ? (
          <ForbiddenView role={user.role} />
        ) : (
          <ViecCuaToiView
            currentUser={user}
            tasks={visibleEmployeeTasks}
            dailyLogs={dailyLogs}
            onAdvanceTask={handleAdvanceEmployeeTask}
            onOpenTask={openDrawer}
            filter={route.params.loc}
            onFilterChange={(f) => setParam('loc', f === 'open' ? null : f)}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={(p) => setParam('uu', p)}
            onSaveLogs={handleSaveLogs}
          />
        );
      case 'bao-cao':
        if (user.role === 'employee' && !isHead(user)) {
          return <WeeklyReportView currentUser={user} mode="edit" onToast={showToast} />;
        }
        return (
          <>
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6 print:hidden">
              <div
                role="tablist"
                aria-label="Loại báo cáo"
                className="flex items-center gap-1 border-b border-surface-container"
              >
                {baoCaoSubs.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={baoCaoSubTab === k}
                    onClick={() => setSub(k)}
                    className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                      baoCaoSubTab === k
                        ? 'border-primary text-primary'
                        : 'border-transparent text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {BAO_CAO_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            {baoCaoSubTab === 'cua-toi' ? (
              <WeeklyReportView currentUser={user} mode="edit" onToast={showToast} />
            ) : baoCaoSubTab === 'tuan' ? (
              <WeeklyReportTeamView currentUser={user} onToast={showToast} />
            ) : (
              <BaoCaoTongQuanView
                tierItems={visibleTierItems}
                teamMembers={visibleTeamMembers}
                teamTasks={visibleTeamTasks}
                dailyLogs={dailyLogs}
                currentUser={user}
                onOpenItem={openDrawer}
              />
            )}
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col font-sans selection:bg-primary-fixed selection:text-on-primary-fixed">
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => navigate(tab)}
        unreadCount={visibleTeamTasks.filter((t) => t.needsHelp).length}
      />

      <main className="w-full pt-[6.5rem] md:pt-14 flex-1">{renderTab()}</main>

      <footer className="w-full bg-white border-t border-surface-container py-4">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 flex items-center justify-center gap-2 text-secondary text-xs">
          <span>© 2026 Hệ thống công việc và báo cáo TAG</span>
        </div>
      </footer>

      <TaskDetailDialog
        item={drawerItem}
        onClose={closeDrawer}
        tab={route.params.tab}
        onTabChange={(t) => setParam('tab', t === 'trao-doi' ? null : t)}
        onUpdateItem={handleUpdateTierItem}
        onSetArchived={handleSetArchived}
        dailyLogs={dailyLogs}
        currentUser={user}
        onAddDailyLog={handleAddDrawerLog}
        acceptance={drawerAcceptance}
        onApprove={handleApproveTeamTask}
        onAdvance={handleAdvanceEmployeeTask}
        onReturn={handleReturnTask}
        onUnblock={handleUnblockTask}
        onPostMessage={handlePostMessage}
        onUploadFiles={handleUploadTaskFiles}
        onDeleteAttachment={handleDeleteAttachment}
      />

      <NewItemModal
        isOpen={newItemMode !== null}
        mode={newItemMode ?? 'plan'}
        onClose={() => setNewItemMode(null)}
        onAddItem={handleAddTierItem}
        parents={tierItems}
        currentUser={user}
        users={assignableUsers}
      />

      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}

const LoadingState: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-4"
  >
    <span className="sr-only">Đang tải dữ liệu…</span>
    <div className="h-24 rounded-xl bg-surface-container-low animate-pulse" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-28 rounded-xl bg-surface-container-low animate-pulse" />
      ))}
    </div>
    <div className="h-80 rounded-xl bg-surface-container-low animate-pulse" />
  </div>
);

const LoadErrorState: React.FC<{ message: string | null; onRetry: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-16 flex flex-col items-center text-center gap-3">
    <div className="w-14 h-14 rounded-full bg-error-container text-on-error-container flex items-center justify-center">
      <span aria-hidden="true" className="material-symbols-outlined [--icon-size:28px]">cloud_off</span>
    </div>
    <h2 className="text-xl font-bold text-on-surface">Chưa tải được dữ liệu</h2>
    <p className="text-sm text-secondary max-w-md">
      {message ?? 'Máy chủ không phản hồi.'} Dữ liệu hiển thị sẽ không chính xác cho tới khi tải lại thành công.
    </p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-semibold"
    >
      <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">refresh</span>
      Thử lại
    </button>
  </div>
);

/** Màn hình chặn cho tab mà vai trò hiện tại không được xem. */
const ForbiddenView: React.FC<{ role: User['role'] }> = ({ role }) => (
  <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-12 flex flex-col items-center text-center gap-3">
    <div className="w-14 h-14 rounded-full bg-error-container/40 text-on-error-container flex items-center justify-center">
      <span aria-hidden="true" className="material-symbols-outlined [--icon-size:28px]">lock</span>
    </div>
    <h2 className="text-xl font-bold text-on-surface">Bạn không có quyền truy cập</h2>
    {role === 'board' || role === 'director' ? (
      <p className="text-sm text-secondary max-w-md leading-relaxed">
        Vai trò {ROLE_LABEL[role]} chỉ truy cập <span className="font-semibold text-primary">Cây công việc</span> và
        <span className="font-semibold text-primary"> Báo cáo</span>.
      </p>
    ) : (
      <p className="text-sm text-secondary max-w-md">
        Vai trò <span className="font-semibold">{ROLE_LABEL[role]}</span> chỉ được phép truy cập
        mục <span className="font-semibold text-primary">Việc của tôi</span>.
      </p>
    )}
  </div>
);

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
