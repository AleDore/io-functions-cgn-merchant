import { pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";
import * as redis from "redis";
import RedisClustr = require("redis-clustr");
import { getConfigOrThrow } from "./config";
const config = getConfigOrThrow();

function createSimpleRedisClient(
  redisUrl: string,
  password?: string,
  port?: string,
  useTls: boolean = true
): redis.RedisClient {
  const DEFAULT_REDIS_PORT = "6379";

  const redisPort: number = parseInt(port || DEFAULT_REDIS_PORT, 10);
  return redis.createClient({
    auth_pass: password,
    host: redisUrl,
    port: redisPort,
    tls: useTls ? { servername: redisUrl } : undefined
  });
}

function createClusterRedisClient(
  redisUrl: string,
  password?: string,
  port?: string
): redis.RedisClient {
  const DEFAULT_REDIS_PORT = "6379";

  const redisPort: number = parseInt(port || DEFAULT_REDIS_PORT, 10);
  return new RedisClustr({
    redisOptions: {
      auth_pass: password,
      tls: {
        servername: redisUrl
      }
    },
    servers: [
      {
        host: redisUrl,
        port: redisPort
      }
    ]
  }) as redis.RedisClient; // Casting RedisClustr with missing typings to RedisClient (same usage).
}

export const REDIS_CLIENT = pipe(
  config.isProduction,
  O.fromPredicate<boolean>(_ => _),
  O.chainNullableK(_ => config.REDIS_CLUSTER_ENABLED),
  O.chain(O.fromPredicate(_ => _)),
  O.map(() =>
    createClusterRedisClient(
      config.REDIS_URL,
      config.REDIS_PASSWORD,
      config.REDIS_PORT
    )
  ),
  O.getOrElse(() =>
    createSimpleRedisClient(
      config.REDIS_URL,
      config.REDIS_PASSWORD,
      config.REDIS_PORT,
      config.REDIS_TLS_ENABLED
    )
  )
);
