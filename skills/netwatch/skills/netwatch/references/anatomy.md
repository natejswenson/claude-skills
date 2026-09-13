# Report anatomy

The report starts with observed socket flows and baseline coverage, then shows
unrecognized and known entries, PID-specific process counters, and security
observations with their limitations.

Each flow includes process, PID, TCP/UDP, socket kind, local address and port,
peer address and port when present, TCP state, socket count, provider hint, and
source records. Kind is connection, listener, or bound; neither lsof's arrow nor
the remote port proves who initiated a connection.

Only connected peer endpoints match destination baseline rules. Listeners and
bound sockets remain unrecognized. A baseline is a recognition preference,
never an integrity check or safety guarantee.

Report and render support `--pid`, process substring, `--host` pattern,
`--port`, `--proto`, and `--kind`. A filter matching nothing says so. JSON
output retains sources and exact values for host integrations.

The self-contained HTML embeds local CSS and controls; it makes no network
requests and runs no commands. Search/status/kind filters affect flow rows;
headline and per-process totals remain the full rendered dataset. Header buttons
sort columns; native details expand source evidence and observations. Without
JavaScript, all rows and their expandable evidence remain readable.
