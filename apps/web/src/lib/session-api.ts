export const sessionApiRequest = async <T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> => {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (typeof payload === "object" && payload !== null && "_tag" in payload) {
      throw payload;
    }
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return payload as T;
};
