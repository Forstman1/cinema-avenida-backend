import { Prisma } from "@prisma/client";

// A screening-wide lock is shared by reservation creation and screening
// mutations. The namespace is intentionally separate from the existing
// per-user and screening/seat lock namespaces.
const SCREENING_LOCK_NAMESPACE = -2;

export async function lockAdvisoryKey(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: number
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      CAST(${namespace} AS integer),
      CAST(${key} AS integer)
    )
  `;
}

export async function lockScreening(
  tx: Prisma.TransactionClient,
  screeningId: number
): Promise<void> {
  await lockAdvisoryKey(tx, SCREENING_LOCK_NAMESPACE, screeningId);
}
