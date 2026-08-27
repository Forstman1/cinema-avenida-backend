import { Response } from "express";
import { ApiErrorResponseDTO } from "../types/api";

export function sendApiError(
  res: Response,
  status: number,
  error: ApiErrorResponseDTO
): void {
  res.status(status).json(error);
}
