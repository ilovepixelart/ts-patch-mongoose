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

function $patch_lookup_pick(_same_0, _v_0, _rest_0) {
  if (_same_0) {
    return {$: "Some", "value": _v_0};
  } else {
    return _rest_0;
  }
}

function $patch_lookup(_d_0, _k_0) {
  if (_d_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _d_0["head"];
    const _ek_0 = _t_0["k"];
    const _v_0 = _t_0["v"];
    const _t_1 = _d_0["tail"];
    return $patch_lookup_pick($$Nat_is_eq(_ek_0, _k_0), _v_0, $$patch_lookup(_t_1, _k_0));
  }
}

function $patch_del_pick(_same_0, _e_0, _rest_0) {
  if (_same_0) {
    return _rest_0;
  } else {
    return {$: "Con", "head": _e_0, "tail": _rest_0};
  }
}

function $patch_del(_d_0, _k_0) {
  if (_d_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _d_0["head"];
    const _ek_0 = _t_0["k"];
    const _v_0 = _t_0["v"];
    const _t_1 = _d_0["tail"];
    return $patch_del_pick($$Nat_is_eq(_ek_0, _k_0), {$: "E", "k": _ek_0, "v": _v_0}, $$patch_del(_t_1, _k_0));
  }
}

function $patch_step(_d_0, _op_0) {
  if (_op_0.$ === "Put") {
    const _k_0 = _op_0["k"];
    const _v_0 = _op_0["v"];
    return {$: "Con", "head": {$: "E", "k": _k_0, "v": _v_0}, "tail": $$patch_del(_d_0, _k_0)};
  } else {
    const _k_1 = _op_0["k"];
    return $patch_del(_d_0, _k_1);
  }
}

function $patch_apply($0, $1) {
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
        $1 = $$patch_step(_d_0, _op_0);
        continue;
      }
    }
  }
}

function $patch_diff_same(_same_0, _k_0, _w_0) {
  if (_same_0) {
    return {$: "Nil"};
  } else {
    return {$: "Con", "head": {$: "Put", "k": _k_0, "v": _w_0}, "tail": {$: "Nil"}};
  }
}

function $patch_diff_one_pick(_found_0, _k_0, _v_0) {
  if (_found_0.$ === "None") {
    return {$: "Con", "head": {$: "Del", "k": _k_0}, "tail": {$: "Nil"}};
  } else {
    const _w_0 = _found_0["value"];
    return $patch_diff_same($$Nat_is_eq(_v_0, _w_0), _k_0, _w_0);
  }
}

function $patch_diff_source(_a_0, _b_0) {
  if (_a_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _a_0["head"];
    const _k_0 = _t_0["k"];
    const _v_0 = _t_0["v"];
    const _t_1 = _a_0["tail"];
    return $List_append($$patch_diff_one_pick($$patch_lookup(_b_0, _k_0), _k_0, _v_0), $$patch_diff_source(_t_1, _b_0));
  }
}

function $patch_diff_added_pick(_found_0, _k_0, _w_0) {
  if (_found_0.$ === "None") {
    return {$: "Con", "head": {$: "Put", "k": _k_0, "v": _w_0}, "tail": {$: "Nil"}};
  } else {
    return {$: "Nil"};
  }
}

function $patch_diff_added(_b_0, _a_0) {
  if (_b_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _b_0["head"];
    const _k_0 = _t_0["k"];
    const _w_0 = _t_0["v"];
    const _t_1 = _b_0["tail"];
    return $List_append($$patch_diff_added_pick($$patch_lookup(_a_0, _k_0), _k_0, _w_0), $$patch_diff_added(_t_1, _a_0));
  }
}

function $patch_diff(_a_0, _b_0) {
  return $List_append($$patch_diff_source(_a_0, _b_0), $$patch_diff_added(_b_0, _a_0));
}

function $patch_example() {
  const _a_0 = {$: "Con", "head": {$: "E", "k": 1, "v": 10}, "tail": {$: "Con", "head": {$: "E", "k": 2, "v": 20}, "tail": {$: "Con", "head": {$: "E", "k": 3, "v": 30}, "tail": {$: "Nil"}}}};
  const _b_0 = {$: "Con", "head": {$: "E", "k": 2, "v": 21}, "tail": {$: "Con", "head": {$: "E", "k": 3, "v": 30}, "tail": {$: "Con", "head": {$: "E", "k": 4, "v": 40}, "tail": {$: "Nil"}}}};
  return $patch_apply($$patch_diff(_a_0, _b_0), _a_0);
}

