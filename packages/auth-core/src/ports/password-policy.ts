export interface PasswordPolicy {
  validate(password: string): void;
}
