export interface AdminUserUsage {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly tenantId: string | null;
  readonly usedBytes: number;
  readonly quotaBytes: number | null;
  readonly quotaSource: "default" | "custom" | "unlimited";
}

const request = async <T>(token: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body as T;
};

export const listUsers = (token: string, search = "") =>
  request<{ users: ReadonlyArray<AdminUserUsage> }>(
    token,
    `/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`,
  );

export const updateQuota = (
  token: string,
  userId: string,
  input: { readonly quotaBytes: number | null } | { readonly useDefault: true },
) =>
  request<{ user: AdminUserUsage }>(token, `/api/admin/users/${encodeURIComponent(userId)}/quota`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
