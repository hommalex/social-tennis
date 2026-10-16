const TournamentGames = {
    props: ['data', 'selected', 'dialog'],
    emits: ['update-tournament-games'],
    setup(props, { emit }) {
        const { ref, computed, watch, onMounted, onUnmounted } = Vue;

        const generatedRounds = ref([]);
        const errorMsg = ref('');
        const showRound = ref(1);
        const viewMode = ref('rounds');
        const activePlayerIds = ref(new Set());
        const swapSource = ref(null); // { rIdx, gIdx, pairKey } — swaps whole pair
        const activeGame = ref(null);
        const scoreInputA = ref(0);
        const scoreInputB = ref(0);

        // Map player level (A best, B mid, C lowest) to a numeric strength score.
        // Ghost placeholders have no level and count as the weakest.
        const getScore = (p) => {
            if (!p || p.isGhost) return 0;
            if (p.level === 'A') return 3;
            if (p.level === 'C') return 1;
            return 2; // 'B' or unset
        };

        const teams = computed(() => props.data?.tournament?.teams || []);
        const allPlayers = computed(() => [
            ...(props.data?.players || []),
            ...(props.data?.tournament?.ghosts || [])
        ]);

        const getPlayer = (id) => allPlayers.value.find(p => p.id === id);
        const getTeam = (id) => teams.value.find(t => t.id === id);

        const hasFinishedGames = computed(() =>
            generatedRounds.value.some(r => r.games?.some(g => g.status === 'finished'))
        );

        const calculateActivePlayers = () => {
            const active = new Set();
            generatedRounds.value.forEach(round => {
                round.games?.forEach(game => {
                    if (game.status === 'in_play') {
                        if (game.pairA.p1) active.add(game.pairA.p1.id);
                        if (game.pairA.p2) active.add(game.pairA.p2.id);
                        if (game.pairB.p1) active.add(game.pairB.p1.id);
                        if (game.pairB.p2) active.add(game.pairB.p2.id);
                    }
                });
            });
            activePlayerIds.value = active;
        };

        // --- Courts --------------------------------------------------------
        // A court is held only by a game in play; finished games keep their court
        // number for the record but release the court itself.
        const numCourts = ref(5);
        const courtNumbers = computed(() =>
            Array.from({ length: numCourts.value }, (_, i) => i + 1));

        const occupiedCourts = computed(() => {
            const busy = new Set();
            generatedRounds.value.forEach(round => {
                (round.games || []).forEach(g => {
                    if (g.status === 'in_play' && g.court) busy.add(g.court);
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

        const setNumCourts = (n) => {
            numCourts.value = n;
            if (props.data?.tournament) props.data.tournament.numOfCourts = n;
        };

        // --- Board view: Queue, Active and Finished together ---------------
        const flatten = (predicate) => {
            const list = [];
            generatedRounds.value.forEach((round, rIdx) => {
                (round.games || []).forEach((game, gIdx) => {
                    if (!predicate(game)) return;
                    list.push({ ...game, roundNum: round.roundNumber, originalRIdx: rIdx, originalGIdx: gIdx });
                });
            });
            return list;
        };

        const activeGames = computed(() =>
            flatten(g => g.status === 'in_play')
                .sort((a, b) => (a.court || 99) - (b.court || 99)));

        // The last five games scored, most recent first.
        const FINISHED_SHOWN = 5;
        const finishedGames = computed(() =>
            flatten(g => g.status === 'finished')
                .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))
                .slice(0, FINISHED_SHOWN));

        const playerLabel = (g, id) => {
            const p = [g.pairA?.p1, g.pairA?.p2, g.pairB?.p1, g.pairB?.p2].find(x => x && x.id === id);
            return p ? p.name : '';
        };

        // Next up, in the planned order, with ready games ahead of blocked ones.
        // Normally just the earliest round still waiting; if none of those can go
        // on court yet, ready games from later rounds are offered too.
        const queueGames = computed(() => {
            const awaiting = flatten(g => g.status === 'awaiting').map(g => {
                const busyNames = gamePlayerIds(g)
                    .filter(id => activePlayerIds.value.has(id))
                    .map(id => playerLabel(g, id));
                return { ...g, busyNames, blocked: busyNames.length > 0 };
            });
            if (!awaiting.length) return [];
            const order = (a, b) =>
                (a.seq ?? a.roundNum * 100 + a.originalGIdx) - (b.seq ?? b.roundNum * 100 + b.originalGIdx);
            const nextRound = Math.min(...awaiting.map(g => g.roundNum));
            let list = awaiting.filter(g => g.roundNum === nextRound);
            if (!list.some(g => !g.blocked)) {
                list = list.concat(awaiting.filter(g => g.roundNum > nextRound && !g.blocked));
            }
            return list.sort((a, b) => (a.blocked - b.blocked) || order(a, b));
        });

        const boardSections = computed(() => [
            { key: 'queue',  title: 'Queue',  icon: 'bi-hourglass', games: queueGames.value,
              empty: 'Nothing waiting.' },
            { key: 'active', title: 'Active', icon: 'bi-activity',  games: activeGames.value,
              empty: 'No games in play.' },
            { key: 'finished', title: 'Finished', icon: 'bi-check2-circle', games: finishedGames.value,
              empty: 'No games scored yet.' }
        ]);

        // --- Fullscreen (courts view) --------------------------------------
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

        // Latin square pairing: for round rIdx, male j partners female (j + rIdx) % numFemales
        const getTeamPairings = (team, roundIdx) => {
            const teamPlayers = (team.players || []).map(id => getPlayer(id)).filter(Boolean);
            const males = teamPlayers.filter(p => p.gender !== 'Female')
                .sort((a, b) => getScore(b) - getScore(a));
            const females = teamPlayers.filter(p => p.gender === 'Female')
                .sort((a, b) => getScore(b) - getScore(a));

            if (males.length === 0 || females.length === 0) return [];

            const pairs = [];
            const numPairs = Math.min(males.length, females.length);
            for (let j = 0; j < numPairs; j++) {
                const female = females[(j + roundIdx) % females.length];
                pairs.push({
                    p1: males[j],
                    p2: female,
                    teamId: team.id,
                    strength: getScore(males[j]) + getScore(female)
                });
            }
            return pairs;
        };

        // Round-robin team matchup scheduler (fixes first team, rotates the rest)
        const getTeamMatchups = (teamList, numRounds) => {
            const t = [...teamList];
            if (t.length % 2 !== 0) t.push(null); // dummy for odd number of teams
            const half = t.length / 2;
            const rounds = [];

            for (let r = 0; r < numRounds; r++) {
                const matchups = [];
                for (let i = 0; i < half; i++) {
                    const a = t[i];
                    const b = t[t.length - 1 - i];
                    if (a && b) matchups.push([a, b]);
                }
                rounds.push(matchups);
                // Rotate: fix t[0], move last element to position 1
                const last = t.splice(t.length - 1, 1)[0];
                t.splice(1, 0, last);
            }
            return rounds;
        };

        const gamePlayerIds = (g) =>
            [g.pairA?.p1, g.pairA?.p2, g.pairB?.p1, g.pairB?.p2].filter(Boolean).map(x => x.id);

        /**
         * Plans the order games should go on court. Everyone plays once per round,
         * so a game started right after another that shares a player will find that
         * player still on court. Pick each next game to share as few players as
         * possible with the games most recently started (the ones still playing),
         * staying within one round of the earliest unplayed round. Stamps game.seq.
         */
        const planGameOrder = (schedule) => {
            const remaining = [];
            schedule.forEach((round, rIdx) => (round.games || []).forEach((game, gIdx) => {
                remaining.push({ game, rIdx, gIdx, ids: gamePlayerIds(game) });
            }));
            const onCourt = [];   // the last (numCourts - 1) started
            let seq = 1;
            while (remaining.length) {
                const earliest = Math.min(...remaining.map(r => r.rIdx));
                const busy = new Set(onCourt.flatMap(r => r.ids));
                let best = null, bestKey = null;
                remaining.forEach(r => {
                    if (r.rIdx > earliest + 1) return;
                    const key = [r.ids.filter(id => busy.has(id)).length, r.rIdx, r.gIdx];
                    if (!bestKey || key[0] < bestKey[0] ||
                        (key[0] === bestKey[0] && (key[1] < bestKey[1] ||
                        (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
                        best = r; bestKey = key;
                    }
                });
                best.game.seq = seq++;
                remaining.splice(remaining.indexOf(best), 1);
                onCourt.push(best);
                if (onCourt.length > Math.max(numCourts.value - 1, 1)) onCourt.shift();
            }
        };

        const generateSchedule = () => {
            if (teams.value.length < 2) {
                errorMsg.value = 'Need at least 2 teams to generate matches. Set up teams in the Teams tab first.';
                return;
            }

            const emptyTeams = teams.value.filter(t => (t.players || []).length === 0);
            if (emptyTeams.length > 0) {
                errorMsg.value = `These teams have no players: ${emptyTeams.map(t => t.name).join(', ')}`;
                return;
            }

            const teamsWithoutMixed = teams.value.filter(t => {
                const players = (t.players || []).map(id => getPlayer(id)).filter(Boolean);
                return !players.some(p => p.gender !== 'Female') || !players.some(p => p.gender === 'Female');
            });
            if (teamsWithoutMixed.length > 0) {
                errorMsg.value = `These teams need both male and female players: ${teamsWithoutMixed.map(t => t.name).join(', ')}`;
                return;
            }

            errorMsg.value = '';
            const numRounds = 3;
            const teamMatchups = getTeamMatchups([...teams.value], numRounds);
            const schedule = [];

            teamMatchups.forEach((roundMatchups, rIdx) => {
                const roundGames = [];
                roundMatchups.forEach(([teamA, teamB]) => {
                    const pairsA = getTeamPairings(teamA, rIdx);
                    const pairsB = getTeamPairings(teamB, rIdx);
                    const numGames = Math.min(pairsA.length, pairsB.length);
                    for (let g = 0; g < numGames; g++) {
                        roundGames.push({
                            id: Math.random().toString(36).substr(2, 9),
                            type: 'doubles',
                            pairA: pairsA[g],
                            pairB: pairsB[g],
                            status: 'awaiting',
                            scoreA: 0,
                            scoreB: 0
                        });
                    }
                });
                schedule.push({ roundNumber: rIdx + 1, games: roundGames, sitOuts: [] });
            });

            // Put the opening games straight onto courts 1..N and start them.
            planGameOrder(schedule);
            let nextCourt = 1;
            schedule.flatMap(round => round.games || [])
                .sort((a, b) => a.seq - b.seq)
                .forEach(g => {
                    if (nextCourt <= numCourts.value) {
                        g.court = nextCourt++;
                        g.status = 'in_play';
                    } else {
                        g.court = null;
                    }
                });

            if (props.data?.tournament) props.data.tournament.numOfCourts = numCourts.value;
            generatedRounds.value = schedule;
            calculateActivePlayers();
            emit('update-tournament-games', schedule);
        };

        const resetGames = async () => {
            const ok = await props.dialog.confirm('Reset Matches', 'This will delete all tournament matches. Are you sure?');
            if (!ok) return;
            generatedRounds.value = [];
            activePlayerIds.value = new Set();
            emit('update-tournament-games', []);
        };

        const switchStatus = async (game) => {
            let target = game;
            if (game.originalRIdx !== undefined) {
                target = generatedRounds.value[game.originalRIdx].games[game.originalGIdx];
            }
            if (target.status === 'awaiting') {
                const court = claimCourt(target);
                if (!court) {
                    props.dialog.alert("No court free", "You need add a result on a court.");
                    return;
                }
                const busyIds = gamePlayerIds(target).filter(id => activePlayerIds.value.has(id));
                if (busyIds.length) {
                    props.dialog.alert("Players on court",
                        `Still playing another game: ${busyIds.map(id => playerLabel(target, id)).join(', ')}.`);
                    return;
                }
                target.court = court;
                target.status = 'in_play';
            } else if (target.status === 'in_play') {
                target.status = 'awaiting';
                target.court = null;
            } else if (target.status === 'finished') {
                const confirmed = await props.dialog.confirm(
                    "Reset Game",
                    "This game is finished. Are you sure you want to reset its score back to 0?"
                );
                if (!confirmed) return;
                target.status = 'awaiting';
                target.scoreA = 0;
                target.scoreB = 0;
                target.court = null;
                target.finishedAt = null;
            }
            calculateActivePlayers();
            emit('update-tournament-games', generatedRounds.value);
        };

        const openScoreModal = (game) => {
            let target = game;
            if (game.originalRIdx !== undefined) {
                target = generatedRounds.value[game.originalRIdx].games[game.originalGIdx];
            }
            activeGame.value = target;
            scoreInputA.value = target.scoreA || 0;
            scoreInputB.value = target.scoreB || 0;
        };

        const saveScore = () => {
            if (!activeGame.value) return;
            activeGame.value.scoreA = parseInt(scoreInputA.value) || 0;
            activeGame.value.scoreB = parseInt(scoreInputB.value) || 0;
            activeGame.value.status = 'finished';
            activeGame.value.finishedAt = new Date().toISOString();
            activeGame.value = null;
            calculateActivePlayers();
            emit('update-tournament-games', generatedRounds.value);
        };

        // Swap entire pairs — pick one, then pick another in the same round
        const handlePairSwap = (rIdx, gIdx, pairKey) => {
            if (!swapSource.value) {
                const game = generatedRounds.value[rIdx].games[gIdx];
                if (game.status === 'finished') {
                    props.dialog.alert('Action Denied', 'Cannot swap pairs in a finished game.');
                    return;
                }
                swapSource.value = { rIdx, gIdx, pairKey };
                return;
            }

            const src = swapSource.value;

            if (src.rIdx !== rIdx) {
                props.dialog.alert('Invalid Swap', 'Can only swap pairs within the same round.');
                swapSource.value = null;
                return;
            }

            if (src.gIdx === gIdx && src.pairKey === pairKey) {
                swapSource.value = null;
                return;
            }

            const targetGame = generatedRounds.value[rIdx].games[gIdx];
            if (targetGame.status === 'finished') {
                props.dialog.alert('Action Denied', 'Cannot swap pairs in a finished game.');
                swapSource.value = null;
                return;
            }

            const round = generatedRounds.value[src.rIdx];
            const pairA = round.games[src.gIdx][src.pairKey];
            const pairB = round.games[gIdx][pairKey];
            round.games[src.gIdx][src.pairKey] = pairB;
            round.games[gIdx][pairKey] = pairA;

            swapSource.value = null;
            calculateActivePlayers();
            emit('update-tournament-games', generatedRounds.value);
        };

        const swapSourceLabel = computed(() => {
            if (!swapSource.value) return '';
            const { rIdx, gIdx, pairKey } = swapSource.value;
            try {
                const pair = generatedRounds.value[rIdx].games[gIdx][pairKey];
                const team = getTeam(pair.teamId);
                return `${team?.name || 'Team'}: ${pair.p1?.name} & ${pair.p2?.name}`;
            } catch { return 'Pair'; }
        });

        const getHeaderClass = (status) => {
            if (status === 'in_play') return 'bg-success text-white';
            if (status === 'finished') return 'bg-dark text-white';
            return 'bg-secondary text-dark';
        };

        const getPairBorderClass = (color) =>
            color === 'secondary' ? 'border-team-grey' : 'border-' + color;

        const getTeamBadgeClass = (color) => {
            if (color === 'secondary') return 'team-dark-grey text-white';
            return `bg-${color || 'primary'} text-white`;
        };

        const getBorderStyle = (teamId) => {
            const colorMap = {
                primary: '#0d6efd', danger: '#dc3545', success: '#198754',
                warning: '#ffc107', info: '#0dcaf0', secondary: '#6c757d',
                dark: '#212529'
            };
            const team = getTeam(teamId);
            const color = colorMap[team?.color] || colorMap.primary;
            return `border-left: 5px solid ${color} !important; border-color: ${color} !important`;
        };

        const hasMounted = ref(false);

        const loadExisting = () => {
            const saved = props.data?.tournament?.numOfCourts;
            if (saved) numCourts.value = saved;
            const games = props.data?.tournament?.games;
            if (Array.isArray(games) && games.length > 0) {
                generatedRounds.value = games;
                calculateActivePlayers();
            }
        };

        // Watch for game changes: load updates or auto-regen if cleared externally (player swap)
        watch(() => props.data?.tournament?.games, (newGames) => {
            if (!hasMounted.value) return;
            if (Array.isArray(newGames) && newGames.length === 0 && generatedRounds.value.length > 0 && teams.value.length > 0) {
                // Games were reset externally — auto-regenerate with updated teams
                generatedRounds.value = [];
                generateSchedule();
            } else if (Array.isArray(newGames) && newGames.length > 0) {
                generatedRounds.value = newGames;
                calculateActivePlayers();
            }
        });

        onMounted(() => {
            loadExisting();
            hasMounted.value = true;
            document.addEventListener('fullscreenchange', syncFullscreen);
        });
        onUnmounted(() => document.removeEventListener('fullscreenchange', syncFullscreen));

        return {
            teams, generatedRounds, errorMsg, showRound, viewMode,
            activePlayerIds, swapSource, swapSourceLabel,
            activeGame, scoreInputA, scoreInputB,
            hasFinishedGames, numCourts, setNumCourts, freeCourts,
            boardSections, isFullscreen, rootEl, toggleFullscreen,
            generateSchedule, resetGames, switchStatus,
            openScoreModal, saveScore, handlePairSwap,
            getHeaderClass, getTeamBadgeClass, getPairBorderClass, getBorderStyle,
            getTeam, getPlayer
        };
    },
    template: `
    <div ref="rootEl" :class="{ 'games-fullscreen': isFullscreen }">
        <!-- Config / Generate Panel -->
        <div v-if="!hasFinishedGames && !isFullscreen" class="card bg-light mb-4">
            <div class="card-body">
                <div v-if="generatedRounds.length === 0">
                    <div class="row g-3 align-items-center">
                        <div class="col-md-8">
                            <p class="fw-bold mb-1">Teams: {{ teams.length }} &nbsp;|&nbsp; 3 Rounds (20 min each)</p>
                            <p class="text-muted small mb-0">
                                Mixed doubles (1M + 1F per pair). Each male plays with each female in their team.
                                Teams play each other once per tournament.
                            </p>
                        </div>
                        <div class="col-md-4">
                            <button class="btn btn-success w-100" @click="generateSchedule">
                                <i class="bi bi-controller"></i> Generate Matches
                            </button>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2 mt-3">
                        <span class="fw-bold">Courts:</span>
                        <div class="btn-group" role="group">
                            <template v-for="n in [3,4,5,6,7]" :key="'tc'+n">
                                <input type="radio" class="btn-check" name="tnumcourts" :id="'tc'+n"
                                       :checked="numCourts === n" @click="setNumCourts(n)">
                                <label class="btn btn-outline-success" :for="'tc'+n">{{ n }}</label>
                            </template>
                        </div>
                    </div>
                    <div v-if="errorMsg" class="alert alert-danger mt-3 mb-0">
                        <i class="bi bi-exclamation-triangle-fill"></i> {{ errorMsg }}
                    </div>
                    <div class="text-center text-muted py-4">
                        <i class="bi bi-trophy display-4"></i>
                        <p class="mt-2">Set up teams in the Teams tab, then click Generate.</p>
                    </div>
                </div>
                <div v-else>
                    <button class="btn btn-danger w-100" @click="resetGames">
                        <i class="bi bi-trash"></i> Reset Matches
                    </button>
                </div>
            </div>
        </div>

        <!-- Schedule -->
        <div v-if="generatedRounds.length > 0" class="card bg-light mb-4">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                    <h4 class="text-success mb-0">
                        {{ viewMode === 'rounds' ? 'Round' : 'Courts' }}
                    </h4>
                    <div class="d-flex align-items-center gap-3">
                        <div class="btn-group" role="group">
                            <input type="radio" class="btn-check" name="tvm" id="tvm1" value="rounds" v-model="viewMode">
                            <label class="btn btn-outline-success" for="tvm1" title="By round"><i class="bi bi-list-ol"></i></label>
                            <input type="radio" class="btn-check" name="tvm" id="tvm2" value="board" v-model="viewMode">
                            <label class="btn btn-outline-success" for="tvm2" title="Queue and Active together"><i class="bi bi-columns-gap"></i></label>
                        </div>
                        <button v-if="viewMode === 'board'" type="button" class="btn btn-outline-secondary"
                                :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
                                @click="toggleFullscreen">
                            <i class="bi" :class="isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'"></i>
                        </button>
                    </div>
                </div>

                <!-- Rounds View -->
                <template v-if="viewMode === 'rounds'">
                    <div class="btn-group w-100 mb-3" role="group">
                        <template v-for="round in generatedRounds" :key="'trt'+round.roundNumber">
                            <input type="radio" class="btn-check" name="trounds"
                                   :id="'tr'+round.roundNumber" :value="round.roundNumber" v-model="showRound">
                            <label class="btn btn-outline-success" :for="'tr'+round.roundNumber">
                                Round {{ round.roundNumber }}
                            </label>
                        </template>
                    </div>

                    <div v-for="(round, rIdx) in generatedRounds" :key="round.roundNumber">
                        <template v-if="showRound === round.roundNumber">
                            <div class="row row-cols-1 row-cols-md-2 g-3">
                                <div class="col" v-for="(game, gIdx) in round.games" :key="game.id">
                                    <div class="card h-100 border-secondary shadow-sm">

                                        <!-- Game header: click to cycle status -->
                                        <div class="card-header py-1 d-flex justify-content-between"
                                             style="cursor:pointer"
                                             :class="getHeaderClass(game.status)"
                                             @click="switchStatus(game)">
                                            <strong class="small">
                                                {{ getTeam(game.pairA.teamId)?.name || 'Team A' }}
                                                vs
                                                {{ getTeam(game.pairB.teamId)?.name || 'Team B' }}
                                                <span v-if="game.court" class="badge bg-dark ms-1">
                                                    <i class="bi bi-geo-alt-fill"></i> Court {{ game.court }}
                                                </span>
                                            </strong>
                                            <span class="badge bg-light text-dark">
                                                {{ game.status === 'in_play' ? 'In Play' : game.status === 'finished' ? 'Finished' : 'Awaiting' }}
                                            </span>
                                        </div>

                                        <div class="card-body p-2">
                                            <!-- Pair A -->
                                            <div class="d-flex justify-content-between mb-2 p-2 rounded bg-light border-start border-4"
                                                 :class="getPairBorderClass(getTeam(game.pairA.teamId)?.color || 'primary')">
                                                <div style="min-width:0">
                                                    <div class="d-flex align-items-center mb-1">
                                                        <i v-if="activePlayerIds.has(game.pairA.p1?.id)"
                                                           class="bi bi-activity text-success me-1 flex-shrink-0"></i>
                                                        <i v-else class="bi bi-hourglass text-secondary me-1 flex-shrink-0"></i>
                                                        <button class="btn btn-sm p-0 px-1 me-1 flex-shrink-0"
                                                                :class="swapSource?.gIdx === gIdx && swapSource?.rIdx === rIdx && swapSource?.pairKey === 'pairA' ? 'btn-warning' : 'btn-outline-secondary'"
                                                                @click.stop="handlePairSwap(rIdx, gIdx, 'pairA')"
                                                                title="Swap this pair">
                                                            <i class="bi bi-arrow-left-right" style="font-size:0.75rem"></i>
                                                        </button>
                                                        <span class="badge me-1 flex-shrink-0"
                                                              :class="getTeamBadgeClass(getTeam(game.pairA.teamId)?.color)"
                                                              style="font-size:0.65rem">
                                                            {{ getTeam(game.pairA.teamId)?.name }}
                                                        </span>
                                                    </div>
                                                    <div class="ps-4">
                                                        <div class="fw-bold small text-truncate">
                                                            <i class="bi bi-gender-male text-primary me-1"></i>{{ game.pairA.p1?.name }}
                                                        </div>
                                                        <div class="fw-bold small text-truncate">
                                                            <i class="bi bi-gender-female text-danger me-1"></i>{{ game.pairA.p2?.name }}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="text-end flex-shrink-0 ms-2">
                                                    <button type="button" class="btn btn-outline-secondary btn-lg"
                                                            @click.stop="openScoreModal(game)">{{ game.scoreA }}</button>
                                                </div>
                                            </div>

                                            <!-- Pair B -->
                                            <div class="d-flex justify-content-between p-2 rounded bg-light border-start border-4"
                                                 :class="getPairBorderClass(getTeam(game.pairB.teamId)?.color || 'danger')">
                                                <div style="min-width:0">
                                                    <div class="d-flex align-items-center mb-1">
                                                        <i v-if="activePlayerIds.has(game.pairB.p1?.id)"
                                                           class="bi bi-activity text-success me-1 flex-shrink-0"></i>
                                                        <i v-else class="bi bi-hourglass text-secondary me-1 flex-shrink-0"></i>
                                                        <button class="btn btn-sm p-0 px-1 me-1 flex-shrink-0"
                                                                :class="swapSource?.gIdx === gIdx && swapSource?.rIdx === rIdx && swapSource?.pairKey === 'pairB' ? 'btn-warning' : 'btn-outline-secondary'"
                                                                @click.stop="handlePairSwap(rIdx, gIdx, 'pairB')"
                                                                title="Swap this pair">
                                                            <i class="bi bi-arrow-left-right" style="font-size:0.75rem"></i>
                                                        </button>
                                                        <span class="badge me-1 flex-shrink-0"
                                                              :class="getTeamBadgeClass(getTeam(game.pairB.teamId)?.color)"
                                                              style="font-size:0.65rem">
                                                            {{ getTeam(game.pairB.teamId)?.name }}
                                                        </span>
                                                    </div>
                                                    <div class="ps-4">
                                                        <div class="fw-bold small text-truncate">
                                                            <i class="bi bi-gender-male text-primary me-1"></i>{{ game.pairB.p1?.name }}
                                                        </div>
                                                        <div class="fw-bold small text-truncate">
                                                            <i class="bi bi-gender-female text-danger me-1"></i>{{ game.pairB.p2?.name }}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="text-end flex-shrink-0 ms-2">
                                                    <button type="button" class="btn btn-outline-secondary btn-lg"
                                                            @click.stop="openScoreModal(game)">{{ game.scoreB }}</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>
                </template>

                <!-- Board View: Queue / Active / Finished -->
                <template v-else>
                    <div v-for="section in boardSections" :key="section.key" class="mb-4">
                        <div class="d-flex align-items-center border-bottom pb-1 mb-2">
                            <h5 class="mb-0 text-secondary">
                                <i class="bi" :class="section.icon"></i> {{ section.title }}
                            </h5>
                            <span v-if="section.key !== 'finished'" class="badge bg-secondary ms-2">{{ section.games.length }}</span>
                        </div>
                        <div v-if="section.games.length === 0" class="text-muted fst-italic small">
                            {{ section.empty }}
                        </div>
                        <div v-else style="display: grid; grid-template-columns: repeat(auto-fill, minmax(225px, 1fr)); gap: 1rem;">
                            <div v-for="game in section.games" :key="game.id">
                                <div class="card h-100 border-secondary shadow-sm">
                                    <div class="card-header py-1 d-flex justify-content-between align-items-center"
                                         style="cursor:pointer"
                                         :class="getHeaderClass(game.status)"
                                         @click="switchStatus(game)">
                                        <strong class="small">
                                            R{{ game.roundNum }}
                                            <span v-if="game.court" class="badge bg-dark ms-1">
                                                <i class="bi bi-geo-alt-fill"></i> Court {{ game.court }}
                                            </span>
                                        </strong>
                                        <span class="badge bg-light text-dark">
                                            {{ game.status === 'in_play' ? 'In Play' : (game.status === 'finished' ? 'Finished' : 'Awaiting') }}
                                        </span>
                                    </div>
                                    <div class="card-body p-2">
                                        <div v-if="game.blocked" class="text-muted mb-1 text-truncate" style="font-size:0.75rem"
                                             :title="game.busyNames.join(', ')">
                                            <i class="bi bi-hourglass-split"></i> Waiting for {{ game.busyNames.join(', ') }}
                                        </div>
                                        <div v-else-if="game.blocked === false" class="small text-success mb-1">
                                            <i class="bi bi-check-circle-fill"></i> Ready
                                        </div>
                                    <div class="d-flex justify-content-between mb-2 p-2 rounded bg-light border-start border-5"
                                         :class="getPairBorderClass(getTeam(game.pairA.teamId)?.color || 'primary')">
                                        <div style="min-width:0">
                                            <span class="badge mb-1 d-inline-block"
                                                  :class="getTeamBadgeClass(getTeam(game.pairA.teamId)?.color)"
                                                  style="font-size:0.65rem">{{ getTeam(game.pairA.teamId)?.name }}</span>
                                            <div class="fw-bold small text-truncate">
                                                <i v-if="activePlayerIds.has(game.pairA.p1?.id)" class="bi bi-activity text-success me-1"></i>
                                                <i class="bi bi-gender-male text-primary me-1"></i>{{ game.pairA.p1?.name }}
                                            </div>
                                            <div class="fw-bold small text-truncate">
                                                <i v-if="activePlayerIds.has(game.pairA.p2?.id)" class="bi bi-activity text-success me-1"></i>
                                                <i class="bi bi-gender-female text-danger me-1"></i>{{ game.pairA.p2?.name }}
                                            </div>
                                        </div>
                                        <button type="button" class="btn btn-outline-secondary btn-lg flex-shrink-0 ms-2"
                                                @click.stop="openScoreModal(game)">{{ game.scoreA }}</button>
                                    </div>
                                    <div class="d-flex justify-content-between p-2 rounded bg-light border-start border-5"
                                         :class="getPairBorderClass(getTeam(game.pairB.teamId)?.color || 'danger')">
                                        <div style="min-width:0">
                                            <span class="badge mb-1 d-inline-block"
                                                  :class="getTeamBadgeClass(getTeam(game.pairB.teamId)?.color)"
                                                  style="font-size:0.65rem">{{ getTeam(game.pairB.teamId)?.name }}</span>
                                            <div class="fw-bold small text-truncate">
                                                <i v-if="activePlayerIds.has(game.pairB.p1?.id)" class="bi bi-activity text-success me-1"></i>
                                                <i class="bi bi-gender-male text-primary me-1"></i>{{ game.pairB.p1?.name }}
                                            </div>
                                            <div class="fw-bold small text-truncate">
                                                <i v-if="activePlayerIds.has(game.pairB.p2?.id)" class="bi bi-activity text-success me-1"></i>
                                                <i class="bi bi-gender-female text-danger me-1"></i>{{ game.pairB.p2?.name }}
                                            </div>
                                        </div>
                                        <button type="button" class="btn btn-outline-secondary btn-lg flex-shrink-0 ms-2"
                                                @click.stop="openScoreModal(game)">{{ game.scoreB }}</button>
                                    </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <p v-if="hasFinishedGames && !isFullscreen" class="text-secondary small">Reset is disabled once a match has been finalised.</p>

        <!-- Score Modal (open scoring — enter both scores) -->
        <div v-if="activeGame" class="modal custom-modal-backdrop">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title"><i class="bi bi-pencil-square me-1"></i> Enter Score</h5>
                        <button class="btn-close btn-close-white" @click="activeGame = null"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted small mb-3 text-center">Time-based match — enter the final score for each pair</p>
                        <div class="row g-3 align-items-center">
                            <div class="col-5 text-center">
                                <span class="badge mb-2 d-block"
                                      :class="getTeamBadgeClass(getTeam(activeGame.pairA.teamId)?.color)">
                                    {{ getTeam(activeGame.pairA.teamId)?.name || 'Pair A' }}
                                </span>
                                <div class="small fw-bold text-truncate">
                                    <i class="bi bi-gender-male text-primary"></i> {{ activeGame.pairA.p1?.name }}
                                </div>
                                <div class="small fw-bold text-truncate mb-2">
                                    <i class="bi bi-gender-female text-danger"></i> {{ activeGame.pairA.p2?.name }}
                                </div>
                                <input type="number" class="form-control form-control-lg text-center"
                                       v-model.number="scoreInputA" min="0" max="99">
                            </div>
                            <div class="col-2 text-center text-muted fw-bold fs-4">vs</div>
                            <div class="col-5 text-center">
                                <span class="badge mb-2 d-block"
                                      :class="getTeamBadgeClass(getTeam(activeGame.pairB.teamId)?.color)">
                                    {{ getTeam(activeGame.pairB.teamId)?.name || 'Pair B' }}
                                </span>
                                <div class="small fw-bold text-truncate">
                                    <i class="bi bi-gender-male text-primary"></i> {{ activeGame.pairB.p1?.name }}
                                </div>
                                <div class="small fw-bold text-truncate mb-2">
                                    <i class="bi bi-gender-female text-danger"></i> {{ activeGame.pairB.p2?.name }}
                                </div>
                                <input type="number" class="form-control form-control-lg text-center"
                                       v-model.number="scoreInputB" min="0" max="99">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" @click="activeGame = null">Cancel</button>
                        <button class="btn btn-success" @click="saveScore">
                            <i class="bi bi-check-lg"></i> Save Score
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Pair Swap Banner -->
        <div v-if="swapSource"
             class="alert alert-info position-fixed bottom-0 start-0 end-0 m-0 rounded-0 z-3 shadow-lg d-flex justify-content-center align-items-center">
            <i class="bi bi-arrow-left-right me-2 fs-4"></i>
            <span>Select another pair to swap with <strong>{{ swapSourceLabel }}</strong></span>
            <button class="btn btn-sm btn-outline-dark ms-3 fw-bold" @click="swapSource = null">Cancel</button>
        </div>
    </div>
    `
};
