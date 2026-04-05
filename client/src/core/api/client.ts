const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError((data.error as string | undefined) ?? "Something went wrong.", response.status);
  }

  return data as T;
}
