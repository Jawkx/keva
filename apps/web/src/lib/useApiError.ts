import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage, isUnauthorized } from "./errors";

// Centralizes error handling for API calls: a 401/Unauthorized bounces the
// user to /login, anything else is turned into a friendly message string for
// the caller to display.
export function useApiError() {
  const navigate = useNavigate();
  return useCallback(
    (error: unknown): string => {
      if (isUnauthorized(error)) {
        navigate("/login", { replace: true });
        return "Your session has expired. Please sign in again.";
      }
      return errorMessage(error);
    },
    [navigate],
  );
}
