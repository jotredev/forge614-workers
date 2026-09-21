#!/usr/bin/env bun
// Stands in for a real AI engine CLI reporting a quota/usage-limit failure.
process.stderr.write("Claude AI usage limit reached|1732000000");
process.exit(1);
