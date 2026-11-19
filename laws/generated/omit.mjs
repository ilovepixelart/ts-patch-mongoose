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

function $unsafe(_k_0) {
  if (_k_0 == 0) {
    return false;
  } else if (_k_0 == 1) {
    return true;
  } else if (_k_0 == 2) {
    return true;
  } else {
    return false;
  }
}

function $or_pick(_a_0, _b_0) {
  if (_a_0) {
    return true;
  } else {
    return _b_0;
  }
}

function $is_top_path(_p_0, _k_0) {
  if (_p_0.$ === "Nil") {
    return false;
  } else {
    const _h_0 = _p_0["head"];
    const _t_0 = _p_0["tail"];
    if (_t_0.$ === "Nil") {
      return $Nat_is_eq(_h_0, _k_0);
    } else {
      return false;
    }
  }
}

function $is_top(_keys_0, _k_0) {
  if (_keys_0.$ === "Nil") {
    return false;
  } else {
    const _p_0 = _keys_0["head"];
    const _rest_0 = _keys_0["tail"];
    return $or_pick($$is_top_path(_p_0, _k_0), $$is_top(_rest_0, _k_0));
  }
}

function $nested_pick(_take_0, _tail_0, _rest_0) {
  if (_take_0) {
    return {$: "Con", "head": _tail_0, "tail": _rest_0};
  } else {
    return _rest_0;
  }
}

function $nested_path(_p_0, _k_0, _rest_0) {
  if (_p_0.$ === "Nil") {
    return _rest_0;
  } else {
    const _h_0 = _p_0["head"];
    const _t_0 = _p_0["tail"];
    if (_t_0.$ === "Nil") {
      return _rest_0;
    } else {
      const _x_0 = _t_0["head"];
      const _xs_0 = _t_0["tail"];
      return $nested_pick($$Bool_and($$Nat_is_eq(_h_0, _k_0), $$Bool_not($$unsafe(_h_0))), {$: "Con", "head": _x_0, "tail": _xs_0}, _rest_0);
    }
  }
}

function $nested(_keys_0, _k_0) {
  if (_keys_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _p_0 = _keys_0["head"];
    const _rest_0 = _keys_0["tail"];
    return $nested_path(_p_0, _k_0, $$nested(_rest_0, _k_0));
  }
}

function $child_pick(_below_0, _keys_0) {
  if (_below_0.$ === "Nil") {
    return _keys_0;
  } else {
    const _p_0 = _below_0["head"];
    const _ps_0 = _below_0["tail"];
    return {$: "Con", "head": _p_0, "tail": _ps_0};
  }
}

function $child_keys(_keys_0, _k_0) {
  return $child_pick($$nested(_keys_0, _k_0), _keys_0);
}

function $unwrap_t(_n_0) {
  if (_n_0.$ === "T") {
    const _t_0 = _n_0["t"];
    return _t_0;
  } else if (_n_0.$ === "Fs") {
    return {$: "Leaf", "v": 0};
  } else {
    return {$: "Leaf", "v": 0};
  }
}

function $unwrap_fs(_n_0) {
  if (_n_0.$ === "T") {
    return {$: "Nil"};
  } else if (_n_0.$ === "Fs") {
    const _fs_0 = _n_0["fs"];
    return _fs_0;
  } else {
    return {$: "Nil"};
  }
}

function $unwrap_ts(_n_0) {
  if (_n_0.$ === "T") {
    return {$: "Nil"};
  } else if (_n_0.$ === "Fs") {
    return {$: "Nil"};
  } else {
    const _ts_0 = _n_0["ts"];
    return _ts_0;
  }
}

function $keep_pick(_omit_0, _field_0, _rest_0) {
  if (_omit_0) {
    return _rest_0;
  } else {
    return {$: "Con", "head": _field_0, "tail": _rest_0};
  }
}

function $go(_fuel_0, _n_0, _keys_0) {
  if (_fuel_0 == 0) {
    return _n_0;
  } else {
    const _f_0 = (_fuel_0 - 1);
    if (_n_0.$ === "T") {
      const _t_0 = _n_0["t"];
      if (_t_0.$ === "Leaf") {
        const _v_0 = _t_0["v"];
        return {$: "T", "t": {$: "Leaf", "v": _v_0}};
      } else if (_t_0.$ === "Obj") {
        const _fs_0 = _t_0["fs"];
        return {$: "T", "t": {$: "Obj", "fs": $$unwrap_fs($$go(_f_0, {$: "Fs", "fs": _fs_0}, _keys_0))}};
      } else {
        const _xs_0 = _t_0["xs"];
        return {$: "T", "t": {$: "Arr", "xs": $$unwrap_ts($$go(_f_0, {$: "Ts", "ts": _xs_0}, _keys_0))}};
      }
    } else if (_n_0.$ === "Fs") {
      const _t_1 = _n_0["fs"];
      if (_t_1.$ === "Nil") {
        return {$: "Fs", "fs": {$: "Nil"}};
      } else {
        const _t_2 = _t_1["head"];
        const _k_0 = _t_2["k"];
        const _t_3 = _t_2["t"];
        const _rest_0 = _t_1["tail"];
        return {$: "Fs", "fs": $$keep_pick($$is_top(_keys_0, _k_0), {$: "F", "k": _k_0, "t": $$unwrap_t($$go(_f_0, {$: "T", "t": _t_3}, $$child_keys(_keys_0, _k_0)))}, $$unwrap_fs($$go(_f_0, {$: "Fs", "fs": _rest_0}, _keys_0)))};
      }
    } else {
      const _t_4 = _n_0["ts"];
      if (_t_4.$ === "Nil") {
        return {$: "Ts", "ts": {$: "Nil"}};
      } else {
        const _t_5 = _t_4["head"];
        const _rest_1 = _t_4["tail"];
        return {$: "Ts", "ts": {$: "Con", "head": $$unwrap_t($$go(_f_0, {$: "T", "t": _t_5}, _keys_0)), "tail": $$unwrap_ts($$go(_f_0, {$: "Ts", "ts": _rest_1}, _keys_0))}};
      }
    }
  }
}

