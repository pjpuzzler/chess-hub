// Starts /api/init while the app bundle is still loading (a classic script,
// so it runs before the module). The app takes this response once; any
// failure falls back to a normal request. open=1: this is the expanded view
// (starts a puzzle's solve clock; the feed card's init does not).
globalThis.chessHubInit = fetch('/api/init?open=1').catch(() => null);
