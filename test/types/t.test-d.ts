import { t } from "i1n";

// 1. Known literal — must compile.
t("auth.login.title");
t("auth.login.submit");
t("common.greeting", { name: "Fran" });

// 2. Unknown literal — must fail typecheck.
// @ts-expect-error — typo, not in I1nKeys.
t("auth.login.titlse");
// @ts-expect-error — completely unknown.
t("flash.calculator.amount_labe");

// 3. Dynamic strings — must compile (no cast required).
declare const someVar: string;
t(someVar);

// Field access from objects (common in real code).
declare const item: { name: string };
t(item.name);