function $omit(_fuel_0, _t_0, _keys_0) {
  return $unwrap_t($$go(_fuel_0, {$: "T", "t": _t_0}, _keys_0));
}

function $with_path(_u_0, _x_0, _xs_0, _keys_0) {
  return {$: "Con", "head": {$: "Con", "head": _u_0, "tail": {$: "Con", "head": _x_0, "tail": _xs_0}}, "tail": _keys_0};
}

function $example() {
  return $omit(100, {$: "Obj", "fs": {$: "Con", "head": {$: "F", "k": 5, "t": {$: "Leaf", "v": 1}}, "tail": {$: "Con", "head": {$: "F", "k": 6, "t": {$: "Obj", "fs": {$: "Con", "head": {$: "F", "k": 5, "t": {$: "Leaf", "v": 2}}, "tail": {$: "Con", "head": {$: "F", "k": 7, "t": {$: "Leaf", "v": 3}}, "tail": {$: "Nil"}}}}}, "tail": {$: "Con", "head": {$: "F", "k": 8, "t": {$: "Arr", "xs": {$: "Con", "head": {$: "Obj", "fs": {$: "Con", "head": {$: "F", "k": 5, "t": {$: "Leaf", "v": 4}}, "tail": {$: "Nil"}}}, "tail": {$: "Nil"}}}}, "tail": {$: "Nil"}}}}}, {$: "Con", "head": {$: "Con", "head": 5, "tail": {$: "Nil"}}, "tail": {$: "Con", "head": {$: "Con", "head": 6, "tail": {$: "Con", "head": 7, "tail": {$: "Nil"}}}, "tail": {$: "Nil"}}});
}

function $Nat_is_eq(_a_0, _b_0) {
  return $Cmp_is_eq(cmp_new(_a_0, _b_0));
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

function $Bool_not(_b_0) {
  if (!_b_0) {
    return true;
  } else {
    return false;
  }
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

const $$is_top_path = $is_top_path;
const $$is_top = $is_top;
const $$Nat_is_eq = $Nat_is_eq;
const $$unsafe = $unsafe;
const $$Bool_not = $Bool_not;
const $$Bool_and = $Bool_and;
const $$nested = $nested;
const $$go = $go;
const $$unwrap_fs = $unwrap_fs;
const $$unwrap_ts = $unwrap_ts;
const $$child_keys = $child_keys;
const $$unwrap_t = $unwrap_t;
const $$keep_pick = $keep_pick;export default {
  "unsafe": run_lib((a0) => run_loop($unsafe(nat_in(a0))), 1),
  "or_pick": run_lib((a0,a1) => run_loop($or_pick(a0,a1)), 2),
  "is_top_path": run_lib((a0,a1) => run_loop($is_top_path(a0,nat_in(a1))), 2),
  "is_top": run_lib((a0,a1) => run_loop($is_top(a0,nat_in(a1))), 2),
  "nested_pick": run_lib((a0,a1,a2) => run_loop($nested_pick(a0,a1,a2)), 3),
  "nested_path": run_lib((a0,a1,a2) => run_loop($nested_path(a0,nat_in(a1),a2)), 3),
  "nested": run_lib((a0,a1) => run_loop($nested(a0,nat_in(a1))), 2),
  "child_pick": run_lib((a0,a1) => run_loop($child_pick(a0,a1)), 2),
  "child_keys": run_lib((a0,a1) => run_loop($child_keys(a0,nat_in(a1))), 2),
  "unwrap_t": run_lib((a0) => run_loop($unwrap_t(a0)), 1),
  "unwrap_fs": run_lib((a0) => run_loop($unwrap_fs(a0)), 1),
  "unwrap_ts": run_lib((a0) => run_loop($unwrap_ts(a0)), 1),
  "keep_pick": run_lib((a0,a1,a2) => run_loop($keep_pick(a0,a1,a2)), 3),
  "go": run_lib((a0,a1,a2) => run_loop($go(nat_in(a0),a1,a2)), 3),
  "omit": run_lib((a0,a1,a2) => run_loop($omit(nat_in(a0),a1,a2)), 3),
  "with_path": run_lib((a0,a1,a2,a3) => run_loop($with_path(nat_in(a0),nat_in(a1),a2,a3)), 4),
  "example": run_lib(() => run_loop($example()), 0),
};
