// Road network graph built from the real OSM street polylines: routing (A*) & traffic paths.
import { RK } from './world.js';
import { Grid } from './geo.js';

export class RoadGraph {
  /**
   * @param roads world.roads
   * @param mode 'walk' (all ways, both directions) | 'drive' (car roads, respects one-way)
   */
  constructor(roads, mode = 'walk') {
    this.mode = mode;
    this.x = []; this.z = []; this.y = []; this.adj = [];
    this.keyMap = new Map();
    this.grid = new Grid(50);
    for (const r of roads) {
      if (mode === 'drive' && (r.k >= RK.service || r.k === RK.foot)) continue;
      const p = r.p, n = p.length / 2;
      let prev = -1;
      for (let i = 0; i < n; i++) {
        const y = r.ys ? r.ys[i] : 0.15;
        const id = this.node(p[i * 2], p[i * 2 + 1], y, !!r.heightFn);
        if (prev >= 0 && prev !== id) {
          const len = Math.hypot(this.x[id] - this.x[prev], this.z[id] - this.z[prev]);
          const e = { a: prev, b: id, len, r };
          this.adj[prev].push({ ...e, to: id, fwd: true });
          if (mode === 'walk' || !r.ow) this.adj[id].push({ ...e, to: prev, fwd: false });
        }
        prev = id;
      }
    }
    for (let i = 0; i < this.x.length; i++) this.grid.addBox(i, this.x[i], this.z[i], this.x[i], this.z[i]);
  }

  node(x, z, y, elevated) {
    // vertices at the same spot are the same junction (OSM shares nodes between ways).
    // Elevated decks are kept apart from roads below unless at the same height.
    const k = Math.round(x * 2) + ',' + Math.round(z * 2) + (elevated && y > 2 ? ',e' + Math.round(y) : '');
    let id = this.keyMap.get(k);
    if (id === undefined) { id = this.x.length; this.keyMap.set(k, id); this.x.push(x); this.z.push(z); this.y.push(y); this.adj.push([]); }
    return id;
  }

  nearest(x, z, maxR = 400, filter) {
    let best = -1, bd = 1e18;
    for (let r = 50; r <= maxR && best < 0; r *= 2) {
      for (const i of this.grid.queryRadius(x, z, r)) {
        if (!this.adj[i].length || (filter && !filter(i))) continue;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  // A* shortest path. Returns {nodes, edges, pts:[x,y,z...], length} or null
  route(sx, sz, tx, tz) {
    const s = this.nearest(sx, sz), t = this.nearest(tx, tz);
    if (s < 0 || t < 0) return null;
    const N = this.x.length;
    const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), fromE = new Array(N);
    const closed = new Uint8Array(N);
    const h = (i) => Math.hypot(this.x[i] - this.x[t], this.z[i] - this.z[t]);
    const heap = new MinHeap();
    g[s] = 0; heap.push(s, h(s));
    while (heap.size) {
      const u = heap.pop();
      if (u === t) break;
      if (closed[u]) continue; closed[u] = 1;
      for (const e of this.adj[u]) {
        // prefer footpaths & quiet streets a little less than main roads for walking? keep pure distance
        const cost = e.len * (this.mode === 'drive' ? (e.r.k <= RK.secondary ? 0.8 : e.r.k <= RK.tertiary ? 0.9 : 1.1) : 1);
        const ng = g[u] + cost;
        if (ng < g[e.to]) { g[e.to] = ng; from[e.to] = u; fromE[e.to] = e; heap.push(e.to, ng + h(e.to)); }
      }
    }
    if (s !== t && from[t] < 0) return null;
    const nodes = [], edges = [];
    for (let c = t; c >= 0; c = from[c]) { nodes.push(c); if (fromE[c]) edges.push(fromE[c]); if (c === s) break; }
    nodes.reverse(); edges.reverse();
    const pts = []; let length = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; pts.push(this.x[n], this.y[n], this.z[n]);
      if (i) length += Math.hypot(this.x[n] - this.x[nodes[i - 1]], this.z[n] - this.z[nodes[i - 1]]);
    }
    return { nodes, edges, pts, length, steps: this.steps(nodes, edges) };
  }

  // turn-by-turn: where the street name changes or the path turns sharply
  steps(nodes, edges) {
    const out = []; let acc = 0;
    for (let i = 1; i < nodes.length - 1; i++) {
      const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
      acc += Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]);
      const ax = this.x[b] - this.x[a], az = this.z[b] - this.z[a], bx = this.x[c] - this.x[b], bz = this.z[c] - this.z[b];
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      const cos = (ax * bx + az * bz) / la / lb, cross = (ax * bz - az * bx) / la / lb;
      const nameChange = edges[i] && edges[i - 1] && edges[i].r.ni !== edges[i - 1].r.ni && edges[i].r.ni !== undefined;
      if (cos < 0.75 || (nameChange && cos < 0.97)) {
        out.push({ node: b, at: acc, dir: cos > 0.95 ? 'straight' : cross > 0 ? 'right' : 'left', ni: edges[i] ? edges[i].r.ni : undefined, sharp: cos < 0.2 });
      }
    }
    return out;
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(item, pri) {
    const k = this.k, v = this.v; let i = k.length; k.push(item); v.push(pri);
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= v[i]) break;[k[p], k[i]] = [k[i], k[p]];[v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop() {
    const k = this.k, v = this.v, top = k[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && v[l] < v[m]) m = l; if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;[k[m], k[i]] = [k[i], k[m]];[v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}
