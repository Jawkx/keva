import { Schema } from "effect";
import { sessionApiRequest } from "./session-api";

const Connection = Schema.Struct({
  clientId: Schema.String,
  name: Schema.NullOr(Schema.String),
  scopes: Schema.Array(Schema.String),
  createdAt: Schema.String,
  active: Schema.Boolean,
  observed: Schema.Boolean,
  lastSeenAt: Schema.NullOr(Schema.String),
});
export type Connection = typeof Connection.Type;

const Revoked = Schema.Struct({ revoked: Schema.Boolean });
const McpConfig = Schema.Struct({ mcpUrl: Schema.String });
const McpClient = Schema.Struct({ name: Schema.String });

export const getMcpConfig = (): Promise<typeof McpConfig.Type> =>
  sessionApiRequest("GET", "/api/mcp/config", McpConfig);

export const getMcpClient = (clientId: string): Promise<typeof McpClient.Type> =>
  sessionApiRequest("GET", `/api/mcp/clients/${encodeURIComponent(clientId)}`, McpClient);

export const listConnections = (): Promise<readonly Connection[]> =>
  sessionApiRequest("GET", "/api/connections", Schema.Array(Connection));

export const revokeConnection = (clientId: string): Promise<{ revoked: boolean }> =>
  sessionApiRequest("DELETE", `/api/connections/${encodeURIComponent(clientId)}`, Revoked);
