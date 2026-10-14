export interface PermissionCatalogue {
  grantsFor(scope: string, role: string): Promise<ReadonlySet<string>>;
}
