import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { assertOwnership, OwnershipGuard } from './ownership.js';

function contextFor(params: Record<string, string>, user?: { id: string; sessionId: string }) {
  return {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
  } as unknown as ExecutionContext;
}

describe('OwnershipGuard', () => {
  const reflector = new Reflector();
  const guard = new OwnershipGuard(reflector);

  beforeEach(() => {
    vi.spyOn(reflector, 'get').mockReturnValue('id');
  });

  it('allows the owner', () => {
    expect(guard.canActivate(contextFor({ id: 'u1' }, { id: 'u1', sessionId: 's' }))).toBe(true);
  });

  it('forbids other users', () => {
    expect(() => guard.canActivate(contextFor({ id: 'u2' }, { id: 'u1', sessionId: 's' }))).toThrow(
      ForbiddenException,
    );
  });

  it('requires authentication', () => {
    expect(() => guard.canActivate(contextFor({ id: 'u1' }))).toThrow(UnauthorizedException);
  });
});

describe('assertOwnership', () => {
  const user = { id: 'u1', sessionId: 's' };

  it('returns resources owned by the user', () => {
    const task = { id: 't1', userId: 'u1' };
    expect(assertOwnership(task, user)).toBe(task);
  });

  it('hides resources of other users and missing resources as 404', () => {
    expect(() => assertOwnership({ id: 't2', userId: 'u2' }, user)).toThrow(NotFoundException);
    expect(() => assertOwnership(null, user)).toThrow(NotFoundException);
  });
});
