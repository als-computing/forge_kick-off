import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function friendlyApiError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || "Request failed";

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    const maybeDetail = (error as { detail?: unknown }).detail;
    if (typeof maybeDetail === "string" && maybeDetail.trim()) {
      return maybeDetail;
    }
  }

  return "Request failed";
}
