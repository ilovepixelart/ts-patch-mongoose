function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}

function u32_to_word(x) {
  let w = {$: "WNil"};
  for (let i = 31; i >= 0; i--) {
    w = {$: "WCon", head: ((x >>> i) & 1) === 1, tail: w};
  }
  return w;
}

function cmp_new(a, b) {
  return {$: a < b ? "LT" : a === b ? "EQ" : "GT"};
}

function tup_new(a, b) {
  return {$: "Tuple", fst: a, snd: b};
}

function nat_divmod(a, b) {
  return tup_new(b && Math.trunc(a / b), b ? a % b : a);
}

function nat_chk(n) {
  if (n > 281474976710655) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}

function nat_in(n) {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 53) {
    throw "bend: expected a Nat host number: an integer from 0 to 2^53";
  }
  return n;
}

function f32_show(x) {
  let s = "nan";
  for (let p = 1; x === x && p <= 9 && f32_round(s) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return (Object.is(x, -0) ? "-0" : s).replace("Infinity", "inf");
}

function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}

function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}

function f32_read(s) {
  const re = /^[\t\n\v\f\r ]*[+-]?((\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  return re.test(s) ? {$: "Some", value: f32_round(
    s.replace(/inf\w*/i, "Infinity"))} : {$: "None"};
}

const f32_round = function f32_round(s) {
  const d = Number(s);
  const a = Math.abs(d);
  const f = Math.fround(a);
  const g = 2 * a - Math.min(f, 2 ** 128);
  if (g === f || Math.fround(g) !== g || g === Infinity) {
    return Math.sign(d) * f;
  }
  let k = 0;
  while (a * 2 ** k % 1 !== 0) {
    k += 1;
  }
  const [, i, r, e] = /(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  const n = Number(e ?? 0) - r.length;
  const x = BigInt(i + r) * 2n ** BigInt(k) * 10n ** BigInt(Math.max(n, 0));
  const y = BigInt(a * 2 ** k) * 10n ** BigInt(Math.max(-n, 0));
  return Math.sign(d) * (x === y || x > y !== g > f ? f : g);
};

const char_new = function char_new(c) {
  return c < 55296 || c >= 57344 && c <= 1114111 ? String.fromCodePoint(c) : String.fromCharCode(56320, c >>> 22, c >>> 11 & 2047, c & 2047);
};

function char_len(s, at = 0) {
  return s[at] === "\uDC00" ? 4 : s.codePointAt(at) > 0xFFFF ? 2 : 1;
}

function char_code(s) {
  return s.length < 4 ? s.codePointAt(0)
    : (s.charCodeAt(1) << 22 | s.charCodeAt(2) << 11 | s.charCodeAt(3)) >>> 0;
}

function string_contains(s, p) {
  // A match starts at a Char, not inside a packed U32 code.
  for (let at = 0; at <= s.length; at += char_len(s, at)) {
    if (s.startsWith(p, at)) {
      return true;
    }
  }
  return false;
}

function str_out(s) {
  return s.replace(/\uDC00[^]{3}/gu, "\uFFFD");
}

function str_in(s) {
  return s.replace(/\p{Cs}/gu, "\uFFFD");
}

// Array
// =====

function array_new(d, v, lgs) {
  if (d > 31 - lgs) {
    throw "bend: an array past the deepest block class 31 (depth + log2 words per cell)";
  }
  return Array(2 ** d).fill(v);
}

function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}

function array_rmw(a, i, f) {
  const old = a[i %= a.length];
  a[i] = f(old);
  return tup_new(a, old);
}

// Run
// ===

function run_tail(f, x) {
  return {$: "$JMP", f: f.j?.f === f ? f.j : f, x};
}

function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}

function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(r.x);
  }
  return r;
}

function run_lib(f, n) {
  return (...a) => a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length)
    : run_loop(f(...a));
}

// Effect
// ======

const $0eff = Object.create(null);
const io_file_append = new Set();

function io_eff(k, run) {
  if (arguments.length > 2) {
    throw new Error("bend: " + k + " takes no need: an effect that waits parks itself");
  }
  if (k in $0eff) {
    throw new Error("bend: two effects register " + k);
  }
  $0eff[k] = run;
}
// Program
// =======

function $lookup_pick(_same_0, _v_0, _rest_0) {
  if (_same_0) {
    return {$: "Some", "value": _v_0};
  } else {
    return _rest_0;
  }
}

function $lookup(_d_0, _k_0) {
  if (_d_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _d_0["head"];
    const _ek_0 = _t_0["k"];
    const _v_0 = _t_0["v"];
    const _t_1 = _d_0["tail"];
    return $lookup_pick($$Nat_is_eq(_ek_0, _k_0), _v_0, $$lookup(_t_1, _k_0));
  }
}

function $del_pick(_same_0, _e_0, _rest_0) {
  if (_same_0) {
    return _rest_0;
  } else {
    return {$: "Con", "head": _e_0, "tail": _rest_0};
  }
}

function $del(_d_0, _k_0) {
  if (_d_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _d_0["head"];
    const _ek_0 = _t_0["k"];
    const _v_0 = _t_0["v"];
    const _t_1 = _d_0["tail"];
    return $del_pick($$Nat_is_eq(_ek_0, _k_0), {$: "E", "k": _ek_0, "v": _v_0}, $$del(_t_1, _k_0));
  }
}