function $find_pick(_same_0, _doc_0, _rest_0) {
  if (_same_0) {
    return {$: "Some", "value": _doc_0};
  } else {
    return _rest_0;
  }
}

function $find(_store_0, _id_0) {
  if (_store_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _store_0["head"];
    const _rid_0 = _t_0["id"];
    const _doc_0 = _t_0["doc"];
    const _rest_0 = _store_0["tail"];
    return $find_pick($$Nat_is_eq(_rid_0, _id_0), _doc_0, $$find(_rest_0, _id_0));
  }
}

function $remove_pick(_same_0, _r_0, _rest_0) {
  if (_same_0) {
    return _rest_0;
  } else {
    return {$: "Con", "head": _r_0, "tail": _rest_0};
  }
}

function $remove(_store_0, _id_0) {
  if (_store_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _t_0 = _store_0["head"];
    const _rid_0 = _t_0["id"];
    const _doc_0 = _t_0["doc"];
    const _rest_0 = _store_0["tail"];
    return $remove_pick($$Nat_is_eq(_rid_0, _id_0), {$: "R", "id": _rid_0, "doc": _doc_0}, $$remove(_rest_0, _id_0));
  }
}

function $max(_a_0, _b_0) {
  if (_a_0 == 0) {
    return _b_0;
  } else {
    const _x_0 = (_a_0 - 1);
    if (_b_0 == 0) {
      return _a_0;
    } else {
      const _y_0 = (_b_0 - 1);
      return nat_chk($$max(_x_0, _y_0) + 1);
    }
  }
}

function $top_pick(_same_0, _version_0, _rest_0) {
  if (!_same_0) {
    return _rest_0;
  } else {
    if (_rest_0.$ === "None") {
      return {$: "Some", "value": _version_0};
    } else {
      const _v_0 = _rest_0["value"];
      return {$: "Some", "value": $$max(_version_0, _v_0)};
    }
  }
}

function $top_version(_hist_0, _id_0) {
  if (_hist_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _hist_0["head"];
    const _hid_0 = _t_0["id"];
    const _v_0 = _t_0["version"];
    const _rest_0 = _hist_0["tail"];
    return $top_pick($$Nat_is_eq(_hid_0, _id_0), _v_0, $$top_version(_rest_0, _id_0));
  }
}

function $next_version(_top_0) {
  if (_top_0.$ === "None") {
    return 0;
  } else {
    const _v_0 = _top_0["value"];
    return nat_chk(_v_0 + 1);
  }
}

function $append_hist(_hist_0, _h_0) {
  return $List_append(_hist_0, {$: "Con", "head": _h_0, "tail": {$: "Nil"}});
}

function $ops_data(_ops_0) {
  if (_ops_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _o_0 = _ops_0["head"];
    const _os_0 = _ops_0["tail"];
    return {$: "Con", "head": _o_0, "tail": $$ops_data(_os_0)};
  }
}

function $ops_once(_ops_0) {
  if (_ops_0.$ === "Nil") {
    return {$: "Nil"};
  } else {
    const _o_0 = _ops_0["head"];
    const _os_0 = _ops_0["tail"];
    return {$: "Con", "head": _o_0, "tail": $$ops_once(_os_0)};
  }
}

function $when_hist(_b_0, _hist_0, _h_0) {
  if (_b_0) {
    return $append_hist(_hist_0, _h_0);
  } else {
    return _hist_0;
  }
}

function $when_ev(_b_0, _evs_0, _e_0) {
  if (_b_0) {
    return $List_append(_evs_0, {$: "Con", "head": _e_0, "tail": {$: "Nil"}});
  } else {
    return _evs_0;
  }
}

function $skipped(_f_0) {
  const _hook_0 = _f_0["hook"];
  const _event_0 = _f_0["event"];
  const _history_0 = _f_0["history"];
  const _x_0 = $$Bool_and(_event_0, _history_0);
  return (_hook_0 || _x_0);
}

function $writes(_c_0, _f_0) {
  const _history_0 = _c_0["history"];
  const _ignored_0 = _f_0["history"];
  return $Bool_and(_history_0, $$Bool_not(_ignored_0));
}

function $emits(_c_0, _f_0) {
  const _events_0 = _c_0["events"];
  const _ignored_0 = _f_0["event"];
  return $Bool_and(_events_0, $$Bool_not(_ignored_0));
}

function $cfg_history(_c_0) {
  const _history_0 = _c_0["history"];
  return _history_0;
}

function $cfg_events(_c_0) {
  const _events_0 = _c_0["events"];
  return _events_0;
}

