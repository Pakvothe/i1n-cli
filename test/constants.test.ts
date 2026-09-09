import { describe, it, expect } from "bun:test";
import {
  contractConstants,
  contractWordings,
  expandConstants,
  expandWordings,
  referencedConstants,
  staleConstantRefs,
} from "../src/shared/constants.js";
import { buildNextState, readPushState, writePushState, _testTmpDir } from "../src/shared/push-state.js";
import { extractVariables } from "../src/shared/variables.js";
import { generateTypeDefinitions } from "../src/shared/codegen.js";
import { runCheck } from "../src/shared/check.js";
import type { Wording } from "../src/shared/types.js";

const constants = { TOKEN_USDT: "U̶S̶D̶T̶", USD: "USD", USDT: "USDT" };

describe("constants: expand", () => {
  it("expands markers, keeps unknown markers, reports used/missing", () => {
    const r = expandConstants("Buy {@TOKEN_USDT} with {@USD} ({@NOPE}) {count}", constants);
    expect(r.text).toBe("Buy U̶S̶D̶T̶ with USD ({@NOPE}) {count}");
    expect(r.used).toEqual(["TOKEN_USDT", "USD"]);
    expect(r.missing).toEqual(["NOPE"]);
  });

  it("expandWordings returns new objects and records usage per key/lang", () => {
    const input: Wording[] = [
      { namespace: "common", key: "buy", value_json: { en: "Buy {@TOKEN_USDT}", es: "Comprá {@TOKEN_USDT}" } },
      { namespace: "common", key: "plain", value_json: { en: "Hello" } },
    ];
    const r = expandWordings(input, constants);
    expect(r.wordings[0].value_json.en).toBe("Buy U̶S̶D̶T̶");
    expect(input[0].value_json.en).toBe("Buy {@TOKEN_USDT}"); // untouched
    expect(r.used).toEqual({ "common:buy": { en: ["TOKEN_USDT"], es: ["TOKEN_USDT"] } });
    expect(r.missing).toEqual([]);
  });
});

describe("constants: contract", () => {
  it("edit around the token keeps the marker", () => {
    expect(contractConstants("Buy more U̶S̶D̶T̶ today", ["TOKEN_USDT"], constants)).toBe(
      "Buy more {@TOKEN_USDT} today",
    );
  });

  it("deleting the token text drops the marker (correct)", () => {
    expect(contractConstants("Buy today", ["TOKEN_USDT"], constants)).toBe("Buy today");
  });

  it("only contracts the names given, so unrelated literals stay literal", () => {
    expect(contractConstants("Pay in USD", ["TOKEN_USDT"], constants)).toBe("Pay in USD");
  });

  it("longest value wins when one value is a prefix of another", () => {
    expect(contractConstants("USDT and USD", ["USD", "USDT"], constants)).toBe("{@USDT} and {@USD}");
  });

  it("explicit markers typed by the user pass through", () => {
    expect(contractConstants("{@TOKEN_USDT} rocks", ["TOKEN_USDT"], constants)).toBe("{@TOKEN_USDT} rocks");
  });

  it("round-trips expand → contract for every used constant", () => {
    const original = "Swap {@USDT} for {@USD}, keep {@TOKEN_USDT} {amount}";
    const e = expandConstants(original, constants);
    expect(contractConstants(e.text, e.used, constants)).toBe(original);
  });
});

