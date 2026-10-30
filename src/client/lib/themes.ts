// Human labels for Lichess puzzle themes. Meta tags (length, phase, eval
// bucket, game source) are hidden; only the tactical idea is shown.
const HIDDEN = new Set([
  'short',
  'long',
  'veryLong',
  'oneMove',
  'crushing',
  'advantage',
  'equality',
  'opening',
  'middlegame',
  'endgame',
  'pawnEndgame',
  'knightEndgame',
  'bishopEndgame',
  'rookEndgame',
  'queenEndgame',
  'queenRookEndgame',
  'master',
  'masterVsMaster',
  'superGM',
  'mix',
  'playerGames',
]);

const LABELS: Record<string, string> = {
  advancedPawn: 'Advanced pawn',
  anastasiaMate: 'Anastasia’s mate',
  arabianMate: 'Arabian mate',
  attackingF2F7: 'Attacking f2/f7',
  attraction: 'Attraction',
  backRankMate: 'Back-rank mate',
  balestraMate: 'Balestra mate',
  blindSwineMate: 'Blind swine mate',
  bodenMate: 'Boden’s mate',
  capturingDefender: 'Capture the defender',
  castling: 'Castling',
  clearance: 'Clearance',
  collinearMove: 'Collinear move',
  cornerMate: 'Corner mate',
  defensiveMove: 'Defensive move',
  deflection: 'Deflection',
  discoveredAttack: 'Discovered attack',
  discoveredCheck: 'Discovered check',
  doubleBishopMate: 'Double bishop mate',
  doubleCheck: 'Double check',
  dovetailMate: 'Dovetail mate',
  enPassant: 'En passant',
  epauletteMate: 'Epaulette mate',
  exposedKing: 'Exposed king',
  fork: 'Fork',
  hangingPiece: 'Hanging piece',
  hookMate: 'Hook mate',
  interference: 'Interference',
  intermezzo: 'Intermezzo',
  killBoxMate: 'Kill box mate',
  kingsideAttack: 'Kingside attack',
  mate: 'Checkmate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  mateIn5: 'Mate in 5+',
  morphysMate: 'Morphy’s mate',
  operaMate: 'Opera mate',
  pillsburysMate: 'Pillsbury’s mate',
  pin: 'Pin',
  promotion: 'Promotion',
  queensideAttack: 'Queenside attack',
  quietMove: 'Quiet move',
  sacrifice: 'Sacrifice',
  skewer: 'Skewer',
  smotheredMate: 'Smothered mate',
  swallowstailMate: 'Swallow’s tail mate',
  trappedPiece: 'Trapped piece',
  triangleMate: 'Triangle mate',
  underPromotion: 'Underpromotion',
  vukovicMate: 'Vuković mate',
  xRayAttack: 'X-ray attack',
  zugzwang: 'Zugzwang',
};

const humanize = (t: string) => {
  const words = t
    .replace(/([A-Z0-9])/g, ' $1')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Display labels for a puzzle's themes, mate length first, no duplicates.
export function themeLabels(themes: readonly string[]): string[] {
  const shown = themes.filter((t) => !HIDDEN.has(t));
  const hasMateIn = shown.some((t) => /^mateIn\d$/.test(t));
  const ordered = [
    ...shown.filter((t) => t.startsWith('mateIn')),
    ...shown.filter(
      (t) => !t.startsWith('mateIn') && !(hasMateIn && t === 'mate')
    ),
  ];
  return [...new Set(ordered.map((t) => LABELS[t] ?? humanize(t)))];
}
