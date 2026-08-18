/**
 * Spond CORS relay — Cloudflare Worker.
 *
 * Why this exists: api.spond.com sends no Access-Control-Allow-Origin header, so
 * the browser blocks any direct call from the tennis app. This Worker forwards
 * the request server-side (where CORS does not apply) and adds the header.
 *
 * It stores NO secrets. Credentials are typed by the user in the app, and the
 * resulting token lives in that browser's localStorage. This Worker only relays.
 *
 * Deploy:  cd worker && npx wrangler deploy
 */

const UPSTREAM = 'https://api.spond.com';

// Allowlist so this cannot be used as an open proxy to arbitrary Spond endpoints.
const ALLOWED_PATHS = [
    /^\/core\/v1\/auth2\/login$/,
    /^\/core\/v1\/auth2\/2fa\/(verify|resend)$/,
    /^\/core\/v1\/profile\/?$/,
    /^\/core\/v1\/groups\/?$/,
    /^\/core\/v1\/group\/[^/]+$/,
    /^\/core\/v1\/sponds\/?$/,
    /^\/core\/v1\/sponds\/upcoming$/,
];

const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'api-level'];

function corsHeaders(origin, env) {
    const configured = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    let allow = origin || '*';
    if (configured.length) {
        if (!origin || !configured.includes(origin)) return null; // caller not permitted
        allow = origin;
    }
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Api-Level',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
    };
}

function json(status, body, cors) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...(cors || {}) },
    });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        const cors = corsHeaders(origin, env);

        if (!cors) return json(403, { message: 'Origin not allowed by this relay.' }, {});
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        const url = new URL(request.url);
        if (!ALLOWED_PATHS.some(re => re.test(url.pathname))) {
            return json(404, { message: `Path not allowed by relay: ${url.pathname}` }, cors);
        }

        const headers = new Headers();
        for (const name of FORWARD_REQUEST_HEADERS) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
        }
        if (!headers.has('accept')) headers.set('accept', 'application/json');

        let upstream;
        try {
            upstream = await fetch(UPSTREAM + url.pathname + url.search, {
                method: request.method,
                headers,
                body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
            });
        } catch (err) {
            return json(502, { message: 'Relay could not reach Spond.', detail: String(err) }, cors);
        }

        const out = new Headers(cors);
        const ct = upstream.headers.get('content-type');
        if (ct) out.set('Content-Type', ct);
        return new Response(upstream.body, { status: upstream.status, headers: out });
    },
};