function $create_pick(_found_0, _c_0, _id_0, _doc_0, _store_0, _hist_0, _evs_0) {
  if (_found_0.$ === "Some") {
    return {$: "S", "store": _store_0, "hist": _hist_0, "evs": _evs_0};
  } else {
    return {$: "S", "store": {$: "Con", "head": {$: "R", "id": _id_0, "doc": _doc_0}, "tail": _store_0}, "hist": $$when_hist($$cfg_history(_c_0), _hist_0, {$: "H", "kind": {$: "KCreate"}, "id": _id_0, "version": 0, "doc": _doc_0, "patch": {$: "Nil"}}), "evs": $$when_ev($$cfg_events(_c_0), _evs_0, {$: "ECreated", "doc": _doc_0})};
  }
}

function $update_write(_ops_0, _c_0, _f_0, _id_0, _old_0, _doc_0, _store_0, _hist_0, _evs_0) {
  if (_ops_0.$ === "Nil") {
    return {$: "S", "store": {$: "Con", "head": {$: "R", "id": _id_0, "doc": _doc_0}, "tail": $$remove(_store_0, _id_0)}, "hist": _hist_0, "evs": _evs_0};
  } else {
    const _o_0 = _ops_0["head"];
    const _os_0 = _ops_0["tail"];
    return {$: "S", "store": {$: "Con", "head": {$: "R", "id": _id_0, "doc": _doc_0}, "tail": $$remove(_store_0, _id_0)}, "hist": $$when_hist($$writes(_c_0, _f_0), _hist_0, {$: "H", "kind": {$: "KUpdate"}, "id": _id_0, "version": $$next_version($$top_version(_hist_0, _id_0)), "doc": {$: "Nil"}, "patch": {$: "Con", "head": _o_0, "tail": _os_0}}), "evs": $$when_ev($$emits(_c_0, _f_0), _evs_0, {$: "EUpdated", "old": _old_0, "doc": _doc_0, "patch": {$: "Con", "head": _o_0, "tail": _os_0}})};
  }
}

function $update_hook(_skip_0, _c_0, _f_0, _id_0, _old_0, _doc_0, _store_0, _hist_0, _evs_0) {
  if (_skip_0) {
    return {$: "S", "store": {$: "Con", "head": {$: "R", "id": _id_0, "doc": _doc_0}, "tail": $$remove(_store_0, _id_0)}, "hist": _hist_0, "evs": _evs_0};
  } else {
    return $update_write($$ops_data($$patch_diff(_old_0, _doc_0)), _c_0, _f_0, _id_0, _old_0, _doc_0, _store_0, _hist_0, _evs_0);
  }
}

function $update_pick(_found_0, _c_0, _f_0, _id_0, _doc_0, _store_0, _hist_0, _evs_0) {
  if (_found_0.$ === "None") {
    return {$: "S", "store": _store_0, "hist": _hist_0, "evs": _evs_0};
  } else {
    const _old_0 = _found_0["value"];
    return $update_hook($$skipped(_f_0), _c_0, _f_0, _id_0, _old_0, _doc_0, _store_0, _hist_0, _evs_0);
  }
}

function $delete_hook(_skip_0, _c_0, _f_0, _id_0, _old_0, _store_0, _hist_0, _evs_0) {
  if (_skip_0) {
    return {$: "S", "store": $$remove(_store_0, _id_0), "hist": _hist_0, "evs": _evs_0};
  } else {
    return {$: "S", "store": $$remove(_store_0, _id_0), "hist": $$when_hist($$writes(_c_0, _f_0), _hist_0, {$: "H", "kind": {$: "KDelete"}, "id": _id_0, "version": 0, "doc": _old_0, "patch": {$: "Nil"}}), "evs": $$when_ev($$emits(_c_0, _f_0), _evs_0, {$: "EDeleted", "old": _old_0})};
  }
}

function $delete_pick(_found_0, _c_0, _f_0, _id_0, _store_0, _hist_0, _evs_0) {
  if (_found_0.$ === "None") {
    return {$: "S", "store": _store_0, "hist": _hist_0, "evs": _evs_0};
  } else {
    const _old_0 = _found_0["value"];
    return $delete_hook($$skipped(_f_0), _c_0, _f_0, _id_0, _old_0, _store_0, _hist_0, _evs_0);
  }
}

