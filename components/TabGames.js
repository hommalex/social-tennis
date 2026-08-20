const TabGames = {
    props: ['data', 'selected', 'dialog', 'levelsReviewed'],
    emits: ['update-games', 'update-exceptions', 'switch-tab'],
    setup(props, { emit }) {
        const { ref, reactive, onMounted, onUnmounted, watch, computed } = Vue;

        const config = reactive({
            gamesPerMatch: 7, 
            numRounds: 3,
            numCourts: 5
        });

        const generatedRounds = ref([]); 

        // Players keep the level from their last session, so the values alone say
        // nothing. levelsReviewed is flipped by the app the moment a level is
        // actually changed on the Players tab, and it resets on every page load —
        // until then, generating a schedule balances on stale data.
        const ignoreLevelWarning = ref(false);
        const blockGenerate = computed(() =>
            props.selected.length > 0 &&
            !props.levelsReviewed &&
            !ignoreLevelWarning.value
        );

        const errorMsg = ref("");
        const showRound = ref(1);
		const viewMode = ref('rounds');
        const activePlayerIds = ref(new Set());
        const activeGame = ref(null);
        const activePair = ref(null);
        // Game ids that were just scored — kept visible in the Active view for a grace period
        const recentlyFinished = ref(new Set());
		// Helper to get name of player currently selected for swap
        const swapSourceName = computed(() => {
            if (!swapSource.value) return "";
            const { rIdx, gIdx, pairKey, pKey } = swapSource.value;
            try {
                return generatedRounds.value[rIdx].games[gIdx][pairKey][pKey].name;
            } catch (e) { return "Player"; }
        });

        // Swap & Conflict State
        const swapSource = ref(null);
        const conflictedPlayerIds = ref(new Set());
        const conflictMsg = ref("");
        const repeatedOpponentIds = ref(new Set());

        // Some players only ever want to play together. A pair key listed here is
        // still drawn in red — the schedule really does repeat it — but it no longer
        // raises the banner asking for a swap. Stored with the current session.
        const pairExceptions = ref([]);
        // Duplicate pairs that are not yet excepted, as [{key, names}] for the prompt.
        const unexceptedPairs = ref([]);

        const calculateActivePlayers = () => {
            const currentActive = new Set();
            if (generatedRounds.value && generatedRounds.value.length > 0) {
                generatedRounds.value.forEach(round => {
                    if (round.games) {
                        round.games.forEach(game => {
                            if (game.status === 'in_play') {
                                if (game.pairA.p1) currentActive.add(game.pairA.p1.id);
                                if (game.pairA.p2) currentActive.add(game.pairA.p2.id);
                                if (game.pairB.p1) currentActive.add(game.pairB.p1.id);
                                if (game.pairB.p2) currentActive.add(game.pairB.p2.id);
                            }
                        });
                    }
                });
            }
            activePlayerIds.value = currentActive;
        };
		
		const hasFinishedGames = computed(() => {
            if (!generatedRounds.value) return false;
            return generatedRounds.value.some(round => 
                round.games && round.games.some(g => g.status === 'finished')
            );
        });
		
		// --- Board view: Queue and Active shown together -------------------
        const flatten = (predicate) => {
            const list = [];
            generatedRounds.value.forEach((round, rIdx) => {
                (round.games || []).forEach((game, gIdx) => {
                    if (!predicate(game)) return;
                    list.push({
                        ...game,
                        roundNum: round.roundNumber,
                        originalRIdx: rIdx,
                        originalGIdx: gIdx
                    });
                });
            });
            return list;
        };

        /** Games on court right now, plus ones just scored so they don't vanish mid-glance. */
        const activeGames = computed(() =>
            flatten(g => g.status === 'in_play' || recentlyFinished.value.has(g.id))
                .sort((a, b) => (a.court || 99) - (b.court || 99)));

        /**
         * Next up: awaiting games whose four players are all off court.
         * Not gated on viewMode — needsCourtFill depends on this being accurate
         * whichever view happens to be open.
         */
        const queueGames = computed(() => {
            return flatten(g => {
                if (g.status !== 'awaiting') return false;
                const busy = (p) => p && activePlayerIds.value.has(p.id);
                return !busy(g.pairA.p1) && !busy(g.pairA.p2)
                    && !busy(g.pairB.p1) && !busy(g.pairB.p2);
            });
        });

        const boardSections = computed(() => [
            { key: 'queue',  title: 'Queue',  icon: 'bi-hourglass', games: queueGames.value,
              empty: 'Nothing ready — everyone waiting is still on court.' },
            { key: 'active', title: 'Active', icon: 'bi-activity',  games: activeGames.value,
              empty: 'No games in play.' }
        ]);

        /** Name of a player id, from the schedule first then the selection list. */
        const playerName = (id) => {
            let found = null;
            (generatedRounds.value || []).forEach(round => {
                (round.games || []).forEach(g => {
                    [g.pairA?.p1, g.pairA?.p2, g.pairB?.p1, g.pairB?.p2].forEach(p => {
                        if (p && String(p.id) === String(id)) found = p.name;
                    });
                });
            });
            if (found) return found;
            const sel = (props.selected || []).find(p => String(p.id) === String(id));
            return sel ? sel.name : 'Player';
        };

        const checkConflicts = () => {
            const conflicts = new Set();
            conflictMsg.value = "";
            unexceptedPairs.value = [];

            if (!generatedRounds.value) return;

            const { partners: pairHistory } = buildPairHistory();
            const excepted = new Set(pairExceptions.value || []);
            const pending = [];

            for (const [key, rounds] of pairHistory.entries()) {
                if (rounds.length > 1) {
                    const ids = key.split('_');
                    conflicts.add(ids[0]);
                    conflicts.add(ids[1]);
                    if (!excepted.has(key)) {
                        pending.push({ key, names: ids.map(playerName) });
                    }
                }
            }

            // Only pairs still awaiting a decision raise the banner — an excepted pair
            // stays red so the repeat is visible, but it is no longer a problem to fix.
            if (pending.length > 0) {
                conflictMsg.value = "Warning: Duplicate partners detected (highlighted in red). Please swap players.";
                unexceptedPairs.value = pending;
            }

            conflictedPlayerIds.value = conflicts;
        };

        /** Whitelist every currently-flagged pair so the banner stops asking. */
        const addPairExceptions = async () => {
            const pairs = unexceptedPairs.value;
            if (pairs.length === 0) return;

            const list = pairs.map(p => `${p.names[0]} and ${p.names[1]}`).join(', ');
            const confirmed = await props.dialog.confirm(
                "Add Exception",
                `${list} will be added to the exception list and will no longer be reported as duplicate partners.`
            );
            if (!confirmed) return;

            const merged = new Set(pairExceptions.value || []);
            pairs.forEach(p => merged.add(p.key));
            pairExceptions.value = Array.from(merged);

            emit('update-exceptions', pairExceptions.value);
            checkConflicts();
        };

        const checkRepeatedGames = () => {
            const gameHistory = {}; // pair key -> array of round numbers
            const repeatedByRound = {};

            if (!generatedRounds.value) return;

            generatedRounds.value.forEach(round => {
                repeatedByRound[round.roundNumber] = new Set();
            });

            generatedRounds.value.forEach(round => {
                if (!round.games) return;
                round.games.forEach(game => {
                    const players = [game.pairA.p1, game.pairA.p2, game.pairB.p1, game.pairB.p2].filter(Boolean);
                    for (let i = 0; i < players.length; i++) {
                        for (let j = i + 1; j < players.length; j++) {
                            const key = [players[i].id, players[j].id].sort().join('_');
                            if (gameHistory[key]) {
                                repeatedByRound[round.roundNumber].add(players[i].id);
                                repeatedByRound[round.roundNumber].add(players[j].id);
                                gameHistory[key].forEach(prevRound => {
                                    repeatedByRound[prevRound].add(players[i].id);
                                    repeatedByRound[prevRound].add(players[j].id);
                                });
                            }
                            if (!gameHistory[key]) gameHistory[key] = [];
                            gameHistory[key].push(round.roundNumber);
                        }
                    }
                });
            });

            repeatedOpponentIds.value = repeatedByRound;
        };

        const getPlayerNameClass = (id) => {
            if (conflictedPlayerIds.value.has(id)) return 'text-danger fw-bold';
            return 'fw-bold';
        };

        const getPlayerStyle = (id, roundNumber) => {
            if (!conflictedPlayerIds.value.has(id)) {
                const roundSet = repeatedOpponentIds.value[roundNumber];
                if (roundSet && roundSet.has(id)) return { color: '#fd7e14' };
            }
            return {};
        };

        const loadExistingGames = () => {
            if (props.data && props.data.current) {
                if (props.data.current.gamesPerMatch) config.gamesPerMatch = props.data.current.gamesPerMatch;
                if (props.data.current.numOfRounds) config.numRounds = props.data.current.numOfRounds;
                if (props.data.current.numOfCourts) config.numCourts = props.data.current.numOfCourts;
                pairExceptions.value = Array.isArray(props.data.current.pairExceptions)
                    ? props.data.current.pairExceptions.slice()
                    : [];

                if (Array.isArray(props.data.current.games) && props.data.current.games.length > 0) {
                    generatedRounds.value = props.data.current.games;
                    calculateActivePlayers();
                    checkConflicts();
                    checkRepeatedGames();
                }
            }
        };

        watch(() => props.data, loadExistingGames, { deep: true });
        onMounted(loadExistingGames);

        // Map player level (A best, B mid, C lowest) to a numeric strength score.
        const getScore = (p) => {
            if (!p) return 2;
            if (p.level === 'A') return 3;
            if (p.level === 'C') return 1;
            return 2; // 'B' or unset
        };

        // Map a player level directly to a tier.
        const levelToTier = (level) => {
            if (level === 'A') return 'high';
            if (level === 'C') return 'low';
            return 'mid'; // 'B' or unset
        };

        const playerTiers = computed(() => {
            const tiers = {};
            if (!props.selected || props.selected.length === 0) return tiers;

            props.selected.forEach(p => {
                tiers[p.id] = levelToTier(p.level);
            });

            return tiers;
        });

        // --- NEW: Get Battery Icon Data ---
        const getBatteryData = (player) => {
            if (!player) return { icon: 'bi-battery', color: 'text-secondary', title: 'N/A' };
            
            const level = player.level || 'B';

            if (level === 'A') return { icon: 'bi-battery-full', color: 'text-success', title: 'Class A' };
            if (level === 'C') return { icon: 'bi-battery', color: 'text-secondary', title: 'Class C' };
            return { icon: 'bi-battery-half', color: 'text-info', title: 'Class B' };
        };

        /**
         * Exchange the players occupying two slots in the same round and refresh the
         * pair strengths. Shared by the manual two-click swap and the automatic
         * court-fill swap so both behave identically.
         */
        const swapSlots = (a, b) => {
            const round = generatedRounds.value[a.rIdx];
            const slotA = round.games[a.gIdx][a.pairKey];
            const slotB = round.games[b.gIdx][b.pairKey];

            const tmp = slotA[a.pKey];
            slotA[a.pKey] = slotB[b.pKey];
            slotB[b.pKey] = tmp;

            [[a.gIdx, a.pairKey], [b.gIdx, b.pairKey]].forEach(([gi, pk]) => {
                const pair = round.games[gi][pk];
                pair.strength = getScore(pair.p1) + (pair.p2 ? getScore(pair.p2) : 0);
            });
        };

        const handleSwap = (rIdx, gIdx, pairKey, pKey) => {
            if (!swapSource.value) {
                swapSource.value = { rIdx, gIdx, pairKey, pKey };
                return;
            }
			
			const clickedRound = generatedRounds.value[rIdx];
            const clickedGame = clickedRound.games[gIdx];

            if (clickedGame.status === 'finished') {
                props.dialog.alert("Action Denied", "Cannot swap players in a finished game.");
                swapSource.value = null;
                return;
            }

            const source = swapSource.value;
            const target = { rIdx, gIdx, pairKey, pKey };

            if (source.rIdx !== target.rIdx) {
                props.dialog.alert("Invalid Swap", "You can only swap players within the same round.");
                swapSource.value = null; 
                return;
            }

            if (source.gIdx === target.gIdx && source.pairKey === target.pairKey && source.pKey === target.pKey) {
                swapSource.value = null;
                return;
            }

            swapSlots(source, target);

            swapSource.value = null;
            checkConflicts();
            checkRepeatedGames();
            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

        // --- Auto-fill a spare court ---------------------------------------
        // With 24+ players on 5 courts the queue dries up: every remaining game in
        // the round still contains someone who is mid-match, so a court sits idle.
        // Swapping a busy player for a free one of the same gender and level makes
        // a game playable again. Singles games are left alone — those are arranged
        // by hand at the start of the session.

        const pairKeyOf = (a, b) => [a, b].sort().join('_');

        /**
         * Single pass over the schedule producing both histories, keyed pair -> rounds.
         * `partners` is what checkConflicts already needed; `met` is the same notion of
         * "have shared a game" that checkRepeatedGames highlights. Built here so the
         * planner can ask the hypothetical question — would this swap repeat a pairing? —
         * against exactly the same definition the warnings use.
         */
        const buildPairHistory = () => {
            const partners = new Map();
            const met = new Map();
            const push = (map, k, r) => {
                if (!map.has(k)) map.set(k, []);
                map.get(k).push(r);
            };
            generatedRounds.value.forEach(round => {
                (round.games || []).forEach(g => {
                    ['pairA', 'pairB'].forEach(pk => {
                        const pair = g[pk];
                        if (pair && pair.p1 && pair.p2)
                            push(partners, pairKeyOf(pair.p1.id, pair.p2.id), round.roundNumber);
                    });
                    const ps = [g.pairA.p1, g.pairA.p2, g.pairB.p1, g.pairB.p2].filter(Boolean);
                    for (let i = 0; i < ps.length; i++)
                        for (let j = i + 1; j < ps.length; j++)
                            push(met, pairKeyOf(ps[i].id, ps[j].id), round.roundNumber);
                });
            });
            return { partners, met };
        };

        /** Pair keys that already appear more than once in the schedule as it stands. */
        const existingDuplicatePairs = (history) => {
            const dupes = new Set();
            history.forEach((rounds, key) => { if (rounds.length > 1) dupes.add(key); });
            return dupes;
        };

        /**
         * Replay a plan on a throwaway copy of the schedule and report whether it would
         * create a partnership that repeats. Returns true if it would, so the caller can
         * discard the plan rather than offer an illegal swap.
         */
        const introducesDuplicatePair = (swaps) => {
            const clone = generatedRounds.value.map(r => ({
                roundNumber: r.roundNumber,
                games: (r.games || []).map(g => ({
                    pairA: { p1: g.pairA.p1, p2: g.pairA.p2 },
                    pairB: { p1: g.pairB.p1, p2: g.pairB.p2 }
                }))
            }));

            swaps.forEach(sw => {
                const a = clone[sw.out.rIdx].games[sw.out.gIdx][sw.out.pairKey];
                const b = clone[sw.in.rIdx].games[sw.in.gIdx][sw.in.pairKey];
                const tmp = a[sw.out.pKey];
                a[sw.out.pKey] = b[sw.in.pKey];
                b[sw.in.pKey] = tmp;
            });

            const countPairs = (rounds) => {
                const m = new Map();
                rounds.forEach(r => (r.games || []).forEach(g => {
                    ['pairA', 'pairB'].forEach(pk => {
                        const p = g[pk];
                        if (p && p.p1 && p.p2) {
                            const k = pairKeyOf(p.p1.id, p.p2.id);
                            if (!m.has(k)) m.set(k, []);
                            m.get(k).push(r.roundNumber);
                        }
                    });
                }));
                return m;
            };

            // Only NEW repeats disqualify a plan — the schedule may already contain some
            // from earlier manual edits, and those are not this swap's fault.
            const before = existingDuplicatePairs(buildPairHistory().partners);
            const after = existingDuplicatePairs(countPairs(clone));
            for (const key of after) if (!before.has(key)) return true;
            return false;
        };

        const sameClass = (a, b) =>
            (a.gender || 'Male') === (b.gender || 'Male') &&
            (a.level || 'B') === (b.level || 'B');

        /** Every doubles slot in an awaiting game of this round, with its occupant. */
        const swappableSlots = (round, rIdx) => {
            const slots = [];
            (round.games || []).forEach((g, gIdx) => {
                if (g.status !== 'awaiting') return;
                if (g.type === 'singles' || !g.pairA.p2 || !g.pairB.p2) return; // hands off singles
                ['pairA', 'pairB'].forEach(pairKey => {
                    ['p1', 'p2'].forEach(pKey => {
                        const player = g[pairKey][pKey];
                        if (player) slots.push({ rIdx, gIdx, pairKey, pKey, player, game: g });
                    });
                });
            });
            return slots;
        };

        /**
         * Find the swaps that would free up one game for a spare court.
         * Returns { game, roundNumber, swaps, softWarnings } or { error }.
         */
        const planCourtFill = () => {
            const { partners, met } = buildPairHistory();
            const busy = activePlayerIds.value;

            const partneredAlready = (a, b) => (partners.get(pairKeyOf(a.id, b.id)) || []).length > 0;
            const metAlready = (a, b) => (met.get(pairKeyOf(a.id, b.id)) || []).length > 0;

            for (let rIdx = 0; rIdx < generatedRounds.value.length; rIdx++) {
                const round = generatedRounds.value[rIdx];
                const slots = swappableSlots(round, rIdx);

                for (const target of (round.games || []).map((g, gIdx) => ({ g, gIdx }))) {
                    const { g, gIdx } = target;
                    if (g.status !== 'awaiting') continue;
                    if (g.type === 'singles' || !g.pairA.p2 || !g.pairB.p2) continue;

                    const occupants = [
                        { pairKey: 'pairA', pKey: 'p1' }, { pairKey: 'pairA', pKey: 'p2' },
                        { pairKey: 'pairB', pKey: 'p1' }, { pairKey: 'pairB', pKey: 'p2' }
                    ].map(sl => ({ ...sl, player: g[sl.pairKey][sl.pKey] }));

                    const blocked = occupants.filter(o => busy.has(o.player.id));
                    if (!blocked.length) continue;          // already playable
                    if (blocked.length > 2) continue;       // too disruptive to fix by swapping

                    const swaps = [];
                    const softWarnings = [];
                    const usedSlotIds = new Set();
                    let ok = true;

                    for (const b of blocked) {
                        // Who would this player's new partner be, in the target game?
                        const partnerKey = b.pKey === 'p1' ? 'p2' : 'p1';
                        const newPartner = g[b.pairKey][partnerKey];
                        const others = occupants
                            .filter(o => o.player.id !== b.player.id)
                            .map(o => o.player);

                        const candidates = slots.filter(sl => {
                            const id = `${sl.gIdx}.${sl.pairKey}.${sl.pKey}`;
                            if (usedSlotIds.has(id)) return false;
                            if (sl.gIdx === gIdx) return false;               // must come from another game
                            if (busy.has(sl.player.id)) return false;          // must be free right now
                            if (!sameClass(sl.player, b.player)) return false; // same gender and level

                            // A swap rewrites BOTH pairs, so neither may recreate a partnership
                            // that exists anywhere in the schedule. This is absolute: if either
                            // side would repeat, the candidate is out and the plan stays null.
                            if (partneredAlready(sl.player, newPartner)) return false;
                            const theirPartner = sl.game[sl.pairKey][sl.pKey === 'p1' ? 'p2' : 'p1'];
                            if (theirPartner && partneredAlready(b.player, theirPartner)) return false;
                            return true;
                        });

                        // Prefer a candidate who has never shared a game with the other three.
                        const clean = candidates.filter(sl => !others.some(o => metAlready(sl.player, o)));
                        const pick = clean[0] || candidates[0];
                        if (!pick) { ok = false; break; }

                        if (!clean.length) {
                            softWarnings.push(`${pick.player.name} has already played in a game with someone here.`);
                        }

                        usedSlotIds.add(`${pick.gIdx}.${pick.pairKey}.${pick.pKey}`);
                        swaps.push({
                            out: { rIdx, gIdx, pairKey: b.pairKey, pKey: b.pKey, player: b.player },
                            in:  { rIdx, gIdx: pick.gIdx, pairKey: pick.pairKey, pKey: pick.pKey, player: pick.player }
                        });
                    }

                    // Each candidate was judged against the pre-swap schedule, so a pair of
                    // swaps could still combine into a repeat. Simulate the whole plan and
                    // throw it away if it introduces any partnership that did not exist before.
                    if (ok && swaps.length && introducesDuplicatePair(swaps)) ok = false;

                    if (ok && swaps.length) {
                        return { rIdx, gIdx, game: g, roundNumber: round.roundNumber, swaps, softWarnings };
                    }
                }
            }
            // Nobody can legally be moved in, so the only way forward is to free up
            // more players: settle a match that is still on court.
            return { error: "No legal swap available — the free players are the wrong gender or level, or have already partnered someone in the waiting games.\n\nYou need add a result on a court to free up more players." };
        };

        const applySwaps = (swaps) => {
            swaps.forEach(sw => swapSlots(sw.out, sw.in));
        };

        const fillSpareCourt = async () => {
            if (!freeCourts.value.length) {
                props.dialog.alert("No spare court", "Every court is in use.");
                return;
            }

            const plan = planCourtFill();
            if (plan.error) { props.dialog.alert("Cannot fill the court", plan.error); return; }

            const lines = plan.swaps.map(sw =>
                `${sw.in.player.name} comes in for ${sw.out.player.name}`);

            // Show the line-up as it will be AFTER the swaps, not the current one.
            const replacement = new Map(plan.swaps.map(sw => [sw.out.player.id, sw.in.player]));
            const after = ['pairA', 'pairB'].map(pk => {
                const pair = plan.game[pk];
                return [pair.p1, pair.p2].filter(Boolean)
                    .map(p => (replacement.get(p.id) || p).name).join(' & ');
            }).join('  vs  ');

            let msg = `To put a game on court ${freeCourts.value[0]}, round ${plan.roundNumber}:\n\n`
                    + lines.join('\n') + `\n\nThat game becomes: ${after}`;
            if (plan.softWarnings.length) msg += `\n\nNote: ${plan.softWarnings.join(' ')}`;

            const confirmed = await props.dialog.confirm("Swap players to fill the court?", msg);
            if (!confirmed) return;

            applySwaps(plan.swaps);
            checkConflicts();
            checkRepeatedGames();
            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

        /**
         * Distinct players in the schedule who are not on court right now.
         * A fill always ends up putting four off-court players on the spare court,
         * so fewer than four free players means no swap can exist. With every court
         * busy this is the same as needing 4 x courts + 4 players in the session.
         */
        const freePlayerCount = computed(() => {
            const free = new Set();
            generatedRounds.value.forEach(round => {
                (round.games || []).forEach(g => {
                    [g.pairA?.p1, g.pairA?.p2, g.pairB?.p1, g.pairB?.p2].forEach(p => {
                        if (p && !activePlayerIds.value.has(p.id)) free.add(p.id);
                    });
                });
            });
            return free.size;
        });

        /** True when a court is idle but nothing in the queue can go on it. */
        const needsCourtFill = computed(() =>
            generatedRounds.value.length > 0 &&
            freeCourts.value.length > 0 &&
            queueGames.value.length === 0 &&
            freePlayerCount.value >= 4 &&
            generatedRounds.value.some(r => (r.games || []).some(g => g.status === 'awaiting'))
        );

        // --- Courts -------------------------------------------------------
        // A court is held only by a game that is actually in play. Finished games
        // keep their court number for the record but release the court itself.
        const courtNumbers = computed(() =>
            Array.from({ length: config.numCourts }, (_, i) => i + 1));

        const occupiedCourts = computed(() => {
            const busy = new Map();
            generatedRounds.value.forEach(round => {
                (round.games || []).forEach(g => {
                    if (g.status === 'in_play' && g.court) busy.set(g.court, g);
                });
            });
            return busy;
        });

        const freeCourts = computed(() =>
            courtNumbers.value.filter(c => !occupiedCourts.value.has(c)));

        /** Lowest free court, preferring the one already pencilled in for this game. */
        const claimCourt = (game) => {
            const free = freeCourts.value;
            if (game.court && free.includes(game.court)) return game.court;
            return free.length ? free[0] : null;
        };

        const switchStatus = async (game) => {
            // 1. Resolve the Real Game Object
            let targetGame = game;

            // If this is a copy from the flat view (has indices), find the original
            if (game.originalRIdx !== undefined && game.originalGIdx !== undefined) {
                targetGame = generatedRounds.value[game.originalRIdx].games[game.originalGIdx];
            }

            // 2. Apply Logic to targetGame
            if (targetGame.status === 'awaiting') {
                const court = claimCourt(targetGame);
                if (!court) {
                    props.dialog.alert("No court free",
                        "You need add a result on a court.");
                    return;
                }
                targetGame.court = court;
                targetGame.status = 'in_play';
            } else if (targetGame.status === 'in_play') {
                targetGame.status = 'awaiting';
                targetGame.court = null;
            } else if (targetGame.status === 'finished') {
                const confirmed = await props.dialog.confirm(
                    "Reset Game",
                    "This game is finished. Are you sure you want to reset its score back to 0?"
                );
                if (!confirmed) return;
                targetGame.status = 'awaiting';
                targetGame.scoreA = 0;
                targetGame.scoreB = 0;
                targetGame.court = null;
            }

            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

        const openScoreModal = (game, pair) => {
            // 1. Resolve the Real Game Object
            if (game.originalRIdx !== undefined && game.originalGIdx !== undefined) {
                activeGame.value = generatedRounds.value[game.originalRIdx].games[game.originalGIdx];
            } else {
                activeGame.value = game;
            }
            activePair.value = pair;
        };

        const saveScore = (score) => {
            if (!activeGame.value) return;
            if (activePair.value === 'A') {
                activeGame.value.scoreA = score;
                activeGame.value.scoreB = config.gamesPerMatch - score;
            } else {
                activeGame.value.scoreB = score;
                activeGame.value.scoreA = config.gamesPerMatch - score;
            }
            activeGame.value.status = 'finished';

            // Keep this game visible in the Active view for 20s so the score can be double-checked
            const finishedId = activeGame.value.id;
            recentlyFinished.value = new Set(recentlyFinished.value).add(finishedId);
            setTimeout(() => {
                const next = new Set(recentlyFinished.value);
                next.delete(finishedId);
                recentlyFinished.value = next;
            }, 20000);

            activeGame.value = null;
            activePair.value = null;
            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

		// --- Player focus: every round for one player ----------------------
        const focusPlayer = ref(null);

        const openPlayerRounds = (player) => {
            if (player) focusPlayer.value = player;
        };

        /** One entry per round for the focused player: their game, or sitting out. */
        const focusPlayerRounds = computed(() => {
            const p = focusPlayer.value;
            if (!p) return [];
            return generatedRounds.value.map(round => {
                const game = (round.games || []).find(g =>
                    [g.pairA.p1, g.pairA.p2, g.pairB.p1, g.pairB.p2]
                        .some(x => x && x.id === p.id));
                if (!game) return { roundNumber: round.roundNumber, sittingOut: true };
                const side = (game.pairA.p1 && game.pairA.p1.id === p.id)
                          || (game.pairA.p2 && game.pairA.p2.id === p.id) ? 'A' : 'B';
                const mine = side === 'A' ? game.pairA : game.pairB;
                const them = side === 'A' ? game.pairB : game.pairA;
                const partner = mine.p1 && mine.p1.id === p.id ? mine.p2 : mine.p1;
                return {
                    roundNumber: round.roundNumber,
                    sittingOut: false,
                    game,
                    partner,
                    opponents: [them.p1, them.p2].filter(Boolean),
                    myScore: side === 'A' ? game.scoreA : game.scoreB,
                    theirScore: side === 'A' ? game.scoreB : game.scoreA
                };
            });
        });

		const getHeaderClass = (status) => {
			switch (status) {
				case 'in_play': return 'bg-success text-white'; 
				case 'finished': return 'bg-dark text-white'; 
				default: return 'bg-secondary'; 
			}
		};

        const validate = () => {
            const count = props.selected.length;
            errorMsg.value = "";
            if (count === 0) return "No players selected.";
            if (count % 2 !== 0) return "Number of players must be even.";
            if (count > 40) return "Maximum 40 players allowed.";
            if (config.numRounds >= 3 && count <= 11) return "For 3 Rounds, you need at least 12 players.";
            if (config.numRounds >= 5 && count <= 19) return "For 5 Rounds, you need at least 20 players.";
            if (config.numRounds >= 7 && count <= 31) return "For 7 Rounds, you need at least 32 players.";
            return "";
        };

        // How many pairings repeat in a freshly built schedule.
        // `duplicatePartners` is what the red warnings flag (same two players on the
        // same side twice); `repeatedMeetings` is the orange one (same two players in
        // the same game twice, as partners or opponents).
        const countScheduleRepeats = (schedule) => {
            const partners = new Map();
            const met = new Map();
            const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

            schedule.forEach(round => (round.games || []).forEach(g => {
                ['pairA', 'pairB'].forEach(pk => {
                    const pair = g[pk];
                    if (pair && pair.p1 && pair.p2)
                        bump(partners, pairKeyOf(pair.p1.id, pair.p2.id));
                });
                const ps = [g.pairA.p1, g.pairA.p2, g.pairB.p1, g.pairB.p2].filter(Boolean);
                for (let i = 0; i < ps.length; i++)
                    for (let j = i + 1; j < ps.length; j++)
                        bump(met, pairKeyOf(ps[i].id, ps[j].id));
            }));

            const excess = (m) => {
                let n = 0;
                m.forEach(count => { if (count > 1) n += count - 1; });
                return n;
            };
            return { duplicatePartners: excess(partners), repeatedMeetings: excess(met) };
        };

        const MAX_GENERATION_ATTEMPTS = 20;

        /** One randomised pass of the scheduler. Returns the rounds it produced. */
        const buildSchedule = () => {
            const schedule = [];
            const players = [...props.selected];
            const pairHistory = {};  // tracks partner pairs across rounds
            const gameHistory = {};  // tracks who was in the same game (all 4 players)
            players.forEach(p => {
                pairHistory[p.id] = new Set();
                gameHistory[p.id] = new Set();
            });

            const singlesUsed = new Set(); // tracks players who already played singles this session

            // Helpers
            const shuffle = (arr) => {
                for (let i = arr.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                }
                return arr;
            };

            const pairKey = (id1, id2) => [id1, id2].sort().join('_');

            // Split players into tiers by their level (A/B/C)
            const tierMap = {};
            players.forEach(p => {
                tierMap[p.id] = levelToTier(p.level);
            });

            // Separate by gender
            const males = players.filter(p => p.gender !== 'Female');
            const females = players.filter(p => p.gender === 'Female');

            for (let r = 1; r <= config.numRounds; r++) {
                let roundGames = [];
                let roundPairs = [];

                // Shuffle within gender groups each round for variety
                const shuffledMales = shuffle([...males]);
                const shuffledFemales = shuffle([...females]);

                // Step A: Create mixed-gender pairs (1M + 1F) first
                const pairedIds = new Set();
                const malePool = [...shuffledMales];
                const femalePool = [...shuffledFemales];

                // Score a potential pair: lower is better
                const scorePair = (p1, p2) => {
                    let score = 0;
                    // Penalty if already partnered before
                    if (pairHistory[p1.id].has(p2.id)) score += 1000;
                    // Penalty if were in same game before (less severe)
                    if (gameHistory[p1.id].has(p2.id)) score += 50;
                    // Level balance: prefer high+low or mid+mid
                    const t1 = tierMap[p1.id], t2 = tierMap[p2.id];
                    if (t1 === 'high' && t2 === 'low') score -= 10;
                    else if (t1 === 'low' && t2 === 'high') score -= 10;
                    else if (t1 === 'mid' && t2 === 'mid') score -= 8;
                    else if (t1 === t2) score += 20; // same tier (high+high or low+low) is bad
                    return score;
                };

                // Pre-select 2 players for singles when player count isn't divisible by 4.
                // Priority: unused males → unused females → any males → any females.
                // Within the chosen pool, prefer same level then least prior contact.
                let singlesPlayers = null;
                if (players.length % 4 === 2) {
                    const unusedMales   = malePool.filter(p => !singlesUsed.has(p.id));
                    const unusedFemales = femalePool.filter(p => !singlesUsed.has(p.id));

                    let candidatePool, sourcePool;
                    if (unusedMales.length >= 2)        { candidatePool = unusedMales;   sourcePool = malePool; }
                    else if (unusedFemales.length >= 2) { candidatePool = unusedFemales; sourcePool = femalePool; }
                    else if (malePool.length >= 2)      { candidatePool = malePool;      sourcePool = malePool; }
                    else if (femalePool.length >= 2)    { candidatePool = femalePool;    sourcePool = femalePool; }

                    if (candidatePool && candidatePool.length >= 2) {
                        let bestI = 0, bestJ = 1, minScore = Infinity;
                        for (let i = 0; i < candidatePool.length; i++) {
                            for (let j = i + 1; j < candidatePool.length; j++) {
                                const p1 = candidatePool[i], p2 = candidatePool[j];
                                let s = 0;
                                if ((p1.level || 'B') !== (p2.level || 'B')) s += 1000;
                                if (gameHistory[p1.id].has(p2.id)) s += 100;
                                if (s < minScore) { minScore = s; bestI = i; bestJ = j; }
                            }
                        }
                        const chosen1 = candidatePool[bestI];
                        const chosen2 = candidatePool[bestJ];
                        singlesPlayers = [chosen1, chosen2];
                        singlesUsed.add(chosen1.id);
                        singlesUsed.add(chosen2.id);
                        const removeById = (arr, id) => { const i = arr.findIndex(p => p.id === id); if (i !== -1) arr.splice(i, 1); };
                        removeById(sourcePool, chosen1.id);
                        removeById(sourcePool, chosen2.id);
                    }
                }

                // For each male, find best female partner
                while (malePool.length > 0 && femalePool.length > 0) {
                    const p1 = malePool.shift();
                    let bestIdx = 0;
                    let bestScore = Infinity;
                    for (let i = 0; i < femalePool.length; i++) {
                        const s = scorePair(p1, femalePool[i]);
                        if (s < bestScore) { bestScore = s; bestIdx = i; }
                    }
                    const p2 = femalePool.splice(bestIdx, 1)[0];
                    pairedIds.add(p1.id);
                    pairedIds.add(p2.id);
                    roundPairs.push({ p1, p2, strength: getScore(p1) + getScore(p2) });
                }

                // Step B: Pair remaining same-gender players
                const remaining = shuffle([...malePool, ...femalePool]);
                while (remaining.length >= 2) {
                    const p1 = remaining.shift();
                    let bestIdx = 0;
                    let bestScore = Infinity;
                    for (let i = 0; i < remaining.length; i++) {
                        const s = scorePair(p1, remaining[i]);
                        if (s < bestScore) { bestScore = s; bestIdx = i; }
                    }
                    const p2 = remaining.splice(bestIdx, 1)[0];
                    roundPairs.push({ p1, p2, strength: getScore(p1) + getScore(p2) });
                }

                // Record pair history
                roundPairs.forEach(pair => {
                    pairHistory[pair.p1.id].add(pair.p2.id);
                    pairHistory[pair.p2.id].add(pair.p1.id);
                });

                // Step C: Match pairs into games — balance strength + avoid repeat game groups
                // Score a potential match: lower is better
                const scoreMatch = (pA, pB) => {
                    let score = 0;
                    // Strength balance: closer combined strengths = better
                    score += Math.abs(pA.strength - pB.strength) * 5;
                    // Penalty for players who were in the same game before
                    const allPlayers = [pA.p1, pA.p2, pB.p1, pB.p2];
                    for (let i = 0; i < allPlayers.length; i++) {
                        for (let j = i + 1; j < allPlayers.length; j++) {
                            if (gameHistory[allPlayers[i].id].has(allPlayers[j].id)) score += 100;
                        }
                    }
                    return score;
                };

                shuffle(roundPairs); // shuffle before matching for variety

                while (roundPairs.length >= 2) {
                    const pairA = roundPairs.shift();
                    let bestIdx = 0;
                    let bestScore = Infinity;
                    for (let i = 0; i < roundPairs.length; i++) {
                        const s = scoreMatch(pairA, roundPairs[i]);
                        if (s < bestScore) { bestScore = s; bestIdx = i; }
                    }
                    const pairB = roundPairs.splice(bestIdx, 1)[0];

                    // Record game history (all 4 players met each other)
                    const gamePlayers = [pairA.p1, pairA.p2, pairB.p1, pairB.p2];
                    for (let i = 0; i < gamePlayers.length; i++) {
                        for (let j = i + 1; j < gamePlayers.length; j++) {
                            gameHistory[gamePlayers[i].id].add(gamePlayers[j].id);
                            gameHistory[gamePlayers[j].id].add(gamePlayers[i].id);
                        }
                    }

                    roundGames.push({
                        id: Math.random().toString(36).substr(2, 9),
                        type: 'doubles',
                        pairA: pairA,
                        pairB: pairB,
                        status: 'awaiting',
                        scoreA: 0,
                        scoreB: 0
                    });
                }

                // Step D: Handle Singles Game
                // Use pre-selected male pair if available, otherwise fall back to any leftover pair
                const singlesPair = singlesPlayers
                    ? { p1: singlesPlayers[0], p2: singlesPlayers[1] }
                    : (roundPairs.length > 0 ? roundPairs.shift() : null);

                if (singlesPair) {
                    gameHistory[singlesPair.p1.id].add(singlesPair.p2.id);
                    gameHistory[singlesPair.p2.id].add(singlesPair.p1.id);
                    roundGames.push({
                        id: Math.random().toString(36).substr(2, 9),
                        type: 'singles',
                        pairA: { p1: singlesPair.p1, p2: null, strength: getScore(singlesPair.p1) },
                        pairB: { p1: singlesPair.p2, p2: null, strength: getScore(singlesPair.p2) },
                        status: 'awaiting',
                        scoreA: 0,
                        scoreB: 0
                    });
                }

                schedule.push({ roundNumber: r, games: roundGames, sitOuts: [] });
            }
            return schedule;
        };

        const generateSchedule = () => {
            const error = validate();
            if (error) { errorMsg.value = error; return; }
            errorMsg.value = "";

            if (!props.data.current) props.data.current = {};
            props.data.current.numOfRounds = config.numRounds;
            props.data.current.gamesPerMatch = config.gamesPerMatch;
            props.data.current.numOfCourts = config.numCourts;

            // Building is randomised, so a single pass can still leave players
            // partnered twice (red) or facing each other twice (orange). Rebuild up
            // to MAX_GENERATION_ATTEMPTS times, stop as soon as a pass is clean, and
            // otherwise keep the cleanest one — repeat partners weigh far more than
            // repeat meetings, since only the former must be fixed by hand.
            let schedule = null;
            let bestScore = Infinity;
            for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
                const candidate = buildSchedule();
                const { duplicatePartners, repeatedMeetings } = countScheduleRepeats(candidate);
                const score = duplicatePartners * 1000 + repeatedMeetings;
                if (score < bestScore) { bestScore = score; schedule = candidate; }
                if (score === 0) break;
            }

            // Put the opening games straight onto courts 1..N and start them, so the
            // session begins with every court in play rather than everything awaiting.
            let nextCourt = 1;
            schedule.forEach(round => {
                (round.games || []).forEach(g => {
                    if (nextCourt <= config.numCourts) {
                        g.court = nextCourt++;
                        g.status = 'in_play';
                    } else {
                        g.court = null;
                    }
                });
            });

            generatedRounds.value = schedule;
            calculateActivePlayers();
            checkConflicts();
            checkRepeatedGames();
            showGuide.value = true;
            emit('update-games', schedule);
        };

        // --- Fullscreen (courts view) --------------------------------------
        // Uses the native Fullscreen API when available so the browser chrome goes
        // too; the CSS class alone is enough on browsers that refuse the request.
        const isFullscreen = ref(false);
        const rootEl = ref(null);

        const syncFullscreen = () => {
            if (document.fullscreenElement === null && isFullscreen.value) {
                isFullscreen.value = false;
            }
        };

        const toggleFullscreen = async () => {
            if (isFullscreen.value) {
                isFullscreen.value = false;
                if (document.fullscreenElement && document.exitFullscreen) {
                    try { await document.exitFullscreen(); } catch (e) {}
                }
                return;
            }
            isFullscreen.value = true;
            const el = rootEl.value;
            if (el && el.requestFullscreen) {
                try { await el.requestFullscreen(); } catch (e) {} // stays CSS-only
            }
        };

        onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen));
        onUnmounted(() => document.removeEventListener('fullscreenchange', syncFullscreen));

        const showGuide = ref(false);

        const resetGames = async () => {
			const confirmed = await props.dialog.confirm(
                "Reset Schedule", 
                "Are you sure? This will delete the current schedule from the cloud."
            );
            
            if(confirmed) {
                generatedRounds.value = [];
                activePlayerIds.value = new Set(); 
                conflictedPlayerIds.value = new Set();
                conflictMsg.value = "";
                emit('update-games', []);
            }
        };

        return {
            config,
            generatedRounds,
            errorMsg,
            generateSchedule,
            showRound,
            resetGames,
            handleSwap, 
            swapSource, 
			swapSourceName,
            openScoreModal, 
            switchStatus,
            getHeaderClass,
            courtNumbers,
            occupiedCourts,
            freeCourts,
            activePlayerIds,
            activeGame,
            activePair,
            saveScore,
            conflictedPlayerIds,
            conflictMsg,
            addPairExceptions,
            unexceptedPairs,
            repeatedOpponentIds,
            getPlayerNameClass,
            getPlayerStyle,
			hasFinishedGames,
			viewMode,
            boardSections,
            fillSpareCourt,
            needsCourtFill,
            activeGames,
            queueGames,
			getBatteryData,
            showGuide,
            isFullscreen,
            toggleFullscreen,
            rootEl,
            blockGenerate,
            ignoreLevelWarning,
            focusPlayer,
            openPlayerRounds,
            focusPlayerRounds
        };
    },
    template: `
    <div ref="rootEl" :class="{ 'games-fullscreen': isFullscreen }">
        <div v-if="!hasFinishedGames && !isFullscreen" class="card bg-light mb-4">
            <div class="card-body">
                <div v-if="generatedRounds.length === 0"> 
                    <div class="row g-3 align-items-end">
                        <div class="col-md-3">
                            <label class="form-label fw-bold">Active Players: {{selected.length}}</label>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Games Per Match</label>
                            <div class="btn-group w-100" role="group">
                              <input type="radio" class="btn-check" name="gamesPerMatch" id="g5" @click="config.gamesPerMatch = 5">
                              <label class="btn btn-outline-primary" for="g5">5</label>
                              <input type="radio" class="btn-check" name="gamesPerMatch" id="g7" checked @click="config.gamesPerMatch = 7">
                              <label class="btn btn-outline-primary" for="g7">7</label>
                              <input type="radio" class="btn-check" name="gamesPerMatch" id="g11" @click="config.gamesPerMatch = 11">
                              <label class="btn btn-outline-primary" for="g11">11</label>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Total Rounds</label>
                            <div class="btn-group w-100" role="group">
                              <input type="radio" class="btn-check" name="numofrounds" id="r3" checked @click="config.numRounds = 3">
                              <label class="btn btn-outline-primary" for="r3">3</label>
                              <input type="radio" class="btn-check" name="numofrounds" id="r5" @click="config.numRounds = 5">
                              <label class="btn btn-outline-primary" for="r5">5</label>
                              <input type="radio" class="btn-check" name="numofrounds" id="r7" @click="config.numRounds = 7">
                              <label class="btn btn-outline-primary" for="r7">7</label>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Courts in Use</label>
                            <div class="btn-group w-100" role="group">
                              <input type="radio" class="btn-check" name="numofcourts" id="c3" :checked="config.numCourts === 3" @click="config.numCourts = 3">
                              <label class="btn btn-outline-primary" for="c3">3</label>
                              <input type="radio" class="btn-check" name="numofcourts" id="c4" :checked="config.numCourts === 4" @click="config.numCourts = 4">
                              <label class="btn btn-outline-primary" for="c4">4</label>
                              <input type="radio" class="btn-check" name="numofcourts" id="c5" :checked="config.numCourts === 5" @click="config.numCourts = 5">
                              <label class="btn btn-outline-primary" for="c5">5</label>
                              <input type="radio" class="btn-check" name="numofcourts" id="c6" :checked="config.numCourts === 6" @click="config.numCourts = 6">
                              <label class="btn btn-outline-primary" for="c6">6</label>
                              <input type="radio" class="btn-check" name="numofcourts" id="c7" :checked="config.numCourts === 7" @click="config.numCourts = 7">
                              <label class="btn btn-outline-primary" for="c7">7</label>
                            </div>
                        </div>
                        <div class="col-12" v-if="blockGenerate">
                            <div class="alert alert-warning mb-0 py-2">
                                <div>
                                    <i class="bi bi-exclamation-triangle-fill"></i>
                                    To get a better result you should update the players level on the
                                    <a href="#" class="fw-bold" @click.prevent="$emit('switch-tab', 'tab-selection')">Players tab</a>.
                                </div>
                                <a href="#" class="small text-muted" @click.prevent="ignoreLevelWarning = true">
                                    The levels are fine — let me generate anyway
                                </a>
                            </div>
                        </div>
                        <div class="col-12">
                            <button class="btn btn-primary w-100" @click="generateSchedule" :disabled="blockGenerate">
                                <i class="bi bi-controller"></i> Generate Matches
                            </button>
                        </div>
                    </div>
                    <div v-if="errorMsg" class="alert alert-danger mt-3 mb-0">
                        <i class="bi bi-exclamation-triangle-fill"></i> {{ errorMsg }}
                    </div>
                    <div class="text-center text-muted py-5">
                        <i class="bi bi-calendar-range display-4"></i>
                        <p class="mt-2">Set rounds and click Generate to see the schedule.</p>
                    </div>
                </div>
                <div v-else>
                    <button class="btn btn-danger w-100" @click="resetGames"> <i class="bi bi-trash"></i> Reset Matches </button>
                </div>
            </div>
        </div>
            
        <div v-if="generatedRounds.length > 0" class="card bg-light mb-4">
            <div class="card-body">
                    <div v-if="conflictMsg" class="alert alert-danger mb-3">
                        <i class="bi bi-exclamation-octagon-fill"></i> {{ conflictMsg }}
                        <a href="#" class="alert-link ms-1" @click.prevent="addPairExceptions">Add exception</a>
                    </div>

                    <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                        <h4 class="text-primary mb-0">
                            {{ viewMode === 'rounds' ? 'Round' : 'Courts' }}
                        </h4>
                        <div class="d-flex align-items-center gap-3">
                            <div class="btn-group" role="group">
                                <input type="radio" class="btn-check" name="viewMode" id="vm1" value="rounds" v-model="viewMode">
                                <label class="btn btn-outline-primary" for="vm1" title="By round"><i class="bi bi-list-ol"></i></label>

                                <input type="radio" class="btn-check" name="viewMode" id="vm2" value="board" v-model="viewMode">
                                <label class="btn btn-outline-primary" for="vm2" title="Queue and Active together"><i class="bi bi-columns-gap"></i></label>
                            </div>

                            <button v-if="viewMode === 'board'" type="button" class="btn btn-outline-secondary"
                                    :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
                                    @click="toggleFullscreen">
                                <i class="bi" :class="isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'"></i>
                            </button>
                        </div>
                    </div>

                    <template v-if="viewMode === 'rounds'">
                        <div class="btn-group w-100 mb-3" role="group">
                            <template v-for="(round, rIdx) in generatedRounds" :key="'tab' + round.roundNumber">
                                <input type="radio" class="btn-check" name="rounds" :id="'roundNum' + round.roundNumber" :value="round.roundNumber" v-model="showRound">
                                <label class="btn btn-outline-primary" :for="'roundNum' + round.roundNumber"> {{ round.roundNumber }} </label>
                            </template>
                        </div>
                        
                        <div v-for="(round, rIdx) in generatedRounds" :key="round.roundNumber">
                            <template v-if="showRound === round.roundNumber">
                                <div class="row row-cols-1 row-cols-md-2 g-3">
                                    <div class="col" v-for="(game, gIdx) in round.games" :key="game.id">
                                        <div class="card h-100 border-secondary shadow-sm">
                                            <div class="card-header py-1 d-flex justify-content-between align-items-center cursor-pointer" 
                                                 :class="getHeaderClass(game.status)" 
                                                 @click="switchStatus(game)">
                                                <strong>
                                                    Game {{ gIdx + 1 }}
                                                    <span v-if="game.court" class="badge bg-dark ms-1">
                                                        <i class="bi bi-geo-alt-fill"></i> Court {{ game.court }}
                                                    </span>
                                                </strong>
                                                <span class="badge bg-light text-dark">
                                                    {{ game.status === 'in_play' ? 'In Play' : (game.status === 'finished' ? 'Finished' : 'Awaiting') }}
                                                </span>
                                            </div>
                                            <div class="card-body p-2">
                                                <div class="d-flex justify-content-between mb-2 p-2 rounded bg-light border-start border-5 border-primary">
                                                    <div style="min-width: 0;">
                                                        <span class="d-flex align-items-center mb-1 text-truncate" :class="getPlayerNameClass(game.pairA.p1.id)" :style="getPlayerStyle(game.pairA.p1.id, round.roundNumber)">
                                                            <i v-if="activePlayerIds.has(game.pairA.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p1' && swapSource.pairKey === 'pairA' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairA', 'p1')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button>
															<i class="bi me-1 flex-shrink-0" style="font-size: 1.1em;" :class="[getBatteryData(game.pairA.p1).icon, getBatteryData(game.pairA.p1).color]" :title="getBatteryData(game.pairA.p1).title"></i>
                                                            <span class="text-truncate">{{ game.pairA.p1.name }}</span>
                                                        </span>
                                                        <span v-if="game.pairA.p2" class="d-flex align-items-center text-truncate" :class="getPlayerNameClass(game.pairA.p2.id)" :style="getPlayerStyle(game.pairA.p2.id, round.roundNumber)">
                                                            <i v-if="activePlayerIds.has(game.pairA.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p2' && swapSource.pairKey === 'pairA' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairA', 'p2')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button>
															<i class="bi me-1 flex-shrink-0" style="font-size: 1.1em;" :class="[getBatteryData(game.pairA.p2).icon, getBatteryData(game.pairA.p2).color]" :title="getBatteryData(game.pairA.p2).title"></i>
                                                            <span class="text-truncate">{{ game.pairA.p2.name }}</span>
                                                        </span>
                                                    </div>
                                                    <div class="text-end mt-2 flex-shrink-0">
                                                        <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game, 'A')">{{ game.scoreA }}</button>
                                                    </div>
                                                </div>
                                                <div class="d-flex justify-content-between p-2 rounded bg-light border-start border-5 border-danger">
                                                    <div style="min-width: 0;">
                                                        <span class="d-flex align-items-center mb-1 text-truncate" :class="getPlayerNameClass(game.pairB.p1.id)" :style="getPlayerStyle(game.pairB.p1.id, round.roundNumber)">
                                                            <i v-if="activePlayerIds.has(game.pairB.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p1' && swapSource.pairKey === 'pairB' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairB', 'p1')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button>
                                                            <i class="bi me-1 flex-shrink-0" style="font-size: 1.1em;" :class="[getBatteryData(game.pairB.p1).icon, getBatteryData(game.pairB.p1).color]" :title="getBatteryData(game.pairB.p1).title"></i>
															<span class="text-truncate">{{ game.pairB.p1.name }}</span>
                                                        </span>
                                                        <span v-if="game.pairB.p2" class="d-flex align-items-center text-truncate" :class="getPlayerNameClass(game.pairB.p2.id)" :style="getPlayerStyle(game.pairB.p2.id, round.roundNumber)">
                                                            <i v-if="activePlayerIds.has(game.pairB.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p2' && swapSource.pairKey === 'pairB' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairB', 'p2')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button>
                                                            <i class="bi me-1 flex-shrink-0" style="font-size: 1.1em;" :class="[getBatteryData(game.pairB.p2).icon, getBatteryData(game.pairB.p2).color]" :title="getBatteryData(game.pairB.p2).title"></i>
															<span class="text-truncate">{{ game.pairB.p2.name }}</span>
                                                        </span>
                                                    </div>
                                                    <div class="text-end mt-2 flex-shrink-0">
                                                        <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game, 'B')">{{ game.scoreB }}</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div v-if="round.sitOuts.length > 0" class="alert alert-warning mt-3">
                                    <strong><i class="bi bi-pause-circle-fill"></i> Sitting Out:</strong> 
                                    <span v-for="(p, i) in round.sitOuts" :key="p.id">
                                        <span class="ms-2 badge border border-dark text-truncate d-inline-flex align-items-center" style="max-width: 150px;" :class="activePlayerIds.has(p.id) ? 'bg-success' : 'bg-warning text-dark'">
                                            <i v-if="activePlayerIds.has(p.id)" class="bi bi-activity me-1"></i>
                                            <i v-else class="bi bi-hourglass-split me-1"></i> 
											<i class="bi me-1 flex-shrink-0" style="font-size: 1.1em;" :class="[getBatteryData(p).icon, getBatteryData(p).color]" :title="getBatteryData(p).title"></i>
                                            <span class="text-truncate">{{ p.name }}</span>
                                        </span>
                                    </span>
                                </div>
                            </template>
                        </div>
                    </template>

                    <template v-else>
                        <div v-for="section in boardSections" :key="section.key" class="mb-4">
                            <div class="d-flex align-items-center border-bottom pb-1 mb-2">
                                <h5 class="mb-0 text-secondary">
                                    <i class="bi" :class="section.icon"></i> {{ section.title }}
                                </h5>
                                <span class="badge bg-secondary ms-2">{{ section.games.length }}</span>
                            </div>
                            <div v-if="section.key === 'queue' && needsCourtFill"
                                 class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between py-2 mb-2">
                                <span>
                                    <i class="bi bi-exclamation-triangle-fill"></i>
                                    Court {{ freeCourts[0] }} is free but nobody is ready.
                                </span>
                                <button class="btn btn-sm btn-warning" @click="fillSpareCourt">
                                    <i class="bi bi-arrow-left-right"></i> Swap players to fill it
                                </button>
                            </div>
                            <div v-if="section.games.length === 0" class="text-muted fst-italic small">
                                {{ section.empty }}
                            </div>
                            <div v-else style="display: grid; grid-template-columns: repeat(auto-fill, minmax(225px, 1fr)); gap: 1rem;">
                            <div v-for="game in section.games" :key="game.id">
                                <div class="card h-100 border-secondary shadow-sm">
                                    <div class="card-header py-1 d-flex justify-content-between align-items-center cursor-pointer" 
                                         :class="getHeaderClass(game.status)" 
                                         @click="switchStatus(game)">
                                        <strong>
                                            Round {{ game.roundNum }}
                                            <span v-if="game.court" class="badge bg-dark ms-1">
                                                <i class="bi bi-geo-alt-fill"></i> Court {{ game.court }}
                                            </span>
                                        </strong>
                                        <span class="badge bg-light text-dark">
                                            {{ game.status === 'in_play' ? 'In Play' : (game.status === 'finished' ? 'Finished' : 'Awaiting') }}
                                        </span>
                                    </div>
                                    <div class="card-body p-2">
                                        <div class="d-flex justify-content-between mb-2 p-2 rounded bg-light border-start border-5 border-primary">
                                            <div style="min-width: 0;">
                                                <span class="d-flex align-items-center mb-1 text-truncate cursor-pointer" :class="getPlayerNameClass(game.pairA.p1.id)" :style="getPlayerStyle(game.pairA.p1.id, game.roundNum)" @click.stop="openPlayerRounds(game.pairA.p1)" title="See all rounds for this player">
                                                    <i v-if="activePlayerIds.has(game.pairA.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairA.p1.name }}</span>
                                                </span>
                                                <span v-if="game.pairA.p2" class="d-flex align-items-center text-truncate cursor-pointer" :class="getPlayerNameClass(game.pairA.p2.id)" :style="getPlayerStyle(game.pairA.p2.id, game.roundNum)" @click.stop="openPlayerRounds(game.pairA.p2)" title="See all rounds for this player">
                                                    <i v-if="activePlayerIds.has(game.pairA.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairA.p2.name }}</span>
                                                </span>
                                            </div>
                                            <div class="text-end mt-2 flex-shrink-0">
                                                <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game, 'A')">{{ game.scoreA }}</button>
                                            </div>
                                        </div>
                                        <div class="d-flex justify-content-between p-2 rounded bg-light border-start border-5 border-danger">
                                            <div style="min-width: 0;">
                                                <span class="d-flex align-items-center mb-1 text-truncate cursor-pointer" :class="getPlayerNameClass(game.pairB.p1.id)" :style="getPlayerStyle(game.pairB.p1.id, game.roundNum)" @click.stop="openPlayerRounds(game.pairB.p1)" title="See all rounds for this player">
                                                    <i v-if="activePlayerIds.has(game.pairB.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairB.p1.name }}</span>
                                                </span>
                                                <span v-if="game.pairB.p2" class="d-flex align-items-center text-truncate cursor-pointer" :class="getPlayerNameClass(game.pairB.p2.id)" :style="getPlayerStyle(game.pairB.p2.id, game.roundNum)" @click.stop="openPlayerRounds(game.pairB.p2)" title="See all rounds for this player">
                                                    <i v-if="activePlayerIds.has(game.pairB.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairB.p2.name }}</span>
                                                </span>
                                            </div>
                                            <div class="text-end mt-2 flex-shrink-0">
                                                <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game, 'B')">{{ game.scoreB }}</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                    </template>
            </div>
        </div>
		<p v-if="hasFinishedGames && !isFullscreen" class="text-secondary"> Reset is disabled once a match has been finalised. </p>

        <div v-if="showGuide" class="modal custom-modal-backdrop" tabindex="-1" style="background-color: rgba(0,0,0,0.5);">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="bi bi-info-circle-fill me-2"></i>How to use the schedule</h5>
                        <button type="button" class="btn-close btn-close-white" @click="showGuide = false"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">Use the <strong><i class="bi bi-arrow-left-right"></i> swap button</strong> next to any player's name to swap them with another player in the same round.</p>
                        <div class="d-flex align-items-start mb-2">
                            <span class="fw-bold me-2" style="color: #dc3545; white-space: nowrap;">Red names</span>
                            <span class="text-muted">— these two players are already partnered together in another round. You <strong>must</strong> swap one of them until no red names remain.</span>
                        </div>
                        <div class="d-flex align-items-start">
                            <span class="fw-bold me-2" style="color: #fd7e14; white-space: nowrap;">Orange names</span>
                            <span class="text-muted">— these players have already met in the same match (as partners or opponents) in another round. No action required, but swapping adds more variety.</span>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" @click="showGuide = false">Got it</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="focusPlayer" class="modal custom-modal-backdrop" tabindex="-1" style="background-color: rgba(0,0,0,0.5);" @click.self="focusPlayer = null">
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title d-flex align-items-center">
                            <i class="bi bi-person-fill me-2"></i>
                            <span class="text-truncate">{{ focusPlayer.name }}</span>
                        </h5>
                        <button type="button" class="btn-close btn-close-white" @click="focusPlayer = null"></button>
                    </div>
                    <div class="modal-body p-2">
                        <div v-for="r in focusPlayerRounds" :key="'fp' + r.roundNumber" class="card mb-2 border-secondary">
                            <div class="card-header py-1 d-flex justify-content-between align-items-center"
                                 :class="r.sittingOut ? 'bg-warning text-dark' : getHeaderClass(r.game.status)">
                                <strong>
                                    Round {{ r.roundNumber }}
                                    <span v-if="!r.sittingOut && r.game.court" class="badge bg-dark ms-1">
                                        <i class="bi bi-geo-alt-fill"></i> Court {{ r.game.court }}
                                    </span>
                                </strong>
                                <span class="badge bg-light text-dark">
                                    {{ r.sittingOut ? 'Sitting Out' : (r.game.status === 'in_play' ? 'In Play' : (r.game.status === 'finished' ? 'Finished' : 'Awaiting')) }}
                                </span>
                            </div>
                            <div v-if="!r.sittingOut" class="card-body p-2">
                                <div class="d-flex justify-content-between align-items-center mb-2 p-2 rounded bg-light border-start border-5 border-primary">
                                    <div style="min-width: 0;">
                                        <div class="text-truncate fw-bold">{{ focusPlayer.name }}</div>
                                        <div v-if="r.partner" class="text-truncate small text-muted">
                                            with {{ r.partner.name }}
                                        </div>
                                    </div>
                                    <span class="badge bg-secondary fs-6 flex-shrink-0">{{ r.myScore }}</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center p-2 rounded bg-light border-start border-5 border-danger">
                                    <div style="min-width: 0;">
                                        <div v-for="o in r.opponents" :key="o.id" class="text-truncate">{{ o.name }}</div>
                                    </div>
                                    <span class="badge bg-secondary fs-6 flex-shrink-0">{{ r.theirScore }}</span>
                                </div>
                                <div v-if="r.game.status === 'awaiting'" class="small fst-italic text-muted mt-2">
                                    <i class="bi bi-info-circle"></i> Subject to change — players can still be swapped.
                                </div>
                            </div>
                            <div v-else class="card-body p-2 small fst-italic text-muted">
                                <i class="bi bi-info-circle"></i> Subject to change — players can still be swapped.
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" @click="focusPlayer = null">Close</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="activeGame" class="modal custom-modal-backdrop" tabindex="-1" style="background-color: rgba(0,0,0,0.5);">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">Set Score (Match to {{ config.gamesPerMatch }})</h5>
                        <button type="button" class="btn-close btn-close-white" @click="activeGame = null"></button>
                    </div>
                    <div class="modal-body text-center">
                        <p class="mb-1 text-muted">Set Score for</p>
                        <h4 v-if="activePair === 'A'" class="mb-3">{{ activeGame.pairA.p1.name }} {{(activeGame.pairA.p2) ? '& ' + activeGame.pairA.p2.name : '' }}</h4>
                        <h4 v-else class="mb-3">{{ activeGame.pairB.p1.name }} {{(activeGame.pairB.p2) ? '& ' + activeGame.pairB.p2.name : '' }}</h4>

                        <div class="d-flex flex-wrap justify-content-center gap-2">
                            <button
                                v-for="i in (config.gamesPerMatch + 1)"
                                :key="i"
                                class="btn btn-outline-primary btn-lg"
                                style="width: 56px;"
                                @click="saveScore(i - 1)"
                            >
                                {{ i - 1 }}
                            </button>
                        </div>

                        <hr>
                        <p v-if="activePair === 'A'" class="small text-muted">
                            {{ activeGame.pairB.p1.name }} {{ (activeGame.pairB.p2) ? '& ' + activeGame.pairB.p2.name : '' }}
                            will automatically receive {{ config.gamesPerMatch }} minus your selection.
                        </p>
                        <p v-else class="small text-muted">
                            {{ activeGame.pairA.p1.name }} {{ (activeGame.pairA.p2) ? '& ' + activeGame.pairA.p2.name : '' }}
                            will automatically receive {{ config.gamesPerMatch }} minus your selection.
                        </p>
                    </div>
                </div>
            </div>
        </div>
		
		<div v-if="!swapSource && conflictMsg" class="alert alert-danger position-fixed bottom-0 start-0 end-0 m-0 rounded-0 z-3 shadow-lg d-flex justify-content-center align-items-center" role="alert">
            <i class="bi bi-exclamation-octagon-fill me-2 fs-4"></i>
            <span class="fw-bold">{{ conflictMsg }}</span>
            <a href="#" class="alert-link fw-bold ms-2" @click.prevent="addPairExceptions">Add exception</a>
        </div>
		
		<div v-if="swapSource" class="alert alert-info position-fixed bottom-0 start-0 end-0 m-0 rounded-0 z-3 shadow-lg d-flex justify-content-center align-items-center" role="alert">
            <i class="bi bi-arrow-left-right me-2 fs-4"></i>
            <span>
                Select another player to swap with <strong>{{ swapSourceName }}</strong>
            </span>
            <button class="btn btn-sm btn-outline-dark ms-3 fw-bold" @click="swapSource = null">Cancel</button>
        </div>



    </div>
    `
};