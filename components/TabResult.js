const TabResult = {
    props: ['data', 'selected'],
    setup(props) {
        const { computed } = Vue;

        const standings = computed(() => {
            // 1. Initialize Map for all selected players (default 0)
            const scores = {};
            const gamesPlayed = {};
            const playerDetails = {}; // Store gender/name for easy access
            
            // Initialize with selected players to ensure everyone appears
            if (props.selected) {
                props.selected.forEach(p => {
                    scores[p.id] = 0;
                    gamesPlayed[p.id] = 0;
                    playerDetails[p.id] = p; // Keep ref to full object
                });
            }

            // 2. Loop through all rounds/games in the data
            const rounds = props.data?.current?.games || [];
            
            rounds.forEach(round => {
                if (!round.games) return;
                
                round.games.forEach(game => {
                    // Only count finished games
                    if (game.status === 'finished') {
                        const updatePlayer = (pid, points) => {
                            if (!scores[pid]) scores[pid] = 0;
                            if (!gamesPlayed[pid]) gamesPlayed[pid] = 0;
                            
                            scores[pid] += parseInt(points || 0);
                            gamesPlayed[pid] += 1;
                        };

                        updatePlayer(game.pairA.p1.id, game.scoreA);
                        updatePlayer(game.pairA.p2.id, game.scoreA);
                        updatePlayer(game.pairB.p1.id, game.scoreB);
                        updatePlayer(game.pairB.p2.id, game.scoreB);
                    }
                });
            });

            // 3. Convert to Array and Sort
            return props.selected.map(p => {
                return {
                    id: p.id,
                    name: p.name,
                    gender: p.gender || 'Male', // Default to Male if missing
                    score: scores[p.id] || 0,
                    played: gamesPlayed[p.id] || 0
                };
            }).sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.name.localeCompare(b.name);
            });
        });

        return {
            standings
        };
    },
    template: `
        <div>
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h4 class="card-title text-primary mb-0">Event Standings</h4>
            </div>

            <div v-if="standings.length > 0" class="table-responsive">
                <table class="table table-hover table-striped align-middle" style="table-layout: fixed;">
                    <thead class="table-dark">
                        <tr>
                            <th scope="col" class="text-center" style="width: 50px;">#</th>
                            <th scope="col">Player</th>
                            <th scope="col" class="text-center" style="width: 50px;"><i class="bi bi-gender-ambiguous"></i></th>
                            <th scope="col" class="text-center fw-bold text-warning" style="width: 80px;">Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(player, index) in standings" :key="player.id">
                            <td class="text-center fw-bold">
                                <span v-if="index === 0" class="text-warning" title="1st Place"><i class="bi bi-trophy-fill"></i></span>
                                <span v-else-if="index === 1" class="text-secondary" title="2nd Place"><i class="bi bi-trophy-fill"></i></span>
                                <span v-else-if="index === 2" class="text-danger" title="3rd Place"><i class="bi bi-trophy-fill"></i></span>
                                <span v-else-if="index === 3" class="text-primary" title="4th Place"><i class="bi bi-award-fill"></i></span>
                                <span v-else class="text-muted small">{{ index + 1 }}</span>
                            </td>
                            
                            <td class="fw-medium text-truncate" :title="player.name">{{ player.name }}</td>
                            
                            <td class="text-center">
                                <i v-if="player.gender === 'Female'" class="bi bi-gender-female text-danger"></i>
                                <i v-else class="bi bi-gender-male text-primary"></i>
                            </td>
                            
                            <td class="text-center fw-bold fs-5">{{ player.score }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <div v-else class="text-center text-muted py-5">
                No players found. Add players in the first tab.
            </div>
        </div>
    `
};