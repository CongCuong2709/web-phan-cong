/**
 * constructionData.ts — đã deprecated.
 *
 * Dữ liệu seed xây dựng đã migrate sang backend SQLite (backend/scripts/seed.ts).
 * App.tsx không còn import từ file này; dữ liệu được fetch qua API.
 *
 * File này giữ lại làm tài liệu lịch sử. Có thể xóa hoàn toàn sau khi
 * backend/scripts/seed.ts đã chạy thành công và DB có dữ liệu.
 */

// Không còn export nào — tránh bundle dead code vào frontend.
export {};