#!/usr/bin/env node
import { program } from 'commander'
import { startServer } from './server'
import { assert } from '@blackglory/errors'
import { Level, Logger, TerminalTransport, stringToLevel } from 'extra-logger'
import { parseServerInfo } from '@utils/parse-server-info'
import { go } from '@blackglory/prelude'

const { name, version, description } = require('../package.json')
process.title = name

program
  .name(name)
  .version(version)
  .description(description)
  .option('--timeout [seconds]', '', '30')
  .option('--port [port]', '', '53')
  .option('--time-to-live [seconds]')
  .option('--stale-while-revalidate [seconds]')
  .option('--stale-if-error [seconds]')
  .option('--cache [filename]', 'The filename of disk cache, memory cache is used by default')
  .option('--log [level]', '', 'info')
  .argument('<server>')
  .action(async (server: string) => {
    const options = getOptions()
    const logger = new Logger({
      level: options.logLevel
    , transport: new TerminalTransport({})
    })

    startServer({
      logger
    , dnsServer: parseServerInfo(server)
    , timeout: options.timeout
    , port: options.port
    , timeToLive: options.timeToLive
    , staleWhileRevalidate: options.staleWhileRevalidate
    , staleIfError: options.staleIfError
    , cacheFilename: options.cacheFilename
    })
  })
  .parse()

function getOptions() {
  const opts = program.opts<{
    port: string
    timeout: string
    timeToLive?: string
    staleWhileRevalidate?: string
    staleIfError?: string
    cache?: string
    log: string
  }>()

  assert(/^\d+$/.test(opts.port), 'The parameter port must be integer')
  const port: number = Number.parseInt(opts.port, 10)

  assert(/^\d+$/.test(opts.timeout), 'The parameter timeout must be integer')
  const timeout: number = Number.parseInt(opts.port, 10) * 1000

  const timeToLive: number | undefined = go(() => {
    if (opts.timeToLive) {
      assert(/^\d+$/.test(opts.timeToLive), 'The parameter timeout must be integer')
      return Number.parseInt(opts.timeToLive, 10) * 1000
    } else {
      return undefined
    }
  })

  const staleWhileRevalidate: number | undefined = go(() => {
    if (opts.staleWhileRevalidate) {
      return Number.parseInt(opts.staleWhileRevalidate, 10) * 1000
    } else {
      return undefined
    }
  })

  const staleIfError: number | undefined = go(() => {
    if (opts.staleIfError) {
      return Number.parseInt(opts.staleIfError, 10) * 1000
    } else {
      return undefined
    }
  })

  const logLevel = stringToLevel(opts.log, Level.Info)

  const cacheFilename = opts.cache

  return {
    port
  , timeout
  , timeToLive
  , staleWhileRevalidate
  , staleIfError
  , logLevel
  , cacheFilename
  }
}
