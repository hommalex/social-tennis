/**
 * Matches Spond attendee names against the club player database.
 *
 * Spond always sends a full "First Last". The bin does not agree with that:
 * some players are stored as a bare first name ("Tara"), some with a truncated
 * surname ("Darius D", "Sarah Don"), and some are simply misspelled relative to
 * Spond ("Fola Filo" vs "Fola Fifo"). Matching on the exact string would create
 * a second record for those players every single week, so each attendee is
 * resolved to a *proposal* the user confirms before anything is written.
 */
const SpondMatch = (() => {

    const norm = (name) => (name || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")   // drop accents
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")                        // drop punctuation: O'Brien -> obrien
        .replace(/\s+/g, " ")
        .trim();

    const tokens = (name) => norm(name).split(" ").filter(Boolean);

    /** Levenshtein distance, capped for speed — we only care about small values. */
    function editDistance(a, b) {
        if (a === b) return 0;
        if (!a.length || !b.length) return Math.max(a.length, b.length);
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const row = [i];
            for (let j = 1; j <= b.length; j++) {
                row[j] = Math.min(
                    prev[j] + 1,
                    row[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
            prev = row;
        }
        return prev[b.length];
    }

    /** Ignore obvious junk rows in the player database. */
    const isJunk = (player) => {
        const n = norm(player && player.name);
        return !n || /^0+$/.test(n);
    };

    /**
     * Confidence tiers, best first. "exact" and "initial" are safe enough to
     * pre-select silently; the rest are pre-selected but flagged for a look.
     */
    const TIER = {
        exact:    { rank: 0, label: "exact",        badge: "success" },
        initial:  { rank: 1, label: "shortened",    badge: "success" },
        firstOnly:{ rank: 2, label: "first name",   badge: "warning" },
        fuzzy:    { rank: 3, label: "close spelling", badge: "warning" },
        none:     { rank: 9, label: "new player",   badge: "secondary" },
    };

    function candidatesFor(spondName, index) {
        const sTok = tokens(spondName);
        const sFull = sTok.join(" ");
        const sFirst = sTok[0] || "";
        const sLast = sTok.length > 1 ? sTok[sTok.length - 1] : "";
        const out = [];

        index.forEach(entry => {
            const { player, full, tok } = entry;
            const bFirst = tok[0] || "";
            const bLast = tok.length > 1 ? tok[tok.length - 1] : "";

            if (full === sFull) { out.push({ player, tier: "exact" }); return; }

            // "Darius D" / "Sarah Don" -> "Darius Dumitru" / "Sarah Donaghy"
            if (bFirst && bFirst === sFirst && bLast && sLast &&
                (sLast.startsWith(bLast) || bLast.startsWith(sLast))) {
                out.push({ player, tier: "initial" }); return;
            }

            // Bin holds only a first name: "Tara" -> "Tara Murphy"
            if (tok.length === 1 && bFirst === sFirst) {
                out.push({ player, tier: "firstOnly" }); return;
            }

            // "Fola Filo" vs "Fola Fifo"
            if (bFirst === sFirst && bLast && sLast && editDistance(bLast, sLast) <= 2) {
                out.push({ player, tier: "fuzzy" }); return;
            }
            if (Math.abs(full.length - sFull.length) <= 3 && editDistance(full, sFull) <= 2) {
                out.push({ player, tier: "fuzzy" }); return;
            }
        });

        return out.sort((a, b) => TIER[a.tier].rank - TIER[b.tier].rank);
    }

    /**
     * Build one proposal per attendee.
     * @returns {Array<{spondName, tier, player|null, alternatives, ambiguous}>}
     */
    function proposals(spondNames, players) {
        const index = (players || [])
            .filter(p => !isJunk(p))
            .map(p => ({ player: p, full: norm(p.name), tok: tokens(p.name) }));

        const takenIds = new Set();
        const rows = [];

        // Exact matches claim their player first, so a weaker tier cannot steal it.
        const ordered = spondNames.map(n => ({ name: n, cands: candidatesFor(n, index) }));
        ordered.sort((a, b) => {
            const ra = a.cands.length ? TIER[a.cands[0].tier].rank : 9;
            const rb = b.cands.length ? TIER[b.cands[0].tier].rank : 9;
            return ra - rb;
        });

        ordered.forEach(({ name, cands }) => {
            const free = cands.filter(c => !takenIds.has(c.player.id));
            const best = free[0] || null;
            const bestTier = best ? best.tier : "none";
            // Two players tie at the same tier -> we must not guess.
            const ambiguous = !!best && free.filter(c => c.tier === bestTier).length > 1;

            if (best && !ambiguous) takenIds.add(best.player.id);

            rows.push({
                spondName: name,
                tier: bestTier,
                player: ambiguous ? null : (best ? best.player : null),
                alternatives: free.slice(0, 6).map(c => ({ player: c.player, tier: c.tier })),
                ambiguous,
            });
        });

        // Restore the original attendee order for display.
        const order = new Map(spondNames.map((n, i) => [n, i]));
        rows.sort((a, b) => order.get(a.spondName) - order.get(b.spondName));
        return rows;
    }

    /** True when the row can be applied without the user looking at it. */
    const isConfident = (row) => !row.ambiguous && (row.tier === "exact" || row.tier === "initial");

    return { norm, tokens, editDistance, proposals, isConfident, TIER };
})();
