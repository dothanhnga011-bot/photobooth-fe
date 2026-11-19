export const PRINT_BRANCHES = ['Bắc Ninh', 'Bắc Giang'];
const KEY = 'nxc-selfbooth-print-branch';
export const printBranchName = branch => branch || 'Chưa phân cơ sở';
export function readPrintBranch() {
  try { return localStorage.getItem(KEY) ?? PRINT_BRANCHES[0]; }
  catch { return PRINT_BRANCHES[0]; }
}
export function savePrintBranch(branch) {
  try { localStorage.setItem(KEY, branch); } catch { /* selection still works in memory */ }
}
export function printQueuePath(branch, status = 'pending') {
  const query = new URLSearchParams({size:'large', status});
  if (branch !== undefined) query.set('branch', branch);
  return `/admin/print-jobs?${query}`;
}
