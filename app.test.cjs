const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the report logic without bootstrapping the browser form.
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, "utf8").split('const form = document.querySelector')[0], context);
const { parseRubric, pairComponents, renderReport, standaloneReport } = context;
const rubric = entries => entries.map(([name, body], i) => `${i + 1}.\nComponent: ${name}\n${body}`).join("\n\n");
const pairs = (before, after) => pairComponents(parseRubric(before).components, parseRubric(after).components);
const statuses = html => [...html.matchAll(/<section class="tile" data-status="([^"]+)"/g)].map(match => match[1]);
const base = [["Accuracy", "Correct facts"], ["Clarity", "Clear wording"], ["Style", "Readable prose"]];

test("insertion preserves unchanged components and displays both numbers", () => {
  const before = rubric(base);
  const after = rubric([base[0], ["Coverage", "All topics"], ...base.slice(1)]);
  const report = renderReport(before, after);
  assert.deepEqual(statuses(report), ["unchanged", "added", "unchanged", "unchanged"]);
  assert.match(report, /2\. Component: Clarity/);
  assert.match(report, /3\. Component: Clarity/);
  assert.deepEqual(statuses(standaloneReport(report)), statuses(report));
});

test("removal preserves unchanged components and the removed tile's position", () => {
  assert.deepEqual(statuses(renderReport(rubric(base), rubric([base[0], base[2]]))),
    ["unchanged", "removed", "unchanged"]);
});

test("same-name insertion matches content before reused numbers", () => {
  const before = rubric([["Accuracy", "First"], ["Accuracy", "Second"]]);
  const after = rubric([["Accuracy", "Inserted"], ["Accuracy", "First"], ["Accuracy", "Second"]]);
  const matched = pairs(before, after);
  assert.equal(matched[0].left, undefined);
  assert.equal(matched[1].left.number, "1");
  assert.equal(matched[2].left.number, "2");
  assert.deepEqual(statuses(renderReport(before, after)), ["added", "unchanged", "unchanged"]);
});

test("same-name removal does not pair against a reused number", () => {
  const before = rubric([["Accuracy", "First"], ["Accuracy", "Second"], ["Accuracy", "Third"]]);
  const after = rubric([["Accuracy", "First"], ["Accuracy", "Third"]]);
  assert.deepEqual(statuses(renderReport(before, after)), ["unchanged", "removed", "unchanged"]);
  assert.equal(pairs(before, after)[2].left.number, "3");
});

test("content edits remain modified after renumbering", () => {
  const after = [["Coverage", "New"], base[0], ["Clarity", "Clear and concise wording"], base[2]];
  assert.deepEqual(statuses(renderReport(rubric(base), rubric(after))),
    ["added", "unchanged", "modified", "unchanged"]);
});

test("identical duplicates are paired once each in original order", () => {
  const text = rubric([["Accuracy", "Same"], ["Accuracy", "Same"]]);
  const matched = pairs(text, text);
  assert.equal(matched[0].left.number, "1");
  assert.equal(matched[1].left.number, "2");
  assert.notEqual(matched[0].left, matched[1].left);
});

test("remaining same-name edit matches after reserving unchanged components", () => {
  const before = rubric([["Accuracy", "First"], ["Accuracy", "Second"]]);
  const after = rubric([["Coverage", "New"], ["Accuracy", "First edited"], ["Accuracy", "Second"]]);
  assert.deepEqual(statuses(renderReport(before, after)), ["added", "modified", "unchanged"]);
});

test("heading formats and trailing blank lines do not make numbering changes modified", () => {
  for (const [before, after] of [
    ["1: Component - Accuracy\nCorrect\n\n", "2: Component - Accuracy\nCorrect"],
    ["1. Component: Accuracy\nCorrect", "2.\nComponent: Accuracy\nCorrect"],
    ["1: Accuracy\nCorrect", "2: Accuracy\nCorrect"]
  ]) assert.deepEqual(statuses(renderReport(before, after)), ["unchanged"]);
});

test("name edits and fully added or removed rubrics are still reported", () => {
  assert.deepEqual(statuses(renderReport(rubric(base), rubric([["ACCURACY", "Correct facts"], ...base.slice(1)]))),
    ["modified", "unchanged", "unchanged"]);
  assert.deepEqual(statuses(renderReport("", rubric(base))), ["added", "added", "added"]);
  assert.deepEqual(statuses(renderReport(rubric(base), "")), ["removed", "removed", "removed"]);
});
