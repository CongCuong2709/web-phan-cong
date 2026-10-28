import React, { useMemo, useState } from 'react';
import type { DailyLog, HistoryEntry, TierItem } from '../types';
import type { AttachmentDto, TaskMessageDto } from '../lib/apiClient';
import {
  MESSAGE_KIND_VI,
  formatDateTime,
  formatIsoDate,
  parseServerTime,
  serverTimeToLocalDate,
  statusEnumToVi,
  todayIso,
} from '../lib/transforms';
import { AttachmentList } from './ui/AttachmentList';
import { FilePicker } from './ui/FilePicker';
import { ghostButtonCls, primaryButtonCls, textareaCls } from './ui/Dialog';

// ─────────────────────────────────────────────────────────────────────
// Trao đổi
// ─────────────────────────────────────────────────────────────────────

const KIND_TONE: Record<TaskMessageDto['kind'], { bar: string; text: string }> = {
  note: { bar: 'border-primary', text: 'text-primary' },
  blocker: { bar: 'border-error', text: 'text-error' },
  start: { bar: 'border-outline', text: 'text-secondary' },
  submit: { bar: 'border-tertiary', text: 'text-tertiary' },
  approve: { bar: 'border-tertiary', text: 'text-tertiary' },
  return: { bar: 'border-warning', text: 'text-warning' },
  unblock: { bar: 'border-tertiary', text: 'text-tertiary' },
};

/** Số tin cuối hiện mặc định; tin cũ hơn mở bằng nút. */
const RECENT_MESSAGES = 6;

/**
 * Luồng trao đổi của 1 đầu việc: tin theo dòng thời gian (cũ → mới), mỗi tin có người viết
 * + ngày giờ và tệp đính kèm. Không sửa / xoá / trả lời từng tin.
 */
