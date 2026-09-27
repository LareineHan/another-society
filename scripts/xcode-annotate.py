#!/usr/bin/env python3
"""Pass xcodebuild / swift output through unchanged and turn compiler/test errors into GitHub
annotations. GitHub keeps ~10 error annotations per step, so errors are grouped per file."""
import os, re, sys
from collections import OrderedDict

ws = os.environ.get("GITHUB_WORKSPACE", "") + "/"
pat = re.compile(r"^(/[^:]+?):(\d+)(?::(\d+))?: (?:fatal )?error: (.+)$")
bare = re.compile(r"^(?:error|fatal error): (.+)$")
by_file: "OrderedDict[str, list]" = OrderedDict()
loose = []
seen = set()
summaries = []
skipped = []
for raw in sys.stdin:
    sys.stdout.write(raw)
    line = raw.rstrip("\n")
    m = pat.match(line)
    if m:
        path, ln, col, msg = m.group(1), m.group(2), m.group(3) or "1", m.group(4)
        rel = path[len(ws):] if path.startswith(ws) else path
        key = (rel, ln, msg)
        if key in seen:
            continue
        seen.add(key)
        by_file.setdefault(rel, []).append((int(ln), int(col), msg))
        continue
    if re.search(r"Executed \d+ tests?, with \d+ failures?", line) and line not in summaries:
        summaries.append(line.strip())
    if " skipped" in line and ("Test Case" in line or "Test case" in line):
        skipped.append(line.strip())
    b = bare.match(line.strip())
    if b and b.group(1) not in loose:
        loose.append(b.group(1))

def esc(s: str) -> str:
    return s.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")

files = list(by_file.items())
for rel, errs in files[:8]:
    first = errs[0]
    body = "\n".join(f"L{l}:{c} {m}" for l, c, m in errs[:40])
    print(f"::error file={rel},line={first[0]},col={first[1]},title={len(errs)} error(s)::{esc(body)}")
if len(files) > 8:
    rest = "\n".join(f"{rel}: " + " | ".join(f"L{l} {m}" for l, _, m in errs[:6]) for rel, errs in files[8:])
    print(f"::error title=more files::{esc(rest)}")
if loose:
    print(f"::error title=other errors::{esc(chr(10).join(loose[:30]))}")
if summaries:
    print(f"::notice title=test summary::{esc(chr(10).join(summaries[-4:]))}")
if skipped:
    print(f"::warning title=skipped tests::{esc(chr(10).join(skipped[:20]))}")
