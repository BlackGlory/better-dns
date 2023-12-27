import { IServerInfo } from '@utils/parse-server-info.js'
import * as dns from 'native-node-dns'
import { IQuestion } from 'native-node-dns-packet'
import { getErrorResultAsync } from 'return-style'
import { Logger } from 'extra-logger'
import { RecordType } from './record-types.js'
import { go, isUndefined } from '@blackglory/prelude'
import {
  memoizeStaleWhileRevalidateAndStaleIfError
, State as MemoizeState
} from 'extra-memoize'
import {
  ExpirableCacheWithStaleWhileRevalidateAndStaleIfError
} from '@extra-memoize/memory-cache'
import {
  StaleWhileRevalidateAndStaleIfErrorDiskCache
} from '@extra-memoize/extra-disk-cache'
import { reusePendingPromises } from 'extra-promise'
import chalk from 'chalk'
import { resolve } from './resolve.js'
import { CustomError } from '@blackglory/errors'
import { consts } from 'native-node-dns-packet'
import { DiskCache, DiskCacheView, PassthroughKeyConverter } from 'extra-disk-cache'

interface IStartServerOptions {
  port: number
  dnsServer: IServerInfo
  timeout: number
  logger: Logger
  timeToLive?: number
  staleWhileRevalidate?: number
  staleIfError?: number
  cacheFilename?: string
}

enum State {
  Hit
, Miss
, Reuse
, StaleIfError
, StaleWhileRevalidate
, Fail
}

class FailedResolution extends CustomError {
  constructor(public readonly response: dns.IPacket) {
    super()
  }
}

export async function startServer({
  logger
, port
, timeout
, dnsServer
, timeToLive
, staleWhileRevalidate
, staleIfError
, cacheFilename
}: IStartServerOptions): Promise<void> {
  const server = dns.createServer()
  const memoizedResolve: (question: IQuestion) => Promise<[dns.IPacket, State]> = await go(async () => {
    if (
      isUndefined(timeToLive) &&
      isUndefined(staleWhileRevalidate) &&
      isUndefined(staleIfError)
    ) {
      const memoizedResolve = reusePendingPromises(
        configuredResolve
      , { verbose: true }
      )

      return async (question: IQuestion) => {
        const [value, isReused] = await memoizedResolve(question)
        return [value, isReused ? State.Reuse : State.Miss]
      }
    } else {
      const memoizedResolve = memoizeStaleWhileRevalidateAndStaleIfError({
        cache: cacheFilename
          ? new StaleWhileRevalidateAndStaleIfErrorDiskCache(
              new DiskCacheView<string, dns.IPacket>(
                await DiskCache.create(cacheFilename)
              , new PassthroughKeyConverter()
              , {
                  toBuffer(value: dns.IPacket): Buffer {
                    return Buffer.from(JSON.stringify(value))
                  }
                , fromBuffer(buffer: Buffer): dns.IPacket {
                    return JSON.parse(buffer.toString())
                  }
                }
              )
            , timeToLive ?? 0
            , staleWhileRevalidate ?? 0
            , staleIfError ?? 0
            )
          : new ExpirableCacheWithStaleWhileRevalidateAndStaleIfError<dns.IPacket>(
              timeToLive ?? 0
            , staleWhileRevalidate ?? 0
            , staleIfError ?? 0
            )
      , verbose: true
      }, configuredResolve)

      return async (question: IQuestion) => {
        const [value, state] = await memoizedResolve(question)
        return [value, go(() => {
          switch (state) {
            case MemoizeState.Hit: return State.Hit
            case MemoizeState.Miss: return State.Miss
            case MemoizeState.Reuse: return State.Reuse
            case MemoizeState.StaleIfError: return State.StaleIfError
            case MemoizeState.StaleWhileRevalidate: return State.StaleWhileRevalidate
            default: throw new Error(`Unknown memoize state: ${state}`)
          }
        })]
      }
    }

    async function configuredResolve(
      question: IQuestion
    ): Promise<dns.IPacket> {
      const res = await resolve(dnsServer, question, timeout)

      // 只缓存响应为NOERROR的请求
      switch (res.header.rcode) {
        case consts.NAME_TO_RCODE.NOERROR: return res
        default: throw new FailedResolution(res)
      }
    }
  })

  server.on('error', console.error)
  server.on('socketError', console.error)
  server.on('request', async (req, res) => {
    logger.trace(`request: ${JSON.stringify(req)}`)

    res.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL

    // https://stackoverflow.com/questions/55092830/how-to-perform-dns-lookup-with-multiple-questions
    const question = req.question[0]
    logger.trace(`${formatHostname(question.name)} ${formatRecordType(question.type)}`)

    const startTime = Date.now()
    const [err, result] = await getErrorResultAsync(() => memoizedResolve(question))
    if (err) {
      if (err instanceof FailedResolution) {
        logger.info(
          `${formatHostname(question.name)} ${formatRecordType(question.type)} ${State[State.Fail]}`
        , getElapsed(startTime)
        )

        res.header.rcode = err.response.header.rcode
        res.answer = err.response.answer
        res.authority = err.response.authority
      } else {
        logger.error(
          `${formatHostname(question.name)} ${err}`
        , getElapsed(startTime)
        )
      }
    } else {
      const [response, state] = result
      logger.info(
        `${formatHostname(question.name)} ${formatRecordType(question.type)} ${State[state]}`
      , getElapsed(startTime)
      )

      res.header.rcode = response.header.rcode
      res.answer = response.answer
      res.authority = response.authority
    }

    logger.trace(`response: ${JSON.stringify(res)}`)
    res.send()
  })

  return server.serve(port)
}

function formatHostname(hostname: string): string {
  return chalk.cyan(hostname)
}

function getElapsed(startTime: number): number {
  return Date.now() - startTime
}

function formatRecordType(recordType: number): string {
  return RecordType[recordType] ?? `Unknown(${recordType})`
}
