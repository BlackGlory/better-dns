import { IServerInfo } from '@utils/parse-server-info'
import * as dns from 'native-node-dns'
import { getErrorResultAsync } from 'return-style'
import { Logger } from 'extra-logger'
import { RecordType } from './record-types'
import { go, isUndefined } from '@blackglory/prelude'
import {
  memoizeStaleWhileRevalidateAndStaleIfError
, State as MemoizeState
} from 'extra-memoize'
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

enum State {
  Hit
, Miss
, Reuse
, StaleIfError
, StaleWhileRevalidate
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
  const memoizedResolve: (question: dns.IQuestion) => Promise<[dns.IPacket, State]> = go(() => {
    if (
      isUndefined(timeToLive) &&
      isUndefined(staleWhileRevalidate) &&
      isUndefined(staleIfError)
    ) {
      const memoizedResolve = reusePendingPromise(
        configuredResolve
      , { verbose: true }
      )

      return async (question: dns.IQuestion) => {
        const [value, isReused] = await memoizedResolve(question)
        return [value, isReused ? State.Reuse : State.Miss]
      }
    } else {
      const memoizedResolve = memoizeStaleWhileRevalidateAndStaleIfError({
        cache: new ExpirableCacheWithStaleWhileRevalidateAndStaleIfError(
          timeToLive ?? 0
        , staleWhileRevalidate ?? 0
        , staleIfError ?? 0
        )
      , verbose: true
      }, configuredResolve)

      return async (question: dns.IQuestion) => {
        const [value, state] = await memoizedResolve(question)
        return [value, go(() => {
          switch (state) {
            case MemoizeState.Hit: return State.Hit
            case MemoizeState.Miss: return State.Miss
            case MemoizeState.Reuse: return State.Reuse
            case MemoizeState.StaleIfError: return State.StaleIfError
            case MemoizeState.StaleWhileRevalidate:
              return State.StaleWhileRevalidate
            default: throw new Error(`Unknown memoize state: ${state}`)
          }
        })]
      }
    }

    async function configuredResolve(
      question: dns.IQuestion
    ): Promise<dns.IPacket> {
      return await resolve(dnsServer, question, timeout)
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
    const [err, result] = await getErrorResultAsync(() => memoizedResolve(question))
    if (err) {
      logger.error(`${formatHostname(question.name)} ${err}`, getElapsed(startTime))
    } else {
      const [response, state] = result
      logger.info(`${formatHostname(question.name)} ${RecordType[question.type]} ${State[state]}`, getElapsed(startTime))

      res.header.rcode = response.header.rcode
      res.answer = response.answer
      res.authority = response.authority
    }

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
