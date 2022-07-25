#!/usr/bin/env node
import { program } from 'commander'
import { startServer } from './server'
import { assert } from '@blackglory/errors'
import { Level, Logger, TerminalTransport, stringToLevel } from 'extra-logger'
import { parseServerInfo } from '@utils/parse-server-info'

program
  .name(require('../package.json').name)
  .version(require('../package.json').version)
  .description(require('../package.json').description)
  .option('--port [port]', '', '53')
  .option('--time-to-live [seconds]')
  .option('--stale-while-revalidate [seconds]')
  .option('--stale-if-error [seconds]')
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
    , port: options.port
    , timeToLive: options.timeToLive
    , staleWhileRevalidate: options.staleWhileRevalidate
    , staleIfError: options.staleIfError
    })
  })
  .parse()

function getOptions() {
  const opts = program.opts<{
    port: string
    timeToLive?: string
    staleWhileRevalidate?: string
    staleIfError?: string
    log: string
  }>()

  assert(/^\d+$/.test(opts.port), 'The parameter port must be integer')
  const port = Number.parseInt(opts.port, 10)
  const timeToLive = opts.timeToLive
    ? Number.parseInt(opts.timeToLive, 10) * 1000
    : undefined
  const staleWhileRevalidate = opts.staleWhileRevalidate
    ? Number.parseInt(opts.staleWhileRevalidate, 10) * 1000
    : undefined
  const staleIfError = opts.staleIfError
    ? Number.parseInt(opts.staleIfError, 10) * 1000
    : undefined
  const logLevel = stringToLevel(opts.log, Level.Info)

  return {
    port
  , timeToLive
  , staleWhileRevalidate
  , staleIfError
  , logLevel
  }
}
