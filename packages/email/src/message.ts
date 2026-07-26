// The one thing this package produces. It is deliberately the whole vocabulary shared with the
// transport layer: a transport receives a rendered message and recipients, and knows nothing about
// how the strings were made — which is what lets `apps/server/src/mail` stay provider-neutral and
// lets this package stay free of any transport, any environment read, and any network.
export interface RenderedMessage {
  readonly subject: string
  readonly html: string
  readonly text: string
}
