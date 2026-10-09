import assert from "node:assert/strict";
import katex from "katex";
assert.ok(katex.renderToString("E=mc^2").includes("katex-mathml"));
assert.ok(katex.renderToString("\\frac{1}{2}").includes("mfrac"));
const options = Object.create({ trust: true });
const restricted = katex.renderToString("\\href{javascript:alert(1)}{click}", options);
assert.doesNotMatch(restricted, /href=["']javascript:/i);
console.log("Math dependency regression passed: ordinary formulas and inherited trust restriction.");
