/**
 * NestJS glue: a guard that validates the access token locally (no round-trip
 * to auth-service) and a decorator to read the authenticated identity.
 *
 * Services must never trust a user id supplied in the body or query.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JwtAccessPayload } from '@betweenus/shared-types';
import { bearerToken, verifyAccessToken } from './tokens';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = bearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: JwtAccessPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = { id: payload.sub, email: payload.email, username: payload.username };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) throw new UnauthorizedException('Not authenticated');
    return request.user;
  },
);
