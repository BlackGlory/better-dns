import { IServerInfo } from '@utils/parse-server-info'
import * as dns from 'native-node-dns'
import { getErrorResultAsync } from 'return-style'
import { Logger } from 'extra-logger'
import chalk from 'chalk'
import ms from 'ms'
import { RecordType } from './record-types'
import { go, isUndefined } from '@blackglory/prelude'
import { memoizeStaleWhileRevalidateAndStaleIfError } from 'extra-memoize'
import {
  ExpirableCacheWithStaleWhileRevalidateAndStaleIfError
} from '@extra-memoize/memory-cache'
import { reusePendingPromise } from 'extra-promise'

interface IStartServerOptions {
  port: number
  dnsServer: IServerInfo
  logger: Logger
  timeToLive?: number
  staleWhileRevalidate?: number
  staleIfError?: number
}

export function startServer({
  logger
, port
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
      }, resolve)
    }

    return reusePendingPromise(resolve)
  })

  server.on('error', console.error)
  server.on('socketError', console.error)
  server.on('request', async (req, res) => {
    logger.trace(`request: ${JSON.stringify(req)}`)

    res.header.rcode = dns.consts.NAME_TO_RCODE.SERVFAIL

    const question = req.question[0]
    logger.trace(`${formatHostname(question.name)} ${RecordType[question.type]}`)

    const startTime = Date.now()
    const [err, response] = await getErrorResultAsync(() => memoizedResolve(dnsServer, question))
    if (err) {
      logger.error(`${formatHostname(question.name)} ${err}`, getElapsed(startTime))
      return sendResponse()
    }
    logger.info(`${formatHostname(question.name)} ${RecordType[question.type]}`, getElapsed(startTime))

    res.header.rcode = response.header.rcode
    res.answer = response.answer
    res.authority = response.authority
    sendResponse()

    function sendResponse() {
      logger.trace(`response: ${JSON.stringify(res)}`)
      res.send()
    }
  })

  return server.serve(port)
}

function resolve(server: IServerInfo, question: dns.IQuestion): Promise<dns.IPacket> {
  return new Promise((resolve, reject) => {
    let response: dns.IPacket
    const request = dns.Request({
      question
    , server: {
        address: server.host
      , port: server.port
      , type: 'udp'
      }
    , timeout: ms('30s')
    , cache: false
    , try_edns: true
    })

    request.on('timeout', () => reject(new Error('timeout')))
    request.on('cancelled', () => reject(new Error('cancelled')))
    request.on('end', () => {
      if (response) {
        resolve(response)
      } else {
        reject(new Error('No response'))
      }
    })
    request.on('message', (err, msg) => {
      if (err) return reject(err)
      response = msg
    })

    request.send()
  })
}

function formatHostname(hostname: string): string {
  return chalk.cyan(hostname)
}

function getElapsed(startTime: number): number {
  return Date.now() - startTime
}
