"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockAdvisoryKey = lockAdvisoryKey;
exports.lockScreening = lockScreening;
// A screening-wide lock is shared by reservation creation and screening
// mutations. The namespace is intentionally separate from the existing
// per-user and screening/seat lock namespaces.
const SCREENING_LOCK_NAMESPACE = -2;
async function lockAdvisoryKey(tx, namespace, key) {
    await tx.$executeRaw `
    SELECT pg_advisory_xact_lock(
      CAST(${namespace} AS integer),
      CAST(${key} AS integer)
    )
  `;
}
async function lockScreening(tx, screeningId) {
    await lockAdvisoryKey(tx, SCREENING_LOCK_NAMESPACE, screeningId);
}
