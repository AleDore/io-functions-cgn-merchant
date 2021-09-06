import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import { RedisClient } from "redis";

/**
 * Parse a Redis single string reply.
 *
 * @see https://redis.io/topics/protocol#simple-string-reply.
 */
export const singleStringReply = (
  err: Error | null,
  reply: "OK" | undefined
): E.Either<Error, boolean> => {
  if (err) {
    return E.left(err);
  }

  return E.right(reply === "OK");
};

/**
 * Parse a Redis single string reply.
 *
 * @see https://redis.io/topics/protocol#simple-string-reply.
 */
export const singleValueReply = (
  err: Error | null,
  reply: string | null
): E.Either<Error, O.Option<string>> => {
  if (err) {
    return E.left(err);
  }
  return E.right(O.fromNullable(reply));
};

/**
 * Parse a Redis integer reply.
 *
 * @see https://redis.io/topics/protocol#integer-reply
 */
export const integerRepl = (
  err: Error | null,
  reply: unknown,
  expectedReply?: number
): E.Either<Error, boolean> => {
  if (err) {
    return E.left(err);
  }
  if (expectedReply !== undefined && expectedReply !== reply) {
    return E.right(false);
  }
  return E.right(typeof reply === "number");
};

export const falsyResponseToError = (
  response: E.Either<Error, boolean>,
  error: Error
): E.Either<Error, true> => {
  if (E.isLeft(response)) {
    return E.left(response.left);
  } else {
    if (response.right) {
      return E.right(true);
    }
    return E.left(error);
  }
};

export const getTask = (
  redisClient: RedisClient,
  key: string
): TE.TaskEither<Error, O.Option<string>> =>
  pipe(
    TE.tryCatch(
      () =>
        new Promise<E.Either<Error, O.Option<string>>>(resolve =>
          redisClient.get(key, (err, response) =>
            resolve(singleValueReply(err, response))
          )
        ),
      E.toError
    ),
    TE.chain(TE.fromEither)
  );

export const deleteTask = (
  redisClient: RedisClient,
  key: string
): TE.TaskEither<Error, boolean> =>
  pipe(
    TE.tryCatch(
      () =>
        new Promise<E.Either<Error, boolean>>(resolve =>
          redisClient.del(key, (err, response) =>
            resolve(integerRepl(err, response, 1))
          )
        ),
      E.toError
    ),
    TE.chain(TE.fromEither)
  );
