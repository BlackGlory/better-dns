#!/usr/bin/env node
import { program } from 'commander'
import { assert } from '@blackglory/errors'
import { Level, Logger, TerminalTransport, stringToLevel } from 'extra-logger'
import { parseServerInfo } from '@utils/parse-server-info.js'
import { startServer } from './server.js'
import { name, version, description } from '@utils/package.js'

interface IOptions {
  port: string
  timeout: string
  timeToLive?: string
  staleWhileRevalidate?: string
  staleIfError?: string
  cache?: string
  log: string
}

process.title = name

program
  .name(name)
  .version(version)
  .description(description)
  .option('--timeout <seconds>', '', '30')
  .option('--port <port>', '', '53')
  .option('--time-to-live <seconds>')
  .option('--stale-while-revalidate <seconds>')
  .option('--stale-if-error <seconds>')
  .option(
    '--cache <filename>'
  , 'The filename of disk cache, memory cache is used by default'
  )
  .option('--log <level>', '', 'info')
  .argument('<server>')
  .action(async (server: string) => {
    const options = program.opts<IOptions>()
    const logLevel = getLogLevel(options)
    const timeout = getTimeout(options)
    const port = getPort(options)
    const timeToLive = getTimeToLive(options)
    const staleWhileRevalidate = getStaleWhileRevalidate(options)
    const staleIfError = getStaleIfError(options)
    const cacheFilename = getCacheFilename(options)
    const dnsServer = parseServerInfo(server)

    const logger = new Logger({
      level: logLevel
    , transport: new TerminalTransport({})
    })

    await startServer({
      logger
    , dnsServer
    , timeout
    , port
    , timeToLive
    , staleWhileRevalidate
    , staleIfError
    , cacheFilename
    })
  })
  .parse()

function getPort(options: IOptions): number {
  assert(/^\d+$/.test(options.port), 'The parameter port must be integer')

  return Number.parseInt(options.port, 10)
}

function getTimeout(options: IOptions): number {
  assert(/^\d+$/.test(options.timeout), 'The parameter timeout must be integer')

  return Number.parseInt(options.port, 10) * 1000
}

function getTimeToLive(options: IOptions): number | undefined {
  if (options.timeToLive) {
    assert(/^\d+$/.test(options.timeToLive), 'The parameter timeout must be integer')

    return Number.parseInt(options.timeToLive, 10) * 1000
  } else {
    return undefined
  }
}

function getStaleWhileRevalidate(options: IOptions): number | undefined {
  if (options.staleWhileRevalidate) {
    return Number.parseInt(options.staleWhileRevalidate, 10) * 1000
  } else {
    return undefined
  }
}

function getStaleIfError(options: IOptions): number | undefined {
  if (options.staleIfError) {
    return Number.parseInt(options.staleIfError, 10) * 1000
  } else {
    return undefined
  }
}

function getLogLevel(options: IOptions): Level {
  return stringToLevel(options.log, Level.Info)
}

function getCacheFilename(options: IOptions): string | undefined {
  return options.cache
}
