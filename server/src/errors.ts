export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) { super(message); this.name = 'ApiError'; }
}
export const bad = (status: number, code: string, message: string, detail?: unknown): never => { throw new ApiError(status, code, message, detail); };
