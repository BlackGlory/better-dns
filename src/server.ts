import { IServerInfo } from '@utils/parse-server-info.js'
import { Logger } from 'extra-logger'
import chalk from 'chalk'
import { DNSServer, IPacket, IQuestion, QR, RCODE, TYPE } from 'extra-dns'
import { createMemoizedResolve, FailedResolution, State } from './resolve.js'

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

export async function startServer(
  {
    logger
  , port
  , timeout
  , dnsServer
  , timeToLive
  , staleWhileRevalidate
  , staleIfError
  , cacheFilename
  }: IStartServerOptions
): Promise<() => Promise<void>> {
  const server = new DNSServer('0.0.0.0', port)

  const memoizedResolve = await createMemoizedResolve({
    dnsServer
  , timeout
  , timeToLive
  , staleWhileRevalidate
  , staleIfError
  , cacheFilename
  })

  server.on('query', async (query, respond) => {
    logger.trace(`request: ${JSON.stringify(query)}`)

    // 默认失败响应.
    const response: IPacket = {
      header: {
        ID: query.header.ID
      , flags: {
          QR: QR.Response
        , OPCODE: query.header.flags.OPCODE
        , AA: 0
        , TC: 0
        , RD: 0
        , RA: 0
        , Z: 0
        , RCODE: RCODE.ServFail
        }
      }
    , questions: query.questions
    , answers: []
    , authorityRecords: []
    , additionalRecords: []
    }

    // https://stackoverflow.com/questions/55092830/how-to-perform-dns-lookup-with-multiple-questions
    const question = query.questions[0] as IQuestion | undefined
    if (question) {
      logger.trace(`${formatHostname(question.QNAME)} ${formatRecordType(question.QTYPE)}`)

      const startTime = Date.now()
      try {
        const [resultResponse, state] = await memoizedResolve(question)
        logger.info(
          `${formatHostname(question.QNAME)} ${formatRecordType(question.QTYPE)} ${State[state]}`
        , getElapsed(startTime)
        )

        response.header.flags.RCODE = resultResponse.header.flags.RCODE
        response.answers = resultResponse.answers
        response.authorityRecords = resultResponse.authorityRecords
        response.additionalRecords = resultResponse.additionalRecords
      } catch (err) {
        if (err instanceof FailedResolution) {
          logger.info(
            `${formatHostname(question.QNAME)} ${formatRecordType(question.QTYPE)} ${State[State.Fail]}`
          , getElapsed(startTime)
          )

          response.header.flags.RCODE = err.response.header.flags.RCODE
          response.answers = err.response.answers
          response.authorityRecords = err.response.authorityRecords
          response.additionalRecords = err.response.additionalRecords
        } else {
          logger.error(`${formatHostname(question.QNAME)} ${err}`, getElapsed(startTime))
        }
      }
    }

    logger.trace(`response: ${JSON.stringify(response)}`)
    await respond(response)
  })

  return await server.listen()
}

function formatHostname(hostname: string): string {
  return chalk.cyan(hostname)
}

function formatRecordType(recordType: number): string {
  return TYPE[recordType] ?? `Unknown(${recordType})`
}

function getElapsed(startTime: number): number {
  return Date.now() - startTime
}
