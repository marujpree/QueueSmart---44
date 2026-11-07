const API_URL = "http://localhost:3001/api";

const currentUserId = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("queuesmart.user"));
    return saved?.id ?? null;
  } catch {
    return null;
  }
};

const request = async (method, path, body) => {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(currentUserId() && { "x-user-id": String(currentUserId()) }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status}).`);
    error.status = res.status;
    error.fields = data?.fields;
    throw error;
  }

  return data;
};

export const apiGet = (path) => request("GET", path);
export const apiPost = (path, body) => request("POST", path, body);
export const apiPatch = (path, body) => request("PATCH", path, body);
export const apiDelete = (path) => request("DELETE", path);
