#!/bin/sh
# Test fixture: stands in for a misbehaving forge614-engines binary that
# writes non-JSON to stdout and exits 0. Used to exercise the
# ENGINES_RESPONSE_INVALID path in resolveHeadlessCommand without relying on
# the real binary ever actually misbehaving.
echo "not valid json {{{ this is not parseable"
exit 0
