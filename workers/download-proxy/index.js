// Cloudflare Worker: streaming download proxy for X media (see README.md).
// No file is stored or cached; bytes flow from X to the visitor.
import {
  RATE_LIMIT_RETRY_SECONDS, checkUpstream, downloadHeaders, errorResponse, parseDownloadRequest, upstreamHeaders
} from './core.mjs';

const respond = ({ status, headers, body }) => new Response(body, { status, headers });

export default {
  async fetch(request, env) {
    const parsed = parseDownloadRequest(request.url, request.method);
    if (!parsed.ok) return respond(parsed.response);

    // HEAD only reads headers, so only full downloads count against the limit.
    if (request.method === 'GET' && env.RATE_LIMITER) {
      const key = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) {
        return respond(errorResponse(429, 'RATE_LIMITED', 'Too many downloads. Please wait a moment.', { 'Retry-After': String(RATE_LIMIT_RETRY_SECONDS) }));
      }
    }

    let upstream;
    try {
      upstream = await fetch(parsed.target, {
        method: request.method,
        headers: upstreamHeaders(name => request.headers.get(name)),
        redirect: 'manual' // a redirect could point anywhere; refuse it
      });
    } catch {
      return respond(errorResponse(502, 'UPSTREAM_UNREACHABLE', 'Could not reach X.'));
    }

    const verdict = checkUpstream(upstream.status, name => upstream.headers.get(name));
    if (!verdict.ok) return respond(verdict.response);

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: downloadHeaders(name => upstream.headers.get(name), parsed.filename)
    });
  }
};
