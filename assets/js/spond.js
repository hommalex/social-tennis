/**
 * Spond API client for the tennis app.
 *
 * All calls go through your own Cloudflare Worker relay (see worker/spond-proxy.js)
 * because api.spond.com sends no CORS headers. Set RELAY_URL below to the URL
 * wrangler prints after `npx wrangler deploy`.
 *
 * Credentials are never stored — only the access/refresh tokens Spond returns,
 * in this browser's localStorage.
 */
const SpondClient = (() => {

    // ---- CONFIG: paste your deployed Worker URL here ------------------------
    const RELAY_URL = "https://spond-relay.social-tennis.workers.dev";
    // ------------------------------------------------------------------------

    const API = "/core/v1";
    const API_LEVEL = "2.7.9";

    const KEY = {
        access: "spond.accessToken",
        accessExp: "spond.accessTokenExpiration",
        refresh: "spond.refreshToken",
        group: "spond.groupId",
    };

    const store = {
        get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
    };

    const isConfigured = () => !!RELAY_URL;
    const hasToken = () => !!store.get(KEY.access);
    const getGroupId = () => store.get(KEY.group);
    const setGroupId = id => store.set(KEY.group, id || null);

    const clearSession = () => {
        store.set(KEY.access, null);
        store.set(KEY.accessExp, null);
        store.set(KEY.refresh, null);
    };

    const tokenLooksExpired = () => {
        const exp = store.get(KEY.accessExp);
        if (!exp) return false;
        const t = Date.parse(exp);
        return Number.isFinite(t) && t <= Date.now();
    };

    /** Thrown when Spond rejects our token — the UI should prompt for login again. */
    class AuthError extends Error {}

    async function call(path, { method = "GET", body, auth = true, params } = {}) {
        if (!isConfigured()) {
            throw new Error("Spond relay URL is not set. Edit RELAY_URL in assets/js/spond.js.");
        }

        const url = new URL(RELAY_URL.replace(/\/+$/, "") + API + path);
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
            });
        }

        const headers = { "Accept": "application/json", "Api-Level": API_LEVEL };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (auth) {
            const token = store.get(KEY.access);
            if (!token) throw new AuthError("Not signed in to Spond.");
            headers["Authorization"] = "Bearer " + token;
        }

        const res = await fetch(url.toString(), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        const text = await res.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { message: text }; } }

        if (res.status === 401 || res.status === 403) {
            if (auth) clearSession();
            throw new AuthError((data && (data.message || data.errorKey)) || "Spond rejected the request.");
        }
        if (!res.ok) {
            throw new Error((data && data.message) || `Spond request failed (HTTP ${res.status}).`);
        }
        return data;
    }

    function saveTokens(data) {
        // Verified shape: { accessToken: {token, expiration}, refreshToken: {token, expiration} }
        const access = data && data.accessToken;
        if (!access || !access.token) return false;
        store.set(KEY.access, access.token);
        store.set(KEY.accessExp, access.expiration || null);
        if (data.refreshToken && data.refreshToken.token) store.set(KEY.refresh, data.refreshToken.token);
        return true;
    }

    /**
     * Sign in with email + password.
     * Returns {ok:true} on success, or {needs2fa:true, token} if the account has 2FA on.
     */
    async function login(email, password) {
        const data = await call("/auth2/login", {
            method: "POST",
            auth: false,
            body: { email: (email || "").trim(), password: password || "" },
        });

        if (saveTokens(data)) return { ok: true };

        // 2FA-enabled accounts return an interim token instead of an access token.
        const interim = data && (data.token || data.twoFactorToken || data.loginToken);
        if (interim) return { needs2fa: true, token: interim };

        throw new Error("Unexpected login response from Spond. Check the browser console.");
    }

    /** Complete a 2FA login with the SMS code. */
    async function verify2fa(interimToken, code, phoneNumber) {
        const data = await call("/auth2/2fa/verify", {
            method: "POST",
            auth: false,
            body: { token: interimToken, code: (code || "").trim(), phoneNumber: phoneNumber || undefined },
        });
        if (saveTokens(data)) return { ok: true };
        throw new Error("Spond did not return a token after 2FA verification.");
    }

    /** Groups this account belongs to. */
    const getGroups = () => call("/groups/");

    /**
     * Events starting soon, nearest first.
     *
     * Spond returns events FARTHEST-future first and applies `max` before we ever
     * see them, so asking for `max: 12` with no upper bound returns the last 12
     * instances of a recurring series (a year out) rather than this week's. Bounding
     * the window with maxEndTimestamp keeps `max` from binding at the wrong end.
     */
    async function getUpcomingEvents(groupId, windowDays = 28) {
        const from = new Date();
        const until = new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);

        const data = await call("/sponds/", {
            params: {
                includeComments: false,
                addProfileInfo: true,
                max: 50,
                minEndTimestamp: from.toISOString(),
                maxEndTimestamp: until.toISOString(),
                groupId: groupId || getGroupId() || undefined,
            },
        });
        const events = Array.isArray(data) ? data : (data && data.sponds) || [];
        return events
            .filter(e => !e.cancelled)
            .sort((a, b) => Date.parse(a.startTimestamp || 0) - Date.parse(b.startTimestamp || 0));
    }

    /** Recently finished events, most recent first. Used for testing and re-imports. */
    async function getPastEvents(groupId, windowDays = 120) {
        const now = new Date();
        const from = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

        const data = await call("/sponds/", {
            params: {
                includeComments: false,
                addProfileInfo: true,
                max: 50,
                minEndTimestamp: from.toISOString(),
                maxEndTimestamp: now.toISOString(),
                groupId: groupId || getGroupId() || undefined,
            },
        });
        const events = Array.isArray(data) ? data : (data && data.sponds) || [];
        return events
            .filter(e => !e.cancelled)
            .sort((a, b) => Date.parse(b.startTimestamp || 0) - Date.parse(a.startTimestamp || 0));
    }

    /**
     * Build id -> display name from every place Spond puts profile info.
     * Kept deliberately broad: the exact nesting varies by event type.
     */
    function buildNameIndex(event) {
        const names = new Map();
        const add = p => {
            if (!p) return;
            const id = p.id || p.profileId || (p.profile && p.profile.id);
            if (!id) return;
            const src = p.profile && (p.profile.firstName || p.profile.lastName) ? p.profile : p;
            const full = [src.firstName, src.lastName].filter(Boolean).join(" ").trim() || src.name || src.displayName;
            if (full && !names.has(id)) names.set(id, full);
        };

        (event.recipients && event.recipients.profiles || []).forEach(add);
        (event.recipients && event.recipients.group && event.recipients.group.members || []).forEach(m => {
            add(m);
            (m.guardians || []).forEach(add);
        });
        (event.responses && event.responses.profiles || []).forEach(add);
        (event.owners || []).forEach(add);
        return names;
    }

    /**
     * Everyone who accepted, as {spondId, name}.
     *
     * spondId is the group-member id used in responses.acceptedIds, and it is
     * stored on each player, so imports resolve by id and never by name.
     */
    function acceptedAttendees(event) {
        const ids = (event.responses && event.responses.acceptedIds) || [];
        const names = buildNameIndex(event);

        const out = ids.map(id => ({ spondId: id, name: names.get(id) || null }));

        // Hosts record their answer on their own entry, not in acceptedIds.
        (event.owners || []).forEach(o => {
            if (o.response === "accepted" && !out.some(a => a.spondId === o.id)) {
                out.push({ spondId: o.id, name: names.get(o.id) || null });
            }
        });
        return out;
    }

    const eventLabel = e => {
        const when = e.startTimestamp ? new Date(e.startTimestamp) : null;
        const stamp = when ? when.toLocaleString(undefined, {
            weekday: "short", day: "numeric", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        }) : "";
        const count = ((e.responses && e.responses.acceptedIds) || []).length;
        return `${e.heading || "Untitled event"} — ${stamp} (${count} in)`;
    };

    return {
        AuthError,
        isConfigured, hasToken, clearSession, tokenLooksExpired,
        getGroupId, setGroupId,
        login, verify2fa,
        getGroups, getUpcomingEvents, getPastEvents,
        acceptedAttendees, eventLabel,
    };
})();
