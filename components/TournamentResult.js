const TournamentResult = {
    props: ['data', 'selected', 'dialog'],
    setup(props) {
        const { computed } = Vue;

        const teamStandings = computed(() => {
            const teams = props.data?.tournament?.teams || [];
            const games = props.data?.tournament?.games || [];
            const allPlayers = props.data?.players || [];

            const teamScores = {};
            const teamWins = {};
            const teamPlayed = {};

            teams.forEach(t => {
                teamScores[t.id] = 0;
                teamWins[t.id] = 0;
                teamPlayed[t.id] = 0;
            });

            games.forEach(round => {
                if (!round.games) return;
                round.games.forEach(game => {
                    if (game.status !== 'finished') return;
                    const aTeam = game.pairA.teamId;
                    const bTeam = game.pairB.teamId;
                    const sA = game.scoreA || 0;
                    const sB = game.scoreB || 0;

                    if (aTeam) {
                        teamScores[aTeam] = (teamScores[aTeam] || 0) + sA;
                        teamPlayed[aTeam] = (teamPlayed[aTeam] || 0) + 1;
                        if (sA > sB) teamWins[aTeam] = (teamWins[aTeam] || 0) + 1;
                    }
                    if (bTeam) {
                        teamScores[bTeam] = (teamScores[bTeam] || 0) + sB;
                        teamPlayed[bTeam] = (teamPlayed[bTeam] || 0) + 1;
                        if (sB > sA) teamWins[bTeam] = (teamWins[bTeam] || 0) + 1;
                    }
                });
            });

            return teams.map(team => {
                const members = (team.players || [])
                    .map(id => allPlayers.find(p => p.id === id))
                    .filter(Boolean);
                return {
                    ...team,
                    totalScore: teamScores[team.id] || 0,
                    wins: teamWins[team.id] || 0,
                    played: teamPlayed[team.id] || 0,
                    members
                };
            }).sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return b.totalScore - a.totalScore;
            });
        });

        return { teamStandings };
    },
    template: `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h4 class="card-title text-success mb-0"><i class="bi bi-trophy"></i> Tournament Standings</h4>
        </div>

        <div v-if="teamStandings.length === 0" class="text-center text-muted py-5">
            <i class="bi bi-trophy display-4"></i>
            <p class="mt-2">No teams found. Set up teams in the Teams tab first.</p>
        </div>

        <div v-else>
            <div v-for="(team, index) in teamStandings" :key="team.id"
                 class="card mb-3 shadow-sm"
                 :class="index === 0 && team.played > 0 ? 'border-warning border-3' : ''">
                <div class="card-header d-flex justify-content-between align-items-center"
                     :class="team.color === 'warning' ? 'bg-warning text-dark' : 'bg-' + (team.color || 'primary') + ' text-white'">
                    <div class="d-flex align-items-center">
                        <span v-if="index === 0 && team.played > 0" class="me-2">
                            <i class="bi bi-trophy-fill text-warning fs-5"></i>
                        </span>
                        <span v-else-if="index === 1 && team.played > 0" class="me-2">
                            <i class="bi bi-trophy-fill fs-5" style="opacity:0.8"></i>
                        </span>
                        <span v-else-if="index === 2 && team.played > 0" class="me-2">
                            <i class="bi bi-trophy fs-5" style="opacity:0.8"></i>
                        </span>
                        <span v-else class="me-2 fw-bold">{{ index + 1 }}</span>
                        <h5 class="mb-0">{{ team.name }}</h5>
                    </div>
                    <div class="text-end">
                        <span class="badge bg-light text-dark me-1">{{ team.wins }}W / {{ team.played }}P</span>
                        <span class="badge bg-warning text-dark fs-6">{{ team.totalScore }} pts</span>
                    </div>
                </div>
                <div class="card-body p-2">
                    <div class="row g-1">
                        <div v-for="member in team.members" :key="member.id" class="col-6 col-md-4">
                            <div class="d-flex align-items-center p-1 rounded bg-light small">
                                <i v-if="member.gender === 'Female'" class="bi bi-gender-female text-danger me-1 flex-shrink-0"></i>
                                <i v-else class="bi bi-gender-male text-primary me-1 flex-shrink-0"></i>
                                <span class="text-truncate">{{ member.name }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `
};
