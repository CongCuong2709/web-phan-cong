import { TierItem, TeamMember, TeamLeadTask, EmployeeTask } from '../types';
import {
  CONSTRUCTION_TIER_ITEMS,
  CONSTRUCTION_TEAM_MEMBERS,
  CONSTRUCTION_TEAM_LEAD_TASKS,
  CONSTRUCTION_EMPLOYEE_TASKS,
} from './constructionData';

// ---------------------------------------------------------------------------
// Re-export brand assets used by Header / LoginPage.
// ---------------------------------------------------------------------------
export const BRAND_LOGO_URL =
  'https://lh3.googleusercontent.com/aida/AEtjO1UcPoUcSZGC55U13UCuQcVYyrd2yaZtxhRGZD9mgjnLRnAIfEuYk5YfKwt5u7M5R9xfTF9VsR_Y6bPMg7CN7_Q98UspvDX0s13HDMDMykGNDugYHZYL9d5z8pf2qGsaRAoXMhSuz0L0xBip6qd-GdzKjWYKJeS2zboUKhVk7Gey_ZA3ieROwFEsguWej9Pgnj2WYLJ1MfEoPur1glz1ogDSRfPWndN-qIU7eIncP4A9TbKijCmqt08BeXc';
export const MANAGER_AVATAR_URL =
  'https://lh3.googleusercontent.com/aida/AEtjO1VjYffWSPe28ukd8bQJaCB9mak4SysJl06rjJyJmTScZaneMUJULCy0eBOMOqJ1g1zOtZLVtYcEcPddRQxOJms2Q8wiXpzSCJKdU4dBRwEK5OlhdJC59zbRTQ8IoD-1v_z43DI--AT1Vzbd3HLUw2vSUvGJ059EP7zKrDGFQvCxo4eiO3TO4tjMFUfDiKCMgMmmDskeTDpLgFbGfyLjRnMKdJqn8kOTGt-cNiz45FUrs7oSEldqyz3Q-_V4';

// ---------------------------------------------------------------------------
// Seed data — đã được sinh tự động từ constructionData.ts (4 dự án xây dựng
// phong phú + subtasks + nhật ký thi công). File này chỉ re-export để giữ
// nguyên API `import { INITIAL_* } from './data/initialData'` cho phần còn
// lại của ứng dụng.
// ---------------------------------------------------------------------------

export const INITIAL_TIER_ITEMS: TierItem[] = CONSTRUCTION_TIER_ITEMS;
export const INITIAL_TEAM_MEMBERS: TeamMember[] = CONSTRUCTION_TEAM_MEMBERS;
export const INITIAL_TEAM_LEAD_TASKS: TeamLeadTask[] = CONSTRUCTION_TEAM_LEAD_TASKS;
export const INITIAL_EMPLOYEE_TASKS: EmployeeTask[] = CONSTRUCTION_EMPLOYEE_TASKS;