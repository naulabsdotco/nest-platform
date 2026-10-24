// Opaque to the package: the adapter's transaction handle (a driver client, a Prisma transaction,
// …), never inspected here and passed back to every store call unchanged. A plain alias lets an
// adapter hand its own type over without a cast.
export type AuthTransaction = unknown;

export interface UnitOfWork {
  transaction<T>(work: (tx: AuthTransaction) => Promise<T>): Promise<T>;
}
