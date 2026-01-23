const TabSelection = {
    props: ['data', 'selected', 'dialog'],
    emits: ['update-selected', 'save-new-player', 'edit-player', 'substitute-player', 'finalize-session'],
    setup(props, { emit }) {
        const { ref, computed } = Vue; 
        
        const searchQuery = ref("");
        const showDropdown = ref(false);

        // Form vars
        const newPlayerGender = ref("Male");
        const newPlayerLevel = ref("B");
		const allActivePlayerIds = ref(new Set());
        
        // Editing State
        const editingId = ref(null);
        const editName = ref("");
        const editGender = ref("");

        // --- Switching State ---
        const switchingPlayer = ref(null);
		
		// --- Flash State ---
        const lastAddedId = ref(null);

        const triggerFlash = (id) => {
            lastAddedId.value = id;
            setTimeout(() => {
                lastAddedId.value = null;
            }, 2000); // 2 seconds
        };

        // Filter logic
        const filteredPlayers = computed(() => {
            if (!searchQuery.value) return [];
            if (!props.data || !props.data.players) return [];

            const query = searchQuery.value.toLowerCase();
            return props.data.players.filter(p => 
                p.name.toLowerCase().includes(query) && 
                !props.selected.some(sel => sel.id === p.id)
            );
        });

        // 1. SELECT LOGIC (Handles both Add and Switch)
        const selectPlayer = async (player) => {
            if (switchingPlayer.value) {
                // SWITCH MODE
                const confirmed = await props.dialog.confirm(
                    'Confirm Replacement',
                    `Replace ${switchingPlayer.value.name} with ${player.name}?`
                );
                
                if(confirmed) {
                    emit('substitute-player', { oldId: switchingPlayer.value.id, newPlayer: player });
                    cancelSwitch();
                }
            } else {
                // NORMAL ADD MODE
				
				if (props.data.current.games.length > 0) {
					props.dialog.alert("Adding players", "The matches have already been genenrated. You need reset the matches in order for this player to included in the matches.");
				}
				
                const newList = [player, ...props.selected];
                emit('update-selected', newList);
				triggerFlash(player.id);
            }
            searchQuery.value = "";
            showDropdown.value = false;
        };
		
		
		 const getAllActivePlayerIds = () => {
            const currentActive = new Set();
			const rounds = props.data?.current?.games;
            if (rounds) {
				rounds.forEach(round => {
                    if (round.games) {
                        round.games.forEach(game => {
							if (game.pairA.p1) currentActive.add(game.pairA.p1.id);
							if (game.pairA.p2) currentActive.add(game.pairA.p2.id);
							if (game.pairB.p1) currentActive.add(game.pairB.p1.id);
							if (game.pairB.p2) currentActive.add(game.pairB.p2.id);
                        });
                    }
                });
            }
            allActivePlayerIds.value = currentActive;
        };

        const removePlayer = async (playerId) => {
			
			getAllActivePlayerIds();
			
			const playerIsActive = allActivePlayerIds.value.has(playerId);
			
			if (playerIsActive) {
				props.dialog.alert("Player is active", "Player is already playing. It cannot be deleted. Try to switch player or reset the matches.");
                return;
			} else {
				const confirmed = await props.dialog.confirm(
                    'Confirm Delete',
                    `Are you sure you want delete this player?`
                );
				
				if (!confirmed) return;
			}
			const newList = props.selected.filter(p => p.id !== playerId);
			emit('update-selected', newList);
        };
        
        // Editing Functions
        const startEditing = (player) => {
            editingId.value = player.id;
            editName.value = player.name;
            editGender.value = player.gender || 'Male';
        };
        
        const cancelEdit = () => {
            editingId.value = null;
            editName.value = "";
            editGender.value = "";
        };
        
        const saveEdit = () => {
            if(!editName.value.trim()) {
                props.dialog.alert("Validation", "Name cannot be empty");
                return;
            }
            
            emit('edit-player', {
                id: editingId.value,
                name: editName.value,
                gender: editGender.value
            });
            cancelEdit();
        };

        // --- Switch Initiator ---
        const switchPlayer = (player) => {
            switchingPlayer.value = player;
            searchQuery.value = ""; // Clear search
            // Scroll to top to see search bar
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        const cancelSwitch = () => {
            switchingPlayer.value = null;
            searchQuery.value = "";
        };

        // 2. CREATE LOGIC (Handles both Add and Switch)
        const createPlayer = () => {
            const generateHashId = () => Math.random().toString(36).slice(2, 14);

            let ratio = [];
            if (newPlayerLevel.value === 'A') ratio = [1, 1, 1, 1, 1];
            else if (newPlayerLevel.value === 'C') ratio = [5, 5, 5, 5, 5];
            else ratio = [2.5,2.5,2.5,2.5,2.5];

            const newPlayer = {
                id: generateHashId(),
                name: searchQuery.value,
                gender: newPlayerGender.value,
                level: newPlayerLevel.value,
                previous5ratio: ratio
            };
            
            // Always save the new player to database
            emit('save-new-player', newPlayer);
            
            if (switchingPlayer.value) {
                // SWITCH MODE
                emit('substitute-player', { 
                    oldId: switchingPlayer.value.id, 
                    newPlayer: newPlayer 
                });
                cancelSwitch();
            } else {
				
				if (props.data.current.games.length > 0) {
					props.dialog.alert("Adding players", "The matches have already been genenrated. You need reset the matches in order for this player to included in the matches.");
				}
				
                // NORMAL ADD MODE
                const newList = [newPlayer, ...props.selected];
                setTimeout(() => emit('update-selected', newList), 1000);
				triggerFlash(newPlayer.id);
            }
            
            searchQuery.value = "";
            showDropdown.value = false;
            newPlayerLevel.value = "B";
        };

		const resetAll = async () => {
            const confirmed = await props.dialog.confirm(
                'Finalize Session',
                'This will calculate player stats, update their history, and clear the current list. Are you sure?'
            );
            
            if(!confirmed) return;

            // 1. Get Game Settings
            const roundsData = props.data?.current?.games || [];
            const gamesPerMatch = props.data?.current?.gamesPerMatch || 7;

            // 2. Calculate Totals for the session
            const sessionScores = {};
            const sessionGamesPlayed = {}; // Track actual games played per player

            roundsData.forEach(round => {
                if(round.games) {
                    round.games.forEach(game => {
                        if(game.status === 'finished') {
                            const addStats = (pid, score) => {
                                if(!sessionScores[pid]) sessionScores[pid] = 0;
                                if(!sessionGamesPlayed[pid]) sessionGamesPlayed[pid] = 0;
                                
                                sessionScores[pid] += (score || 0);
                                sessionGamesPlayed[pid] += 1; // Increment count for this player
                            };

                            addStats(game.pairA.p1.id, game.scoreA);
                            if (game.pairA.p2) addStats(game.pairA.p2.id, game.scoreA);
                            
                            addStats(game.pairB.p1.id, game.scoreB);
                            if (game.pairB.p2) addStats(game.pairB.p2.id, game.scoreB);
                        }
                    });
                }
            });

            // 3. Update Player Objects (Only for those currently selected)
            props.selected.forEach(p => {
                const totalScore = sessionScores[p.id] || 0;
                const played = sessionGamesPlayed[p.id] || 0;
                
                // Only update ratio if they actually played at least one game
                if (played > 0) {
                    // Formula: (((TotalScore / ActualGamesPlayed) / GamesPerMatch) * 5)
                    let newRatio = ((totalScore / played) / gamesPerMatch) * 5;
                    
                    // Safety clamp (0 to 5) and rounding
                    if (isNaN(newRatio)) newRatio = 0;
                    newRatio = Math.max(0, Math.min(5, newRatio)); 
                    newRatio = parseFloat(newRatio.toFixed(3));

                    // Update Array (FIFO)
                    if (!p.previous5ratio) p.previous5ratio = [];
                    p.previous5ratio.push(newRatio);
                    
                    // Keep only last 5
                    if (p.previous5ratio.length > 5) {
                        p.previous5ratio.shift(); // Remove oldest
                    }
                }
            });

            // 4. Emit event to Parent to save everything and clear selection
            emit('finalize-session');
        };

        return {
            searchQuery,
            showDropdown,
            filteredPlayers,
            newPlayerGender,
            newPlayerLevel,
            editingId,
            editName,
            editGender,
            selectPlayer,
            removePlayer,
            createPlayer,
            resetAll,
            switchPlayer,
            startEditing,
            cancelEdit,
            saveEdit,
            switchingPlayer,
            cancelSwitch,
			lastAddedId
        };
    },
    template: `
        <div>
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h4 class="card-title text-primary mb-0">Select Players</h4>
                <button v-if="selected.length > 0" class="btn btn-sm btn-outline-danger" @click="resetAll">
                    <i class="bi bi-trash"></i> Reset All
                </button>
            </div>
            
            <div v-if="switchingPlayer" class="alert alert-warning d-flex justify-content-between align-items-center">
                <span>
                    <i class="bi bi-arrow-left-right"></i> 
                    Replacing <strong>{{ switchingPlayer.name }}</strong>. 
                    Select or Create the new player below.
                </span>
                <button class="btn btn-sm btn-close" @click="cancelSwitch"></button>
            </div>

            <div class="position-relative mb-4">
                <label class="form-label" v-if="!switchingPlayer">Search or Add Player</label>
                <label class="form-label text-warning fw-bold" v-else>Search Replacement for {{ switchingPlayer.name }}</label>
                
                <div class="input-group">
                    <span class="input-group-text" :class="switchingPlayer ? 'bg-warning text-dark' : ''">
                        <i class="bi bi-search"></i>
                    </span>
                    <input 
                        type="text" 
                        class="form-control" 
                        :class="switchingPlayer ? 'border-warning' : ''"
                        placeholder="Type player name..." 
                        v-model="searchQuery"
                        maxlength="25"
                        @focus="showDropdown = true"
                        @blur="setTimeout(() => showDropdown = false, 200)"
                    >
                </div>

                <ul class="list-group autocomplete-list" v-if="showDropdown && filteredPlayers.length > 0">
                    <li 
                        v-for="player in filteredPlayers" 
                        :key="player.id" 
                        class="list-group-item autocomplete-item d-flex justify-content-between align-items-center"
                        @click="selectPlayer(player)"
                    >
                        {{ player.name }}
                        <span class="badge rounded-pill" :class="switchingPlayer ? 'bg-warning text-dark' : 'bg-secondary'">
                            {{ switchingPlayer ? 'Switch' : 'Select' }}
                        </span>
                    </li>
                </ul>

                <div v-if="searchQuery.length >= 3 && filteredPlayers.length === 0" class="card mt-2 bg-light border-success">
                    <div class="card-body py-2">
                        <h6 class="card-subtitle mb-2 text-success">
                            <i class="bi bi-person-plus-fill"></i> New Player: <strong>{{ searchQuery }}</strong>
                        </h6>
                        <div class="row g-2 align-items-center">
                            <div class="col-md-4">
                                <select class="form-select form-select-sm" v-model="newPlayerGender">
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <select class="form-select form-select-sm" v-model="newPlayerLevel">
                                    <option value="A">Class A (Expert)</option>
                                    <option value="B">Class B (Interm.)</option>
                                    <option value="C">Class C (Beginner)</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <button class="btn btn-sm btn-success w-100" @click="createPlayer">
                                    <i class="bi bi-check-lg"></i> {{ switchingPlayer ? 'Create & Switch' : 'Create & Add' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="selected.length > 0">
                <h5 class="text-secondary border-bottom pb-2">Selected Players ({{ selected.length }})</h5>
                <ul class="list-group">
                    <li class="list-group-item"
                        v-for="p in selected" 
                        :key="p.id"
						:class="{ 
                            'list-group-item-warning': switchingPlayer && switchingPlayer.id === p.id,
                            'list-group-item-success': lastAddedId === p.id 
                        }"
                        style="transition: background-color 0.5s ease;"
                    >
                        <div v-if="editingId !== p.id" class="d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center text-truncate me-2" :title="p.name">
                                <i v-if="p.gender === 'Female'" class="bi bi-gender-female text-danger me-2"></i>
                                <i v-else class="bi bi-gender-male text-primary me-2"></i>
                                {{ p.name }}
                            </div>

                            <div class="btn-group flex-shrink-0" role="group" aria-label="Player Actions">
                              <button type="button" class="btn btn-sm btn-outline-primary" title="Switch" @click="switchPlayer(p)">
                                <i class="bi bi-arrow-clockwise"></i>
                              </button>
                              <button type="button" class="btn btn-sm btn-outline-info" title="Edit" @click="startEditing(p)">
                                <i class="bi bi-pen"></i>
                              </button>
                              <button type="button" class="btn btn-sm btn-outline-danger" title="Remove" @click="removePlayer(p.id)">
                                <i class="bi bi-trash"></i>
                              </button>
                            </div>
                        </div>
                        <div v-else class="row g-2 align-items-center">
                                <div class="col-4">
                                    <input type="text" class="form-control form-control-sm" v-model="editName" placeholder="Name">
                                </div>
                                <div class="col-4">
                                    <select class="form-select form-select-sm" v-model="editGender">
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                    </select>
                                </div>
                                <div class="col-4 text-end">
                                    <div class="btn-group">
                                        <button class="btn btn-sm btn-success me-1" @click="saveEdit"><i class="bi bi-check"></i></button>
                                        <button class="btn btn-sm btn-secondary" @click="cancelEdit"><i class="bi bi-x"></i></button>
                                    </div>
                                </div>
                            </div>
                    </li>
                </ul>
            </div>
            <div v-else class="text-muted fst-italic mt-3">
                No players selected yet.
            </div>
        </div>
    `
};