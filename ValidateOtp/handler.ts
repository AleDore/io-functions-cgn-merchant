import * as express from "express";

import { Context } from "@azure/functions";
import {
  IResponseErrorNotFound,
  ResponseErrorInternal,
  ResponseErrorNotFound
} from "@pagopa/ts-commons/lib/responses";
import {
  IResponseErrorForbiddenNotAuthorized,
  IResponseErrorInternal,
  IResponseSuccessJson,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { parseJSON, toError } from "fp-ts/lib/Either";
import { identity } from "fp-ts/lib/function";
import { none, Option, some } from "fp-ts/lib/Option";
import {
  fromEither,
  fromLeft,
  fromPredicate,
  TaskEither,
  taskEither
} from "fp-ts/lib/TaskEither";
import { ContextMiddleware } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";
import { RequiredBodyPayloadMiddleware } from "io-functions-commons/dist/src/utils/middlewares/required_body_payload";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "io-functions-commons/dist/src/utils/request_middleware";
import * as t from "io-ts";
import { RedisClient } from "redis";
import { OtpCode } from "../generated/definitions/OtpCode";
import { OtpValidationResponse } from "../generated/definitions/OtpValidationResponse";
import { Timestamp } from "../generated/definitions/Timestamp";
import { ValidateOtpPayload } from "../generated/definitions/ValidateOtpPayload";
import { deleteTask, getTask } from "../utils/redis_storage";

const OTP_PREFIX = "OTP_";
const OTP_FISCAL_CODE_PREFIX = "OTP_FISCALCODE_";

type ResponseTypes =
  | IResponseSuccessJson<OtpValidationResponse>
  | IResponseErrorNotFound
  | IResponseErrorForbiddenNotAuthorized
  | IResponseErrorInternal;

type IGetValidateOtpHandler = (
  context: Context,
  payload: ValidateOtpPayload
) => Promise<ResponseTypes>;

export const CommonOtpPayload = t.interface({
  expiresAt: Timestamp,
  fiscalCode: FiscalCode
});

export type CommonOtpPayload = t.TypeOf<typeof CommonOtpPayload>;

export const OtpResponseAndFiscalCode = t.interface({
  fiscalCode: FiscalCode,
  otpResponse: OtpValidationResponse
});

export type OtpResponseAndFiscalCode = t.TypeOf<
  typeof OtpResponseAndFiscalCode
>;

const retrieveOtp = (
  redisClient: RedisClient,
  otpCode: OtpCode
): TaskEither<Error, Option<OtpResponseAndFiscalCode>> =>
  getTask(redisClient, `${OTP_PREFIX}${otpCode}`).chain(maybeOtp =>
    maybeOtp.foldL(
      () => taskEither.of(none),
      otpPayloadString =>
        fromEither(
          parseJSON(otpPayloadString, toError).chain(_ =>
            CommonOtpPayload.decode(_).mapLeft(
              () => new Error("Cannot decode Otp Payload")
            )
          )
        ).chain(otpPayload =>
          fromEither(
            OtpResponseAndFiscalCode.decode({
              fiscalCode: otpPayload.fiscalCode,
              otpResponse: {
                expires_at: otpPayload.expiresAt
              }
            }).bimap(() => new Error("Cannot decode Otp Payload"), some)
          )
        )
    )
  );

const invalidateOtp = (
  redisClient: RedisClient,
  otpCode: OtpCode,
  fiscalCode: FiscalCode
): TaskEither<Error, true> =>
  deleteTask(redisClient, `${OTP_PREFIX}${otpCode}`)
    .chain(
      fromPredicate(
        result => result,
        () => new Error("Unexpected delete OTP operation")
      )
    )
    .chain(() =>
      deleteTask(redisClient, `${OTP_FISCAL_CODE_PREFIX}${fiscalCode}`)
    )
    .chain(
      fromPredicate(
        result => result,
        () => new Error("Unexpected delete fiscalCode operation")
      )
    )
    .map(() => true);

export function ValidateOtpHandler(
  redisClient: RedisClient
): IGetValidateOtpHandler {
  return async (_, payload) =>
    retrieveOtp(redisClient, payload.otp_code)
      .mapLeft<IResponseErrorInternal | IResponseErrorNotFound>(() =>
        ResponseErrorInternal("Cannot validate OTP Code")
      )
      .chain<OtpValidationResponse>(maybeOtpResponseAndFiscalCode =>
        maybeOtpResponseAndFiscalCode.foldL(
          () =>
            fromLeft(
              ResponseErrorNotFound("Not Found", "OTP Not Found or invalid")
            ),
          otpResponseAndFiscalCode =>
            payload.invalidate_otp
              ? invalidateOtp(
                  redisClient,
                  payload.otp_code,
                  otpResponseAndFiscalCode.fiscalCode
                ).bimap(
                  () => ResponseErrorInternal("Cannot invalidate OTP"),
                  () => ({
                    ...otpResponseAndFiscalCode.otpResponse,
                    expires_at: new Date()
                  })
                )
              : taskEither.of(otpResponseAndFiscalCode.otpResponse)
        )
      )
      .fold<ResponseTypes>(identity, ResponseSuccessJson)
      .run();
}

export function ValidateOtp(redisClient: RedisClient): express.RequestHandler {
  const handler = ValidateOtpHandler(redisClient);

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    RequiredBodyPayloadMiddleware(ValidateOtpPayload)
  );

  return wrapRequestHandler(middlewaresWrap(handler));
}
