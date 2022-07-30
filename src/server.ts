import { IServerInfo } from '@utils/parse-server-info'
import * as dns from 'native-node-dns'
import { getErrorResultAsync } from 'return-style'
import { Logger } from 'extra-logger'
import { RecordType } from './record-types'
import { go, isUndefined, isEmptyArray } from '@blackglory/prelude'
import { memoizeStaleWhileRevalidateAndStaleIfError } from 'extra-memoize'
import {
  ExpirableCacheWithStaleWhileRevalidateAndStaleIfError
} from '@extra-memoize/memory-cache'
import { reusePendingPromise } from 'extra-promise'
import chalk from 'chalk'
import { resolve } from './resolve'
import { CustomError } from '@blackglory/errors'

interface IStartServerOptions {
  port: number
  dnsServer: IServerInfo
  timeout: number
  logger: Logger
  timeToLive?: number
  staleWhileRevalidate?: number
  staleIfError?: number
}

class NoAnswerError extends CustomError {
  constructor(public readonly response: dns.IPacket) {
    super()
  }
}

export function startServer({
  logger
, port
, timeout
, dnsServer
, timeToLive
, staleWhileRevalidate
, staleIfError
}: IStartServerOptions) {
  const server = dns.createServer()
  const memoizedResolve = go(() => {
    if (
      isUndefined(timeToLive) &&
      isUndefined(staleWhileRevalidate) &&
      isUndefined(staleIfError)
    ) {
      return memoizeStaleWhileRevalidateAndStaleIfError({
        cache: new ExpirableCacheWithStaleWhileRevalidateAndStaleIfError(
          timeToLive ?? 0
        , staleWhileRevalidate ?? 0
        , staleIfError ?? 0
        )
      }, configuredResolve)
    }

    return reusePendingPromise(configuredResolve)

    async function configuredResolve(question: dns.IQuestion): Promise<dns.IPacket> {
      const response = await resolve(dnsServer, question, timeout)
      if (isEmptyArray(response.answer)) {
        // 为了正确缓存该函数, 在没有结果时断定为上游解析失败, 抛出错误而不是缓存空响应.
        throw new NoAnswerError(response)
      } else {
        return response
      }
    }
  })

  server.on('error', console.error)
  server.on('socketError', console.error)
  server.on('request', async (req, res) => {
    logger.trace(`request: ${JSON.stringify(req)}`)

    res.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL

    const question = req.question[0]
    logger.trace(`${formatHostname(question.name)} ${RecordType[question.type]}`)

    const startTime = Date.now()
    const [err, response] = await go(async () => {
      const [err, response] = await getErrorResultAsync(() => memoizedResolve(question))
      if (err && err instanceof NoAnswerError) {
        return [undefined, err.response]
      } else {
        return [err, response]
      }
    })
    if (err) {
      logger.error(`${formatHostname(question.name)} ${err}`, getElapsed(startTime))
      return sendResponse()
    }
    logger.info(`${formatHostname(question.name)} ${RecordType[question.type]}`, getElapsed(startTime))

    res.header.rcode = response!.header.rcode
    res.answer = response!.answer
    res.authority = response!.authority
    sendResponse()

    function sendResponse() {
      logger.trace(`response: ${JSON.stringify(res)}`)
      res.send()
    }
  })

  return server.serve(port)
}

function formatHostname(hostname: string): string {
  return chalk.cyan(hostname)
}

function getElapsed(startTime: number): number {
  return Date.now() - startTime
}
