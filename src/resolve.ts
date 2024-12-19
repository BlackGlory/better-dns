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
import { DNSClient, IPacket, IQuestion, OPCODE, QR, RCODE } from 'extra-dns'
import { timeoutSignal } from 'extra-abort'
import { randomIntInclusive } from 'extra-rand'
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
    , [type: 'ArrayBuffer', number[]]
    > = {
      toJSON(value) {
        if (value instanceof ArrayBuffer) return ['ArrayBuffer', toArray(new Uint8Array(value))]
        throw new Error(`Unhandled raw ${value}`)
      }
    , fromJSON([type, value]) {
        switch (type) {
          case 'ArrayBuffer': return new Uint8Array(value).buffer
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
        ID: randomIntInclusive(0, 2 ** 16)
      , flags: {
          QR: QR.Query
        , OPCODE: OPCODE.Query
        , AA: 0
        , TC: 0
        , RD: 0
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
