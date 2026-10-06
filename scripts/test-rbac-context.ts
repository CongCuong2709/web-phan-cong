/**
 * scripts/test-rbac-context.ts — Verify visibleTierItems logic cho 4 roles.
 *
 * Mục đích: mô phỏng App.tsx visibleTierItems filter, kiểm tra manager `hung`
 * thực sự thấy T1 project (read-only) + phases QLDA + tasks.
 *
 * Chạy: cd C:\Users\Admin\Downloads\web-phan-cong ; npx tsx scripts/test-rbac-context.ts
 */

import { CONSTRUCTION_TIER_ITEMS } from '../src/data/constructionData.js';

interface TierItemLite {
  id: string;
  code: string;
  tier: number;
  title: string;
  parentId?: string;
  department?: string;
  ownerUsername?: string;
}

type Role = 'admin' | 'director' | 'manager' | 'employee';

interface UserLite {
  username: string;
  role: Role;
  departments: string[];
}

const USERS: UserLite[] = [
  { username: 'admin',  role: 'admin',     departments: ['ĐH', 'QLDA', 'KTTC', 'TC'] },
  { username: 'khanh',  role: 'director',  departments: ['ĐH'] },
  { username: 'hung',   role: 'manager',   departments: ['QLDA'] },
  { username: 'cuong',  role: 'manager',   departments: ['KTTC'] },
  { username: 'thanh',  role: 'manager',   departments: ['TC'] },
  { username: 'hong',   role: 'employee',  departments: ['QLDA'] },
];

