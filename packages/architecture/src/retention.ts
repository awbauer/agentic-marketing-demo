/** Retention as configured for the proof (Section 17): shown in the Trust view, not hard-coded there. */
export const PROOF_RETENTION = {
  transcriptsAndAuditHours: 24,
  imageObjectsDays: 7,
  memoryDays: 14,
  region: "US commercial data stays in organization-controlled regions; partner data stays home.",
} as const;
