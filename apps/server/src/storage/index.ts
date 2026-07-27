import { type Env, storageEnv } from '../config/env.js'
import type { Logger } from '../logger.js'
import { createLocalStorageProvider } from './local.js'
import type { StorageProvider } from './provider.js'
import { createS3StorageProvider } from './s3.js'

export type { LocalStorageOptions } from './local.js'
export { createLocalStorageProvider } from './local.js'
export type { StorageProvider, StoredObject } from './provider.js'
export {
  InvalidStorageKeyError,
  objectKeyFor,
  STORAGE_KEY_PATTERN,
  thumbnailKeyFor,
  validateKey,
} from './provider.js'
export type { FetchLike, S3StorageOptions } from './s3.js'
export { createS3StorageProvider, S3RequestError } from './s3.js'

export type StorageLogger = Pick<Logger, 'info'>

// On the `createMailer` precedent, with the one difference that matters: THIS NEVER RETURNS NULL.
// Email is an optional feature whose absence leaves a complete product — the in-app inbox works in
// full without a mailer. Storage is not: an instance with no byte store cannot show an image
// somebody pasted. So `local` is what an unconfigured instance gets, and it is complete.
export function createStorageProvider(env: Env, logger: StorageLogger): StorageProvider {
  const config = storageEnv(env)

  if (config.provider === 's3') {
    logger.info(
      { provider: 's3', bucket: config.bucket, endpoint: config.endpoint ?? 'aws' },
      'attachment storage: S3-compatible object store',
    )
    return createS3StorageProvider({
      bucket: config.bucket,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      endpoint: config.endpoint ?? undefined,
      forcePathStyle: config.forcePathStyle,
    })
  }

  logger.info({ provider: 'local', dir: config.dir }, 'attachment storage: local filesystem')
  return createLocalStorageProvider({ dir: config.dir })
}
