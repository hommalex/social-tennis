const TabGames = {
    props: ['data', 'selected', 'dialog'],
    emits: ['update-games'],
    setup(props, { emit }) {
        const { ref, reactive, onMounted, watch, computed } = Vue;

        const config = reactive({
            gamesPerMatch: 7, 
            numRounds: 3 
        });

        const generatedRounds = ref([]); 
        const errorMsg = ref("");
        const showRound = ref(1);
		const viewMode = ref('rounds');
        const activePlayerIds = ref(new Set());
        const activeGame = ref(null);
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
		
		// --- UPDATED: Computed Property for Flat Views ---
        const filteredGames = computed(() => {
            if (viewMode.value === 'rounds') return []; 
            
            const list = [];
            
            generatedRounds.value.forEach((round, rIdx) => {
                if (round.games) {
                    round.games.forEach((game, gIdx) => {
                        let include = false;

                        // 1. ACTIVE VIEW: Show all games currently running
                        if (viewMode.value === 'active') {
                            if (game.status === 'in_play') include = true;
                        } 
                        // 2. QUEUE VIEW: Show awaiting games ONLY if all players are free
                        else if (viewMode.value === 'queue') {
                            if (game.status === 'awaiting') {
                                // Check if any player is currently busy
                                const p1Busy = activePlayerIds.value.has(game.pairA.p1.id);
                                const p2Busy = game.pairA.p2 && activePlayerIds.value.has(game.pairA.p2.id);
                                const p3Busy = activePlayerIds.value.has(game.pairB.p1.id);
                                const p4Busy = game.pairB.p2 && activePlayerIds.value.has(game.pairB.p2.id);

                                // Include only if NO ONE is busy
                                if (!p1Busy && !p2Busy && !p3Busy && !p4Busy) {
                                    include = true;
                                }
                            }
                        }

                        if (include) {
                            list.push({
                                ...game,
                                roundNum: round.roundNumber, 
                                originalRIdx: rIdx,          
                                originalGIdx: gIdx           
                            });
                        }
                    });
                }
            });
            return list;
        });

        const checkConflicts = () => {
            const pairHistory = {}; 
            const conflicts = new Set();
            conflictMsg.value = "";

            if (!generatedRounds.value) return;

            generatedRounds.value.forEach(round => {
                if(!round.games) return;
                round.games.forEach(game => {
                    // Only check for conflicts if it is a Doubles game (has p2)
                    if (game.pairA.p2) {
                        const idsA = [game.pairA.p1.id, game.pairA.p2.id].sort();
                        const keyA = idsA.join('_');
                        if (!pairHistory[keyA]) pairHistory[keyA] = [];
                        pairHistory[keyA].push(round.roundNumber);
                    }

                    if (game.pairB.p2) {
                        const idsB = [game.pairB.p1.id, game.pairB.p2.id].sort();
                        const keyB = idsB.join('_');
                        if (!pairHistory[keyB]) pairHistory[keyB] = [];
                        pairHistory[keyB].push(round.roundNumber);
                    }
                });
            });

            let foundConflict = false;
            for (const [key, rounds] of Object.entries(pairHistory)) {
                if (rounds.length > 1) {
                    foundConflict = true;
                    const ids = key.split('_');
                    conflicts.add(ids[0]);
                    conflicts.add(ids[1]);
                }
            }

            if (foundConflict) {
                conflictMsg.value = "Warning: Duplicate partners detected (highlighted in red). Please swap players.";
            }

            conflictedPlayerIds.value = conflicts;
        };

        const loadExistingGames = () => {
            if (props.data && props.data.current) {
                if (props.data.current.gamesPerMatch) config.gamesPerMatch = props.data.current.gamesPerMatch;
                if (props.data.current.numOfRounds) config.numRounds = props.data.current.numOfRounds;

                if (Array.isArray(props.data.current.games) && props.data.current.games.length > 0) {
                    generatedRounds.value = props.data.current.games;
                    calculateActivePlayers();
                    checkConflicts(); 
                }
            }
        };

        watch(() => props.data, loadExistingGames, { deep: true });
        onMounted(loadExistingGames);

        const getScore = (p) => {
            if (!p.previous5ratio || !Array.isArray(p.previous5ratio)) return 0;
            return p.previous5ratio.reduce((partialSum, a) => partialSum + a, 0);
        };
		
		const displayScore = (p) => {
            if (!p) return "0.0";
            return getScore(p).toFixed(1); // Rounds to 1 decimal place
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

            const round = generatedRounds.value[source.rIdx];
            const player1 = round.games[source.gIdx][source.pairKey][source.pKey];
            const player2 = round.games[target.gIdx][target.pairKey][target.pKey];

            round.games[source.gIdx][source.pairKey][source.pKey] = player2;
            round.games[target.gIdx][target.pairKey][target.pKey] = player1;

            const updateStrength = (gIdx, pKey) => {
                const p1 = round.games[gIdx][pKey].p1;
                const p2 = round.games[gIdx][pKey].p2;
                round.games[gIdx][pKey].strength = getScore(p1) + getScore(p2);
            };

            updateStrength(source.gIdx, source.pairKey);
            updateStrength(target.gIdx, target.pairKey);

            swapSource.value = null;
            checkConflicts(); 
            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

        const switchStatus = (game) => {
            // 1. Resolve the Real Game Object
            let targetGame = game;
            
            // If this is a copy from the flat view (has indices), find the original
            if (game.originalRIdx !== undefined && game.originalGIdx !== undefined) {
                targetGame = generatedRounds.value[game.originalRIdx].games[game.originalGIdx];
            }

            // 2. Apply Logic to targetGame
            if (targetGame.status === 'awaiting') {
                targetGame.status = 'in_play';
            } else if (targetGame.status === 'in_play') {
                targetGame.status = 'awaiting';
            } else if (targetGame.status === 'finished') { 
                targetGame.status = 'awaiting'; 
                targetGame.scoreA = 0; 
                targetGame.scoreB = 0; 
            }
            
            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

        const openScoreModal = (game) => {
            // 1. Resolve the Real Game Object
            if (game.originalRIdx !== undefined && game.originalGIdx !== undefined) {
                activeGame.value = generatedRounds.value[game.originalRIdx].games[game.originalGIdx];
            } else {
                activeGame.value = game;
            }
        };

        const saveScore = (scoreA) => {
            if (!activeGame.value) return;
            activeGame.value.scoreA = scoreA;
            activeGame.value.scoreB = config.gamesPerMatch - scoreA;
            activeGame.value.status = 'finished';
            activeGame.value = null;
            calculateActivePlayers();
            emit('update-games', generatedRounds.value);
        };

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

        const generateSchedule = () => {
            const error = validate();
            if (error) { errorMsg.value = error; return; }
            errorMsg.value = ""; 

            if (!props.data.current) props.data.current = {};
            props.data.current.numOfRounds = config.numRounds;
            props.data.current.gamesPerMatch = config.gamesPerMatch;

            const schedule = [];
            const players = [...props.selected]; 
            const history = {}; 
            players.forEach(p => history[p.id] = new Set());

            for (let r = 1; r <= config.numRounds; r++) {
                let roundGames = [];
                let availablePlayers = [...players].sort((a, b) => getScore(b) - getScore(a));
                let roundPairs = [];

                // Step A: Create Pairs
                while (availablePlayers.length >= 2) {
                    const p1 = availablePlayers.shift(); 
                    let bestPartnerIndex = -1;
                    for (let i = availablePlayers.length - 1; i >= 0; i--) {
                        const candidate = availablePlayers[i];
                        if (history[p1.id].has(candidate.id)) continue; 
                        bestPartnerIndex = i;
                        if (p1.gender !== candidate.gender) break; 
                    }
                    if (bestPartnerIndex === -1) bestPartnerIndex = availablePlayers.length - 1;
                    const p2 = availablePlayers.splice(bestPartnerIndex, 1)[0];
                    history[p1.id].add(p2.id);
                    history[p2.id].add(p1.id);
                    roundPairs.push({ p1, p2, strength: getScore(p1) + getScore(p2) });
                }

                // Step B: Create Matches
                roundPairs.sort((a, b) => b.strength - a.strength);

                while (roundPairs.length >= 2) {
                    const pairA = roundPairs.shift();
                    const pairB = roundPairs.shift(); 
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

                // Step C: Handle Leftover Pair (Singles)
                if (roundPairs.length > 0) {
                    const leftover = roundPairs.shift(); // This pair becomes opponents
                    roundGames.push({
                        id: Math.random().toString(36).substr(2, 9),
                        type: 'singles', // Mark as singles
                        pairA: { p1: leftover.p1, p2: null, strength: getScore(leftover.p1) },
                        pairB: { p1: leftover.p2, p2: null, strength: getScore(leftover.p2) },
                        status: 'awaiting',
                        scoreA: 0,
                        scoreB: 0
                    });
                }

                // Sitouts is now always empty if even number validation passes
                schedule.push({ roundNumber: r, games: roundGames, sitOuts: [] });
            }
            generatedRounds.value = schedule;
            calculateActivePlayers(); 
            checkConflicts();
            emit('update-games', schedule);
        };

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
            activePlayerIds,
            activeGame, 
            saveScore,
            conflictedPlayerIds,
            conflictMsg,
			hasFinishedGames,
			viewMode,
            filteredGames,
			displayScore
        };
    },
    template: `
    <div>
        <div v-if="!hasFinishedGames" class="card bg-light mb-4">
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
                            <button class="btn btn-primary w-100" @click="generateSchedule">
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
                    </div>

                    <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                        <h4 class="text-primary mb-0">
                            {{ viewMode === 'rounds' ? 'Round' : (viewMode === 'active' ? 'Active' : 'Queue') }}
                        </h4>
                        <div class="btn-group" role="group">
                            <input type="radio" class="btn-check" name="viewMode" id="vm1" value="rounds" v-model="viewMode">
                            <label class="btn btn-outline-primary" for="vm1"><i class="bi bi-list-ol"></i></label>

                            <input type="radio" class="btn-check" name="viewMode" id="vm2" value="active" v-model="viewMode">
                            <label class="btn btn-outline-primary" for="vm2"><i class="bi bi-activity"></i></label>

                            <input type="radio" class="btn-check" name="viewMode" id="vm3" value="queue" v-model="viewMode">
                            <label class="btn btn-outline-primary" for="vm3"><i class="bi bi-hourglass"></i></label>
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
                                            <div class="card-header py-1 d-flex justify-content-between cursor-pointer" 
                                                 :class="getHeaderClass(game.status)" 
                                                 @click="switchStatus(game)">
                                                <strong>Game {{ gIdx + 1 }}</strong>
                                                <span class="badge bg-light text-dark">
                                                    {{ game.status === 'in_play' ? 'In Play' : (game.status === 'finished' ? 'Finished' : 'Awaiting') }}
                                                </span>
                                            </div>
                                            <div class="card-body p-2">
                                                <div class="d-flex justify-content-between mb-2 p-2 rounded bg-light border-start border-5 border-primary">
                                                    <div style="min-width: 0;">
                                                        <span class="d-flex align-items-center mb-1 text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairA.p1.id), 'fw-bold': !conflictedPlayerIds.has(game.pairA.p1.id)}"> 
                                                            <i v-if="activePlayerIds.has(game.pairA.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p1' && swapSource.pairKey === 'pairA' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairA', 'p1')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button> 
															<span class="badge rounded-pill bg-secondary">{{displayScore(game.pairA.p1)}}</span>
                                                            <span class="text-truncate">{{ game.pairA.p1.name }}</span>
                                                        </span> 
                                                        <span v-if="game.pairA.p2" class="d-flex align-items-center text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairA.p2.id), 'fw-bold': !conflictedPlayerIds.has(game.pairA.p2.id)}"> 
                                                            <i v-if="activePlayerIds.has(game.pairA.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p2' && swapSource.pairKey === 'pairA' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairA', 'p2')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button> 
															<span class="badge rounded-pill bg-secondary">{{ displayScore(game.pairA.p2) }}</span>
                                                            <span class="text-truncate">{{ game.pairA.p2.name }}</span>
                                                        </span>
                                                    </div>
                                                    <div class="text-end mt-2 flex-shrink-0">
                                                        <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game)">{{ game.scoreA }}</button>
                                                    </div>
                                                </div>
                                                <div class="d-flex justify-content-between p-2 rounded bg-light border-start border-5 border-danger">
                                                    <div style="min-width: 0;">
                                                        <span class="d-flex align-items-center mb-1 text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairB.p1.id), 'fw-bold': !conflictedPlayerIds.has(game.pairB.p1.id)}"> 
                                                            <i v-if="activePlayerIds.has(game.pairB.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p1' && swapSource.pairKey === 'pairB' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairB', 'p1')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button> 
                                                            <span class="badge rounded-pill bg-secondary">{{ displayScore(game.pairB.p1) }}</span>
															<span class="text-truncate">{{ game.pairB.p1.name }}</span>
                                                        </span> 
                                                        <span v-if="game.pairB.p2" class="d-flex align-items-center text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairB.p2.id), 'fw-bold': !conflictedPlayerIds.has(game.pairB.p2.id)}"> 
                                                            <i v-if="activePlayerIds.has(game.pairB.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                            <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                            <button type="button" class="btn btn-sm me-1 p-0 px-1 flex-shrink-0" :class="swapSource && swapSource.pKey === 'p2' && swapSource.pairKey === 'pairB' && swapSource.gIdx === gIdx ? 'btn-warning' : 'btn-outline-secondary'" @click.stop="handleSwap(rIdx, gIdx, 'pairB', 'p2')"><i class="bi bi-arrow-left-right" style="font-size:0.8rem"></i></button> 
                                                            <span class="badge rounded-pill bg-secondary">{{ displayScore(game.pairB.p2) }}</span>
															<span class="text-truncate">{{ game.pairB.p2.name }}</span>
                                                        </span>
                                                    </div>
                                                    <div class="text-end mt-2 flex-shrink-0">
                                                        <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game)">{{ game.scoreB }}</button>
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
											<span class="badge rounded-pill bg-secondary">({{ displayScore(p) }})</span>
                                            <span class="text-truncate">{{ p.name }}</span>
                                        </span>
                                    </span>
                                </div>
                            </template>
                        </div>
                    </template>

                    <template v-else>
                        <div v-if="filteredGames.length === 0" class="text-center py-5 text-muted">
                            <i class="bi bi-inbox fs-1"></i>
                            <p>No matches found in this view.</p>
                        </div>
                        <div class="row row-cols-1 row-cols-md-2 g-3">
                            <div class="col" v-for="game in filteredGames" :key="game.id">
                                <div class="card h-100 border-secondary shadow-sm">
                                    <div class="card-header py-1 d-flex justify-content-between cursor-pointer" 
                                         :class="getHeaderClass(game.status)" 
                                         @click="switchStatus(game)">
                                        <strong>Round {{ game.roundNum }}</strong>
                                        <span class="badge bg-light text-dark">
                                            {{ game.status === 'in_play' ? 'In Play' : (game.status === 'finished' ? 'Finished' : 'Awaiting') }}
                                        </span>
                                    </div>
                                    <div class="card-body p-2">
                                        <div class="d-flex justify-content-between mb-2 p-2 rounded bg-light border-start border-5 border-primary">
                                            <div style="min-width: 0;">
                                                <span class="d-flex align-items-center mb-1 text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairA.p1.id), 'fw-bold': !conflictedPlayerIds.has(game.pairA.p1.id)}"> 
                                                    <i v-if="activePlayerIds.has(game.pairA.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairA.p1.name }}</span>
                                                </span> 
                                                <span v-if="game.pairA.p2" class="d-flex align-items-center text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairA.p2.id), 'fw-bold': !conflictedPlayerIds.has(game.pairA.p2.id)}"> 
                                                    <i v-if="activePlayerIds.has(game.pairA.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairA.p2.name }}</span>
                                                </span>
                                            </div>
                                            <div class="text-end mt-2 flex-shrink-0">
                                                <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game)">{{ game.scoreA }}</button>
                                            </div>
                                        </div>
                                        <div class="d-flex justify-content-between p-2 rounded bg-light border-start border-5 border-danger">
                                            <div style="min-width: 0;">
                                                <span class="d-flex align-items-center mb-1 text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairB.p1.id), 'fw-bold': !conflictedPlayerIds.has(game.pairB.p1.id)}"> 
                                                    <i v-if="activePlayerIds.has(game.pairB.p1.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairB.p1.name }}</span>
                                                </span> 
                                                <span v-if="game.pairB.p2" class="d-flex align-items-center text-truncate" :class="{'text-danger fw-bold': conflictedPlayerIds.has(game.pairB.p2.id), 'fw-bold': !conflictedPlayerIds.has(game.pairB.p2.id)}"> 
                                                    <i v-if="activePlayerIds.has(game.pairB.p2.id)" class="bi bi-activity text-success me-2 spinner-grow-sm flex-shrink-0"></i>
                                                    <i v-else class="bi bi-hourglass text-secondary me-2 flex-shrink-0"></i>
                                                    <span class="text-truncate">{{ game.pairB.p2.name }}</span>
                                                </span>
                                            </div>
                                            <div class="text-end mt-2 flex-shrink-0">
                                                <button type="button" class="btn btn-outline-secondary btn-lg" @click.stop="openScoreModal(game)">{{ game.scoreB }}</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>
            </div>
        </div>
		<p v-if="hasFinishedGames" class="text-secondary"> Reset is disabled once a match has been finalised. </p>

        <div v-if="activeGame" class="modal custom-modal-backdrop" tabindex="-1" style="background-color: rgba(0,0,0,0.5);">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">Set Score (Match to {{ config.gamesPerMatch }})</h5>
                        <button type="button" class="btn-close btn-close-white" @click="activeGame = null"></button>
                    </div>
                    <div class="modal-body text-center">
                        <p class="mb-1 text-muted">Set Score for</p>
                        <h4 class="mb-3">{{ activeGame.pairA.p1.name }} {{(activeGame.pairA.p2) ? '& ' + activeGame.pairA.p2.name : '' }}</h4>
                        
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
                        <p class="small text-muted">
                            Team B ({{ activeGame.pairB.p1.name }} {{ (activeGame.pairA.p2) ? '& ' + activeGame.pairB.p2.name : '' }}) 
                            will automatically receive {{ config.gamesPerMatch }} minus your selection.
                        </p>
                    </div>
                </div>
            </div>
        </div>
		
		<div v-if="!swapSource && conflictMsg" class="alert alert-danger position-fixed bottom-0 start-0 end-0 m-0 rounded-0 z-3 shadow-lg d-flex justify-content-center align-items-center" role="alert">
            <i class="bi bi-exclamation-octagon-fill me-2 fs-4"></i>
            <span class="fw-bold">{{ conflictMsg }}</span>
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