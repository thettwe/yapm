// Every link in every template goes through here, so a link can never be built from anything but
// the caller's public base URL. An email full of `localhost` links is a failure no unit test in the
// app would otherwise catch, and this is the single choke point where that can be asserted.
//
// The path is resolved as relative, not root-absolute, so a `PUBLIC_URL` carrying a sub-path
// (`https://example.com/yapm`) keeps it.
export function absoluteUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim()
  return new URL(path.replace(/^\/+/, ''), base.endsWith('/') ? base : `${base}/`).toString()
}