function $step(_c_0, _st_0, _cmd_0) {
  const _store_0 = _st_0["store"];
  const _hist_0 = _st_0["hist"];
  const _evs_0 = _st_0["evs"];
  if (_cmd_0.$ === "Create") {
    const _id_0 = _cmd_0["id"];
    const _doc_0 = _cmd_0["doc"];
    return $create_pick($$find(_store_0, _id_0), _c_0, _id_0, _doc_0, _store_0, _hist_0, _evs_0);
  } else if (_cmd_0.$ === "Update") {
    const _id_1 = _cmd_0["id"];
    const _doc_1 = _cmd_0["doc"];
    const _f_0 = _cmd_0["flags"];
    return $update_pick($$find(_store_0, _id_1), _c_0, _f_0, _id_1, _doc_1, _store_0, _hist_0, _evs_0);
  } else {
    const _id_2 = _cmd_0["id"];
    const _f_1 = _cmd_0["flags"];
    return $delete_pick($$find(_store_0, _id_2), _c_0, _f_1, _id_2, _store_0, _hist_0, _evs_0);
  }
}

function $run($0, $1, $2) {
  for (;;) {
    {
      const _cmds_0 = $0;
      const _c_0 = $1;
      const _st_0 = $2;
      if (_cmds_0.$ === "Nil") {
        return _st_0;
      } else {
        const _cmd_0 = _cmds_0["head"];
        const _cs_0 = _cmds_0["tail"];
        $0 = _cs_0;
        $1 = _c_0;
        $2 = $$step(_c_0, _st_0, _cmd_0);
        continue;
      }
    }
  }
}

function $empty() {
  return {$: "S", "store": {$: "Nil"}, "hist": {$: "Nil"}, "evs": {$: "Nil"}};
}

function $store_of(_st_0) {
  const _store_0 = _st_0["store"];
  return _store_0;
}

function $hist_of(_st_0) {
  const _hist_0 = _st_0["hist"];
  return _hist_0;
}

function $evs_of(_st_0) {
  const _evs_0 = _st_0["evs"];
  return _evs_0;
}

function $none() {
  return {$: "Flags", "hook": false, "event": false, "history": false};
}

