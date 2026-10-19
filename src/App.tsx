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
  HistoryEntry,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// Helper maps: Tiếng Việt (UI) ↔ enum DB (ISS-007 unified)
// ─────────────────────────────────────────────────────────────────────

/** Map UI status tiếng Việt → enum DB. */
export function viStatusToEnum(s: string | undefined): string {
  switch (s) {
    case 'Đã xong': return 'done';
    case 'Đang chạy':
    case 'Đang làm': return 'doing';
    case 'Sắp xong': return 'pending_approval';
    case 'Điểm nghẽn':
    case 'Đang nghẽn': return 'blocked';
    case 'Lên lịch':
    case 'Chuẩn bị':
    default: return 'pending';
  }
}

/** Map UI priority tiếng Việt → enum DB. */
export function viPriorityToEnum(p: string | undefined): string {
  switch (p) {
    case 'Cao (Critical Path)': return 'critical';
    case 'Thấp': return 'low';
    case 'Trung bình':
    default: return 'normal';
  }
}
import { AuthProvider, useAuth } from './auth/AuthContext';
import { canAddDailyLog, findManagerOf, uid } from './auth/permissions';
import { api, fireAndForget } from './lib/apiClient';
import {
  apiToTierItem,
  apiToTeamLeadTask,
  apiToEmployeeTask,
  apiToDailyLog,
  apiToTeamMember,
  apiToHistoryEntry,
  extractBackendId,
  toCompositeId,
} from './lib/transforms';
import { SEED_USERS } from './data/users';
import { Header } from './components/Header';
import { Gantt4TangView } from './components/Gantt4TangView';
import { GiaoViecNhomView } from './components/GiaoViecNhomView';
import { ViecCuaToiView } from './components/ViecCuaToiView';
import { BaoCaoTongQuanView } from './components/BaoCaoTongQuanView';
import { DetailsDrawer } from './components/DetailsDrawer';
import { NewItemModal } from './components/NewItemModal';
import { ExportModal } from './components/ExportModal';
import { NewPersonalTaskModal } from './components/NewPersonalTaskModal';
import { Toast } from './components/Toast';
import LoginPage from './components/LoginPage';

const ROLE_HELLO: Record<User['role'], string> = {
  admin: 'Quản trị hệ thống',
  director: 'Điều hành',
  manager: 'Trưởng phòng',
  employee: 'Nhân viên',
};

function AppShell() {
  const { user, logout, users: onlineUsers } = useAuth();

  if (!user) {
    return <LoginPage />;
  }

  return <AuthenticatedApp key={user.id} user={user} onlineUsers={onlineUsers} />;
}

interface AuthenticatedAppProps {
  user: User;
  /** Danh sách user đã biết ở AuthContext (SEED + user backend vừa login). */
  onlineUsers: User[];
}

