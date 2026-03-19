const TournamentTeams = {
    props: ['data', 'selected', 'dialog'],
    emits: ['update-tournament-teams', 'update-tournament-ghosts', 'regen-games'],
    setup(props, { emit }) {
        const { ref, computed } = Vue;

        const movingPlayer = ref(null); // { playerId, fromTeamId }
        const editingTeamId = ref(null);
        const editTeamName = ref('');

        const TEAM_COLORS = ['primary', 'danger', 'success', 'warning', 'info', 'secondary', 'dark'];
        const TEAM_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];

        const generateId = () => Math.random().toString(36).slice(2, 10);

        const getScore = (p) => {
            if (!p?.previous5ratio) return 0;
            return p.previous5ratio.reduce((s, a) => s + a, 0);
        };

        const teams = computed(() => props.data?.tournament?.teams || []);

        // allPlayers includes real players + any ghost placeholders
        const allPlayers = computed(() => [
            ...(props.data?.players || []),
            ...(props.data?.tournament?.ghosts || [])
        ]);

        const hasGames = computed(() => (props.data?.tournament?.games || []).length > 0);

        const getPlayer = (id) => allPlayers.value.find(p => p.id === id);

        const unassignedPlayers = computed(() => {
            if (!props.selected) return [];
            const assignedIds = new Set();
            teams.value.forEach(t => (t.players || []).forEach(id => assignedIds.add(id)));
            return props.selected.filter(p => !assignedIds.has(p.id));
        });

        const playerTiers = computed(() => {
            const tiers = {};
            if (!props.selected?.length) return tiers;
            const sorted = [...props.selected].sort((a, b) => getScore(b) - getScore(a));
            const total = sorted.length;
            sorted.forEach((p, i) => {
                const g = Math.floor((i / total) * 3);
                tiers[p.id] = g === 0 ? 'high' : g === 1 ? 'mid' : 'low';
            });
            return tiers;
        });

        const getTierData = (playerId) => {
            const p = getPlayer(playerId);
            if (p?.isGhost) return { icon: 'bi-person-slash', color: 'text-muted' };
            const tier = playerTiers.value[playerId];
            if (tier === 'high') return { icon: 'bi-battery-full', color: 'text-success' };
            if (tier === 'mid') return { icon: 'bi-battery-half', color: 'text-warning' };
            return { icon: 'bi-battery', color: 'text-secondary' };
        };

        const snakeDraft = (players, teamList) => {
            let forward = true, idx = 0;
            players.forEach(p => {
                teamList[idx].players.push(p.id);
                if (forward) {
                    idx++;
                    if (idx >= teamList.length) { idx = teamList.length - 1; forward = false; }
                } else {
                    idx--;
                    if (idx < 0) { idx = 0; forward = true; }
                }
            });
        };

        const autoGenerateTeams = async () => {
            if (!props.selected?.length) {
                props.dialog.alert('No Players', 'Add players in the Players tab first.');
                return;
            }
            if (props.selected.length < 12) {
                props.dialog.alert('Not Enough Players', 'Need at least 12 players (min 4 teams of 3).');
                return;
            }
            if (teams.value.length > 0) {
                const ok = await props.dialog.confirm('Regenerate Teams', 'This will discard current teams. Continue?');
                if (!ok) return;
            }

            // Always create teams of exactly 6 — fill short teams with Ghost players
            const numTeams = Math.max(4, Math.ceil(props.selected.length / 6));
            const totalSlots = numTeams * 6;
            const numGhosts = totalSlots - props.selected.length;

            // Work out ghost gender split to get as close to 3M+3F per team as possible
            const malesCount = props.selected.filter(p => p.gender !== 'Female').length;
            const femalesCount = props.selected.filter(p => p.gender === 'Female').length;
            const targetPerGender = numTeams * 3;
            const ghostMaleCount = Math.max(0, Math.min(numGhosts, targetPerGender - malesCount));
            const ghostFemaleCount = numGhosts - ghostMaleCount;

            const ghosts = [];
            for (let i = 0; i < ghostMaleCount; i++) {
                ghosts.push({ id: `ghost-m-${i}`, name: 'Ghost Player', gender: 'Male', isGhost: true, previous5ratio: [0, 0, 0, 0, 0] });
            }
            for (let i = 0; i < ghostFemaleCount; i++) {
                ghosts.push({ id: `ghost-f-${i}`, name: 'Ghost Player', gender: 'Female', isGhost: true, previous5ratio: [0, 0, 0, 0, 0] });
            }

            const newTeams = Array.from({ length: numTeams }, (_, i) => ({
                id: generateId(),
                name: 'Team ' + (TEAM_NAMES[i] || String(i + 1)),
                color: TEAM_COLORS[i % TEAM_COLORS.length],
                players: []
            }));

            const allMales = [
                ...props.selected.filter(p => p.gender !== 'Female').sort((a, b) => getScore(b) - getScore(a)),
                ...ghosts.filter(g => g.gender !== 'Female')
            ];
            const allFemales = [
                ...props.selected.filter(p => p.gender === 'Female').sort((a, b) => getScore(b) - getScore(a)),
                ...ghosts.filter(g => g.gender === 'Female')
            ];

            snakeDraft(allMales, newTeams);
            snakeDraft(allFemales, newTeams);

            emit('update-tournament-ghosts', ghosts);
            emit('update-tournament-teams', newTeams);
        };

        const startEditTeam = (team) => {
            editingTeamId.value = team.id;
            editTeamName.value = team.name;
        };

        const saveTeamName = () => {
            if (!editTeamName.value.trim()) return;
            emit('update-tournament-teams', teams.value.map(t =>
                t.id === editingTeamId.value ? { ...t, name: editTeamName.value.trim() } : t
            ));
            editingTeamId.value = null;
        };

        const cycleTeamColor = (teamId) => {
            emit('update-tournament-teams', teams.value.map(t => {
                if (t.id !== teamId) return t;
                const idx = TEAM_COLORS.indexOf(t.color || 'primary');
                return { ...t, color: TEAM_COLORS[(idx + 1) % TEAM_COLORS.length] };
            }));
        };

        const startMoving = (playerId, fromTeamId) => {
            if (movingPlayer.value?.playerId === playerId) {
                movingPlayer.value = null;
                return;
            }
            movingPlayer.value = { playerId, fromTeamId };
        };

        // Swap the selected player with targetPlayer (player-to-player swap)
        const swapWithPlayer = async (targetPlayerId, targetTeamId) => {
            if (!movingPlayer.value) return;
            const { playerId: srcId, fromTeamId: srcTeamId } = movingPlayer.value;

            // Same player clicked = cancel selection
            if (targetPlayerId === srcId) { movingPlayer.value = null; return; }
            // Same team = cancel
            if (srcTeamId !== null && srcTeamId === targetTeamId) { movingPlayer.value = null; return; }

            if (hasGames.value) {
                const ok = await props.dialog.confirm(
                    '⚠️ Matches Will Reset',
                    'Moving this player will reset ALL matches and regenerate them from scratch, even if matches have already started. All scores will be lost. Continue?'
                );
                if (!ok) { movingPlayer.value = null; return; }
            }

            const newTeams = teams.value.map(team => {
                let players = [...(team.players || [])];
                if (team.id === srcTeamId) {
                    const i = players.indexOf(srcId);
                    if (i >= 0) players[i] = targetPlayerId;
                }
                if (team.id === targetTeamId) {
                    const i = players.indexOf(targetPlayerId);
                    if (i >= 0) players[i] = srcId;
                }
                return { ...team, players };
            });

            emit('update-tournament-teams', newTeams);
            if (hasGames.value) emit('regen-games');
            movingPlayer.value = null;
        };

        // Move source player to unassigned pool
        const unassignPlayer = async () => {
            if (!movingPlayer.value) return;
            const { playerId, fromTeamId } = movingPlayer.value;
            if (!fromTeamId) { movingPlayer.value = null; return; }

            if (hasGames.value) {
                const ok = await props.dialog.confirm(
                    '⚠️ Matches Will Reset',
                    'Unassigning this player will reset ALL matches and regenerate them. All scores will be lost. Continue?'
                );
                if (!ok) { movingPlayer.value = null; return; }
            }

            emit('update-tournament-teams', teams.value.map(team => {
                if (team.id !== fromTeamId) return team;
                return { ...team, players: (team.players || []).filter(id => id !== playerId) };
            }));
            if (hasGames.value) emit('regen-games');
            movingPlayer.value = null;
        };

        const getTeamHeaderClass = (color) => {
            return `bg-${color || 'primary'} text-white`;
        };

        const getTeamFooterClass = (color) => {
            return `bg-${color || 'primary'} bg-opacity-75 text-white`;
        };

        const getBadgeClass = () => {
            return 'border border-white text-white';
        };

        return {
            teams, movingPlayer, unassignedPlayers, hasGames,
            getPlayer, getTierData,
            autoGenerateTeams,
            startMoving, swapWithPlayer, unassignPlayer,
            editingTeamId, editTeamName, startEditTeam, saveTeamName,
            cycleTeamColor, getTeamHeaderClass, getTeamFooterClass, getBadgeClass
        };
    },
    template: `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h4 class="card-title text-success mb-0"><i class="bi bi-people-fill"></i> Teams</h4>
            <button class="btn btn-sm btn-success" @click="autoGenerateTeams">
                <i class="bi bi-shuffle"></i> Auto-Generate Teams
            </button>
        </div>

        <!-- Static warning when matches are already generated -->
        <div v-if="hasGames && !movingPlayer" class="alert alert-warning py-2 mb-3 small">
            <i class="bi bi-exclamation-triangle-fill me-1"></i>
            <strong>Matches already generated.</strong> Moving any player will reset and regenerate all matches.
        </div>

        <!-- Moving player banner -->
        <div v-if="movingPlayer" class="alert alert-danger d-flex justify-content-between align-items-center mb-3 py-2">
            <span>
                <i class="bi bi-arrow-left-right me-2"></i>
                Moving <strong>{{ getPlayer(movingPlayer.playerId)?.name }}</strong> —
                click another player to swap.
                <span v-if="hasGames" class="text-danger fw-bold ms-1">⚠️ Will reset all matches!</span>
            </span>
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-warning" @click="unassignPlayer">Unassign</button>
                <button class="btn btn-sm btn-close" @click="movingPlayer = null"></button>
            </div>
        </div>

        <!-- Unassigned Players -->
        <div v-if="unassignedPlayers.length > 0" class="card mb-3 border-warning">
            <div class="card-header bg-warning text-dark py-2">
                <i class="bi bi-person-exclamation me-1"></i>
                Unassigned Players ({{ unassignedPlayers.length }})
            </div>
            <div class="card-body p-2">
                <div class="d-flex flex-wrap gap-2">
                    <span v-for="p in unassignedPlayers" :key="p.id"
                          class="badge border d-inline-flex align-items-center gap-1 p-2"
                          :class="movingPlayer?.playerId === p.id
                            ? 'bg-info text-dark border-info'
                            : movingPlayer && movingPlayer.playerId !== p.id
                              ? 'bg-danger bg-opacity-10 text-dark border-danger'
                              : 'bg-light text-dark border-secondary'"
                          style="font-size: 0.85rem; cursor: pointer;"
                          @click="movingPlayer && movingPlayer.playerId !== p.id ? swapWithPlayer(p.id, null) : startMoving(p.id, null)">
                        <i v-if="p.gender === 'Female'" class="bi bi-gender-female text-danger"></i>
                        <i v-else class="bi bi-gender-male text-primary"></i>
                        <i class="bi" :class="[getTierData(p.id).icon, getTierData(p.id).color]"></i>
                        {{ p.name }}
                        <i v-if="movingPlayer && movingPlayer.playerId !== p.id" class="bi bi-arrow-left-right ms-1 small text-danger"></i>
                    </span>
                </div>
            </div>
        </div>

        <!-- Empty state -->
        <div v-if="teams.length === 0" class="text-center text-muted py-5">
            <i class="bi bi-people display-4"></i>
            <p class="mt-2">No teams yet. Click <strong>Auto-Generate Teams</strong> to create balanced teams.</p>
            <p class="small">Teams of 6 (3M + 3F), balanced by skill. Ghost players fill any missing slots.</p>
        </div>

        <!-- Teams Grid -->
        <div class="row row-cols-1 row-cols-md-2 g-3">
            <div class="col" v-for="team in teams" :key="team.id">
                <div class="card h-100 shadow-sm">

                    <!-- Team Header -->
                    <div class="card-header py-2 d-flex justify-content-between align-items-center"
                         :class="getTeamHeaderClass(team.color)">
                        <div v-if="editingTeamId !== team.id" class="d-flex align-items-center gap-2 flex-grow-1">
                            <span class="fw-bold">{{ team.name }}</span>
                            <span class="badge" :class="getBadgeClass(team.color)">{{ (team.players || []).length }}</span>
                        </div>
                        <div v-else class="d-flex gap-2 flex-grow-1" @click.stop>
                            <input type="text" class="form-control form-control-sm" v-model="editTeamName"
                                   @keyup.enter="saveTeamName" maxlength="20" @click.stop>
                            <button class="btn btn-sm btn-light" @click.stop="saveTeamName"><i class="bi bi-check"></i></button>
                            <button class="btn btn-sm btn-outline-light" @click.stop="editingTeamId = null"><i class="bi bi-x"></i></button>
                        </div>
                        <div class="d-flex gap-1 flex-shrink-0" @click.stop>
                            <button class="btn btn-sm btn-outline-light" title="Change colour" @click.stop="cycleTeamColor(team.id)">
                                <i class="bi bi-palette"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-light" title="Rename" @click.stop="startEditTeam(team)">
                                <i class="bi bi-pen"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Players -->
                    <div class="card-body p-2">
                        <div v-if="(team.players || []).length === 0" class="text-center text-muted py-2 small">
                            <i class="bi bi-person-plus"></i> No players assigned
                        </div>
                        <div class="row g-1">
                            <div v-for="playerId in (team.players || [])" :key="playerId" class="col-6">
                                <div class="d-flex align-items-center p-1 rounded small"
                                     :class="movingPlayer?.playerId === playerId
                                        ? 'bg-info text-dark'
                                        : movingPlayer && movingPlayer.playerId !== playerId
                                          ? 'bg-danger bg-opacity-10 border border-danger border-opacity-50'
                                          : getPlayer(playerId)?.isGhost
                                            ? 'bg-light border border-dashed border-secondary text-muted'
                                            : 'bg-light'"
                                     style="cursor: pointer;"
                                     @click.stop="movingPlayer && movingPlayer.playerId !== playerId ? swapWithPlayer(playerId, team.id) : startMoving(playerId, team.id)">
                                    <template v-if="getPlayer(playerId)">
                                        <template v-if="getPlayer(playerId).isGhost">
                                            <i class="bi bi-arrow-left-right text-secondary me-1 flex-shrink-0" style="font-size:0.75em" title="Click to swap"></i>
                                            <i class="bi bi-person-dash text-muted me-1 flex-shrink-0"></i>
                                            <span class="text-muted fst-italic text-truncate">Ghost</span>
                                            <i v-if="movingPlayer && movingPlayer.playerId !== playerId"
                                               class="bi bi-arrow-left-right ms-auto flex-shrink-0 small text-danger"></i>
                                        </template>
                                        <template v-else>
                                            <i class="bi bi-arrow-left-right text-secondary me-1 flex-shrink-0" style="font-size:0.75em" title="Click to swap"></i>
                                            <i v-if="getPlayer(playerId).gender === 'Female'"
                                               class="bi bi-gender-female text-danger me-1 flex-shrink-0"></i>
                                            <i v-else class="bi bi-gender-male text-primary me-1 flex-shrink-0"></i>
                                            <i class="bi me-1 flex-shrink-0"
                                               :class="[getTierData(playerId).icon, getTierData(playerId).color]"></i>
                                            <span class="text-truncate">{{ getPlayer(playerId).name }}</span>
                                            <i v-if="movingPlayer && movingPlayer.playerId !== playerId"
                                               class="bi bi-arrow-left-right ms-auto flex-shrink-0 small text-danger"></i>
                                        </template>
                                    </template>
                                    <template v-else>
                                        <span class="text-muted fst-italic small">Unknown</span>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer stats -->
                    <div class="card-footer small py-1 d-flex justify-content-between fw-semibold"
                         :class="getTeamFooterClass(team.color)">
                        <span><i class="bi bi-gender-male me-1"></i>{{ (team.players || []).filter(id => getPlayer(id)?.gender !== 'Female').length }} M</span>
                        <span><i class="bi bi-gender-female me-1"></i>{{ (team.players || []).filter(id => getPlayer(id)?.gender === 'Female').length }} F</span>
                        <span><i class="bi bi-person-dash me-1"></i>{{ (team.players || []).filter(id => getPlayer(id)?.isGhost).length }}</span>
                        <span>Total: {{ (team.players || []).length }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `
};