function $step(_d_0, _op_0) {
  if (_op_0.$ === "Put") {
    const _k_0 = _op_0["k"];
    const _v_0 = _op_0["v"];
    return {$: "Con", "head": {$: "E", "k": _k_0, "v": _v_0}, "tail": $$del(_d_0, _k_0)};
  } else {
    const _k_1 = _op_0["k"];
    return $del(_d_0, _k_1);
  }
}

function $apply($0, $1) {
  for (;;) {
    {
      const _ops_0 = $0;
      const _d_0 = $1;
      if (_ops_0.$ === "Nil") {
        return _d_0;
      } else {
        const _op_0 = _ops_0["head"];
        const _t_0 = _ops_0["tail"];
        $0 = _t_0;
        $1 = $$step(_d_0, _op_0);
        continue;
      }
    }
  }
}

function $diff_same(_same_0, _k_0, _w_0) {
  if (_same_0) {
    return {$: "Nil"};
  } else {
    return {$: "Con", "head": {$: "Put", "k": _k_0, "v": _w_0}, "tail": {$: "Nil"}};
  }
}

function $diff_one_pick(_found_0, _k_0, _v_0) {
  if (_found_0.$ === "None") {
    return {$: "Con", "head": {$: "Del", "k": _k_0}, "tail": {$: "Nil"}};
  } else {
    const _w_0 = _found_0["value"];
    return $diff_same($$Nat_is_eq(_v_0, _w_0), _k_0, _w_0);
  }
}

function $diff_source(_a_0, _b_0) {
  if (_a_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _a_0["head"];
    const _k_0 = _t_0["k"];
    const _v_0 = _t_0["v"];
    const _t_1 = _a_0["tail"];
    return $List_append($$diff_one_pick($$lookup(_b_0, _k_0), _k_0, _v_0), $$diff_source(_t_1, _b_0));
  }
}

function $diff_added_pick(_found_0, _k_0, _w_0) {
  if (_found_0.$ === "None") {
    return {$: "Con", "head": {$: "Put", "k": _k_0, "v": _w_0}, "tail": {$: "Nil"}};
  } else {
    return {$: "Nil"};
  }
}

function $diff_added(_b_0, _a_0) {
  if (_b_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _b_0["head"];
    const _k_0 = _t_0["k"];
    const _w_0 = _t_0["v"];
    const _t_1 = _b_0["tail"];
    return $List_append($$diff_added_pick($$lookup(_a_0, _k_0), _k_0, _w_0), $$diff_added(_t_1, _a_0));
  }
}

function $diff(_a_0, _b_0) {
  return $List_append($$diff_source(_a_0, _b_0), $$diff_added(_b_0, _a_0));
}

function $example() {
  const _a_0 = {$: "Con", "head": {$: "E", "k": 1, "v": 10}, "tail": {$: "Con", "head": {$: "E", "k": 2, "v": 20}, "tail": {$: "Con", "head": {$: "E", "k": 3, "v": 30}, "tail": {$: "Nil"}}}};
  const _b_0 = {$: "Con", "head": {$: "E", "k": 2, "v": 21}, "tail": {$: "Con", "head": {$: "E", "k": 3, "v": 30}, "tail": {$: "Con", "head": {$: "E", "k": 4, "v": 40}, "tail": {$: "Nil"}}}};
  return $apply($$diff(_a_0, _b_0), _a_0);
}

function $Nat_is_eq(_a_0, _b_0) {
  return $Cmp_is_eq(cmp_new(_a_0, _b_0));
}

function $List_append(_xs_0, _ys_0) {
  if (_xs_0.$ === "Nil") {
    return _ys_0;
  } else {
    const _h_0 = _xs_0["head"];
    const _t_0 = _xs_0["tail"];
    return {$: "Con", "head": _h_0, "tail": $$List_append(_t_0, _ys_0)};
  }
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

const $$Nat_is_eq = $Nat_is_eq;
const $$lookup = $lookup;
const $$del = $del;
const $$step = $step;
const $$diff_one_pick = $diff_one_pick;
const $$diff_source = $diff_source;
const $$diff_added_pick = $diff_added_pick;
const $$diff_added = $diff_added;
const $$diff = $diff;
const $$List_append = $List_append;export default {
  "lookup_pick": run_lib((a0,a1,a2) => run_loop($lookup_pick(a0,nat_in(a1),a2)), 3),
  "lookup": run_lib((a0,a1) => run_loop($lookup(a0,nat_in(a1))), 2),
  "del_pick": run_lib((a0,a1,a2) => run_loop($del_pick(a0,a1,a2)), 3),
  "del": run_lib((a0,a1) => run_loop($del(a0,nat_in(a1))), 2),
  "step": run_lib((a0,a1) => run_loop($step(a0,a1)), 2),
  "apply": run_lib((a0,a1) => run_loop($apply(a0,a1)), 2),
  "diff_same": run_lib((a0,a1,a2) => run_loop($diff_same(a0,nat_in(a1),nat_in(a2))), 3),
  "diff_one_pick": run_lib((a0,a1,a2) => run_loop($diff_one_pick(a0,nat_in(a1),nat_in(a2))), 3),
  "diff_source": run_lib((a0,a1) => run_loop($diff_source(a0,a1)), 2),
  "diff_added_pick": run_lib((a0,a1,a2) => run_loop($diff_added_pick(a0,nat_in(a1),nat_in(a2))), 3),
  "diff_added": run_lib((a0,a1) => run_loop($diff_added(a0,a1)), 2),
  "diff": run_lib((a0,a1) => run_loop($diff(a0,a1)), 2),
  "example": run_lib(() => run_loop($example()), 0),
};
