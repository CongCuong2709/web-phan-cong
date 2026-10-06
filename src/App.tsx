import React, { useState, useEffect, useMemo } from 'react';
import {
  ActiveAppTab,
  TierItem,
  TeamMember,
  TeamLeadTask,
  EmployeeTask,
  QuickHelpRequest,
  User,
  ROLE_LABEL,
  SubTask,
  DailyLog,
  HistoryEntry,
} from './types';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { canAddDailyLog, canEditSubtask, findManagerOf, uid } from './auth/permissions';
import { api, fireAndForget } from './lib/apiClient';
import {
  apiToTierItem,
  apiToTeamLeadTask,
  apiToEmployeeTask,
  apiToHelpRequest,
  apiToSubtask,
  apiToDailyLog,
  apiToTeamMember,
  apiToHistoryEntry,
} from './lib/transforms';
import { SEED_USERS } from './data/users';
import { Header } from './components/Header';
import { Gantt4TangView } from './components/Gantt4TangView';
import { GiaoViecNhomView } from './components/GiaoViecNhomView';
import { ViecCuaToiView } from './components/ViecCuaToiView';
import { BaoCaoTongQuanView } from './components/BaoCaoTongQuanView';
import { DetailsDrawer } from './components/DetailsDrawer';
import { NewItemModal } from './components/NewItemModal';
import { DeliverablePreviewModal } from './components/DeliverablePreviewModal';
import { MessageModal } from './components/MessageModal';
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
  const { user, logout } = useAuth();

  if (!user) {
    return <LoginPage />;
  }

  return <AuthenticatedApp key={user.id} user={user} />;
}

interface AuthenticatedAppProps {
  user: User;
}

