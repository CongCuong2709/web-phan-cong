/**
 * lib/dates.js — Ngày theo giờ địa phương của máy chủ.
 *
 * Không dùng `new Date().toISOString().slice(0, 10)`: đó là ngày UTC, nên ở
 * Việt Nam (UTC+7) mọi thao tác trước 7h sáng bị ghi sang ngày hôm trước.
 */

/** 'YYYY-MM-DD' của `d` theo giờ địa phương. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ngày hôm nay theo giờ địa phương. */
export function today() {
  return localDate();
}
