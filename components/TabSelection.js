const TabSelection = {
    props: ['data', 'selected', 'dialog'],
	emits: ['update-selected', 'save-new-player', 'edit-player', 'substitute-player', 'finalize-session', 'delete-player'],
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
        const editLevel = ref("");

        // --- Switching State ---
        const switchingPlayer = ref(null);

        // --- Quick Level Popup State ---
        const levelPopupId = ref(null);

        const toggleLevelPopup = (playerId) => {
            levelPopupId.value = levelPopupId.value === playerId ? null : playerId;
        };

        const setLevel = (player, level) => {
            if (player.level !== level) {
                emit('edit-player', {
                    id: player.id,
                    name: player.name,
                    gender: player.gender,
                    level: level
                });
            }
            levelPopupId.value = null;
        };
		
		// --- Level Guide Popup ---
        const showLevelGuide = ref(false);

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
                p.name.toLowerCase().includes(query)
            );
        });

        // Class breakdown for the selected list header
        const levelCounts = computed(() => {
            const counts = { A: 0, B: 0, C: 0 };
            props.selected.forEach(p => {
                const lvl = p.level || 'B';
                if (counts[lvl] !== undefined) counts[lvl]++;
            });
            return counts;
        });

        const isAlreadySelected = (playerId) => {
            return props.selected.some(sel => sel.id === playerId);
        };

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
				
                const isFirst = props.selected.length === 0;
                const newList = [player, ...props.selected];
                emit('update-selected', newList);
				triggerFlash(player.id);
                if (isFirst) showLevelGuide.value = true;
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
            editLevel.value = player.level || 'B';
        };

        const cancelEdit = () => {
            editingId.value = null;
            editName.value = "";
            editGender.value = "";
            editLevel.value = "";
        };
        
        const saveEdit = () => {
            if(!editName.value.trim()) {
                props.dialog.alert("Validation", "Name cannot be empty");
                return;
            }
            
            emit('edit-player', {
                id: editingId.value,
                name: editName.value,
                gender: editGender.value,
                level: editLevel.value
            });
            cancelEdit();
        };
		
		const deletePlayer = async (id) => {
            const confirmed = await props.dialog.confirm(
                'Permanently Delete Player',
                'Are you sure you want to permanently delete this player from the database? This cannot be undone.'
            );
            
            if (confirmed) {
                emit('delete-player', id);
                cancelEdit();
            }
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

            const newPlayer = {
                id: generateHashId(),
                name: searchQuery.value,
                gender: newPlayerGender.value,
                level: newPlayerLevel.value
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
                const isFirst = props.selected.length === 0;
                const newList = [newPlayer, ...props.selected];
                setTimeout(() => emit('update-selected', newList), 1000);
				triggerFlash(newPlayer.id);
                if (isFirst) showLevelGuide.value = true;
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

            // 3. Rank players who actually played by their session score (the final table)
            //    and split them into 3 equal groups to reassign their level.
            //    Top third -> A, middle third -> B, bottom third -> C.
            const ranked = props.selected
                .filter(p => (sessionGamesPlayed[p.id] || 0) > 0)
                .sort((a, b) => (sessionScores[b.id] || 0) - (sessionScores[a.id] || 0));

            const total = ranked.length;
            ranked.forEach((p, index) => {
                const group = Math.floor((index / total) * 3); // Results in 0, 1, or 2
                if (group === 0) p.level = 'A';
                else if (group === 1) p.level = 'B';
                else p.level = 'C';
            });

            // 4. Emit event to Parent to save everything and clear selection
            emit('finalize-session');
        };


        // --- Spond Import ---
        const spondBusy = ref(false);
        const spondStatus = ref("");
        const showSpondLogin = ref(false);
        const spondEmail = ref("");
        const spondPassword = ref("");
        const spond2faCode = ref("");
        const spond2faToken = ref(null);
        const spondEvents = ref([]);
        const showSpondPicker = ref(false);

        const normalizeName = (name) => (name || "")
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
            .toLowerCase().replace(/\s+/g, " ").trim();

        const closeSpondLogin = () => {
            showSpondLogin.value = false;
            spondEmail.value = "";
            spondPassword.value = "";
            spond2faCode.value = "";
            spond2faToken.value = null;
        };

        // Entry point for the button.
        const importFromSpond = async () => {
            if (!SpondClient.isConfigured()) {
                props.dialog.alert("Spond not set up",
                    "The relay URL is missing. Set RELAY_URL in assets/js/spond.js to your deployed Cloudflare Worker URL.");
                return;
            }
            if (!SpondClient.hasToken() || SpondClient.tokenLooksExpired()) {
                showSpondLogin.value = true;
                return;
            }
            await loadSpondEvents();
        };

        const loadSpondEvents = async () => {
            spondBusy.value = true;
            spondStatus.value = "Fetching events from Spond...";
            try {
                const events = await SpondClient.getUpcomingEvents();
                if (!events.length) {
                    props.dialog.alert("Nothing found", "Spond returned no upcoming events for your account.");
                    return;
                }
                // Always let the user pick, even with a single event — you import
                // ~30 min before the session and must be sure it is the right one.
                spondEvents.value = events;
                showSpondPicker.value = true;
            } catch (err) {
                if (err instanceof SpondClient.AuthError) {
                    showSpondLogin.value = true;
                } else {
                    props.dialog.alert("Spond error", err.message || String(err));
                }
            } finally {
                spondBusy.value = false;
                spondStatus.value = "";
            }
        };

        // Past events: needed to test against a session that already has attendees,
        // and to re-import one after the fact.
        const loadPastSpondEvents = async () => {
            spondBusy.value = true;
            try {
                const events = await SpondClient.getPastEvents();
                if (!events.length) {
                    props.dialog.alert("Nothing found", "Spond returned no recent past events.");
                    return;
                }
                spondEvents.value = events;
                showSpondPicker.value = true;
            } catch (err) {
                if (err instanceof SpondClient.AuthError) showSpondLogin.value = true;
                else props.dialog.alert("Spond error", err.message || String(err));
            } finally {
                spondBusy.value = false;
            }
        };

        const chooseSpondEvent = async (event) => {
            showSpondPicker.value = false;
            await applySpondEvent(event);
        };

        // New arrivals from Spond need a gender and class before they are useful
        // for match generation, so they are prompted for right after the import.
        const showNewPlayerPrompt = ref(false);
        const newPlayerRows = ref([]);

        const newPlayersReady = computed(() => newPlayerRows.value.every(r => r.gender && r.level));

        const saveNewPlayerDetails = () => {
            newPlayerRows.value.forEach(r => {
                emit("edit-player", { id: r.id, name: r.name, gender: r.gender, level: r.level });
            });
            showNewPlayerPrompt.value = false;
            newPlayerRows.value = [];
        };

        const dismissNewPlayerPrompt = () => {
            showNewPlayerPrompt.value = false;
            newPlayerRows.value = [];
        };

        // Import attendees straight in. Players carry the Spond member id they came
        // from, so this resolves by id — spelling can never cause a mismatch.
        const applySpondEvent = async (event) => {
            console.log("[Spond] raw event:", event);

            const attendees = SpondClient.acceptedAttendees(event);
            if (!attendees.length) {
                props.dialog.alert("No attendees", "Nobody has accepted this event yet.");
                return;
            }

            if (props.data.current.games.length > 0) {
                props.dialog.alert("Adding players",
                    "The matches have already been genenrated. You need reset the matches in order for these players to included in the matches.");
            }

            const players = (props.data && props.data.players) || [];
            const bySpondId = new Map(players.filter(p => p.spondId).map(p => [p.spondId, p]));
            const generateHashId = () => Math.random().toString(36).slice(2, 14);

            const newList = [...props.selected];
            const created = [];
            const createdPlayers = [];
            const nameless = [];
            let added = 0, alreadyIn = 0;

            attendees.forEach(att => {
                let player = bySpondId.get(att.spondId);

                if (!player) {
                    if (!att.name) { nameless.push(att.spondId); return; }
                    // Joined the Spond group after the last import.
                    player = { id: generateHashId(), spondId: att.spondId, name: att.name, level: "B" };
                    emit("save-new-player", player);
                    bySpondId.set(att.spondId, player);
                    created.push(player.name);
                    createdPlayers.push(player);
                }

                if (newList.some(p => p.id === player.id)) { alreadyIn++; return; }
                newList.push(player);
                added++;
            });

            if (added) emit("update-selected", newList);

            const lines = [`${added} player(s) added from "${event.heading || "event"}".`];
            if (created.length) lines.push(`New from Spond: ${created.join(", ")}.`);
            if (alreadyIn) lines.push(`${alreadyIn} were already in the list.`);
            if (nameless.length) {
                lines.push(`${nameless.length} attendee(s) could not be identified — see the browser console.`);
                console.warn("[Spond] attendees with no name in payload:", nameless);
            }
            await props.dialog.alert("Spond import", lines.join(" "));

            if (createdPlayers.length) {
                newPlayerRows.value = createdPlayers.map(p => ({
                    id: p.id, name: p.name, gender: null, level: p.level || "B"
                }));
                showNewPlayerPrompt.value = true;
            }
        };

        const doSpondLogin = async () => {
            if (!spondEmail.value.trim() || !spondPassword.value) {
                props.dialog.alert("Validation", "Enter your Spond email and password.");
                return;
            }
            spondBusy.value = true;
            spondStatus.value = "Signing in to Spond...";
            try {
                const result = await SpondClient.login(spondEmail.value, spondPassword.value);
                if (result.needs2fa) {
                    spond2faToken.value = result.token;
                    spondPassword.value = "";
                    spondStatus.value = "";
                    return; // modal switches to the code step
                }
                closeSpondLogin();
                await loadSpondEvents();
            } catch (err) {
                props.dialog.alert("Sign-in failed", err.message || String(err));
            } finally {
                spondBusy.value = false;
                spondStatus.value = "";
            }
        };

        const doSpond2fa = async () => {
            spondBusy.value = true;
            try {
                await SpondClient.verify2fa(spond2faToken.value, spond2faCode.value);
                closeSpondLogin();
                await loadSpondEvents();
            } catch (err) {
                props.dialog.alert("Verification failed", err.message || String(err));
            } finally {
                spondBusy.value = false;
            }
        };

        const signOutOfSpond = () => {
            SpondClient.clearSession();
            props.dialog.alert("Spond", "Signed out of Spond on this device.");
        };

        return {
            searchQuery,
            showDropdown,
            filteredPlayers,
            levelCounts,
            newPlayerGender,
            newPlayerLevel,
            editingId,
            editName,
            editGender,
            editLevel,
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
			lastAddedId,
			deletePlayer,
			isAlreadySelected,
			levelPopupId,
			toggleLevelPopup,
			setLevel,
			showLevelGuide,
			spondBusy,
			spondStatus,
			showSpondLogin,
			spondEmail,
			spondPassword,
			spond2faCode,
			spond2faToken,
			spondEvents,
			showSpondPicker,
			importFromSpond,
			chooseSpondEvent,
			doSpondLogin,
			doSpond2fa,
			closeSpondLogin,
			signOutOfSpond,
			showNewPlayerPrompt,
			newPlayerRows,
			newPlayersReady,
			saveNewPlayerDetails,
			dismissNewPlayerPrompt,
			loadPastSpondEvents,
			SpondClient
        };
    },
    template: `
        <div>
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h4 class="card-title text-primary mb-0">Select Players</h4>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-success" @click="importFromSpond" :disabled="spondBusy" title="Import tonight's attendees from Spond">
                        <span v-if="spondBusy" class="spinner-border spinner-border-sm me-1" role="status"></span>
                        <i v-else class="bi bi-cloud-download"></i>
                        {{ spondBusy ? 'Loading...' : 'Import from Spond' }}
                    </button>
                    <button v-if="selected.length > 0" class="btn btn-sm btn-outline-danger" @click="resetAll">
                        <i class="bi bi-trash"></i> Reset All
                    </button>
                </div>
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
                <small v-if="selected.length > 0" class="form-text text-muted"> 
                    Aim for roughly 25% Class A, 50% Class B, and 25% Class C players. (e.g., 5 Class A, 10 Class B, 5 Class C).
                </small>

                <ul class="list-group autocomplete-list" v-if="showDropdown && filteredPlayers.length > 0">
                    <li
                        v-for="player in filteredPlayers"
                        :key="player.id"
                        class="list-group-item autocomplete-item d-flex justify-content-between align-items-center"
                        :class="{ 'list-group-item-danger': isAlreadySelected(player.id) && !switchingPlayer }"
                        :style="isAlreadySelected(player.id) && !switchingPlayer ? 'cursor: default;' : ''"
                        @click="!(isAlreadySelected(player.id) && !switchingPlayer) && selectPlayer(player)"
                    >
                        {{ player.name }}
                        <span v-if="isAlreadySelected(player.id) && !switchingPlayer" class="badge rounded-pill bg-success">
                            Already Added
                        </span>
                        <span v-else class="badge rounded-pill" :class="switchingPlayer ? 'bg-warning text-dark' : 'bg-secondary'">
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
                <h5 class="text-secondary border-bottom pb-2 d-flex flex-wrap align-items-center gap-2">
                    <span>Selected Players ({{ selected.length }})</span>
                    <span class="d-flex flex-wrap gap-1">
                        <span class="badge rounded-pill bg-success" title="Class A (Expert)">
                            <i class="bi bi-battery-full"></i> {{ levelCounts.A }} Class A
                        </span>
                        <span class="badge rounded-pill bg-info" title="Class B (Intermediate)">
                            <i class="bi bi-battery-half"></i> {{ levelCounts.B }} Class B
                        </span>
                        <span class="badge rounded-pill bg-secondary" title="Class C (Beginner)">
                            <i class="bi bi-battery"></i> {{ levelCounts.C }} Class C
                        </span>
                    </span>
                </h5>
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
                            <div class="d-flex align-items-center me-2" style="min-width: 0;">
                                <i v-if="p.gender === 'Female'" class="bi bi-gender-female text-danger me-2"></i>
                                <i v-else class="bi bi-gender-male text-primary me-2"></i>
                                <span class="position-relative me-2 flex-shrink-0" style="cursor: pointer;" :title="'Class ' + (p.level || 'B') + ' - click to change'" @click.stop="toggleLevelPopup(p.id)">
                                    <i v-if="p.level === 'A'" class="bi bi-battery-full text-success" title="Class A - click to change"></i>
                                    <i v-else-if="p.level === 'C'" class="bi bi-battery text-secondary" title="Class C - click to change"></i>
                                    <i v-else class="bi bi-battery-half text-info" title="Class B - click to change"></i>

                                    <div v-if="levelPopupId === p.id" class="level-popup-backdrop" @click.stop="levelPopupId = null"></div>
                                    <div v-if="levelPopupId === p.id" class="level-popup card shadow-sm">
                                        <button type="button" class="btn btn-sm text-start" :class="p.level === 'A' ? 'btn-success' : 'btn-outline-success'" @click.stop="setLevel(p, 'A')">
                                            <i class="bi bi-battery-full"></i> Class A
                                        </button>
                                        <button type="button" class="btn btn-sm text-start" :class="p.level === 'B' ? 'btn-info' : 'btn-outline-info'" @click.stop="setLevel(p, 'B')">
                                            <i class="bi bi-battery-half"></i> Class B
                                        </button>
                                        <button type="button" class="btn btn-sm text-start" :class="p.level === 'C' ? 'btn-secondary' : 'btn-outline-secondary'" @click.stop="setLevel(p, 'C')">
                                            <i class="bi bi-battery"></i> Class C
                                        </button>
                                    </div>
                                </span>
                                <span class="text-truncate" :title="p.name">{{ p.name }}</span>
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
                                <div class="col-4">
                                    <select class="form-select form-select-sm" v-model="editLevel">
                                        <option value="A">Class A</option>
                                        <option value="B">Class B</option>
                                        <option value="C">Class C</option>
                                    </select>
                                </div>
                                <div class="col-12 text-end">
                                    <div class="btn-group">
                                        <button class="btn btn-sm btn-success" title="Save" @click="saveEdit"><i class="bi bi-check"></i></button>
                                        <button class="btn btn-sm btn-secondary" title="Cancel" @click="cancelEdit"><i class="bi bi-x"></i></button>
                                    </div>
                                    <button class="btn btn-sm btn-danger ms-1" title="Permanently Delete" @click="deletePlayer(editingId)">
                                        <i class="bi bi-trash-fill"></i>
                                    </button>
                                </div>
                            </div>
                    </li>
                </ul>
            </div>
            <div v-else class="text-muted fst-italic mt-3">
                No players selected yet.
            </div>

        <div v-if="showLevelGuide" class="modal custom-modal-backdrop" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="bi bi-info-circle-fill me-2"></i>Pro Tip: Player Levels</h5>
                        <button type="button" class="btn-close btn-close-white" @click="showLevelGuide = false"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">You can quickly change any player's level by tapping the <strong>battery icon</strong> next to their name.</p>
                        <p class="mb-3">Aim for roughly 25% Class A, 50% Class B, and 25% Class C players. (e.g., 5 Class A, 10 Class B, 5 Class C).</p>
                        <div class="text-center mb-3">
                            <div class="d-inline-flex flex-column gap-2 p-3 border rounded bg-light" style="min-width: 160px;">
                                <div class="d-flex align-items-center gap-2">
                                    <i class="bi bi-battery-full text-success fs-5"></i>
                                    <span><strong>Class A</strong> — Expert</span>
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                    <i class="bi bi-battery-half text-info fs-5"></i>
                                    <span><strong>Class B</strong> — Intermediate</span>
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                    <i class="bi bi-battery text-secondary fs-5"></i>
                                    <span><strong>Class C</strong> — Beginner</span>
                                </div>
                            </div>
                        </div>
                        <p class="text-muted mb-0"><i class="bi bi-stars text-warning me-1"></i>Setting accurate levels helps generate <strong>more balanced and competitive matches</strong> when you create the schedule.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" @click="showLevelGuide = false">Got it!</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="showSpondLogin" class="modal custom-modal-backdrop" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title"><i class="bi bi-cloud-download me-2"></i>Sign in to Spond</h5>
                        <button type="button" class="btn-close btn-close-white" @click="closeSpondLogin"></button>
                    </div>
                    <div class="modal-body">
                        <template v-if="!spond2faToken">
                            <p class="text-muted small mb-3">
                                Your Spond login is sent straight to Spond and never stored — only the
                                session token is kept on this device, so you should only need this once.
                            </p>
                            <div class="mb-2">
                                <label class="form-label">Spond email</label>
                                <input type="email" class="form-control" v-model="spondEmail" autocomplete="username" placeholder="you@example.com">
                            </div>
                            <div class="mb-2">
                                <label class="form-label">Spond password</label>
                                <input type="password" class="form-control" v-model="spondPassword" autocomplete="current-password" @keyup.enter="doSpondLogin">
                            </div>
                        </template>
                        <template v-else>
                            <p class="mb-3">Spond sent a verification code to your phone. Enter it below.</p>
                            <input type="text" class="form-control" v-model="spond2faCode" inputmode="numeric" placeholder="6-digit code" @keyup.enter="doSpond2fa">
                        </template>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" @click="closeSpondLogin">Cancel</button>
                        <button v-if="!spond2faToken" type="button" class="btn btn-success" @click="doSpondLogin" :disabled="spondBusy">
                            <span v-if="spondBusy" class="spinner-border spinner-border-sm me-1"></span>Sign in
                        </button>
                        <button v-else type="button" class="btn btn-success" @click="doSpond2fa" :disabled="spondBusy">Verify</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="showNewPlayerPrompt" class="modal custom-modal-backdrop" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-info text-white">
                        <h5 class="modal-title"><i class="bi bi-person-plus-fill me-2"></i>New player{{ newPlayerRows.length > 1 ? 's' : '' }} from Spond</h5>
                    </div>
                    <div class="modal-body">
                        <p class="small text-muted">
                            Set the gender and class so the matches come out balanced.
                        </p>
                        <div v-for="row in newPlayerRows" :key="row.id" class="border rounded p-2 mb-2">
                            <div class="fw-bold mb-2">
                                <i v-if="row.gender === 'Female'" class="bi bi-gender-female text-danger"></i>
                                <i v-else-if="row.gender === 'Male'" class="bi bi-gender-male text-primary"></i>
                                <i v-else class="bi bi-question-circle text-warning"></i>
                                {{ row.name }}
                            </div>
                            <div class="d-flex flex-wrap gap-2">
                                <div class="btn-group btn-group-sm" role="group">
                                    <button type="button" class="btn"
                                            :class="row.gender === 'Male' ? 'btn-primary' : 'btn-outline-primary'"
                                            @click="row.gender = 'Male'">
                                        <i class="bi bi-gender-male"></i> Male
                                    </button>
                                    <button type="button" class="btn"
                                            :class="row.gender === 'Female' ? 'btn-danger' : 'btn-outline-danger'"
                                            @click="row.gender = 'Female'">
                                        <i class="bi bi-gender-female"></i> Female
                                    </button>
                                </div>
                                <div class="btn-group btn-group-sm" role="group">
                                    <button type="button" class="btn"
                                            :class="row.level === 'A' ? 'btn-success' : 'btn-outline-success'"
                                            @click="row.level = 'A'">
                                        <i class="bi bi-battery-full"></i> A
                                    </button>
                                    <button type="button" class="btn"
                                            :class="row.level === 'B' ? 'btn-info' : 'btn-outline-info'"
                                            @click="row.level = 'B'">
                                        <i class="bi bi-battery-half"></i> B
                                    </button>
                                    <button type="button" class="btn"
                                            :class="row.level === 'C' ? 'btn-secondary' : 'btn-outline-secondary'"
                                            @click="row.level = 'C'">
                                        <i class="bi bi-battery"></i> C
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p v-if="!newPlayersReady" class="small text-warning mb-0">
                            <i class="bi bi-exclamation-triangle"></i> Pick a gender for everyone to continue.
                        </p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-link btn-sm text-muted me-auto" @click="dismissNewPlayerPrompt">
                            I'll do it later
                        </button>
                        <button type="button" class="btn btn-info" :disabled="!newPlayersReady" @click="saveNewPlayerDetails">
                            <i class="bi bi-check-lg"></i> Save
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="showSpondPicker" class="modal custom-modal-backdrop" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title"><i class="bi bi-calendar-event me-2"></i>Which event?</h5>
                        <button type="button" class="btn-close btn-close-white" @click="showSpondPicker = false"></button>
                    </div>
                    <div class="modal-body p-0">
                        <ul class="list-group list-group-flush">
                            <li v-for="ev in spondEvents" :key="ev.id"
                                class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                                style="cursor: pointer;" @click="chooseSpondEvent(ev)">
                                <span>{{ SpondClient.eventLabel(ev) }}</span>
                                <i class="bi bi-chevron-right text-muted"></i>
                            </li>
                        </ul>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-link btn-sm text-muted me-auto" @click="loadPastSpondEvents">
                            Show past events
                        </button>
                        <button type="button" class="btn btn-link btn-sm text-muted" @click="showSpondPicker = false; signOutOfSpond()">
                            Sign out
                        </button>
                        <button type="button" class="btn btn-secondary" @click="showSpondPicker = false">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `
};