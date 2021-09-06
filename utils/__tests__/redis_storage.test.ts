// tslint:disable: no-any
import { pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import { deleteTask, getTask } from "../redis_storage";

const aRedisKey = "KEY";
const aRedisValue = "VALUE";

const getMock = jest.fn().mockImplementation((_, cb) => cb(null, aRedisValue));
const delMock = jest.fn().mockImplementation((_, cb) => cb(null, 1));
const redisClientMock = {
  del: delMock,
  get: getMock
};

describe("getTask", () => {
  it("should return a value if redis get key-value pair correctly", async () => {
    await pipe(
      getTask(redisClientMock as any, aRedisKey),
      TE.bimap(
        () => fail(),
        O.fold(
          () => fail(),
          value => expect(value).toEqual(aRedisValue)
        )
      )
    )();
  });

  it("should return none if no value was found for the provided key", async () => {
    getMock.mockImplementationOnce((_, cb) => cb(undefined, null));
    await pipe(
      getTask(redisClientMock as any, aRedisKey),
      TE.bimap(
        () => fail(),
        maybeResult => expect(O.isNone(maybeResult)).toBeTruthy()
      )
    )();
  });

  it("should return an error if redis get value fails", async () => {
    getMock.mockImplementationOnce((_, cb) =>
      cb(new Error("Cannot get value"), null)
    );
    await pipe(
      getTask(redisClientMock as any, aRedisKey),
      TE.bimap(
        _ => expect(_).toBeDefined(),
        () => fail()
      )
    )();
  });
});

describe("deleteTask", () => {
  it("should return true if key has been deleted from redis", async () => {
    await pipe(
      deleteTask(redisClientMock as any, aRedisKey),
      TE.bimap(
        () => fail(),
        del => expect(del).toBeTruthy()
      )
    )();
  });

  it("should return false if key does not exists in redis", async () => {
    delMock.mockImplementationOnce((_, cb) => cb(null, 0));
    await pipe(
      deleteTask(redisClientMock as any, aRedisKey),
      TE.bimap(
        () => fail(),
        del => expect(del).toBeFalsy()
      )
    )();
  });

  it("should return an error if redis delete fails", async () => {
    delMock.mockImplementationOnce((_, cb) =>
      cb(new Error("Cannot perform delete on redis"), null)
    );
    await pipe(
      deleteTask(redisClientMock as any, aRedisKey),
      TE.bimap(
        _ => expect(_).toBeDefined(),
        () => fail()
      )
    )();
  });
});
