// The consumer's adapters are bound under these tokens by AuthCoreModule.forRoot; the guards inject
// them, and they stay out of the public barrel so a consumer wires ports, not internals.
export const SCOPE_RESOLVER = Symbol('AUTH_SCOPE_RESOLVER');
export const PERMISSION_CATALOGUE = Symbol('AUTH_PERMISSION_CATALOGUE');
