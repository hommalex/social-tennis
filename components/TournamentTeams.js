const TournamentTeams = {
    props: ['data', 'selected', 'dialog'],
    emits: ['update-tournament-teams'],
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
        const allPlayers = computed(() => props.data?.players || []);

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
                props.dialog.alert('Not Enough Players', 'Need at least 12 players (min 2 teams of 6).');
                return;
            }
            if (teams.value.length > 0) {
                const ok = await props.dialog.confirm('Regenerate Teams', 'This will discard current teams. Continue?');
                if (!ok) return;
            }

            const numTeams = Math.max(4, Math.floor(props.selected.length / 6));
            const newTeams = Array.from({ length: numTeams }, (_, i) => ({
                id: generateId(),
                name: 'Team ' + (TEAM_NAMES[i] || String(i + 1)),
                color: TEAM_COLORS[i % TEAM_COLORS.length],
                players: []
            }));

            const males = [...props.selected]
                .filter(p => p.gender !== 'Female')
                .sort((a, b) => getScore(b) - getScore(a));
            const females = [...props.selected]
                .filter(p => p.gender === 'Female')
                .sort((a, b) => getScore(b) - getScore(a));

            snakeDraft(males, newTeams);
            snakeDraft(females, newTeams);

            emit('update-tournament-teams', newTeams);
        };

        const addTeam = () => {
            const i = teams.value.length;
            emit('update-tournament-teams', [...teams.value, {
                id: generateId(),
                name: 'Team ' + (TEAM_NAMES[i] || String(i + 1)),
                color: TEAM_COLORS[i % TEAM_COLORS.length],
                players: []
            }]);
        };

        const removeTeam = async (teamId) => {
            const ok = await props.dialog.confirm('Remove Team', 'Remove this team? Players will become unassigned.');
            if (!ok) return;
            emit('update-tournament-teams', teams.value.filter(t => t.id !== teamId));
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

        const moveToTeam = (toTeamId) => {
            if (!movingPlayer.value) return;
            const { playerId, fromTeamId } = movingPlayer.value;
            if (fromTeamId === toTeamId) { movingPlayer.value = null; return; }

            emit('update-tournament-teams', teams.value.map(team => {
                let players = [...(team.players || [])];
                if (team.id === fromTeamId) players = players.filter(id => id !== playerId);
                else if (team.id === toTeamId) players = [...players, playerId];
                return { ...team, players };
            }));
            movingPlayer.value = null;
        };

        const moveToUnassigned = () => {
            if (!movingPlayer.value) return;
            const { playerId, fromTeamId } = movingPlayer.value;
            if (!fromTeamId) { movingPlayer.value = null; return; }

            emit('update-tournament-teams', teams.value.map(team => {
                if (team.id !== fromTeamId) return team;
                return { ...team, players: (team.players || []).filter(id => id !== playerId) };
            }));
            movingPlayer.value = null;
        };

        const getTeamHeaderClass = (color) => {
            if (color === 'warning') return 'bg-warning text-dark';
            return `bg-${color || 'primary'} text-white`;
        };

        return {
            teams, movingPlayer, unassignedPlayers,
            getPlayer, getTierData,
            autoGenerateTeams, addTeam, removeTeam,
            startMoving, moveToTeam, moveToUnassigned,
            editingTeamId, editTeamName, startEditTeam, saveTeamName,
            cycleTeamColor, getTeamHeaderClass
        };
    },
    template: `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h4 class="card-title text-success mb-0"><i class="bi bi-people-fill"></i> Teams</h4>
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-success" @click="addTeam">
                    <i class="bi bi-plus-circle"></i> Add Team
                </button>
                <button class="btn btn-sm btn-success" @click="autoGenerateTeams">
                    <i class="bi bi-shuffle"></i> Auto-Generate
                </button>
            </div>
        </div>

        <!-- Moving player banner -->
        <div v-if="movingPlayer" class="alert alert-info d-flex justify-content-between align-items-center mb-3 py-2">
            <span><i class="bi bi-arrow-left-right me-2"></i>Moving player — click a team card to place them there.</span>
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-warning" @click="moveToUnassigned">Unassign</button>
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
                          :class="movingPlayer?.playerId === p.id ? 'bg-info text-dark border-info' : 'bg-light text-dark border-secondary'"
                          style="font-size: 0.85rem; cursor: pointer;"
                          @click="startMoving(p.id, null)">
                        <i v-if="p.gender === 'Female'" class="bi bi-gender-female text-danger"></i>
                        <i v-else class="bi bi-gender-male text-primary"></i>
                        <i class="bi" :class="[getTierData(p.id).icon, getTierData(p.id).color]"></i>
                        {{ p.name }}
                    </span>
                </div>
            </div>
        </div>

        <!-- Empty state -->
        <div v-if="teams.length === 0" class="text-center text-muted py-5">
            <i class="bi bi-people display-4"></i>
            <p class="mt-2">No teams yet. Click <strong>Auto-Generate</strong> to create balanced teams, or <strong>Add Team</strong> to build manually.</p>
            <p class="small">Auto-Generate creates teams balanced by skill (high/mid/low) and gender (3M / 3F).</p>
        </div>

        <!-- Teams Grid -->
        <div class="row row-cols-1 row-cols-md-2 g-3">
            <div class="col" v-for="team in teams" :key="team.id">
                <div class="card h-100 shadow-sm"
                     :class="movingPlayer && movingPlayer.fromTeamId !== team.id ? 'team-drop-target border-info' : ''"
                     @click.self="moveToTeam(team.id)">

                    <!-- Team Header -->
                    <div class="card-header py-2 d-flex justify-content-between align-items-center"
                         :class="getTeamHeaderClass(team.color)"
                         @click="moveToTeam(team.id)">
                        <div v-if="editingTeamId !== team.id" class="d-flex align-items-center gap-2 flex-grow-1">
                            <span class="fw-bold">{{ team.name }}</span>
                            <span class="badge bg-white text-dark">{{ (team.players || []).length }}</span>
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
                            <button class="btn btn-sm btn-outline-light" title="Remove team" @click.stop="removeTeam(team.id)">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Players -->
                    <div class="card-body p-2" @click="moveToTeam(team.id)">
                        <div v-if="(team.players || []).length === 0" class="text-center text-muted py-2 small">
                            <i class="bi bi-arrow-down-circle"></i> Click here to drop a player into this team
                        </div>
                        <div class="row g-1">
                            <div v-for="playerId in (team.players || [])" :key="playerId" class="col-6">
                                <div class="d-flex align-items-center p-1 rounded small"
                                     :class="movingPlayer?.playerId === playerId ? 'bg-info text-dark' : 'bg-light'"
                                     style="cursor: pointer;"
                                     @click.stop="startMoving(playerId, team.id)">
                                    <template v-if="getPlayer(playerId)">
                                        <i v-if="getPlayer(playerId).gender === 'Female'"
                                           class="bi bi-gender-female text-danger me-1 flex-shrink-0"></i>
                                        <i v-else class="bi bi-gender-male text-primary me-1 flex-shrink-0"></i>
                                        <i class="bi me-1 flex-shrink-0"
                                           :class="[getTierData(playerId).icon, getTierData(playerId).color]"></i>
                                        <span class="text-truncate">{{ getPlayer(playerId).name }}</span>
                                    </template>
                                    <template v-else>
                                        <span class="text-muted fst-italic small">Unknown player</span>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer stats -->
                    <div class="card-footer text-muted small py-1 d-flex justify-content-between" @click.stop>
                        <span>
                            <i class="bi bi-gender-male text-primary"></i>
                            {{ (team.players || []).filter(id => getPlayer(id)?.gender !== 'Female').length }} M
                        </span>
                        <span>
                            <i class="bi bi-gender-female text-danger"></i>
                            {{ (team.players || []).filter(id => getPlayer(id)?.gender === 'Female').length }} F
                        </span>
                        <span>Total: {{ (team.players || []).length }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `
};