function $example() {
  return $run({$: "Con", "head": {$: "Create", "id": 1, "doc": {$: "Con", "head": {$: "E", "k": 1, "v": 10}, "tail": {$: "Nil"}}}, "tail": {$: "Con", "head": {$: "Update", "id": 1, "doc": {$: "Con", "head": {$: "E", "k": 1, "v": 11}, "tail": {$: "Con", "head": {$: "E", "k": 2, "v": 20}, "tail": {$: "Nil"}}}, "flags": $$none()}, "tail": {$: "Con", "head": {$: "Update", "id": 1, "doc": {$: "Con", "head": {$: "E", "k": 1, "v": 11}, "tail": {$: "Con", "head": {$: "E", "k": 2, "v": 20}, "tail": {$: "Nil"}}}, "flags": $$none()}, "tail": {$: "Con", "head": {$: "Create", "id": 2, "doc": {$: "Con", "head": {$: "E", "k": 1, "v": 5}, "tail": {$: "Nil"}}}, "tail": {$: "Con", "head": {$: "Delete", "id": 1, "flags": $$none()}, "tail": {$: "Nil"}}}}}}, {$: "Cfg", "history": true, "events": true}, $$empty());
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

const $$Nat_is_eq = $Nat_is_eq;
const $$patch_lookup = $patch_lookup;
const $$patch_del = $patch_del;
const $$patch_step = $patch_step;
const $$patch_diff_one_pick = $patch_diff_one_pick;
const $$patch_diff_source = $patch_diff_source;
const $$patch_diff_added_pick = $patch_diff_added_pick;
const $$patch_diff_added = $patch_diff_added;
const $$patch_diff = $patch_diff;
const $$find = $find;
const $$remove = $remove;
const $$max = $max;
const $$top_version = $top_version;
const $$ops_data = $ops_data;
const $$ops_once = $ops_once;
const $$Bool_and = $Bool_and;
const $$Bool_not = $Bool_not;
const $$cfg_history = $cfg_history;
const $$when_hist = $when_hist;
const $$cfg_events = $cfg_events;
const $$when_ev = $when_ev;
const $$writes = $writes;
const $$next_version = $next_version;
const $$emits = $emits;
const $$skipped = $skipped;
const $$step = $step;
const $$none = $none;
const $$empty = $empty;
const $$List_append = $List_append;export default {
  "patch:lookup_pick": run_lib((a0,a1,a2) => run_loop($patch_lookup_pick(a0,nat_in(a1),a2)), 3),
  "patch:lookup": run_lib((a0,a1) => run_loop($patch_lookup(a0,nat_in(a1))), 2),
  "patch:del_pick": run_lib((a0,a1,a2) => run_loop($patch_del_pick(a0,a1,a2)), 3),
  "patch:del": run_lib((a0,a1) => run_loop($patch_del(a0,nat_in(a1))), 2),
  "patch:step": run_lib((a0,a1) => run_loop($patch_step(a0,a1)), 2),
  "patch:apply": run_lib((a0,a1) => run_loop($patch_apply(a0,a1)), 2),
  "patch:diff_same": run_lib((a0,a1,a2) => run_loop($patch_diff_same(a0,nat_in(a1),nat_in(a2))), 3),
  "patch:diff_one_pick": run_lib((a0,a1,a2) => run_loop($patch_diff_one_pick(a0,nat_in(a1),nat_in(a2))), 3),
  "patch:diff_source": run_lib((a0,a1) => run_loop($patch_diff_source(a0,a1)), 2),
  "patch:diff_added_pick": run_lib((a0,a1,a2) => run_loop($patch_diff_added_pick(a0,nat_in(a1),nat_in(a2))), 3),
  "patch:diff_added": run_lib((a0,a1) => run_loop($patch_diff_added(a0,a1)), 2),
  "patch:diff": run_lib((a0,a1) => run_loop($patch_diff(a0,a1)), 2),
  "patch:example": run_lib(() => run_loop($patch_example()), 0),
  "find_pick": run_lib((a0,a1,a2) => run_loop($find_pick(a0,a1,a2)), 3),
  "find": run_lib((a0,a1) => run_loop($find(a0,nat_in(a1))), 2),
  "remove_pick": run_lib((a0,a1,a2) => run_loop($remove_pick(a0,a1,a2)), 3),
  "remove": run_lib((a0,a1) => run_loop($remove(a0,nat_in(a1))), 2),
  "max": run_lib((a0,a1) => run_loop($max(nat_in(a0),nat_in(a1))), 2),
  "top_pick": run_lib((a0,a1,a2) => run_loop($top_pick(a0,nat_in(a1),a2)), 3),
  "top_version": run_lib((a0,a1) => run_loop($top_version(a0,nat_in(a1))), 2),
  "next_version": run_lib((a0) => run_loop($next_version(a0)), 1),
  "append_hist": run_lib((a0,a1) => run_loop($append_hist(a0,a1)), 2),
  "ops_data": run_lib((a0) => run_loop($ops_data(a0)), 1),
  "ops_once": run_lib((a0) => run_loop($ops_once(a0)), 1),
  "when_hist": run_lib((a0,a1,a2) => run_loop($when_hist(a0,a1,a2)), 3),
  "when_ev": run_lib((a0,a1,a2) => run_loop($when_ev(a0,a1,a2)), 3),
  "skipped": run_lib((a0) => run_loop($skipped(a0)), 1),
  "writes": run_lib((a0,a1) => run_loop($writes(a0,a1)), 2),
  "emits": run_lib((a0,a1) => run_loop($emits(a0,a1)), 2),
  "cfg_history": run_lib((a0) => run_loop($cfg_history(a0)), 1),
  "cfg_events": run_lib((a0) => run_loop($cfg_events(a0)), 1),
  "create_pick": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($create_pick(a0,a1,nat_in(a2),a3,a4,a5,a6)), 7),
  "update_write": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8) => run_loop($update_write(a0,a1,a2,nat_in(a3),a4,a5,a6,a7,a8)), 9),
  "update_hook": run_lib((a0,a1,a2,a3,a4,a5,a6,a7,a8) => run_loop($update_hook(a0,a1,a2,nat_in(a3),a4,a5,a6,a7,a8)), 9),
  "update_pick": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($update_pick(a0,a1,a2,nat_in(a3),a4,a5,a6,a7)), 8),
  "delete_hook": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($delete_hook(a0,a1,a2,nat_in(a3),a4,a5,a6,a7)), 8),
  "delete_pick": run_lib((a0,a1,a2,a3,a4,a5,a6) => run_loop($delete_pick(a0,a1,a2,nat_in(a3),a4,a5,a6)), 7),
  "step": run_lib((a0,a1,a2) => run_loop($step(a0,a1,a2)), 3),
  "run": run_lib((a0,a1,a2) => run_loop($run(a0,a1,a2)), 3),
  "empty": run_lib(() => run_loop($empty()), 0),
  "store_of": run_lib((a0) => run_loop($store_of(a0)), 1),
  "hist_of": run_lib((a0) => run_loop($hist_of(a0)), 1),
  "evs_of": run_lib((a0) => run_loop($evs_of(a0)), 1),
  "none": run_lib(() => run_loop($none()), 0),
  "example": run_lib(() => run_loop($example()), 0),
};
