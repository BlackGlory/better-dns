import { CustomError, go, isUndefined, toArray } from '@blackglory/prelude'
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
import { DiskCache, DiskCacheView, PassthroughKeyConverter } from 'extra-disk-cache'
import { BraveJSON, IConverter } from 'brave-json'
import {
  DNSClient
, IPacket
, IQuestion
, OPCODE
, QR
, RCODE
, A_RDATA
, AAAA_RDATA
, CNAME_RDATA
, MX_RDATA
, NS_RDATA
, PTR_RDATA
, SOA_RDATA
, AFSDB_RDATA
, NAPTR_RDATA
, SRV_RDATA
} from 'extra-dns'
import { timeoutSignal } from 'extra-abort'
import { randomInt } from 'extra-rand'
import { IServerInfo } from './utils/parse-server-info.js'

export enum State {
  Hit
, Miss
, Reuse
, StaleIfError
, StaleWhileRevalidate
, Fail
}

export class FailedResolution extends CustomError {
  constructor(public readonly response: IPacket) {
    super()
  }
}

export async function createMemoizedResolve(
  {
    dnsServer
  , timeout
  , timeToLive
  , staleWhileRevalidate
  , staleIfError
  , cacheFilename
  }: {
    dnsServer: IServerInfo
    timeout: number
    timeToLive?: number
    staleWhileRevalidate?: number
    staleIfError?: number
    cacheFilename?: string
  }
): Promise<(question: IQuestion) => Promise<[IPacket, State]>> {
  const client = new DNSClient(dnsServer.host, dnsServer.port ?? 53)

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
    const converter: IConverter<
      ArrayBufferLike
    | A_RDATA
    | AAAA_RDATA
    | CNAME_RDATA
    | MX_RDATA
    | NS_RDATA
    | PTR_RDATA
    | SOA_RDATA
    | AFSDB_RDATA
    | NAPTR_RDATA
    | SRV_RDATA
    , [type: 'ArrayBuffer', number[]]
    | [type: 'A_RDATA', { ADDRESS: string }]
    | [type: 'AAAA_RDATA', { ADDRESS: string }]
    | [type: 'CNAME_RDATA', { CNAME: string }]
    | [type: 'MX_RDATA', {
        PREFERENCE: number
        EXCHANGE: string
      }]
    | [type: 'NS_RDATA', { NSDNAME: string }]
    | [type: 'PTR_RDATA', { PTRDNAME: string }]
    | [type: 'SOA_RDATA', {
        MNAME: string
        RNAME: string
        SERIAL: number
        REFRESH: number
        RETRY: number
        EXPIRE: number
        MINIMUM: number
      }]
    | [type: 'AFSDB_RDATA', {
        SUBTYPE: number
        HOSTNAME: string
      }]
    | [type: 'NAPTR_RDATA', {
        ORDER: number
        PREFERENCE: number
        FLAGS: string
        SERVICES: string
        REGEXP: string
        REPLACEMENT: string
      }]
    | [type: 'SRV_RDATA', {
        PRIORITY: number
        WEIGHT: number
        PORT: number
        TARGET: string
      }]
    > = {
      toJSON(value) {
        if (value instanceof ArrayBuffer) return ['ArrayBuffer', toArray(new Uint8Array(value))]
        if (value instanceof A_RDATA) return ['A_RDATA', { ADDRESS: value.ADDRESS }]
        if (value instanceof AAAA_RDATA) return ['AAAA_RDATA', { ADDRESS: value.ADDRESS }]
        if (value instanceof CNAME_RDATA) return ['CNAME_RDATA', { CNAME: value.CNAME }]
        if (value instanceof MX_RDATA) {
          return ['MX_RDATA', {
            PREFERENCE: value.PREFERENCE
          , EXCHANGE: value.EXCHANGE
          }]
        }
        if (value instanceof NS_RDATA) return ['NS_RDATA', { NSDNAME: value.NSDNAME }]
        if (value instanceof PTR_RDATA) return ['PTR_RDATA', { PTRDNAME: value.PTRDNAME }]
        if (value instanceof SOA_RDATA) {
          return ['SOA_RDATA', {
            MNAME: value.MNAME
          , RNAME: value.RNAME
          , SERIAL: value.SERIAL
          , REFRESH: value.REFRESH
          , RETRY: value.RETRY
          , EXPIRE: value.EXPIRE
          , MINIMUM: value.MINIMUM
          }]
        }
        if (value instanceof AFSDB_RDATA) {
          return ['AFSDB_RDATA', {
            SUBTYPE: value.SUBTYPE
          , HOSTNAME: value.HOSTNAME
          }]
        }
        if (value instanceof NAPTR_RDATA) {
          return ['NAPTR_RDATA', {
            ORDER: value.ORDER
          , PREFERENCE: value.PREFERENCE
          , FLAGS: value.FLAGS
          , SERVICES: value.SERVICES
          , REGEXP: value.REGEXP
          , REPLACEMENT: value.REPLACEMENT
          }]
        }
        if (value instanceof SRV_RDATA) {
          return ['SRV_RDATA', {
            PRIORITY: value.PRIORITY
          , WEIGHT: value.WEIGHT
          , PORT: value.PORT
          , TARGET: value.TARGET
          }]
        }
        throw new Error(`Unhandled raw ${value}`)
      }
    , fromJSON([type, value]) {
        switch (type) {
          case 'ArrayBuffer': return new Uint8Array(value).buffer
          case 'A_RDATA': return new A_RDATA(value.ADDRESS)
          case 'AAAA_RDATA': return new AAAA_RDATA(value.ADDRESS)
          case 'CNAME_RDATA': return new CNAME_RDATA(value.CNAME)
          case 'MX_RDATA': return new MX_RDATA(value.PREFERENCE, value.EXCHANGE)
          case 'NS_RDATA': return new NS_RDATA(value.NSDNAME)
          case 'PTR_RDATA': return new PTR_RDATA(value.PTRDNAME)
          case 'SOA_RDATA': {
            return new SOA_RDATA(
              value.MNAME
            , value.RNAME
            , value.SERIAL
            , value.REFRESH
            , value.RETRY
            , value.EXPIRE
            , value.MINIMUM
            )
          }
          case 'AFSDB_RDATA': return new AFSDB_RDATA(value.SUBTYPE, value.HOSTNAME)
          case 'NAPTR_RDATA': {
            return new NAPTR_RDATA(
              value.ORDER
            , value.PREFERENCE
            , value.FLAGS
            , value.SERVICES
            , value.REGEXP
            , value.REPLACEMENT
            )
          }
          case 'SRV_RDATA': {
            return new SRV_RDATA(
              value.PRIORITY
            , value.WEIGHT
            , value.PORT
            , value.TARGET
            )
          }
          default: throw new Error(`Unhandled type ${type}`)
        }
      }
    }
    const braveJSON = new BraveJSON(converter)

    const memoizedResolve = memoizeStaleWhileRevalidateAndStaleIfError({
      cache: cacheFilename
        ? new StaleWhileRevalidateAndStaleIfErrorDiskCache(
            new DiskCacheView<string, IPacket>(
              await DiskCache.create(cacheFilename)
            , new PassthroughKeyConverter()
            , {
                toBuffer: value => {
                  const packet: IPacket = {
                    header: value.header
                  , questions: value.questions
                  , answers: value.answers
                  , authorityRecords: value.authorityRecords
                  , additionalRecords: value.additionalRecords
                  }
                  return Buffer.from(braveJSON.stringify(packet))
                }
              , fromBuffer: buffer => braveJSON.parse(buffer.toString())
              }
            )
          , timeToLive ?? 0
          , staleWhileRevalidate ?? 0
          , staleIfError ?? 0
          )
        : new ExpirableCacheWithStaleWhileRevalidateAndStaleIfError<IPacket>(
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
  ): Promise<IPacket> {
    const query: IPacket = {
      header: {
        ID: randomInt(0, 2 ** 16)
      , flags: {
          QR: QR.Query
        , OPCODE: OPCODE.Query
        , AA: 0
        , TC: 0
        , RD: 1
        , RA: 0
        , Z: 0
        , RCODE: 0
        }
      }
    , questions: [question]
    , answers: []
    , authorityRecords: []
    , additionalRecords: []
    }

    const response = await client.resolve(query, timeoutSignal(timeout))

    switch (response.header.flags.RCODE) {
      case RCODE.NoError: return response
      default: throw new FailedResolution(response)
    }
  }
}
