import { useCallback } from "react";
import { useNavigate } from "react-router";
import { errorMessage, isUnauthorized } from "./errors";

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
