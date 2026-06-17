import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { env } from '../env.js';
import { handleWhatsAppWebhookPayload, verifyMetaWebhookSignature } from '../services/whatsapp-webhook.js';

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

/** Meta Cloud API webhook — verification + inbound status quick-replies (no tenant header). */
export default async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (!request.url?.startsWith('/api/v1/webhooks/whatsapp')) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks);
    (request as RequestWithRawBody).rawBody = raw;
    return Readable.from([raw]);
  });

  app.get('/api/v1/webhooks/whatsapp/meta', { config: { rateLimit: false } }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
    if (mode === 'subscribe' && expected && token === expected && challenge) {
      return reply.code(200).type('text/plain').send(challenge);
    }
    return reply.code(403).send({ error: 'verification_failed' });
  });

  app.post('/api/v1/webhooks/whatsapp/meta', { config: { rateLimit: false } }, async (req, reply) => {
    const rawBody = (req as RequestWithRawBody).rawBody;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const secret = env.META_APP_SECRET?.trim() ?? '';

    if (secret && rawBody) {
      if (!verifyMetaWebhookSignature(rawBody, signature, secret)) {
        return reply.code(401).send({ error: 'invalid_signature' });
      }
    } else if (secret && !rawBody) {
      return reply.code(400).send({ error: 'missing_raw_body' });
    }

    const body = req.body as unknown;
    handleWhatsAppWebhookPayload(body).catch((err) => {
      console.error('[whatsapp-webhook] async handler failed', err);
    });

    return reply.code(200).send({ ok: true });
  });
}
