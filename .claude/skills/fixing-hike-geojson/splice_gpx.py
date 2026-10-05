#!/usr/bin/env python3
"""Replace a section of an openrouteservice hike GeoJSON with the recorded GPX track.

Usage:
  python3 splice_gpx.py <slug> <lat1>,<lon1> <lat2>,<lon2> [--eps M] [--dry-run]

The two points bound the section (order along the route doesn't matter). The
section's inner vertices are replaced by GPX points, thinned with 3D RDP so the
point spacing matches the rest of the file (or with --eps metres). GPX elevation
is offset-corrected so both joins meet the GeoJSON's DEM values. Steps inside
the section become one instruction-less step per segment; every index
(way_points, steps, extras) after the section is shifted.
"""
import argparse, json, math, re, statistics, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / 'static/_projects/data-viz/hikes'


def hav(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def length(seq):
    return sum(hav(a, b) for a, b in zip(seq, seq[1:]))


def updown(seq):
    up = sum(max(b[2] - a[2], 0) for a, b in zip(seq, seq[1:]))
    down = sum(max(a[2] - b[2], 0) for a, b in zip(seq, seq[1:]))
    return up, down


def rdp(pts, eps):
    """3D Douglas-Peucker in metres, so elevation peaks survive thinning."""
    lat0 = math.radians(pts[0][1])
    X = [(q[0] * 111320 * math.cos(lat0), q[1] * 111320, q[2]) for q in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = X[i], X[j]
        v = [b[k] - a[k] for k in range(3)]
        L = sum(c * c for c in v) or 1e-9
        best, bi = 0, None
        for k in range(i + 1, j):
            w = [X[k][m] - a[m] for m in range(3)]
            t = max(0, min(1, sum(w[m] * v[m] for m in range(3)) / L))
            d = math.dist(X[k], [a[m] + t * v[m] for m in range(3)])
            if d > best:
                best, bi = d, k
        if bi is not None and best > eps:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [q for q, k in zip(pts, keep) if k]


def nearest(seq, P, lo=0):
    """Index (>= lo) of the point in seq nearest to P=(lon, lat), and its distance."""
    i = min(range(lo, len(seq)), key=lambda k: hav(seq[k], P))
    return i, hav(seq[i], P)


def passes(seq, P, radius=30):
    """Best index of every separate pass of seq near P (a route can pass a point twice)."""
    best = {}
    run = -1
    for k, q in enumerate(seq):
        d = hav(q, P)
        if d > radius:
            continue
        if run < 0 or k - best[run][0] > 5:
            run = k
        if run not in best or d < best[run][1]:
            best[run] = (k, d)
    found = list(best.values()) or [nearest(seq, P)]
    top = min(d for _, d in found)
    return [(k, d) for k, d in found if d <= top + 10]  # drop passes clearly further away


def bracket(seq, A, B, name, forced=None, ordered=False):
    """Indices (i < j) of A and B on seq, and the snap distances. forced = 'i:j' overrides.
    ordered: prefer passes where A comes before B (same direction as the caller's track)."""
    if forced:
        i, j = map(int, forced.split(':'))
        return i, j, hav(seq[i], A), hav(seq[j], B)
    pa, pb = passes(seq, A), passes(seq, B)
    pairs = [(a, b) for a in pa for b in pb if a[0] != b[0]]
    if ordered and any(a[0] < b[0] for a, b in pairs):
        pairs = [(a, b) for a, b in pairs if a[0] < b[0]]
    (i, di), (j, dj) = min(pairs, key=lambda ab: abs(ab[0][0] - ab[1][0]))
    if len(pa) > 1 or len(pb) > 1:
        print(f'WARNING: {name} passes a bounding point more than once '
              f'(A at {[k for k, _ in pa]}, B at {[k for k, _ in pb]}); using the shortest span. '
              f'Override with --{name.lower()}-range i:j if that is the wrong pass.')
    return (i, j, di, dj) if i < j else (j, i, dj, di)


def steepness(a, b):
    """openrouteservice steepness class from the grade between two points."""
    h = hav(a, b)
    g = 0 if h == 0 else (b[2] - a[2]) / h * 100
    s = abs(g)
    k = 0 if s < 1 else 1 if s < 4 else 2 if s < 7 else 3 if s < 10 else 4 if s < 16 else 5
    return k if g >= 0 else -k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('slug')
    ap.add_argument('a'); ap.add_argument('b')
    ap.add_argument('--eps', type=float, help='RDP tolerance in metres (default: auto-match spacing)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--geojson-range', help='force GeoJSON indices i:j of the section ends')
    ap.add_argument('--gpx-range', help='force GPX trkpt indices i:j of the section ends')
    ap.add_argument('--root', type=Path, default=ROOT, help='hikes data dir (holds geojson/ and gpx/)')
    args = ap.parse_args()

    geo_path = args.root / 'geojson' / f'{args.slug}.json'
    gpx_path = args.root / 'gpx' / f'{args.slug}.gpx'
    d = json.loads(geo_path.read_text())
    f = next(x for x in d['features'] if x['geometry']['type'] == 'LineString')
    p, c = f['properties'], f['geometry']['coordinates']
    gpx = [(float(lo), float(la), float(e)) for la, lo, e in re.findall(
        r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)">\s*<ele>([-\d.]+)</ele>', gpx_path.read_text())]
    if not gpx:
        sys.exit('GPX has no trkpt with <ele>')

    A, B = [tuple(map(float, s.split(',')))[::-1] for s in (args.a, args.b)]  # -> (lon, lat)
    S, E, dA, dB = bracket(c, A, B, 'GeoJSON', args.geojson_range)
    gs, ge, gA, gB = bracket(gpx, c[S], c[E], 'GPX', args.gpx_range, ordered=True)
    if hav(gpx[gs], c[S]) > hav(gpx[gs], c[E]):
        gpx = gpx[::-1]  # GPX recorded in the opposite direction to the route
        gs, ge = len(gpx) - 1 - ge, len(gpx) - 1 - gs
    print(f'GeoJSON {S}..{E} (snap {dA:.1f} m / {dB:.1f} m), GPX {gs}..{ge} (snap {gA:.1f} m / {gB:.1f} m)')
    if max(dA, dB, gA, gB) > 50:
        sys.exit('A bounding point is >50 m from a track; check the coordinates.')

    sec = gpx[gs:ge + 1]
    sec = [q for i, q in enumerate(sec) if i == 0 or q[:2] != sec[i - 1][:2]]

    # Match the spacing of the untouched part of the file.
    rest = c[:S + 1] + c[E:]
    target = statistics.mean(hav(a, b) for a, b in zip(rest, rest[1:]) if hav(a, b) < 1000)
    if args.eps:
        eps = args.eps
    else:
        def spacing(e):
            r = rdp(sec, e)
            return length(r) / (len(r) - 1)
        eps = min((e / 2 for e in range(1, 41)), key=lambda e: abs(spacing(e) - target))
    new = rdp(sec, eps)[1:-1]

    # Remove the GPX's elevation offset, blended linearly between the two joins.
    chain = [c[S]] + new + [c[E]]
    cum = [0]
    for a, b in zip(chain, chain[1:]):
        cum.append(cum[-1] + hav(a, b))
    o0, o1 = sec[0][2] - c[S][2], sec[-1][2] - c[E][2]
    new = [[round(q[0], 6), round(q[1], 6), round(q[2] - (o0 + (o1 - o0) * cum[i + 1] / cum[-1]), 1)]
           for i, q in enumerate(new)]
    nc = c[:S + 1] + new + c[E:]
    delta = len(new) - (E - S - 1)
    E2 = E + delta
    print(f'eps {eps} m: {E - S - 1} -> {len(new)} points, mean spacing {cum[-1] / (len(new) + 1):.1f} m '
          f'(file {target:.1f} m), length {length(c[S:E + 1]):.0f} -> {cum[-1]:.0f} m, '
          f'elevation offset {o0:+.1f} / {o1:+.1f} m')
    if args.dry_run:
        return

    def sh(i):
        return i + delta if i >= E else i

    # Via points strictly inside the section move to the nearest new vertex.
    wp = []
    for i in p.get('way_points', []):
        if S < i < E:
            i = nearest(nc, c[i], S)[0]
            i = min(max(i, S + 1), E2 - 1)
        else:
            i = sh(i)
        wp.append(i)
    old_wp = p.get('way_points', [])
    p['way_points'] = wp

    # Rebuild steps: clip steps that straddle the section, collapse the inside to one bare step per segment.
    tot_dist = tot_dur = 0.0
    for si, seg in enumerate(p.get('segments', [])):
        s0, s1 = old_wp[si], old_wp[si + 1]
        n0, n1 = wp[si], wp[si + 1]
        if s1 <= S or s0 >= E:
            for st in seg['steps']:
                st['way_points'] = [sh(i) for i in st['way_points']]
            tot_dist += seg['distance']; tot_dur += seg['duration']
            continue
        out, gone_dist, gone_dur = [], 0.0, 0.0
        for st in seg['steps']:
            a, b = st['way_points']
            full = length(c[a:b + 1]) or 1e-9
            if b <= S or a >= E or a == b:
                if not (a == b and S < a < E):
                    st['way_points'] = [sh(a), sh(b)]
                    out.append(st)
                continue
            keep = length(c[a:max(a, S) + 1]) + length(c[min(b, E):b + 1])
            frac = keep / full
            gone_dist += st['distance'] * (1 - frac); gone_dur += st['duration'] * (1 - frac)
            if a < S:
                out.append({**st, 'distance': round(st['distance'] * length(c[a:S + 1]) / full, 3),
                            'duration': round(st['duration'] * length(c[a:S + 1]) / full, 1), 'way_points': [a, S]})
            if b > E:
                out.append({**st, 'distance': round(st['distance'] * length(c[E:b + 1]) / full, 3),
                            'duration': round(st['duration'] * length(c[E:b + 1]) / full, 1),
                            'way_points': [E2, sh(b)]})
        lo, hi = max(n0, S), min(n1, E2)
        nd = length(nc[lo:hi + 1]) / 1000
        od = length(c[max(s0, S):min(s1, E) + 1]) / 1000
        ndur = round(gone_dur * nd / (gone_dist or od or 1e-9), 1)
        out.append({'distance': round(nd, 3), 'duration': ndur, 'type': 6,
                    'instruction': '', 'name': '-', 'way_points': [lo, hi]})
        out.sort(key=lambda st: (st['way_points'][0], st['way_points'][1] == st['way_points'][0]))
        seg['steps'] = out
        seg['distance'] = round(seg['distance'] - gone_dist + nd, 3)
        seg['duration'] = round(seg['duration'] - gone_dur + ndur, 1)
        ou, odn = updown(c[s0:s1 + 1]); nu, ndn = updown(nc[n0:n1 + 1])
        if 'ascent' in seg:
            seg['ascent'] += nu - ou; seg['descent'] += ndn - odn
        tot_dist += seg['distance']; tot_dur += seg['duration']

    ou, odn = updown(c); nu, ndn = updown(nc)
    if 'ascent' in p:
        p['ascent'] = round(p['ascent'] + nu - ou, 1); p['descent'] = round(p['descent'] + ndn - odn, 1)
    if 'summary' in p and p.get('segments'):
        p['summary']['distance'] = round(tot_dist, 3); p['summary']['duration'] = tot_dur

    # extras: shift ranges, mark the new section unknown (0); steepness is recomputed.
    for name, ex in p.get('extras', {}).items():
        out = []
        for a, b, v in ex['values']:
            for lo, hi in ((a, min(b, S)), (max(a, E), b)):
                if lo < hi:
                    out.append([sh(lo), sh(hi), v])
        if name == 'steepness':
            mid = []
            for i in range(S, E2):
                v = steepness(nc[i], nc[i + 1])
                if mid and mid[-1][2] == v:
                    mid[-1][1] = i + 1
                else:
                    mid.append([i, i + 1, v])
        else:
            mid = [[S, E2, 0]]
        merged = []
        for r in sorted(out + mid):
            if merged and merged[-1][2] == r[2] and merged[-1][1] == r[0]:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        ex['values'] = merged

    f['geometry']['coordinates'] = nc
    geo_path.write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {geo_path}: {len(nc)} points, '
          f"ascent {p.get('ascent')}, descent {p.get('descent')}, distance {p.get('summary', {}).get('distance')} km")


if __name__ == '__main__':
    main()
