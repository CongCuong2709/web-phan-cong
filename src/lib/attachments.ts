/**
 * attachments.ts — Quy tắc tệp đính kèm phía giao diện.
 *
 * Chỉ để báo lỗi sớm cho người dùng; server (backend/lib/attachments.js) kiểm tra lại
 * cả đuôi lẫn nội dung tệp. Giữ 2 danh sách đuôi + giới hạn dung lượng khớp nhau.
 */

export const MAX_FILE_MB = 25;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
/** Số tệp tối đa mỗi lần gửi (mỗi tệp là 1 request). */
export const MAX_FILES_PER_SEND = 10;

const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx'];

/** Giá trị cho `<input type="file" accept>`. */
export const FILE_ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(',');

export const FILE_RULES_TEXT = `Ảnh, PDF, Word, Excel, PowerPoint (.pptx) · tối đa ${MAX_FILE_MB} MB mỗi tệp`;

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** Lỗi của 1 tệp (tiếng Việt) hoặc null nếu hợp lệ. */
export function fileError(file: File): string | null {
  if (!ALLOWED_EXT.includes(extOf(file.name))) return `${file.name}: định dạng không được hỗ trợ.`;
  if (file.size === 0) return `${file.name}: tệp rỗng.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: vượt quá ${MAX_FILE_MB} MB.`;
  return null;
}

/** "1,2 MB" / "48 KB". */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Biểu tượng Material Symbols theo loại tệp. */
export function fileIcon(name: string): string {
  const ext = extOf(name);
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'picture_as_pdf';
  if (ext === 'xls' || ext === 'xlsx') return 'table_chart';
  if (ext === 'pptx') return 'slideshow';
  return 'description';
}

/** Lưu blob đã tải về thành tệp trên máy người dùng. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
