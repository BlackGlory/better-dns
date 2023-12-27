import { IServerInfo } from '@utils/parse-server-info.js'
import * as dns from 'native-node-dns'
import { IQuestion } from 'native-node-dns-packet'

export function resolve(
  server: IServerInfo
, question: IQuestion
, timeout: number
): Promise<dns.IPacket> {
  return new Promise((resolve, reject) => {
    let response: dns.IPacket
    const request = dns.Request({
      question
    , server: {
        address: server.host
      , port: server.port
      , type: 'udp'
      }
    , timeout
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