function AuthenticatedApp({ user }: AuthenticatedAppProps) {
  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveAppTab>(() => {
    // Employees land on "Việc của tôi" by default.
    return user.role === 'employee' ? 'viec-cua-toi' : 'cay-gantt-4-tang';
  });

  // Core state — full data store, filtered per render below.
  // Phase 1+: backend là source of truth duy nhất. Initial state = empty.
  // Sau khi user login, fetch fresh data từ API xuống (xem useEffect bên dưới).
  const [tierItems, setTierItems] = useState<TierItem[]>([]);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const [teamTasks, setTeamTasks] = useState<TeamLeadTask[]>([]);

  const [employeeTasks, setEmployeeTasks] = useState<EmployeeTask[]>([]);

  const [helpRequests, setHelpRequests] = useState<QuickHelpRequest[]>([]);

  /** Fetch toàn bộ data từ backend sau khi user login. Chạy lại khi user.id thay đổi. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Tier items
      const tierRes = await api.listTierItems();
      if (!cancelled && tierRes.ok) {
        setTierItems(tierRes.data.items.map(apiToTierItem));
      }

      // Team members (derive từ backend users + tier items)
      const memRes = await api.listTeamMembers();
      if (!cancelled && memRes.ok) {
        setTeamMembers(memRes.data.members.map(apiToTeamMember));
      }

      // Team tasks
      const teamRes = await api.listTeamTasks();
      if (!cancelled && teamRes.ok) {
        setTeamTasks(teamRes.data.tasks.map(apiToTeamLeadTask));
      }

      // Employee tasks
      const empRes = await api.listEmployeeTasks();
      if (!cancelled && empRes.ok) {
        setEmployeeTasks(empRes.data.tasks.map(apiToEmployeeTask));
      }

      // Help requests
      const helpRes = await api.listHelpRequests();
      if (!cancelled && helpRes.ok) {
        setHelpRequests(helpRes.data.requests.map(apiToHelpRequest));
      }

      // Subtasks + Daily logs (cho DetailsDrawer)
      const subRes = await api.listSubtasks();
      if (!cancelled && subRes.ok) {
        setSubtasks(subRes.data.items.map(apiToSubtask));
      }
      const logRes = await api.listDailyLogs();
      if (!cancelled && logRes.ok) {
        setDailyLogs(logRes.data.items.map(apiToDailyLog));
      }

      // History (global recent)
      const histRes = await api.listHistory(50);
      if (!cancelled && histRes.ok) {
        setHistory(histRes.data.items.map(apiToHistoryEntry));
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  // Sub-tasks + nhật ký thi công + history (cho DetailsDrawer)
  // Phase 1+: fetch từ API sau login; không dùng hardcoded fallback nữa.
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // C9 fix: helper ghi HistoryEntry kèm entityType/entityId phù hợp.
  // Được gọi từ các handler chính (handleUpdateTierItem, handleAddTierItem,
  // handleAddDailyLog, handleApproveTeamTask, handleResolveHelp, ...).
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
        let cur: string | undefined = t.parentId;
        while (cur) {
          if (seen.has(cur)) break;
          const parent = tierItems.find((p) => p.id === cur);
          if (!parent) break;
          result.push(parent);
          seen.add(cur);
          cur = parent.parentId;
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
    if (user.role === 'manager') {
      const depts = user.departments ?? [];
      return employeeTasks.filter(
        (t) => !t.department || depts.includes(t.department)
      );
    }
    // Employees only see their own tasks (case-insensitive username check).
    const usernameLower = user.username.toLowerCase();
    return employeeTasks.filter((t) => t.ownerUsername?.toLowerCase() === usernameLower);
  }, [employeeTasks, user]);

  // ---------------- Modals & Drawers state ----------------
  const [selectedItemForDrawer, setSelectedItemForDrawer] = useState<TierItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [previewTask, setPreviewTask] = useState<TeamLeadTask | null>(null);
  const [messageTarget, setMessageTarget] = useState<{ name: string; taskTitle: string } | null>(
    null
  );
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isNewPersonalTaskOpen, setIsNewPersonalTaskOpen] = useState(false);

  // Toast state
  // Fix Bổ sung-5: showToast giờ nhận type để Toast component hiển thị màu/icon phù hợp
  // (success/error/warning). Trước đây luôn là success → user không phân biệt được lỗi API.
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

  // Roll-up recalculation helper
  // Fix Bổ sung-2: pre-group childrenByParent trong 1 pass O(N) thay vì filter 3 lần
  // trong mỗi tier loop → cũ O(N²), giờ O(N). Quan trọng khi scale lên 500+ items.
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
      if (avg === 100) parent.status = 'Đã xong';
      else if (avg > 90) parent.status = 'Sắp xong';
      else if (includeRunningStatus && avg > 0 &&
               (parent.status === 'Đã xong' || parent.status === 'Sắp xong')) {
        // Tier 1: nếu trước đó đã xong mà progress giảm → revert về 'Đang chạy'.
        // Tránh overwrite 'Chuẩn bị' khi avg = 0.
        parent.status = 'Đang chạy';
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

  // Update item in 4-Tier tree
  const handleUpdateTierItem = (updated: TierItem) => {
    const newItems = tierItems.map((item) => (item.id === updated.id ? updated : item));
    const recalculated = recalculateRollup(newItems);
    setTierItems(recalculated);
    setSelectedItemForDrawer(updated);
    // C9 fix: ghi lịch sử thao tác.
    logHistory('task', updated.id, `Cập nhật tiến độ ${updated.code} → ${updated.progress}%`);
    // Dual-write: sync lên backend (fire-and-forget).
    // TierItem.id ở frontend là 'tier_item-XYZ' nhưng backend dùng INTEGER; nếu
    // id là số thì sync được, nếu là string seed → skip (Phase 2 sẽ migrate ID).
    if (typeof updated.id === 'number' || /^\d+$/.test(String(updated.id))) {
      fireAndForget(
        api.updateTierItem(Number(updated.id), {
          title: updated.title,
            progress: updated.progress,
            status: updated.status,
            priority: updated.priority,
            deadline: updated.deadline,
            description: updated.description,
            management_notes: updated.managementNotes,
            start_week: updated.gantt.startWeek,
            end_week: updated.gantt.endWeek,
            gantt_label: updated.gantt.label,
            gantt_bar_color: updated.gantt.barColor,
          }),
          `updateTierItem#${updated.id}`,
      );
    }
    showToast(`Đã cập nhật tiến độ ${updated.code} lên ${updated.progress}% (Tự động cộng dồn)`);
  };

  // Add new item into 4-Tier tree
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
      ownerUsername: newItemData.ownerUsername,
      department: newItemData.department ?? user.departments[0],
      deadline: newItemData.deadline || '31/10/2026',
      progress: newItemData.progress || 0,
      status: newItemData.status || 'Chuẩn bị',
      priority: newItemData.priority || 'Trung bình',
      description: newItemData.description || 'Chưa có mô tả',
      deliverables: newItemData.deliverables || [
        { id: `del-${Date.now()}`, title: 'Hoàn tất bàn giao', completed: false },
      ],
      managementNotes: newItemData.managementNotes || `Tạo bởi ${user.fullname}.`,
      gantt: newItemData.gantt || {
        startWeek: 2,
        endWeek: 3,
        barColor: '#004ac6',
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

    // Sync lên backend — đợi response để lấy id thật
    // Fix TD-02: parentId từ form đã là id (string), chỉ cần Number() trực tiếp.
    //           KHÔNG lookup theo code (id chứ không phải code mới đúng).
    // Fix Bổ sung-3: sau khi backend trả về item thật, thay local id bằng backend id
    //                để các PATCH sau gọi đúng endpoint.
    const parentNumericId = newItem.parentId
      ? Number(newItem.parentId) || undefined
      : undefined;

    const result = await api.createTierItem({
      code: newItem.code,
      tier: newItem.tier,
      title: newItem.title,
      parent_id: parentNumericId,
      department_code: newItem.department,
      owner_user_id: undefined, // backend sẽ default = current user
      progress: newItem.progress,
      status: newItem.status,
      priority: newItem.priority,
      description: newItem.description,
      management_notes: newItem.managementNotes,
      deadline: newItem.deadline,
      start_week: newItem.gantt.startWeek,
      end_week: newItem.gantt.endWeek,
      gantt_label: newItem.gantt.label,
      gantt_bar_color: newItem.gantt.barColor,
    });

    if (result.ok && result.data?.item?.id != null) {
      const backendId = String(result.data.item.id);
      // Replace local id bằng backend id trong state (fix Bổ sung-3)
      // Đồng thời cập nhật code nếu backend đã generate lại (vd: NEW-XXXXXX)
      const backendItem = result.data.item;
      setTierItems((prev) =>
        prev.map((t) =>
          t.id === localId
            ? {
                ...t,
                id: backendId,
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
            ? { ...h, entityId: backendId }
            : h
        )
      );
    } else {
      console.warn(`[handleAddTierItem] Backend lưu thất bại: ${result.error?.message || 'unknown'}`);
      // Fix Bổ sung-5: báo lỗi API rõ ràng (toast error) để user biết dữ liệu chỉ
      // tồn tại local. Trước đây silent → user tưởng backend OK.
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
    // Dual-write: sync lên backend (nếu id là số).
    if (typeof taskId === 'number' || /^\d+$/.test(String(taskId))) {
      fireAndForget(api.approveTask(Number(taskId)), `approveTask#${taskId}`);
    }
    showToast('Đã phê duyệt nghiệm thu công việc!');
  };

  // Resolve Help Request
  const handleResolveHelp = (taskId: string) => {
    const task = teamTasks.find((t) => t.id === taskId);
    setTeamTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' as const } : t))
    );
    logHistory('task', taskId, 'Xử lý yêu cầu hỗ trợ từ nhân viên');
    if (typeof taskId === 'number' || /^\d+$/.test(String(taskId))) {
      fireAndForget(api.resolveHelp(Number(taskId)), `resolveHelp#${taskId}`);
    }
    // Update the team member who owns this task (by ownerName matching member.name)
    if (task) {
      setTeamMembers((prev) =>
        prev.map((m) =>
          m.name === task.ownerName
            ? {
                ...m,
                needHelp: false,
                urgentNote: undefined,
                statusText: '2 việc đang làm',
                onTimeRate: '100% đúng hạn',
              }
            : m
        )
      );
    }
    showToast('Đã ghi nhận hỗ trợ! Trạng thái chuyển sang: Đang làm bình thường');
  };

  // Toggle Employee Task Done
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
  };

  // Start task in employee view
  const handleStartEmployeeTask = (taskId: string) => {
    setEmployeeTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'doing' } : t))
    );
    showToast('Trạng thái chuyển sang: Đang tiến hành làm.');
  };

  // Update deliverable text
  const handleUpdateEmployeeDeliverable = (taskId: string, newText: string) => {
    setEmployeeTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, currentDeliverable: newText, lastUpdated: 'Vừa cập nhật' }
          : t
      )
    );
    showToast('Đã lưu kết quả bàn giao mới!');
  };

  // Fix UI-03: thêm ghi chú vào EmployeeTask — immutable update đúng cách
  // (trước đây ViecCuaToiView mutate trực tiếp task.notes — vi phạm React).
  const handleAddEmployeeNote = (taskId: string, noteText: string) => {
    setEmployeeTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              notes: [...(t.notes ?? []), noteText],
              notesCount: (t.notesCount ?? 0) + 1,
            }
          : t
      )
    );
    showToast('Đã gửi ghi chú cho Trưởng phòng');
    // TODO Phase 2: wire lên POST /api/employee-tasks/:id/notes khi backend có endpoint
  };

  // Send help request from Employee (uses real logged-in user)
  const handleSendHelpRequest = (
    req: Omit<QuickHelpRequest, 'id' | 'timestamp' | 'status'>
  ) => {
    const newReq: QuickHelpRequest = {
      id: `help-${Date.now()}`,
      timestamp: 'Vừa xong',
      status: 'pending',
      ...req,
    };
    setHelpRequests((prev) => [newReq, ...prev]);

    setTeamTasks((prev) => [
      {
        id: uid('task-urgent'),
        code: `NV-CANDAY-${Date.now().toString(36).toUpperCase()}`,
        title: `Yêu cầu hỗ trợ từ ${req.sender}: ${req.reason}`,
        category: 'Hỗ trợ khẩn',
        deliverableType: 'text',
        deliverableText: req.message,
        ownerName: req.sender,
        ownerAvatar: user.avatar,
        ownerUsername: user.username,
        department: user.departments[0],
        submittedAt: 'Vừa báo',
        status: 'need_help',
        priority: 'Cao',
        helpMessage: {
          author: req.sender,
          message: req.message,
          timeAgo: 'Vừa xong',
        },
      },
      ...prev,
    ]);

    showToast(`Lời nhắn đã gửi tới Trưởng phòng phụ trách (phòng ban ${user.departments[0] ?? ''})!`);
  };

  // Add personal task (uses current user info)
  const handleAddPersonalTask = (title: string, deadline: string, notes: string) => {
    // C4 fix: tìm đúng Trưởng phòng phụ trách thay vì gán chính employee.
    const manager = findManagerOf(user, SEED_USERS);
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
      ownerUsername: user.username,
      department: user.departments[0],
      manager: {
        name: manager?.fullname ?? user.fullname, // fallback cho director/admin
        role: manager
          ? `${ROLE_HELLO[manager.role]} · ${manager.departments[0] ?? ''}`
          : `${ROLE_HELLO[user.role]} · ${user.departments[0] ?? ''}`,
        avatar: manager?.avatar ?? user.avatar ?? '',
      },
      notesCount: notes ? 1 : 0,
      notes: notes ? [notes] : [],
    };

    setEmployeeTasks((prev) => [newTask, ...prev]);
    logHistory('task', newTask.id, `Tạo việc cá nhân: "${title}"`);
    // Dual-write: sync việc cá nhân lên backend.
    fireAndForget(
      api.createEmployeeTask({
        title,
        description: notes || newTask.description,
        deadline,
      }),
      `createEmployeeTask#${newTask.code}`,
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
              onResolveHelp={handleResolveHelp}
              onOpenNewTaskModal={() => setIsNewItemModalOpen(true)}
              onOpenNewBundleModal={() => setIsNewItemModalOpen(true)}
              onPreviewDeliverable={(task) => setPreviewTask(task)}
              onSendMessage={(name, title) => setMessageTarget({ name, taskTitle: title })}
            />
          ))}

        {activeTab === 'viec-cua-toi' &&
          (user.role === 'director' ? (
            <ForbiddenView role={user.role} />
          ) : (
            <ViecCuaToiView
              currentUser={user}
              tasks={visibleEmployeeTasks}
              onToggleDone={handleToggleEmployeeTask}
              onStartTask={handleStartEmployeeTask}
              onUpdateDeliverable={handleUpdateEmployeeDeliverable}
              onAddNote={handleAddEmployeeNote}
              onSendHelpRequest={handleSendHelpRequest}
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
              onExport={() => setIsExportModalOpen(true)}
            />
          ))}
      </main>

      {/* Footer */}
      <footer className="w-full bg-white border-t border-[#e5eeff] py-4">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[#565e74] text-[12px]">
          <span>
            © 2026 Tiến độ 4 Tầng & Việc Nhóm Enterprise • Quản trị điều hành chính xác & trực quan
          </span>
          <span className="text-[#565e74]/70">
            Dự án (T1) → Giai đoạn (T2) → Hạng mục (T3) → Đầu việc (T4)
          </span>
        </div>
      </footer>

      {/* 8 Core Fields Slide-over Inspector Drawer */}
      <DetailsDrawer
        item={selectedItemForDrawer}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateItem={handleUpdateTierItem}
        subtasks={subtasks}
        dailyLogs={dailyLogs}
        history={history}
        allTierItems={tierItems}
        currentUser={user}
        onUpdateSubtaskProgress={(subId, progress) => {
          const subtask = subtasks.find((s) => s.id === subId);
          if (!subtask) return;
          // A8 guard: kiểm tra quyền sửa SubTask. Manager cần biết parent item
          // để xác định department; tìm qua subtask.taskId.
          const parentItem = tierItems.find((t) => t.id === subtask.taskId);
          if (!canEditSubtask(user, subtask, parentItem)) {
            showToast('Bạn không có quyền cập nhật SubTask này.');
            return;
          }
          setSubtasks((prev) =>
            prev.map((s) => (s.id === subId ? { ...s, progress } : s))
          );
          logHistory('subtask', subId, `Cập nhật nhanh SubTask → ${progress}%`);
        }}
        onAddDailyLog={(subtaskId, desc, result, obstacle, progress) => {
          const finalProgress = progress ?? 0;
          const subtask = subtasks.find((s) => s.id === subtaskId);
          if (!subtask) return;
          // A7 guard: chỉ assignee SubTask hoặc manager trong phòng ban được ghi nhật ký.
          const parentItem = tierItems.find((t) => t.id === subtask.taskId);
          if (!canAddDailyLog(user, subtask, parentItem)) {
            showToast('Bạn không có quyền ghi nhật ký cho SubTask này.');
            return;
          }
          const newLog: DailyLog = {
            id: uid('log'),
            subtaskId,
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
          setSubtasks((prev) =>
            prev.map((s) =>
              s.id === subtaskId ? { ...s, progress: Math.max(s.progress, finalProgress) } : s
            )
          );
          logHistory('subtask', subtaskId, `Ghi nhật ký thi công (+${finalProgress}%)`);
          // Dual-write: sync daily log mới lên backend.
          if (typeof subtaskId === 'number' || /^\d+$/.test(String(subtaskId))) {
            fireAndForget(
              api.addDailyLog({
                subtaskId: Number(subtaskId),
                description: desc,
                result,
                obstacle,
                progress: finalProgress,
              }),
              `addDailyLog#${subtaskId}`,
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
        deptUsers={SEED_USERS
          .filter((u) => u.departments?.some((d) => (user.departments ?? []).includes(d)))
          .map((u) => ({ username: u.username, fullname: u.fullname }))}
      />

      {/* Deliverable Evidence Preview Modal */}
      <DeliverablePreviewModal
        task={previewTask}
        isOpen={!!previewTask}
        onClose={() => setPreviewTask(null)}
        onApprove={handleApproveTeamTask}
      />

      {/* Send Message Modal */}
      <MessageModal
        isOpen={!!messageTarget}
        onClose={() => setMessageTarget(null)}
        targetName={messageTarget?.name || ''}
        taskTitle={messageTarget?.taskTitle || ''}
        onSend={(msg) => {
          showToast(`Đã gửi tin nhắn đến ${messageTarget?.name}: "${msg}"`);
        }}
      />

      {/* Export Report Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onSuccess={(type) => {
          showToast(
            `Đã xuất thành công tệp ${
              type === 'pdf' ? 'Tien-do-4-tang-Q4.pdf' : 'Tien-do-dieu-hanh-WBS.xlsx'
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
          Vai trò <span className="font-semibold">{ROLE_LABEL[role]} (BGĐ)</span> hoạt động ở
          chế độ <span className="font-semibold text-[#004ac6]">Executive Only</span>, chỉ truy cập
          <span className="font-semibold text-[#004ac6]"> Cây Gantt 4 Tầng</span> và
          <span className="font-semibold text-[#004ac6]"> Báo cáo &amp; Tổng quan</span>.
          Các tab điều hành cấp phòng ban được ẩn để tránh trùng lặp nghiệp vụ với
          Trưởng phòng.
        </p>
      ) : (
        <p className="text-[13px] text-[#565e74] max-w-md">
          Vai trò <span className="font-semibold">{ROLE_LABEL[role]}</span> chỉ được phép truy cập
          mục <span className="font-semibold text-[#004ac6]">Việc của tôi</span>. Hãy đăng nhập bằng
          tài khoản có vai trò cao hơn nếu bạn cần xem báo cáo này.
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