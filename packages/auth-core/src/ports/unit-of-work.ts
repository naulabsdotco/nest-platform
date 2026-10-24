declare const transaction: unique symbol;

// Opaque to the package: the adapter returns its driver's transaction context and every store call
// takes it back as the optional trailing argument.
export interface AuthTransaction {
  readonly [transaction]: true;
}

export interface UnitOfWork {
  transaction<T>(work: (tx: AuthTransaction) => Promise<T>): Promise<T>;
}