function AuthenticatedApp({ user, onlineUsers }: AuthenticatedAppProps) {
  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveAppTab>(() => {
    // Employees land on "Việc của tôi" by default.
    return user.role === 'employee' ? 'viec-cua-toi' : 'cay-gantt-4-tang';
  });

  // Core state — backend là source of truth. Initial state = rỗng;
  // được fill sau login qua useEffect bên dưới.
  const [tierItems, setTierItems] = useState<TierItem[]>([]);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const [teamTasks, setTeamTasks] = useState<TeamLeadTask[]>([]);

  const [employeeTasks, setEmployeeTasks] = useState<EmployeeTask[]>([]);

  /** Fetch toàn bộ data từ backend sau khi user login. Chạy lại khi user.id thay đổi. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ISS-007: Single source of truth — 1 endpoint /api/tasks cho cả 3 view
      // (Gantt, Giao việc nhóm, Việc của tôi). Transform sang 3 derived types.
      // Lưu ý: /api/tasks trả về DỮ LIỆU CẢ 4 TIER. Chỉ tier 4 mới là "đầu việc"
      // cá nhân (team lead / employee view) — tier 1/2/3 (dự án / giai đoạn / hạng mục)
      // chỉ hiển thị trên cây Gantt. Nếu không filter, manager xem "Việc của tôi"
      // sẽ thấy cả project/phase/bundle (vì seed cho manager làm owner) → bug.
      //
      // Phase F: tasks.currentDeliverable đã bỏ (chuyển sang daily_logs.result).
      // Phải chạy Promise.all với /api/daily-logs để merge log hôm nay vào
      // employeeTasks ngay từ đầu — nếu không, sau reload Status Strip sẽ
      // hiển thị "Chưa nộp" dù DB đã có daily_log.result thật (bug trước đây).
      const [tasksRes, logRes, memRes, histRes] = await Promise.all([
        api.listTasks(),
        api.listDailyLogs(),
        api.listTeamMembers(),
        api.listHistory(50),
      ]);
      if (cancelled) return;

      // Build lookup: taskNumId → daily_log của HÔM NAY (mới nhất trong ngày).
      const today = new Date().toISOString().slice(0, 10);
      const todayLogByTaskNum: Record<number, ReturnType<typeof apiToDailyLog>> = {};
      if (logRes.ok) {
        for (const raw of logRes.data.items) {
          const log = apiToDailyLog(raw);
          if (log.logDate !== today) continue;
          const numId = Number(log.taskId);
          if (!Number.isFinite(numId)) continue;
          if (todayLogByTaskNum[numId] !== undefined) continue;
          todayLogByTaskNum[numId] = log;
        }
      }

      if (tasksRes.ok) {
        const items = tasksRes.data.items;
        const tier4Only = items.filter((it) => it.tier === 4);
        setTierItems(items.map(apiToTierItem));
        setTeamTasks(tier4Only.map(apiToTeamLeadTask));
        // Merge log hôm nay vào currentDeliverable / description baseline trước
        // khi set state — đảm bảo render đầu đã có data, không flicker.
        setEmployeeTasks(
          tier4Only.map((api: any) => {
            const base = apiToEmployeeTask(api);
            const log: ReturnType<typeof apiToDailyLog> | undefined =
              todayLogByTaskNum[api.id];
            if (!log) return base;
            return {
              ...base,
              currentDeliverable: log.result ?? '',
              // desc form-prefill: nếu user đã ghi log hôm nay thì dùng description
              // của log đó (mới nhất) thay vì description gốc của task.
              description: log.description?.trim() ? log.description : base.description,
              lastUpdated: 'Hôm nay',
              // Fix #1: lấy progress mới nhất từ daily_log.progress hôm nay
              // để slider hiển thị đúng baseline. Tránh bug reset về 0 khi Save All.
              progress: log.progress ?? 0,
            };
          }),
        );
      }

      if (logRes.ok) {
        setDailyLogs(logRes.data.items.map(apiToDailyLog));
      }

      if (memRes.ok) {
        setTeamMembers(memRes.data.members.map(apiToTeamMember));
      }

      if (histRes.ok) {
        setHistory(histRes.data.items.map(apiToHistoryEntry));
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  // Sub-tasks + nhật ký thi công + history (cho DetailsDrawer)
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Danh sách user từ backend (cho dropdown "Người phụ trách" trong NewItemModal).
  // Admin thấy tất cả; Manager thấy user cùng phòng; Employee bị 403 (skip).
  // Initial = SEED_USERS để tránh flash rỗng khi đang fetch.
  const [directoryUsers, setDirectoryUsers] = useState<User[]>(SEED_USERS);

  /** Fetch /api/users sau khi login. Employee skip (backend 403). */
  useEffect(() => {
    if (user.role === 'employee') {
      setDirectoryUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await api.listUsers();
      if (cancelled) return;
      if (r.ok) {
        const rawDepts = (u: { departments?: string | null }): string[] => {
          const d = u.departments;
          if (!d) return [];
          return d.split(',').map((s) => s.trim()).filter(Boolean);
        };
        setDirectoryUsers(
          r.data.users.map((u) => ({
            id: String(u.id),
            username: u.username,
            fullname: u.fullname,
            email: u.email ?? undefined,
            role: u.role,
            departments: rawDepts(u) as User['departments'],
            initial: u.initial ?? u.fullname.charAt(0),
            avatar: u.avatar_url ?? undefined,
            password: '', // không cần plaintext ở client
          }))
        );
      }
      // Fail → giữ SEED_USERS (offline fallback)
    })();
    return () => { cancelled = true; };
  }, [user.id, user.role]);

  /** Ghi HistoryEntry vào state — được gọi từ các handler chính. */
  const logHistory = (
    entityType: HistoryEntry['entityType'],
    entityId: string,
    action: string
  ) => {
    setHistory((prev) => [
      ...prev,
      {
        id: uid('hist'),
        entityType,
        entityId,
        action,
        username: user.username,
        userName: user.fullname,
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      },
    ]);
  };

  // ---------------- Role-based data slicing ----------------
  // Manager: thấy descendants thuộc dept của mình (T2/T3/T4), đồng thời include
  // cả T1 project cha như là read-only context header — đúng pattern enterprise PM
  // (Jira, MS Project) để user không bị "mất bức tranh lớn".
  // Employee: chỉ thấy T4 của chính mình + parent chain (T3 → T2 → T1) làm read-only
  // context — minimal-leak pattern, đúng use case "task này thuộc dự án nào?".
  const visibleTierItems = useMemo<TierItem[]>(() => {
    if (user.role === 'admin' || user.role === 'director') return tierItems;
    if (user.role === 'manager') {
      const depts = user.departments ?? [];
      const result: TierItem[] = [];
      const seen = new Set<string>();

      // 1. Descendants (T2/T3/T4) thuộc dept của manager
      const descendants = tierItems.filter(
        (t) => t.tier >= 2 && (!t.department || depts.includes(t.department))
      );
      for (const d of descendants) {
        if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
      }

      // 2. Walk UP: với mỗi descendant, include cả parent chain até T1.
      //    → T1 project hiện như read-only context (DetailsDrawer đã có canEdit guard).
      for (const d of descendants) {
        let pid = d.parentId;
        while (pid) {
          if (seen.has(pid)) break;
          const parent = tierItems.find((p) => p.id === pid);
          if (!parent) break;
          result.push(parent);
          seen.add(pid);
          if (parent.tier === 1) break; // đã lên T1, dừng
          pid = parent.parentId;
        }
      }
      return result;
    }
    if (user.role === 'employee') {
      // 1. T4 của chính employee
      const myT4 = tierItems.filter(
        (t) => t.tier === 4 && t.ownerUsername === user.username
      );
      const result: TierItem[] = [];
      const seen = new Set<string>();

      for (const t of myT4) {
        if (!seen.has(t.id)) { result.push(t); seen.add(t.id); }
      }

      // 2. Walk UP: T4 → T3 → T2 → T1 (parent chain làm read-only context)
      for (const t of myT4) {
        let cur: string | undefined = t.parentId ?? undefined;
        while (cur) {
          if (seen.has(cur)) break;
          const parent = tierItems.find((p) => p.id === cur);
          if (!parent) break;
          result.push(parent);
          seen.add(cur);
          cur = parent.parentId ?? undefined;
        }
      }
      return result;
    }
    return [];
  }, [tierItems, user]);

  const visibleTeamMembers = useMemo<TeamMember[]>(() => {
    if (user.role === 'admin') return teamMembers;
    if (user.role === 'manager') {
      const depts = user.departments ?? [];
      return teamMembers.filter(
        (m) => !m.department || depts.includes(m.department)
      );
    }
    // Director & Employee: không truy cập tab giao việc nhóm
    return [];
  }, [teamMembers, user]);

  const visibleTeamTasks = useMemo<TeamLeadTask[]>(() => {
    if (user.role === 'admin') return teamTasks;
    if (user.role === 'manager') {
      const depts = user.departments ?? [];
      return teamTasks.filter(
        (t) => !t.department || depts.includes(t.department)
      );
    }
    // Director & Employee: không truy cập tab giao việc nhóm
    return [];
  }, [teamTasks, user]);

  const visibleEmployeeTasks = useMemo<EmployeeTask[]>(() => {
    if (user.role === 'admin') {
      // Admin xem tất cả employee tasks
      return employeeTasks;
    }
    if (user.role === 'director') {
      // BGĐ không có tab Việc của tôi nên trả về rỗng — tránh leak dữ liệu nhân viên
      return [];
    }
    // BUG-01 fix (FE): tab "Việc của tôi" của Manager chỉ hiển thị task mà CHÍNH HỌ là owner,
    // không lọc theo department nữa (sẽ lộ việc của nhân viên dưới quyền).
    // Pattern đồng nhất với employee ở dưới — case-insensitive username check.
    const usernameLower = user.username.toLowerCase();
    return employeeTasks.filter(
      (t) => t.ownerUsername?.toLowerCase() === usernameLower
    );
  }, [employeeTasks, user]);

  // ---------------- Modals & Drawers state ----------------
  const [selectedItemForDrawer, setSelectedItemForDrawer] = useState<TierItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  // Phase F: previewTask (DeliverablePreviewModal) + messageTarget (MessageModal) đã bỏ.
  // 3 bảng sub-resource tương ứng (task_deliverables, task_help_messages, messages) đã xoá.
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isNewPersonalTaskOpen, setIsNewPersonalTaskOpen] = useState(false);

  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success');
  const showToast = (
    msg: string,
    type: 'success' | 'error' | 'warning' = 'success'
  ) => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 3500);
  };

  /**
   * Tính lại tiến độ cộng dồn: T4→T3→T2→T1.
   * Pre-group theo parent trong 1 pass O(N) để tránh nested filter O(N²).
   */
  const recalculateRollup = (items: TierItem[]): TierItem[] => {
    // Explicit Map type — nếu không, TypeScript widen status/progress thành string/number
    // và các phép gán literal bên dưới bị reject.
    const itemsMap = new Map<string, TierItem>(
      items.map((i) => [i.id, { ...i }])
    );

    // 1 pass: group children by parent id
    const childrenByParent = new Map<string, TierItem[]>();
    for (const item of itemsMap.values()) {
      if (item.parentId) {
        const arr = childrenByParent.get(item.parentId);
        if (arr) arr.push(item);
        else childrenByParent.set(item.parentId, [item]);
      }
    }

    // Helper: tính avg + cập nhật status theo threshold (mirror backend logic).
    const applyRollup = (parent: TierItem, children: TierItem[], includeRunningStatus: boolean) => {
      if (children.length === 0) return;
      const avg = Math.round(
        children.reduce((acc, c) => acc + c.progress, 0) / children.length
      );
      parent.progress = avg;
      // ISS-007: TierItem.status là Tiếng Việt (string union). Cast any-string.
      const status = parent.status as string;
      if (avg === 100) parent.status = 'Đã xong' as TierItem['status'];
      else if (avg > 90) parent.status = 'Sắp xong' as TierItem['status'];
      else if (includeRunningStatus && avg > 0 &&
               (status === 'Đã xong' || status === 'Sắp xong')) {
        // Tier 1: nếu trước đó đã xong mà progress giảm → revert về 'Đang chạy'.
        // Tránh overwrite 'Chuẩn bị' khi avg = 0.
        parent.status = 'Đang chạy' as TierItem['status'];
      }
    };

    // Tier 3 ← Tier 4
    for (const item of itemsMap.values()) {
      if (item.tier === 3) applyRollup(item, childrenByParent.get(item.id) ?? [], false);
    }
    // Tier 2 ← Tier 3
    for (const item of itemsMap.values()) {
      if (item.tier === 2) applyRollup(item, childrenByParent.get(item.id) ?? [], false);
    }
    // Tier 1 ← Tier 2 (Fix Bổ sung-1: Tier 1 giờ update status)
    for (const item of itemsMap.values()) {
      if (item.tier === 1) applyRollup(item, childrenByParent.get(item.id) ?? [], true);
    }

    return Array.from(itemsMap.values());
  };

  /** Cập nhật 1 item trong cây 4 tầng + sync backend (backend tự rollup). */
  const handleUpdateTierItem = (updated: TierItem) => {
    // B9: bỏ dual-write rollup ở FE — backend giờ tự tính qua trigger + recomputeRollup.
    // FE chỉ giữ optimistic update cho UX mượt; backend là source of truth.
    const newItems = tierItems.map((item) => (item.id === updated.id ? updated : item));
    setTierItems(newItems);
    setSelectedItemForDrawer(updated);
    logHistory('task', updated.id, `Cập nhật tiến độ ${updated.code} → ${updated.progress}%`);
    // Sync lên backend nếu id là của row thật (không phải local placeholder).
    // ID frontend giờ là composite "<tier>-<num>" (vd "4-1"); extract số để gọi API.
    const numId = extractBackendId(updated.id);
    if (Number.isFinite(numId)) {
      fireAndForget(
        api.updateTask(updated.tier, numId, {
          title: updated.title,
          progress: updated.progress,
          status: viStatusToEnum(updated.status),
          priority: viPriorityToEnum(updated.priority),
          start_date: updated.startDate,
          end_date: updated.endDate,
          description: updated.description,
          management_notes: updated.managementNotes,
        }),
        `updateTask#${updated.id}`,
      );
    }
    showToast(`Đã cập nhật tiến độ ${updated.code} lên ${updated.progress}%`);
  };

  /** Thêm item mới vào cây 4 tầng: optimistic update trước, rồi sync backend. */
  const handleAddTierItem = async (newItemData: Partial<TierItem>) => {
    const localId = `tier-item-${Date.now()}`;
    const newItem: TierItem = {
      id: localId,
      code: newItemData.code || `NV-${Math.floor(Math.random() * 900)}`,
      tier: newItemData.tier || 4,
      tierName: newItemData.tierName || 'Tầng 4: Đầu việc',
      tierBadge: newItemData.tierBadge || 'VIỆC T4',
      title: newItemData.title || 'Đầu việc mới',
      parentId: newItemData.parentId,
      owner: newItemData.owner || {
        name: user.fullname,
        role: `${ROLE_HELLO[user.role]} · ${user.departments[0] ?? ''}`,
        initial: user.initial ?? user.fullname.charAt(0),
        avatar: user.avatar,
      },
      ownerUsername: newItemData.ownerUsername ?? '',
      department: newItemData.department ?? user.departments[0],
      // 2026-10: deadline → end_date; startDate mặc định = today nếu không có
      startDate: newItemData.startDate || new Date().toISOString().slice(0, 10),
      endDate: newItemData.endDate || '2099-12-31',
      progress: newItemData.progress || 0,
      status: newItemData.status || 'Chuẩn bị',
      priority: newItemData.priority || 'Trung bình',
      description: newItemData.description || 'Chưa có mô tả',
      // Phase F: bỏ deliverables (bảng task_deliverables đã xoá).
      managementNotes: newItemData.managementNotes || `Tạo bởi ${user.fullname}.`,
      gantt: newItemData.gantt || {
        startWeek: 2,
        endWeek: 3,
      },
    };

    // Optimistic update với rollup ngay để UI responsive
    const newItems = [...tierItems, newItem];
    setTierItems(recalculateRollup(newItems));
    logHistory(
      newItem.tier === 1 ? 'project' : newItem.tier === 2 ? 'phase' : newItem.tier === 3 ? 'bundle' : 'task',
      localId,
      `Tạo mới ${newItem.code}: ${newItem.title}`,
    );
    showToast(`Đã thêm thành công: ${newItem.title}`);

    // Sync lên backend — đợi response để replace local id bằng backend INTEGER id,
    // đảm bảo các PATCH sau gọi đúng endpoint.
    // parentId giờ là composite "<tier>-<num>" → extract numeric cho backend.
    const parentNumericId = newItem.parentId
      ? extractBackendId(newItem.parentId)
      : NaN;

    const result = await api.createTask({
      code: newItem.code,
      tier: newItem.tier,
      title: newItem.title,
      parent_id: parentNumericId,
      department_code: newItem.department,
      // ISS-006 fix: gửi owner_username thay vì undefined → backend tra cứu ID
      owner_username: newItem.ownerUsername,
      progress: newItem.progress,
      // Map status VN → enum DB
      status: viStatusToEnum(newItem.status),
      priority: viPriorityToEnum(newItem.priority),
      description: newItem.description,
      management_notes: newItem.managementNotes,
      start_date: newItem.startDate,
      end_date: newItem.endDate,
      start_week: newItem.gantt.startWeek,
      end_week: newItem.gantt.endWeek,
    });

    if (result.ok && result.data?.item?.id != null) {
      // Replace local id bằng composite id mới từ backend (giữ tier để walk cây đúng).
      const backendCompositeId = toCompositeId(newItem.tier, result.data.item.id);
      // Replace local id bằng backend id trong state (fix Bổ sung-3)
      // Đồng thời cập nhật code nếu backend đã generate lại (vd: NEW-XXXXXX)
      const backendItem = result.data.item;
      setTierItems((prev) =>
        prev.map((t) =>
          t.id === localId
            ? {
                ...t,
                id: backendCompositeId,
                code: backendItem.code ?? t.code,
                // Sync các field từ backend để khớp với DB.
                // Cast progress/status vì TierItemDto dùng string/number thay vì literal union.
                progress: typeof backendItem.progress === 'number'
                  ? backendItem.progress
                  : t.progress,
                status: (backendItem.status as TierItem['status']) ?? t.status,
              }
            : t
        )
      );
      // Cập nhật history entry id tương ứng
      setHistory((prev) =>
        prev.map((h) =>
          h.entityId === localId && h.entityType === (
            newItem.tier === 1 ? 'project' :
            newItem.tier === 2 ? 'phase' :
            newItem.tier === 3 ? 'bundle' : 'task'
          )
            ? { ...h, entityId: backendCompositeId }
            : h
        )
      );
    } else {
      console.warn(`[handleAddTierItem] Backend lưu thất bại: ${result.error?.message || 'unknown'}`);
      showToast(
        `Đã lưu local nhưng backend lỗi: ${result.error?.message || 'unknown'}`,
        'warning'
      );
    }
  };

  // Approve Team Task
  const handleApproveTeamTask = (taskId: string) => {
    setTeamTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'done' as const } : t))
    );
    logHistory('task', taskId, 'Nghiệm thu & duyệt hoàn thành');
    // Dual-write: sync lên backend (id là composite "<tier>-<num>").
    const numId = extractBackendId(taskId);
    if (Number.isFinite(numId)) {
      // Phase C: cần tier để dispatch; tìm trong tierItems.
      const found = tierItems.find((t) => String(t.id) === String(taskId));
      const tier = found?.tier ?? 4;
      fireAndForget(api.approveTask(tier, numId), `approveTask#${taskId}`);
    }
    showToast('Đã phê duyệt nghiệm thu công việc!');
  };

  // Phase F: handleResolveHelp đã bỏ. Escalation giờ là tasks.blocker_note
  // (NV ghi 1 dòng, manager xem khi mở task). Không cần ticket workflow.

  /** Toggle trạng thái done/doing của EmployeeTask — sync backend. */
  const handleToggleEmployeeTask = (taskId: string) => {
    setEmployeeTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          const isDone = t.status === 'done';
          return {
            ...t,
            status: isDone ? 'doing' : 'done',
            lastUpdated: isDone ? 'Đang làm' : 'Vừa báo xong việc',
          };
        }
        return t;
      })
    );
    showToast('Tuyệt vời! Kết quả công việc đã tự động cập nhật lên bảng của Trưởng phòng.');
    // Sync lên backend — chỉ gọi nếu id trỏ về row thật (composite "<tier>-<num>").
    const numId = extractBackendId(taskId);
    if (Number.isFinite(numId)) {
      // Phase C: cần tier; lookup trong tierItems (đã merge từ 4 bảng).
      const found = tierItems.find((t) => String(t.id) === String(taskId));
      const tier = found?.tier ?? 4;
      fireAndForget(
        api.toggleTask(tier, numId),
        `toggleTask#${taskId}`,
      );
    }
  };

  /** Chuyển task từ pending → doing. Dùng PATCH thay vì toggle (toggle chỉ done↔doing). */
  const handleStartEmployeeTask = (taskId: string) => {
    setEmployeeTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'doing' } : t))
    );
    showToast('Trạng thái chuyển sang: Đang tiến hành làm.');
    const numId = extractBackendId(taskId);
    if (Number.isFinite(numId)) {
      const found = tierItems.find((t) => String(t.id) === String(taskId));
      const tier = found?.tier ?? 4;
      fireAndForget(
        api.updateTask(tier, numId, { status: 'doing' }),
        `startEmployeeTask#${taskId}`,
      );
    }
  };

  // Phase F: handleUpdateEmployeeDeliverable đã bỏ. "Kết quả bàn giao" giờ
  // là daily_log.result của ngày hôm nay. ViecCuaToiView gọi onAddDailyLog.

  // Phase F: handleAddEmployeeNote đã bỏ (task_notes bảng xoá). Ghi chú
  // cho sếp giờ dùng daily_log.obstacle hoặc tasks.blocker_note.

  // Phase F: handleSendHelpRequest đã bỏ (help_requests bảng xoá).
  // Escalation giờ là 1 dòng tasks.blocker_note (NV viết trong ViecCuaToiView).

  /** Set blocker_note trên task — escalation thay cho help_requests cũ. */
  const handleSetBlocker = (taskId: string, note: string) => {
    const trimmed = note.trim();
    setEmployeeTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, blockerNote: trimmed } : t))
    );
    if (!trimmed) return;
    const numId = extractBackendId(taskId);
    if (!Number.isFinite(numId)) return;
    const found = tierItems.find((t) => String(t.id) === String(taskId));
    const tier = found?.tier ?? 4;
    fireAndForget(
      api.setTaskBlocker(tier, numId, trimmed),
      `setBlocker#${taskId}`,
    );
    showToast('Đã ghi nhận vướng mắc. Trưởng phòng sẽ xem khi mở task.');
  };

  /** Tạo việc cá nhân (không có trong tier tree). */
  const handleAddPersonalTask = (title: string, deadline: string, notes: string) => {
    // Ưu tiên directoryUsers (từ /api/users), fallback về onlineUsers rồi SEED_USERS (offline).
    // Employee không gọi được /api/users (403), thường dùng onlineUsers từ AuthContext.
    const sourceUsers = directoryUsers.length > 0 ? directoryUsers : onlineUsers;
    const manager = findManagerOf(
      user,
      sourceUsers.length > 0 ? sourceUsers : SEED_USERS,
    );
    const newTask: EmployeeTask = {
      id: `emp-task-${Date.now()}`,
      code: `NV-${Math.floor(100 + Math.random() * 900)}`,
      bundleName: 'Việc cá nhân',
      title,
      description: notes || 'Nhiệm vụ cá nhân tự ghi chú.',
      currentDeliverable: 'Đang chuẩn bị triển khai',
      lastUpdated: 'Vừa tạo',
      deadline,
      isToday: deadline.includes('Hôm nay'),
      status: 'doing',
      // Fix #1: personal task mới tạo luôn bắt đầu từ 0%.
      progress: 0,
      ownerUsername: user.username,
      department: user.departments[0],
      manager: {
        name: manager?.fullname ?? user.fullname, // fallback cho director/admin
        role: manager
          ? `${ROLE_HELLO[manager.role]} · ${manager.departments[0] ?? ''}`
          : `${ROLE_HELLO[user.role]} · ${user.departments[0] ?? ''}`,
        avatar: manager?.avatar ?? user.avatar ?? '',
      },
      // Phase F: bỏ notesCount/notes (task_notes bảng xoá). Nội dung `notes`
      // từ NewPersonalTaskModal giờ được lưu trong description + daily_log.
    };

    setEmployeeTasks((prev) => [newTask, ...prev]);
    logHistory('task', newTask.id, `Tạo việc cá nhân: "${title}"`);
    // Phase C: dùng createTask chuẩn (không còn alias createEmployeeTask).
    fireAndForget(
      api.createTask({
        tier: 4,
        title,
        description: notes || newTask.description,
        end_date: deadline,
        priority: 'normal',
        status: 'pending',
      }),
      `createTask#${newTask.code}`,
    );
    showToast(`Đã thêm việc cá nhân: "${title}"`);
  };

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadCount={teamTasks.filter((t) => t.status === 'need_help').length}
      />

      <main className="w-full pt-14 flex-1">
        {activeTab === 'cay-gantt-4-tang' && (
          <Gantt4TangView
            tierItems={visibleTierItems}
            currentUser={user}
            onSelectItem={(item) => {
              setSelectedItemForDrawer(item);
              setIsDrawerOpen(true);
            }}
            onOpenNewModal={() => setIsNewItemModalOpen(true)}
            onExport={() => setIsExportModalOpen(true)}
          />
        )}

        {activeTab === 'giao-viec-nhom' &&
          (user.role === 'employee' || user.role === 'director' ? (
            <ForbiddenView role={user.role} />
          ) : (
            <GiaoViecNhomView
              teamMembers={visibleTeamMembers}
              tasks={visibleTeamTasks}
              onApproveTask={handleApproveTeamTask}
              onOpenNewTaskModal={() => setIsNewItemModalOpen(true)}
              onOpenNewBundleModal={() => setIsNewItemModalOpen(true)}
            />
          ))}

        {activeTab === 'viec-cua-toi' &&
          (user.role === 'director' ? (
            <ForbiddenView role={user.role} />
          ) : (
            <ViecCuaToiView
              currentUser={user}
              tasks={visibleEmployeeTasks}
              dailyLogs={dailyLogs}
              onToggleDone={handleToggleEmployeeTask}
              onStartTask={handleStartEmployeeTask}
              onAddDailyLog={(taskId, desc, result, obstacle, progress) => {
                const finalProgress = progress ?? 0;
                const task = tierItems.find((t) => t.id === taskId);
                if (!task) return;
                if (!canAddDailyLog(user, task)) {
                  showToast('Bạn không có quyền ghi nhật ký cho task này.');
                  return;
                }
                // Cập nhật local state trước (optimistic). NV sẽ thấy ngay
                // task.currentDeliverable = result mà không cần reload.
                // Sync blockerNote từ obstacle để status "Có vướng mắc" phản
                // ánh đúng ý NV sau khi ghi nhật ký inline.
                setEmployeeTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? {
                          ...t,
                          currentDeliverable: result || '',
                          blockerNote: obstacle ? obstacle.trim() : t.blockerNote,
                          lastUpdated: 'Vừa ghi nhật ký',
                        }
                      : t,
                  )
                );
                setDailyLogs((prev) => [
                  {
                    id: uid('log'),
                    taskId,
                    logDate: new Date().toISOString().slice(0, 10),
                    description: desc,
                    result,
                    obstacle,
                    progress: finalProgress,
                    username: user.username,
                    userName: user.fullname,
                    userRole: `${ROLE_LABEL[user.role]} · ${user.departments[0] ?? ''}`,
                  },
                  ...prev,
                ]);
                logHistory('daily_log', taskId, `Ghi nhật ký thi công (+${finalProgress}%)`);
                const taskNumId = extractBackendId(taskId);
                if (Number.isFinite(taskNumId)) {
                  fireAndForget(
                    api.addDailyLog({
                      taskId: taskNumId,
                      description: desc,
                      result,
                      obstacle,
                      progress: finalProgress,
                    }),
                    `addDailyLog#${taskId}`,
                  );
                }
                showToast('Đã ghi nhật ký thi công mới.');
              }}
              onSaveAllLogs={(entries) => {
                // Batch save — 1 cú click lưu N task. Tối ưu N+1 network call.
                // Mỗi entry qua cùng pipeline (canAddDailyLog guard + optimistic
                // update + audit + fireAndForget API) nhưng gom toast thành summary.
                let saved = 0;
                let skipped = 0;
                for (const e of entries) {
                  const finalProgress = e.progress ?? 0;
                  const task = tierItems.find((t) => t.id === e.taskId);
                  if (!task) {
                    skipped++;
                    continue;
                  }
                  if (!canAddDailyLog(user, task)) {
                    skipped++;
                    continue;
                  }
                  setEmployeeTasks((prev) =>
                    prev.map((t) =>
                      t.id === e.taskId
                        ? {
                            ...t,
                            currentDeliverable: e.result || '',
                            blockerNote: e.obstacle ? e.obstacle.trim() : t.blockerNote,
                            lastUpdated: 'Vừa ghi nhật ký',
                          }
                        : t,
                    ),
                  );
                  setDailyLogs((prev) => [
                    {
                      id: uid('log'),
                      taskId: e.taskId,
                      logDate: new Date().toISOString().slice(0, 10),
                      description: e.desc,
                      result: e.result,
                      obstacle: e.obstacle,
                      progress: finalProgress,
                      username: user.username,
                      userName: user.fullname,
                      userRole: `${ROLE_LABEL[user.role]} · ${user.departments[0] ?? ''}`,
                    },
                    ...prev,
                  ]);
                  logHistory(
                    'daily_log',
                    e.taskId,
                    `Ghi nhật ký thi công (+${finalProgress}%)`,
                  );
                  const taskNumId = extractBackendId(e.taskId);
                  if (Number.isFinite(taskNumId)) {
                    fireAndForget(
                      api.addDailyLog({
                        taskId: taskNumId,
                        description: e.desc,
                        result: e.result,
                        obstacle: e.obstacle,
                        progress: finalProgress,
                      }),
                      `addDailyLog#${e.taskId}`,
                    );
                  }
                  saved++;
                }
                if (saved > 0) {
                  const msg =
                    skipped > 0
                      ? `Đã lưu ${saved} nhật ký (bỏ qua ${skipped} task không có quyền).`
                      : `Đã lưu ${saved} nhật ký.`;
                  showToast(msg);
                } else if (skipped > 0) {
                  showToast('Không có task nào được lưu (thiếu quyền).', 'warning');
                }
              }}
              onOpenNewPersonalTaskModal={() => setIsNewPersonalTaskOpen(true)}
            />
          ))}

        {activeTab === 'bao-cao' &&
          (user.role === 'employee' ? (
            <ForbiddenView role="employee" />
          ) : (
            <BaoCaoTongQuanView
              tierItems={visibleTierItems}
              teamMembers={visibleTeamMembers}
              teamTasks={visibleTeamTasks}
              dailyLogs={dailyLogs}
              currentUser={user}
              onExport={() => setIsExportModalOpen(true)}
            />
          ))}
      </main>

      {/* Footer */}
      <footer className="w-full bg-white border-t border-[#e5eeff] py-4">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 flex items-center justify-center gap-2 text-[#565e74] text-[12px]">
          <span>© 2026 Hệ thống công việc và báo cáo TAG</span>
        </div>
      </footer>

      {/* 8 Core Fields Slide-over Inspector Drawer */}
      <DetailsDrawer
        item={selectedItemForDrawer}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateItem={handleUpdateTierItem}
        dailyLogs={dailyLogs}
        history={history}
        allTierItems={tierItems}
        currentUser={user}
        onAddDailyLog={(taskId, desc, result, obstacle, progress) => {
          const finalProgress = progress ?? 0;
          // A7 guard: chỉ owner task hoặc manager trong phòng ban được ghi nhật ký.
          const task = tierItems.find((t) => t.id === taskId);
          if (!task) return;
          if (!canAddDailyLog(user, task)) {
            showToast('Bạn không có quyền ghi nhật ký cho task này.');
            return;
          }
          const newLog: DailyLog = {
            id: uid('log'),
            taskId,
            logDate: new Date().toISOString().slice(0, 10),
            description: desc,
            result,
            obstacle,
            progress: finalProgress,
            username: user.username,
            userName: user.fullname,
            userRole: `${ROLE_LABEL[user.role]} · ${user.departments[0] ?? ''}`,
          };
          setDailyLogs((prev) => [newLog, ...prev]);
          logHistory('daily_log', taskId, `Ghi nhật ký thi công (+${finalProgress}%)`);
          // Dual-write: sync daily log mới lên backend. taskId là composite '<tier>-<num>'.
          const taskNumId = extractBackendId(taskId);
          if (Number.isFinite(taskNumId)) {
            fireAndForget(
              api.addDailyLog({
                taskId: taskNumId,
                description: desc,
                result,
                obstacle,
                progress: finalProgress,
              }),
              `addDailyLog#${taskId}`,
            );
          }
          showToast('Đã ghi nhật ký thi công mới.');
        }}
      />

      {/* Add New Item Modal */}
      <NewItemModal
        isOpen={isNewItemModalOpen}
        onClose={() => setIsNewItemModalOpen(false)}
        onAddItem={handleAddTierItem}
        parents={tierItems.map((i) => ({ id: i.id, title: i.title, tier: i.tier }))}
        currentUser={user}
        // Filter theo phòng ban của user; admin (departments=[]) thấy hết.
        deptUsers={directoryUsers
          .filter((u) => {
            if (user.departments.length === 0) return true;
            return u.departments?.some((d) => user.departments.includes(d));
          })
          .map((u) => ({ username: u.username, fullname: u.fullname }))}
      />

      {/* Phase F: DeliverablePreviewModal + MessageModal đã bỏ.
            Hai component này chỉ render preview file PDF/spreadsheet/photo và
            nhắn tin 1-1 — tương ứng với 2 bảng đã xoá. */}

      {/* Export Report Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onSuccess={(type) => {
          showToast(
            `Đã xuất thành công tệp ${
              type === 'pdf' ? 'He-thong-TAG-Q4.pdf' : 'Bao-cao-TAG.xlsx'
            }!`
          );
        }}
      />

      {/* New Personal Task Modal */}
      <NewPersonalTaskModal
        isOpen={isNewPersonalTaskOpen}
        onClose={() => setIsNewPersonalTaskOpen(false)}
        onAdd={handleAddPersonalTask}
        currentUser={user}
      />

      {/* Toast Notification */}
      <Toast message={toastMessage} type={toastType} />
    </div>
  );
}

/**
 * Inline forbidden screen for tabs the current role shouldn't see.
 * Kept tiny so it doesn't pull another component file.
 */
const ForbiddenView: React.FC<{ role: User['role'] }> = ({ role }) => {
  const isDirector = role === 'director';
  return (
    <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-12 flex flex-col items-center text-center gap-3">
      <div className="w-14 h-14 rounded-full bg-[#ffdad6]/40 text-[#93000a] flex items-center justify-center">
        <span className="material-symbols-outlined text-[28px]">lock</span>
      </div>
      <h2 className="text-[20px] font-bold text-[#0b1c30]">Bạn không có quyền truy cập</h2>
      {isDirector ? (
        <p className="text-[13px] text-[#565e74] max-w-md leading-relaxed">
          Vai trò BGĐ chỉ truy cập <span className="font-semibold text-[#004ac6]">Cây công việc</span> và
          <span className="font-semibold text-[#004ac6]"> Báo cáo</span>.
        </p>
      ) : (
        <p className="text-[13px] text-[#565e74] max-w-md">
          Vai trò <span className="font-semibold">{ROLE_LABEL[role]}</span> chỉ được phép truy cập
          mục <span className="font-semibold text-[#004ac6]">Việc của tôi</span>.
        </p>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}