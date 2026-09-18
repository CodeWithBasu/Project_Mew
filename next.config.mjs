import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBotId } from 'botid/next/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    unoptimized: true,
  },
}

// withBotId adds the proxy rewrites that keep BotID's client challenge from
// being defeated by ad-blockers. checkBotId() in the protected routes reads
// the result.
export default withBotId(nextConfig)
