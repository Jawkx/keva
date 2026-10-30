import { useCallback } from "react";
import { useNavigate } from "react-router";
import { errorMessage, isUnauthorized } from "./errors";

export function useApiError() {
  const navigate = useNavigate();
  return useCallback(
    (cause: unknown): string => {
      if (isUnauthorized(cause)) {
        navigate("/login", { replace: true });
        return "Your session has expired. Please sign in again.";
      }
      return errorMessage(cause);
    },
    [navigate],
  );
}
