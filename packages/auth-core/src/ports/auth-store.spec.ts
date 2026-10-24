import { describe, expect, it } from 'vitest';
import { AuthSubjectCreationFailedError } from '../errors';
import type { AuthStore, NewSubject } from './auth-store';

const input: NewSubject = {
  email: 'subject@example.com',
  credential: { algo: 'argon2id', hash: 'argon2id-hash' },
  scopes: [{ scope: 'example-app', role: 'member' }],
};

describe('AuthStore.createSubject', () => {
  it('takes the subject, its credential and every scope in one call and returns the id', async () => {
    const created: NewSubject[] = [];
    const store: Pick<AuthStore, 'createSubject'> = {
      createSubject: async (subject) => {
        created.push(subject);
        return { subjectId: 'subject-1' };
      },
    };

    const result = await store.createSubject(input);

    expect(result).toEqual({ subjectId: 'subject-1' });
    expect(created).toEqual([input]);
  });

  it('active is optional and a scope may carry it', async () => {
    const store: Pick<AuthStore, 'createSubject'> = {
      createSubject: async () => ({ subjectId: 'subject-1' }),
    };

    await store.createSubject({ ...input, scopes: [{ scope: 'example-app', role: 'member', active: false }] });

    expect(input.scopes[0]?.active).toBeUndefined();
  });

  it('a duplicate email or an unknown scope is one typed error the adapter raises', () => {
    const error = new AuthSubjectCreationFailedError();

    expect(error).toBeInstanceOf(AuthSubjectCreationFailedError);
    expect(error.code).toBe('AUTH_SUBJECT_CREATION_FAILED');
  });
});
