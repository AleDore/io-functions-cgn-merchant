/* tslint:disable: no-any */

import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import * as date_fns from "date-fns";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import { context } from "../../__mocks__/durable-functions";
import { Otp } from "../../generated/definitions/Otp";
import { OtpCode } from "../../generated/definitions/OtpCode";
import { ValidateOtpPayload } from "../../generated/definitions/ValidateOtpPayload";
import * as redis_storage from "../../utils/redis_storage";
import {
  CommonOtpPayload,
  OTP_FISCAL_CODE_PREFIX,
  OTP_PREFIX,
  ValidateOtpHandler
} from "../handler";

const now = new Date();
const anOtpCode = "AAAAAAAA123" as OtpCode;
const anOtpTtl = 10 as NonNegativeInteger;
const aFiscalCode = "DNLLSS99S20H501F" as FiscalCode;
const aValidationPayload: ValidateOtpPayload = {
  invalidate_otp: false,
  otp_code: anOtpCode
};

const aValidationPayloadWithInvalidation: ValidateOtpPayload = {
  invalidate_otp: true,
  otp_code: anOtpCode
};
const anOtp: Otp = {
  code: anOtpCode,
  expires_at: date_fns.addHours(now, 1),
  ttl: anOtpTtl
};

const anOtpPayload: CommonOtpPayload = {
  expiresAt: anOtp.expires_at,
  fiscalCode: aFiscalCode
};

const getTaskMock = jest
  .fn()
  .mockImplementation(() => TE.of(O.some(JSON.stringify(anOtpPayload))));
jest.spyOn(redis_storage, "getTask").mockImplementation(getTaskMock);

const deleteTaskMock = jest.fn().mockImplementation(() => TE.of(true));
jest.spyOn(redis_storage, "deleteTask").mockImplementation(deleteTaskMock);

describe("ValidateOtpHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return an internal error if Redis retrieve fails", async () => {
    getTaskMock.mockImplementationOnce(() =>
      TE.left(new Error("Cannot read from Redis"))
    );
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayload);
    expect(response.kind).toBe("IResponseErrorInternal");
  });
  it("should return an internal error if Otp payload cannot be parsed", async () => {
    getTaskMock.mockImplementationOnce(() => TE.of(O.some("")));
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayload);
    expect(response.kind).toBe("IResponseErrorInternal");
  });

  it("should return an internal error if Redis delete fails", async () => {
    deleteTaskMock.mockImplementationOnce(() =>
      TE.left("Cannot delete from Redis")
    );
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayloadWithInvalidation);
    expect(deleteTaskMock).toBeCalledTimes(1);
    expect(response.kind).toBe("IResponseErrorInternal");
  });

  it("should return an internal error if OTP delete fails", async () => {
    deleteTaskMock.mockImplementationOnce(() => TE.of(false));
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayloadWithInvalidation);
    expect(deleteTaskMock).toBeCalledTimes(1);
    expect(response.kind).toBe("IResponseErrorInternal");
  });

  it("should return an internal error if fiscalCode-OTP delete fails", async () => {
    deleteTaskMock.mockImplementationOnce(() => TE.of(true));
    deleteTaskMock.mockImplementationOnce(() => TE.of(false));
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayloadWithInvalidation);
    expect(deleteTaskMock).toBeCalledTimes(2);
    expect(response.kind).toBe("IResponseErrorInternal");
  });

  it("should return Not found if Otp code doesn't match on Redis", async () => {
    getTaskMock.mockImplementationOnce(() => TE.of(O.none));
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayload);
    expect(response.kind).toBe("IResponseErrorNotFound");
  });

  it("should return success if otp validation succeed", async () => {
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayload);
    expect(response.kind).toBe("IResponseSuccessJson");
    if (response.kind === "IResponseSuccessJson") {
      expect(response.value).toEqual({
        expires_at: anOtp.expires_at
      });
    }
  });

  it("should return success if otp validation and delete succeed", async () => {
    const handler = ValidateOtpHandler({} as any);
    const response = await handler(context, aValidationPayloadWithInvalidation);
    expect(deleteTaskMock).toBeCalledTimes(2);
    expect(deleteTaskMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      `${OTP_PREFIX}${aValidationPayloadWithInvalidation.otp_code}`
    );
    expect(deleteTaskMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      `${OTP_FISCAL_CODE_PREFIX}${anOtpPayload.fiscalCode}`
    );
    expect(response.kind).toBe("IResponseSuccessJson");
    if (response.kind === "IResponseSuccessJson") {
      expect(
        date_fns.isBefore(response.value.expires_at, anOtp.expires_at)
      ).toBeTruthy();
    }
  });
});
