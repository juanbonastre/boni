import sys, json, re
t = sys.stdin.read()
m = re.search(r"\[.*\]", t, re.S)
for p in json.loads(m.group(0)):
    print(f"{p['phase']:34} frames={p['frames']:4} p50={p['p50']:5} p95={p['p95']:6} max={p['max']:6} jank={p['jank']}")
