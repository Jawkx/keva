import { sessionApiRequest } from "./session-api";

export interface Connection {
  readonly clientId: string;
  readonly name: string | null;
  readonly scopes: readonly string[];
  readonly createdAt: string;
}

export const listConnections = (): Promise<readonly Connection[]> =>
  sessionApiRequest<readonly Connection[]>("GET", "/api/connections");

export const revokeConnection = (clientId: string): Promise<{ revoked: boolean }> =>
  sessionApiRequest<{ revoked: boolean }>(
    "DELETE",
    `/api/connections/${encodeURIComponent(clientId)}`,
  );
