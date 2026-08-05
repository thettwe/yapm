import type { AuthService } from '../auth.js'

type SsoMethods = Pick<
  AuthService,
  | 'registerSsoProvider'
  | 'updateSsoProvider'
  | 'deleteSsoProvider'
  | 'requestSsoDomainVerification'
  | 'verifySsoDomain'
>

// The five provider-management calls, for a test that fakes `AuthService` for a surface that has no
// business reaching them. They REJECT rather than resolve: a route that started calling one would
// fail the test loudly instead of quietly passing against a stub that pretends to have registered
// an identity provider.
export function unreachableSsoMethods(): SsoMethods {
  const refuse = (name: string) => () =>
    Promise.reject(new Error(`${name} is not reachable from this surface`))
  return {
    registerSsoProvider: refuse('registerSsoProvider'),
    updateSsoProvider: refuse('updateSsoProvider'),
    deleteSsoProvider: refuse('deleteSsoProvider'),
    requestSsoDomainVerification: refuse('requestSsoDomainVerification'),
    verifySsoDomain: refuse('verifySsoDomain'),
  }
}
