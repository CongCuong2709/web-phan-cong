# 🔐 Ghi chép vấn đề phân quyền (Role-based Access Control Issues)

> Cập nhật: 03/10/2026 — **Vòng 2: 2-Day Sprint đã fix**

---

## ✅ ĐÃ FIX TRONG 2-DAY SPRINT

| Issue | Vấn đề | Fix |
|---|---|---|
| A1 | `NewItemModal`: Manager tạo được T1/T2 | ✅ Filter `allowedTiers` theo role: **Admin=[1-4]**, **Director=[1,2]**, **Manager=[3,4]**, **Employee=[4]** |
| A3 | `NewItemModal`: Owner name free-text | ✅ Thay bằng `<select>` dropdown từ `deptUsers` (SEED_USERS lọc theo phòng ban) |
| A4 | `DetailsDrawer`: Mọi role kéo slider progress | ✅ Slider readonly cho director; canEdit guard theo role+ownership |
| A6 | `DetailsDrawer`: Dropdown status không guard | ✅ Nút "Chỉnh sửa nhanh" bị ẩn nếu `!canEdit` |
| B2 | `LoginPage`: Hiển thị plaintext password | ✅ Password blur mặc định, chỉ hiện khi hover |
| B3 | `LoginPage`: Tiết lộ admin/hung/hong credentials | ✅ Xóa credential footnote; xóa hint username từ placeholder |
| C1 | `Gantt4TangView`: Bar vị trí hardcode theo `item.code` | ✅ Tính `left%`+`width%` từ `item.gantt.startWeek`/`endWeek` |
| C2 | `ViecCuaToiView`: Metric "Đã hoàn thành" hardcode = 5 | ✅ Dùng `doneCount` đã tính |
| C3 | `ViecCuaToiView`: Tên task hôm nay hardcode | ✅ Dùng `firstTodayPending?.title` dynamic |
| C5 | `ViecCuaToiView`: Notes mutation trực tiếp | ✅ Dùng immutable copy `[...(task.notes ?? []), newNoteText]` |
| C6 | `ViecCuaToiView`: Metric 4 luôn "Đang thuận lợi" | ✅ Tính `overdueCount` và đổi màu/text theo thực tế |
| A9/D3 | Manager thấy "Báo cáo nhanh cho Trưởng phòng" | ✅ Ẩn section "Quick Help" nếu `isManager` |

---

## ❌ CÒN LẠI — CHƯA FIX (cần thêm thời gian)

### 🔴 Critical

#### A5 — `DetailsDrawer` toggle `deliverables` không check owner
📍 `src/components/DetailsDrawer.tsx:104-122`
- Click checkbox deliverable → tính % mới → rollup cây — không check quyền.
- **Fix đề xuất**: Wrap `handleToggleDeliverable` trong guard `if (!canEdit) return`.

#### A7 — `handleAddDailyLog` không check sở hữu SubTask
📍 `src/App.tsx:543-557`
- Bất kỳ user nào mở T4 → ghi nhật ký. Chỉ assignee mới được ghi.
- **Fix đề xuất**: Check `sub.assigneeUsername === user.username || user.role === 'admin'`.

#### A8 — Slider subtask progress không check role
📍 `src/App.tsx:538-542` + `DetailsDrawer.tsx`
- `onUpdateSubtaskProgress` mở cho tất cả roles.
- **Fix đề xuất**: Truyền `canEditSubtask` prop vào DetailsDrawer.

#### A10 — `handleSendHelpRequest` code hardcode `NV-CANDAY`
📍 `src/App.tsx:398`
- Code không unique → nhiều help request trùng code.
- **Fix đề xuất**: `NV-CANDAY-${Date.now()}` hoặc UUID.

#### A13 — Admin vào "Việc của tôi" thấy TẤT CẢ task nhân viên
📍 `src/App.tsx:178-181`
- Tab tên "Việc của tôi" nhưng Admin thấy tất cả → gây nhầm.
- **Fix đề xuất**: Với admin, hiển thị UI khác (ví dụ: overview mode).

#### B1 — Plain-text password trong localStorage
📍 `src/auth/AuthContext.tsx:97`
- Không thể fix frontend-only, cần backend bcrypt.

