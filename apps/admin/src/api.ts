import { AdminUsersResult, UpdateAdminQuotaResult, type UpdateAdminQuota } from "@keva/schema";
import { Schema } from "effect";

export type { AdminUserUsage } from "@keva/schema";

const request = async <A, I>(
  token: string,
  path: string,
  schema: Schema.Schema<A, I>,
  init?: RequestInit,
): Promise<A> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return Schema.decodeUnknownSync(schema)(body);
};

export const listUsers = (token: string, search = "", signal?: AbortSignal) =>
  request(
    token,
    `/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    AdminUsersResult,
    signal ? { signal } : undefined,
  );

export const updateQuota = (token: string, userId: string, input: UpdateAdminQuota) =>
  request(token, `/api/admin/users/${encodeURIComponent(userId)}/quota`, UpdateAdminQuotaResult, {
    method: "PUT",
    body: JSON.stringify(input),
  });
