import type { FastifyReply } from "fastify";

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): FastifyReply {
  if (retryAfterSeconds !== undefined) {
    reply.header("Retry-After", String(Math.max(1, Math.round(retryAfterSeconds))));
  }
  return reply.status(status).send({ code, message });
}