function visibleTierItems(user: UserLite, tierItems: TierItemLite[]): TierItemLite[] {
  if (user.role === 'admin' || user.role === 'director') return tierItems;
  if (user.role === 'manager') {
    const depts = user.departments ?? [];
    const result: TierItemLite[] = [];
    const seen = new Set<string>();
    const descendants = tierItems.filter(
      (t) => t.tier >= 2 && (!t.department || depts.includes(t.department))
    );
    for (const d of descendants) {
      if (!seen.has(d.id)) { result.push(d); seen.add(d.id); }
    }
    for (const d of descendants) {
      let pid = d.parentId;
      while (pid) {
        if (seen.has(pid)) break;
        const parent = tierItems.find((p) => p.id === pid);
        if (!parent) break;
        result.push(parent);
        seen.add(pid);
        if (parent.tier === 1) break;
        pid = parent.parentId;
      }
    }
    return result;
  }
  if (user.role === 'employee') {
    const myT4 = tierItems.filter(
      (t) => t.tier === 4 && t.ownerUsername === user.username
    );
    const result: TierItemLite[] = [];
    const seen = new Set<string>();
    for (const t of myT4) {
      if (!seen.has(t.id)) { result.push(t); seen.add(t.id); }
    }
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
}

const lite: TierItemLite[] = CONSTRUCTION_TIER_ITEMS.map((t) => ({
  id: t.id,
  code: t.code,
  tier: t.tier,
  title: t.title,
  parentId: t.parentId,
  department: t.department,
  ownerUsername: t.ownerUsername,
}));

const tierCounts = (items: TierItemLite[]) => ({
  T1: items.filter((i) => i.tier === 1).length,
  T2: items.filter((i) => i.tier === 2).length,
  T3: items.filter((i) => i.tier === 3).length,
  T4: items.filter((i) => i.tier === 4).length,
});

console.log('━━━ visibleTierItems test (seed: 1 project owned by khanh ĐH) ━━━\n');
console.log(`Total in data: ${lite.length} items (${JSON.stringify(tierCounts(lite))})\n`);

for (const u of USERS) {
  const v = visibleTierItems(u, lite);
  const c = tierCounts(v);
  const t1ReadOnly = v.filter((i) => i.tier === 1 && i.department && !u.departments.includes(i.department));
  console.log(
    `[${u.role.padEnd(8)}] ${u.username.padEnd(8)} (depts=${JSON.stringify(u.departments).padEnd(22)}) ` +
    `→ ${v.length.toString().padStart(3)} items | T1=${c.T1} (read-only=${t1ReadOnly.length}) T2=${c.T2} T3=${c.T3} T4=${c.T4}`
  );
  if (t1ReadOnly.length > 0) {
    console.log(`             read-only T1: ${t1ReadOnly.map((t) => `${t.code} (dept=${t.department})`).join(', ')}`);
  }
}

// Specific test: hung (QLDA manager) phải thấy ít nhất 1 T1 project
const hung = USERS.find((u) => u.username === 'hung')!;
const hungVisible = visibleTierItems(hung, lite);
const hungHasT1 = hungVisible.some((i) => i.tier === 1);
const hungHasT2 = hungVisible.some((i) => i.tier === 2);
const hungHasReadOnlyT1 = hungVisible.some((i) => i.tier === 1 && i.department && !hung.departments.includes(i.department));

// Debug: in chi tiết các manager
console.log('\n━━━ Debug: chi tiết items mỗi manager thấy ━━━');
for (const u of USERS.filter((u) => u.role === 'manager')) {
  const v = visibleTierItems(u, lite);
  console.log(`\n[${u.username} (${JSON.stringify(u.departments)})]:`);
  v.forEach((i) => console.log(`  ${i.code.padEnd(10)} T${i.tier} dept=${(i.department ?? '∅').padEnd(6)} ${i.title.slice(0, 50)}`));
}

console.log('\n━━━ Hung (manager QLDA) assertions ━━━');
console.log(`  ✓ Thấy ít nhất 1 T1 project:           ${hungHasT1 ? 'PASS' : 'FAIL ❌'}`);
console.log(`  ✓ Thấy ít nhất 1 T2 phase:            ${hungHasT2 ? 'PASS' : 'FAIL ❌'}`);
console.log(`  ✓ T1 đó là read-only (không thuộc QLDA): ${hungHasReadOnlyT1 ? 'PASS' : 'FAIL ❌'}`);
console.log(`  ✓ Tổng items > 0:                     ${hungVisible.length > 0 ? 'PASS' : 'FAIL ❌'}`);

// Employee Hong: chỉ thấy T4 của mình + parent chain T3 → T2 → T1
const hong = USERS.find((u) => u.username === 'hong')!;
const hongVisible = visibleTierItems(hong, lite);
const hongT4 = hongVisible.filter((i) => i.tier === 4).length;
const hongT3 = hongVisible.filter((i) => i.tier === 3).length;
const hongT2 = hongVisible.filter((i) => i.tier === 2).length;
const hongT1 = hongVisible.filter((i) => i.tier === 1).length;
const hongHasOwnT4 = hongT4 === 5;  // CV0001-0005

console.log('\n━━━ Hong (employee QLDA) assertions ━━━');
console.log(`  ✓ Thấy đúng 5 T4 của mình:             ${hongHasOwnT4 ? 'PASS' : 'FAIL ❌ (got ' + hongT4 + ')'}`);
console.log(`  ✓ Thấy 1 T3 bundle parent chain:        ${hongT3 === 1 ? 'PASS' : 'FAIL ❌ (got ' + hongT3 + ')'}`);
console.log(`  ✓ Thấy 1 T2 phase parent chain:         ${hongT2 === 1 ? 'PASS' : 'FAIL ❌ (got ' + hongT2 + ')'}`);
console.log(`  ✓ Thấy 1 T1 project read-only context:   ${hongT1 === 1 ? 'PASS' : 'FAIL ❌ (got ' + hongT1 + ')'}`);

const allPass =
  hungHasT1 && hungHasT2 && hungHasReadOnlyT1 && hungVisible.length > 0 &&
  hongHasOwnT4 && hongT3 === 1 && hongT2 === 1 && hongT1 === 1;
console.log(`\n${allPass ? '🎉 TẤT CẢ PASS' : '❌ CÓ LỖI — CẦN DEBUG'}`);
process.exit(allPass ? 0 : 1);