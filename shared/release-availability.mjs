// Temporary release boundary: Dots and the console-hosted local MCP lanes stay
// in the tree for later review, but this release does not wire them.
// A literal constant, never an environment/profile/argv value — nothing outside
// this file can reopen it, including a previously set env var or saved flag.
export const MCP_RELEASE_ENABLED = false;
