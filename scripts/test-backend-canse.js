/**
 * scripts/test-backend-canse.js — Verify backend canSee() cho T1 read-only context.
 *
 * Mục đích: copy logic canSee từ backend/routes/tierItems.js và test với các role/dept combo.
 *
 * Chạy: node scripts/test-backend-canse.js
 */

function inDepartment(user, department) {
  if (!department) return true;
  const depts = (user.departments || '').split(',').filter(Boolean);
  if (depts.length === 0) return true;
  return depts.includes(department);
}

function canSee(user, item) {
  if (user.role === 'admin' || user.role === 'director') return true;
  if (user.role === 'manager') {
    if (item.tier === 1) return true;  // T1 read-only context
    return inDepartment(user, item.department_code);
  }
  return item.tier === 4 && item.owner_username_str === user.username;
}

const USERS = [
  { username: 'admin',  role: 'admin',     departments: 'ĐH,QLDA,KTTC,TC' },
  { username: 'khanh',  role: 'director',  departments: 'ĐH' },
  { username: 'hung',   role: 'manager',   departments: 'QLDA' },
  { username: 'cuong',  role: 'manager',   departments: 'KTTC' },
  { username: 'thanh',  role: 'manager',   departments: 'TC' },
  { username: 'hong',   role: 'employee',  departments: 'QLDA' },
];

const ITEMS = [
  { id: 1, code: 'DA-NOTX-001', tier: 1, department_code: 'ĐH', owner_username_str: 'khanh' },
  { id: 2, code: 'GD-001',      tier: 2, department_code: 'QLDA', owner_username_str: 'hung' },
  { id: 3, code: 'GD-002',      tier: 2, department_code: 'KTTC', owner_username_str: 'cuong' },
  { id: 4, code: 'GD-003',      tier: 2, department_code: 'TC',   owner_username_str: 'thanh' },
  { id: 5, code: 'CV0001',      tier: 4, department_code: 'QLDA', owner_username_str: 'hong' },
];

console.log('━━━ Backend canSee() test (sau fix) ━━━\n');

for (const u of USERS) {
  const visible = ITEMS.filter((it) => canSee(u, it));
  const t1Count = visible.filter((i) => i.tier === 1).length;
  const t2Count = visible.filter((i) => i.tier === 2).length;
  const t4Count = visible.filter((i) => i.tier === 4).length;
  console.log(
    `[${u.role.padEnd(8)}] ${u.username.padEnd(8)} (depts=${u.departments.padEnd(22)}) ` +
    `→ ${visible.length} items | T1=${t1Count} T2=${t2Count} T4=${t4Count}`
  );
  if (visible.length > 0) {
    visible.forEach((i) => console.log(`             ${i.code.padEnd(12)} T${i.tier} dept=${(i.department_code || '∅').padEnd(6)} owner=${i.owner_username_str}`));
  }
}

// Assertions
console.log('\n━━━ Assertions ━━━');
const hung = USERS.find((u) => u.username === 'hung');
const hungT1 = ITEMS.filter((i) => i.tier === 1 && canSee(hung, i)).length;
console.log(`  ✓ Hung (QLDA) thấy T1 project:        ${hungT1 === 1 ? 'PASS' : 'FAIL ❌ (got ' + hungT1 + ')'}`);

const cuong = USERS.find((u) => u.username === 'cuong');
const cuongT1 = ITEMS.filter((i) => i.tier === 1 && canSee(cuong, i)).length;
console.log(`  ✓ Cuong (KTTC) thấy T1 project:       ${cuongT1 === 1 ? 'PASS' : 'FAIL ❌'}`);

const hong = USERS.find((u) => u.username === 'hong');
const hongT1 = ITEMS.filter((i) => i.tier === 1 && canSee(hong, i)).length;
const hongT4 = ITEMS.filter((i) => i.tier === 4 && canSee(hong, i)).length;
console.log(`  ✓ Hong (employee) KHÔNG thấy T1:      ${hongT1 === 0 ? 'PASS' : 'FAIL ❌'}`);
console.log(`  ✓ Hong (employee) thấy T4 của mình:   ${hongT4 >= 1 ? 'PASS' : 'FAIL ❌'}`);

const allPass = hungT1 === 1 && cuongT1 === 1 && hongT1 === 0 && hongT4 >= 1;
console.log(`\n${allPass ? '🎉 TẤT CẢ PASS' : '❌ CẦN DEBUG'}`);
process.exit(allPass ? 0 : 1);