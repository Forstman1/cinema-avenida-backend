"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendApiError = sendApiError;
function sendApiError(res, status, error) {
    res.status(status).json(error);
}
