#!/usr/bin/env node
// The notes plugin's git server (plugins/notes/server/notes-git-server.mjs), started from here because the installed
// systemd unit names this path.
import { listen } from "../plugins/notes/server/notes-git-server.mjs";

listen();