#### B4 — Session chỉ lưu userId, không có token
📍 `src/auth/AuthContext.tsx:78-85`
- Edit localStorage → đăng nhập thành user khác.
- **Fix đề xuất**: Cần backend JWT.

### 🟡 Medium

#### C4 — `handleAddPersonalTask` set manager = chính mình
📍 `src/App.tsx:436-440`
- Nhân viên tự tạo việc → UI hiện "Trưởng phòng giao: <chính mình>".
- **Fix đề xuất**: Dùng `teamMembers.find(m => m.department === user.departments[0] && m.role === 'manager')`.

#### C5 (partial) — Notes vẫn chưa persist qua state setter đúng cách
- `task.notes = updatedNotes` vẫn là mutation tạm thời.
- **Fix đề xuất**: Thêm `onAddNote(taskId, noteText)` callback từ `App.tsx`.

#### C8 — Search filter không có debounce
📍 `src/components/Gantt4TangView.tsx:312-318`
- Mỗi keystroke re-filter toàn bộ tierItems.
- **Fix đề xuất**: `useState` + `useEffect` debounce 300ms.

#### C9 — `history` không append khi có thao tác mới
📍 `src/App.tsx:107`
- `const [history]` không có setter → lịch sử không cập nhật.
- **Fix đề xuất**: Đổi thành `useState<HistoryEntry[]>` có setter, append mỗi khi có thao tác quan trọng.

#### C10 — `GiaoViecNhomView` filter member by name
📍 `src/components/GiaoViecNhomView.tsx`
- So sánh `task.ownerName` (string) thay vì ID → bug nếu trùng tên.
- **Fix đề xuất**: Filter bằng `task.ownerUsername`.

#### D1 — Phòng TC trống khi demo
📍 `src/data/constructionData.ts`
- `thanh` và `ngoc` có task trong T3/T4 nhưng TeamLeadTask và EmployeeTask filter lấy tối đa 12 items → TC tasks có thể bị cắt.
- **Fix đề xuất**: Đảm bảo `teamLeadTasks` và `employeeTasks` include ít nhất 2 tasks của TC.

#### D2 — GiaoViecNhomView hardcode "5 thành viên sẵn sàng"
📍 `src/components/GiaoViecNhomView.tsx:246`
- **Fix đề xuất**: Dùng `teamMembers.length` dynamic.

### 🟢 Low

#### A2 — Admin: `department = currentUser.departments[0]` luôn gán phòng đầu tiên
- Khi admin tạo item → department = `'ĐH'` (đầu tiên trong array), không cho chọn phòng khác.

#### A11 — `NewItemModal`: `defaultTier` không reset khi modal đóng mở lại
- State `tier` giữ giá trị cũ từ lần mở trước.
- **Fix đề xuất**: Reset state trong `useEffect([isOpen])`.

#### D4 — "In báo cáo" = `window.print()` in toàn bộ trang
- Cần CSS `@media print` riêng để in đẹp và chỉ in phần báo cáo.

#### E2 — `[history]` useState const không bao giờ update
📍 `src/App.tsx:107`
- Đã note ở C9.

#### E3 — `NV-CANDAY` hardcode
📍 `src/App.tsx:398`
- Đã note ở A10.

#### E4 — `Math.random()` có thể tạo code trùng
📍 `NewItemModal.tsx:51-58` + `App.tsx:275`
- **Fix đề xuất**: Dùng `Date.now()` hoặc `crypto.randomUUID()`.

#### G1 — `BRAND_LOGO_URL` link Google có thể die
- **Fix đề xuất**: Host logo file trong `/public/`.

#### G4 — `package.json name: "react-example"`
- **Fix đề xuất**: Đổi thành `"tien-do-4-tang"`.

---

## 📊 Tóm tắt

| Nhóm | Tổng | Đã fix | Còn lại |
|---|---|---|---|
| 🔴 Critical RBAC | 13 | 8 | 5 |
| 🟠 Logic/UX | 10 | 4 | 6 |
| 🟡 Medium | 6 | 0 | 6 |
| 🟢 Low/Nitpick | 7 | 0 | 7 |
| **Tổng** | **36** | **12** | **24** |