export const ConversationSection: React.FC<{
  messages: TaskMessageDto[] | null;
  /** Người xem gửi được tin (NV làm việc, TP phòng đó, admin) và nhánh chưa lưu trữ. */
  canPost: boolean;
  /** Chỉ người làm việc mới "báo vướng mắc". */
  canReportBlocker: boolean;
  onPost: (body: string, kind: 'note' | 'blocker', files: File[]) => Promise<boolean>;
}> = ({ messages, canPost, canReportBlocker, onPost }) => {
  const [showAll, setShowAll] = useState(false);
  const [onlyBlockers, setOnlyBlockers] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<'note' | 'blocker' | null>(null);

  const blockers = messages?.filter((m) => m.kind === 'blocker') ?? [];
  const openBlockers = blockers.filter((m) => !m.is_resolved).length;
  const shown = (onlyBlockers ? blockers : messages ?? []);
  const hidden = showAll ? 0 : Math.max(0, shown.length - RECENT_MESSAGES);
  const visible = shown.slice(hidden);

  const send = async (kind: 'note' | 'blocker') => {
    if (sending) return;
    setSending(kind);
    try {
      if (await onPost(body.trim(), kind, files)) {
        setBody('');
        setFiles([]);
      }
    } finally {
      setSending(null);
    }
  };

  return (
    <section aria-labelledby="trao-doi-title" className="bg-white p-3.5 rounded-lg border border-surface-container">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 id="trao-doi-title" className="text-xs font-semibold text-secondary uppercase tracking-wider">
          Trao đổi {messages && <span className="normal-case font-normal">({messages.length})</span>}
        </h3>
        {blockers.length > 0 && (
          <span className={`text-xs font-semibold ${openBlockers ? 'text-error' : 'text-secondary'}`}>
            {blockers.length} vướng mắc · {openBlockers ? `${openBlockers} chưa xử lý` : 'đã xử lý hết'}
          </span>
        )}
      </div>

      {messages === null ? (
        <p role="status" className="text-xs text-outline">Đang tải trao đổi…</p>
      ) : messages.length === 0 ? (
        <p className="text-xs text-outline italic">Chưa có trao đổi nào cho việc này.</p>
      ) : (
        <>
          {blockers.length > 0 && (
            <div role="group" aria-label="Lọc trao đổi" className="flex gap-1.5 mb-2">
              {[false, true].map((only) => (
                <button
                  key={String(only)}
                  type="button"
                  aria-pressed={onlyBlockers === only}
                  onClick={() => setOnlyBlockers(only)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    onlyBlockers === only
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-white text-secondary border-surface-container-high hover:bg-surface-container-low'
                  }`}
                >
                  {only ? `Vướng mắc (${blockers.length})` : `Tất cả (${messages.length})`}
                </button>
              ))}
            </div>
          )}
          {hidden > 0 && (
            <button type="button" onClick={() => setShowAll(true)} className="text-xs font-semibold text-primary hover:underline mb-2">
              Xem {hidden} tin cũ hơn
            </button>
          )}
          <ol className="flex flex-col gap-3">
            {visible.map((m) => {
              const tone = KIND_TONE[m.kind];
              return (
                <li key={m.id} className={`border-l-[3px] pl-3 ${tone.bar}`}>
                  <div className={`text-xs font-bold ${tone.text}`}>
                    {MESSAGE_KIND_VI[m.kind]}
                    {m.kind === 'blocker' && (
                      <span className={`ml-1.5 font-semibold ${m.is_resolved ? 'text-secondary' : 'text-error'}`}>
                        · {m.is_resolved ? 'Đã xử lý' : 'Chưa xử lý'}
                      </span>
                    )}
                  </div>
                  {m.body && <p className="text-sm text-on-surface whitespace-pre-line break-words">{m.body}</p>}
                  {m.attachments.length > 0 && (
                    <div className="mt-1.5">
                      <AttachmentList items={m.attachments} />
                    </div>
                  )}
                  <div className="text-xs text-secondary mt-1">
                    {m.author_fullname ?? m.author_username_str ?? '—'} · {formatDateTime(m.created_at)}
                    {m.kind === 'blocker' && m.is_resolved === 1 && m.resolved_at && (
                      <> · {m.resolved_by_fullname ?? 'Trưởng phòng'} gỡ lúc {formatDateTime(m.resolved_at)}</>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {canPost && (
        <div className="mt-3 pt-3 border-t border-surface-container flex flex-col gap-2">
          <label htmlFor="trao-doi-input" className="text-xs font-bold text-on-surface">Viết trao đổi</label>
          <textarea
            id="trao-doi-input"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Nội dung ghi chú, kết quả, câu hỏi cho người giao / người làm…"
            className={textareaCls}
          />
          <FilePicker files={files} onChange={setFiles} disabled={sending !== null} />
          <div className="flex justify-end gap-2 flex-wrap">
            {canReportBlocker && (
              <button
                type="button"
                onClick={() => send('blocker')}
                disabled={sending !== null || !body.trim()}
                title="Gửi Trưởng phòng như một vướng mắc cần gỡ"
                className={`${ghostButtonCls} text-error`}
              >
                {sending === 'blocker' ? 'Đang gửi…' : 'Báo là vướng mắc'}
              </button>
            )}
            <button
              type="button"
              onClick={() => send('note')}
              disabled={sending !== null || (!body.trim() && files.length === 0)}
              className={primaryButtonCls}
            >
              {sending === 'note' ? 'Đang gửi…' : 'Gửi ghi chú'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Dòng thời gian
// ─────────────────────────────────────────────────────────────────────

type TimelineKind = 'status' | 'log' | 'message' | 'blocker' | 'system';

interface TimelineEntry {
  key: string;
  at: Date;
  /** Id gốc trong bảng nguồn — phân thứ tự các sự kiện cùng giây (id lớn hơn = ghi sau). */
  seq: number;
  kind: TimelineKind;
  title: string;
  detail?: string;
  who: string;
}

const DOT: Record<TimelineKind, string> = {
  status: 'border-warning',
  log: 'border-tertiary',
  message: 'border-primary',
  blocker: 'border-error',
  system: 'border-outline',
};

const LEGEND: [TimelineKind, string][] = [
  ['status', 'Trạng thái'],
  ['log', 'Nhật ký / tiến độ'],
  ['blocker', 'Vướng mắc'],
  ['message', 'Trao đổi'],
  ['system', 'Hệ thống'],
];

const RECENT_DAYS = 7;

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ngày (local) của lần đầu / lần cuối chuyển sang trạng thái `to`. */
function statusDate(history: HistoryEntry[], to: string, pick: 'first' | 'last', from?: string): string | undefined {
  const hits = history
    .filter((h) => h.toStatus === to && (!from || h.fromStatus === from))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const hit = pick === 'first' ? hits[0] : hits[hits.length - 1];
  return hit ? serverTimeToLocalDate(hit.createdAt) : undefined;
}

/**
 * Lịch sử gộp của 1 đầu việc: tạo việc, đổi trạng thái, nhật ký, trao đổi, tệp — mới nhất trên cùng,
 * nhóm theo ngày. Mặc định hiện 7 ngày gần nhất; phía trên là các mốc ngày thực tế.
 */
export const TimelineSection: React.FC<{
  item: TierItem;
  history: HistoryEntry[] | null;
  logs: DailyLog[];
  messages: TaskMessageDto[] | null;
}> = ({ item, history, logs, messages }) => {
  const [showAll, setShowAll] = useState(false);
  const today = todayIso();

  const entries = useMemo<TimelineEntry[]>(() => {
    const out: TimelineEntry[] = [];
    for (const h of history ?? []) {
      // Vướng mắc đã có tin riêng trong luồng trao đổi.
      if (h.action.startsWith('Cập nhật vướng mắc')) continue;
      const at = parseServerTime(h.createdAt);
      if (!at) continue;
      const isStatus = !!h.toStatus;
      out.push({
        key: `h${h.id}`,
        at,
        seq: Number(h.id),
        kind: isStatus ? 'status' : 'system',
        title: isStatus
          ? `Đổi trạng thái: ${statusEnumToVi(h.fromStatus)} → ${statusEnumToVi(h.toStatus)}`
          : h.action.startsWith('Gỡ vướng mắc') ? 'Gỡ vướng mắc' : h.action,
        who: h.userName || 'Hệ thống',
      });
    }
    // Tiến độ của lần ghi trước (theo ngày nhật ký) để hiện mức tăng "40% → 60%".
    const byDate = [...logs].sort((a, b) => a.logDate.localeCompare(b.logDate));
    for (const [i, l] of byDate.entries()) {
      const at = parseServerTime(l.createdAt);
      if (!at) continue;
      const prev = i > 0 ? byDate[i - 1].progress : undefined;
      out.push({
        key: `l${l.id}`,
        at,
        seq: Number(l.id),
        kind: 'log',
        title: `Nhật ký ngày ${formatIsoDate(l.logDate)} · ${
          prev !== undefined && prev !== l.progress ? `${prev}% → ${l.progress}%` : `tiến độ ${l.progress}%`
        }`,
        detail: [l.description, l.result && `Kết quả: ${l.result}`, l.obstacle && `Vướng mắc: ${l.obstacle}`]
          .filter(Boolean)
          .join('\n'),
        who: l.userName,
      });
    }
    for (const m of messages ?? []) {
      const at = parseServerTime(m.created_at);
      if (!at) continue;
      const files = m.attachments.length ? ` · ${m.attachments.length} tệp` : '';
      out.push({
        key: `m${m.id}`,
        at,
        seq: m.id,
        kind: m.kind === 'blocker' ? 'blocker' : 'message',
        title: `${MESSAGE_KIND_VI[m.kind]}${files}`,
        detail: m.body || undefined,
        who: m.author_fullname ?? '—',
      });
    }
    return out.sort((a, b) => b.at.getTime() - a.at.getTime() || b.seq - a.seq);
  }, [history, logs, messages]);

  if (history === null || messages === null) {
    return <p role="status" className="text-xs text-outline">Đang tải lịch sử…</p>;
  }

  const created = serverTimeToLocalDate(item.createdAt);
  const started = statusDate(history, 'doing', 'first', 'pending');
  const submitted = statusDate(history, 'pending_approval', 'last');
  const finished = item.status === 'Đã xong' ? statusDate(history, 'done', 'last') : undefined;

  const cutoff = daysAgoIso(RECENT_DAYS - 1);
  const recent = entries.filter((e) => serverDay(e.at) >= cutoff);
  const visible = showAll ? entries : recent;

  const byDay: [string, TimelineEntry[]][] = [];
  for (const e of visible) {
    const day = serverDay(e.at);
    const last = byDay[byDay.length - 1];
    if (last && last[0] === day) last[1].push(e);
    else byDay.push([day, [e]]);
  }

  const milestones: [string, string | undefined][] = [
    ['Ngày giao', created],
    ['Bắt đầu thực tế', started],
    ['Báo xong', submitted],
    ['Hoàn thành', finished],
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2">
        {milestones.map(([label, date]) => (
          <div key={label} className="rounded-md border border-surface-container bg-surface px-2.5 py-1.5">
            <dt className="text-xs text-secondary">{label}</dt>
            <dd className={`text-sm ${date ? 'font-semibold text-on-surface' : 'italic text-outline'}`}>
              {date ? formatIsoDate(date) : 'Chưa có'}
            </dd>
          </div>
        ))}
      </dl>

      {visible.length === 0 ? (
        <p className="text-xs text-outline italic">
          {entries.length === 0 ? 'Chưa có hoạt động nào được ghi lại.' : `Không có hoạt động trong ${RECENT_DAYS} ngày gần nhất.`}
        </p>
      ) : (
        <ol className="relative pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-0.5 before:bg-surface-container-high">
          {byDay.map(([day, items]) => (
            <li key={day} className="mb-2">
              <div className="text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">
                {day === today ? 'Hôm nay' : formatIsoDate(day)}
              </div>
              <ol className="flex flex-col gap-2">
                {items.map((e) => (
                  <li key={e.key} className="relative text-sm">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-white border-2 ${DOT[e.kind]}`}
                    />
                    <div className="font-semibold text-on-surface">{e.title}</div>
                    {e.detail && <p className="text-xs text-on-surface-variant whitespace-pre-line break-words">{e.detail}</p>}
                    <div className="text-xs text-secondary">
                      {e.who} · {timeOf(e.at)}
                    </div>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
          {LEGEND.map(([k, label]) => (
            <li key={k} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full border-2 ${DOT[k]}`} />
              {label}
            </li>
          ))}
        </ul>
        {entries.length > recent.length && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
            {showAll ? `Chỉ hiện ${RECENT_DAYS} ngày gần nhất` : `Xem toàn bộ (${entries.length})`}
          </button>
        )}
      </div>
    </div>
  );
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const serverDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const timeOf = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ─────────────────────────────────────────────────────────────────────
// Tệp của task
// ─────────────────────────────────────────────────────────────────────

/** Tệp khi giao việc (không gồm tệp trong tin trao đổi — kết quả của người làm gửi qua Trao đổi). */
export const TaskFilesSection: React.FC<{
  files: AttachmentDto[] | null;
  canUpload: boolean;
  /** Xoá được: người tải lên hoặc admin. */
  canDelete: (a: AttachmentDto) => boolean;
  onUpload: (files: File[]) => Promise<boolean>;
  onDelete: (a: AttachmentDto) => Promise<boolean>;
}> = ({ files, canUpload, canDelete, onUpload, onDelete }) => {
  const [picked, setPicked] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    setUploading(true);
    try {
      if (await onUpload(picked)) setPicked([]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="bg-white p-3.5 rounded-lg border border-surface-container">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
        Tệp khi giao việc {files && <span className="normal-case font-normal">({files.length})</span>}
      </h3>
      {files === null ? (
        <p role="status" className="text-xs text-outline">Đang tải tệp…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-outline italic">Người giao chưa đính kèm tệp nào.</p>
      ) : (
        <AttachmentList items={files} showMeta canDelete={canDelete} onDelete={onDelete} />
      )}
      {canUpload && (
        <div className="mt-2 flex flex-col gap-2">
          <FilePicker files={picked} onChange={setPicked} disabled={uploading} label="Thêm tệp" />
          {picked.length > 0 && (
            <div className="flex justify-end">
              <button type="button" onClick={upload} disabled={uploading} className={primaryButtonCls}>
                {uploading ? 'Đang tải lên…' : `Tải lên ${picked.length} tệp`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