describe("constants: contractWordings (push path)", () => {
  const server: Wording[] = [
    { namespace: "common", key: "buy", value_json: { en: "Buy {@TOKEN_USDT}", es: "Comprá {@TOKEN_USDT}" } },
    { namespace: "common", key: "fee", value_json: { en: "Fee in USD" } },
  ];

  it("contracts using state usage + server references; leaves other keys alone", () => {
    const local: Wording[] = [
      { namespace: "common", key: "buy", value_json: { en: "Buy more U̶S̶D̶T̶", es: "Comprá U̶S̶D̶T̶" } },
      { namespace: "common", key: "fee", value_json: { en: "Fee in USD" } }, // literal USD, no constant on server
      { namespace: "common", key: "new", value_json: { en: "USDT here" } }, // brand-new key: literal stays
    ];
    const baseline = { "common:buy": { en: "Buy {@TOKEN_USDT}", es: "Comprá {@TOKEN_USDT}" } };
    const out = contractWordings(local, server, baseline, constants, constants);
    expect(out[0].value_json).toEqual({ en: "Buy more {@TOKEN_USDT}", es: "Comprá {@TOKEN_USDT}" });
    expect(out[1].value_json.en).toBe("Fee in USD");
    expect(out[2].value_json.en).toBe("USDT here");
    expect(out[1]).toBe(local[1]); // unchanged rows keep identity
  });

  it("constant changed on the server between pull and push: snapshot value contracts, no phantom edit", () => {
    const snapshot = { TOKEN_USDT: "OLD" };
    const current = { TOKEN_USDT: "NEW" };
    const local: Wording[] = [{ namespace: "common", key: "buy", value_json: { en: "Buy OLD" } }];
    const out = contractWordings(local, server, { "common:buy": { en: "Buy {@TOKEN_USDT}" } }, snapshot, current);
    expect(out[0].value_json.en).toBe("Buy {@TOKEN_USDT}"); // equals server → unchanged in the diff
  });

  it("fresh checkout (no state) still contracts from server references", () => {
    const local: Wording[] = [{ namespace: "common", key: "buy", value_json: { en: "Buy U̶S̶D̶T̶ now" } }];
    const out = contractWordings(local, server, undefined, null, constants);
    expect(out[0].value_json.en).toBe("Buy {@TOKEN_USDT} now");
  });

  it("no constants anywhere → input returned as-is", () => {
    const local: Wording[] = [{ namespace: "c", key: "k", value_json: { en: "x" } }];
    expect(contractWordings(local, [], undefined, null, null)).toBe(local);
  });
});

describe("constants: codegen and check ignore {@NAME}", () => {
  const wordings: Wording[] = [
    { namespace: "common", key: "buy", value_json: { en_us: "Buy {@TOKEN_USDT} for {price}", es_ar: "Comprá por {price}" } },
  ];

  it("extractVariables excludes constants", () => {
    expect(extractVariables("Buy {@TOKEN_USDT} for {price}")).toEqual(["price"]);
    expect(referencedConstants("Buy {@TOKEN_USDT} {@A}")).toEqual(["TOKEN_USDT", "A"]);
  });

  it("codegen emits only runtime params", () => {
    const dts = generateTypeDefinitions(wordings, "en_us");
    expect(dts).toContain('"common.buy": { price: string };');
    expect(dts).not.toContain("@TOKEN_USDT");
  });

  it("check does not report a placeholder mismatch for a constant missing in a language", () => {
    const report = runCheck({ sourceLocale: "en_us" }, wordings);
    expect(report.issues.filter(i => i.type === "placeholder_mismatch")).toEqual([]);
  });
});

describe("constants: stale refs and push-state snapshot", () => {
  const server: Wording[] = [
    { namespace: "common", key: "buy", value_json: { en: "Buy {@TOKEN_USDT}", es: "Comprá" } },
    { namespace: "common", key: "fee", value_json: { en: "Fee {@USD}" } },
  ];

  it("lists only pairs referencing a constant whose value changed/added/removed", () => {
    const snapshot = { TOKEN_USDT: "OLD", USD: "USD" };
    const current = { TOKEN_USDT: "NEW", USD: "USD" };
    expect(staleConstantRefs(server, snapshot, current)).toEqual([
      { namespace: "common", key: "buy", lang: "en", value: "Buy {@TOKEN_USDT}" },
    ]);
    expect(staleConstantRefs(server, current, current)).toEqual([]);
    expect(staleConstantRefs(server, current, { TOKEN_USDT: "NEW" }).map(s => s.key)).toEqual(["fee"]);
  });

  it("push state persists markers (never expansions) plus the constants snapshot", () => {
    const dir = _testTmpDir();
    const state = buildNextState(server, { "common:buy": { es: "Comprá {@TOKEN_USDT}" } }, { constants: { TOKEN_USDT: "X" }, hash: "abc" });
    writePushState(state, dir);
    const back = readPushState(dir);
    expect(back.wordings["common:buy"].values).toEqual({ en: "Buy {@TOKEN_USDT}", es: "Comprá {@TOKEN_USDT}" });
    expect(back.constants).toEqual({ TOKEN_USDT: "X" });
    expect(back.constants_hash).toBe("abc");
  });

  it("buildNextState without constants info leaves the fields absent (pre-1.6 shape)", () => {
    const state = buildNextState(server, {});
    expect(state.constants).toBeUndefined();
    expect(state.constants_hash).toBeUndefined();
  });
});
