// POST /auth/register — 공개(anon) 엔드포인트, 인증 불필요.
// docs/swagger.json의 RegisterRequest/RegisterResponse 계약을 따른다.

import { Router } from "express";
import { registerAccount, EmailAliasTakenError } from "../services/registrationService";

export const registrationRouter = Router();

registrationRouter.post("/register", async (req, res) => {
  const { email_alias, corporate_password, app_password, preferred_room_ids } = req.body ?? {};

  if (
    typeof email_alias !== "string" ||
    email_alias.trim() === "" ||
    typeof corporate_password !== "string" ||
    corporate_password === "" ||
    typeof app_password !== "string" ||
    app_password === ""
  ) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "email_alias, corporate_password, app_password는 필수입니다.",
      },
    });
    return;
  }

  if (
    preferred_room_ids !== undefined &&
    (!Array.isArray(preferred_room_ids) || preferred_room_ids.some((id) => typeof id !== "string"))
  ) {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "preferred_room_ids는 문자열 배열이어야 합니다." },
    });
    return;
  }

  try {
    const result = await registerAccount({
      emailAlias: email_alias,
      corporatePassword: corporate_password,
      appPassword: app_password,
      preferredRoomIds: preferred_room_ids ?? [],
    });

    res.status(201).json({
      id: result.id,
      status: result.status,
      message:
        result.status === "auto_approved"
          ? "등록 신청이 자동 승인되었습니다. 바로 로그인하실 수 있어요."
          : "등록 신청이 접수되었습니다. 승인되면 로그인하실 수 있어요.",
    });
  } catch (error) {
    if (error instanceof EmailAliasTakenError) {
      res.status(409).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[registration.routes] register failed", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "등록 신청 처리 중 오류가 발생했습니다." },
    });
  }
});
