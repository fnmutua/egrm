import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { hasPermission, type Permission } from '@egrm/core';
import { env } from '../env.js';

export interface AuthUser {
  sub: string;
  tenantId: string;
  email: string;
  name: string;
  permissions: string[];
  tenantWide: boolean;
  jurisdictionRoots: string[];
  sensitiveClasses: string[];
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (perm: Permission) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '8h' } });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (req.user.tenantId !== req.tenant.id) {
      return reply.code(403).send({ error: 'tenant_mismatch' });
    }
  });

  app.decorate('requirePermission', (perm: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(req, reply);
      if (reply.sent) return;
      if (!hasPermission(req.user.permissions, perm)) {
        return reply.code(403).send({ error: 'forbidden', required: perm });
      }
    };
  });
});
