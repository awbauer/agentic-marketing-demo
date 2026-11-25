// Cloud Scheduler calls /internal/scheduled with a Google-signed OIDC token for the scheduler's
// service account. Only that account, with this service as the audience, may run maintenance.
import { OAuth2Client } from "google-auth-library";

export type SchedulerVerifier = (authorization: string | null) => Promise<boolean>;

export function schedulerVerifier(options: {
  audience: string;
  serviceAccount: string;
  client?: Pick<OAuth2Client, "verifyIdToken">;
}): SchedulerVerifier {
  const client = options.client ?? new OAuth2Client();
  return async (authorization) => {
    const token = authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return false;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: options.audience });
      const payload = ticket.getPayload();
      return Boolean(
        payload?.email_verified &&
          payload.email?.toLowerCase() === options.serviceAccount.toLowerCase(),
      );
    } catch {
      return false;
    }
  };
}
