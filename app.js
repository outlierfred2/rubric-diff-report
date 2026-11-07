"use strict";

const lines = text => text === "" ? [] : text.split(/\r\n?|\n/);

function compare(before, after) {
  const changes = [];
  let start = 0;
  let endBefore = before.length;
  let endAfter = after.length;
  while (start < endBefore && start < endAfter && before[start] === after[start]) {
    changes.push(["same", before[start++]]);
  }
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  const height = endBefore - start;
  const width = endAfter - start;
  const stride = width + 1;
  // Bound the table so large, unrelated inputs remain usable.
  const coarse = height > 0 && width > 0 && (height + 1) * stride > 4_000_000;
  let left = start;
  let right = start;
  if (height && width && !coarse) {
    const matches = new Uint32Array((height + 1) * stride);
    for (let i = height - 1; i >= 0; i--) {
      for (let j = width - 1; j >= 0; j--) {
        const cell = i * stride + j;
        matches[cell] = before[start + i] === after[start + j]
          ? 1 + matches[cell + stride + 1]
          : Math.max(matches[cell + 1], matches[cell + stride]);
      }
    }
    while (left < endBefore && right < endAfter) {
      const cell = (left - start) * stride + right - start;
      if (before[left] === after[right]) {
        changes.push(["same", before[left++]]);
        right++;
      } else if (matches[cell + stride] >= matches[cell + 1]) {
        changes.push(["removed", before[left++]]);
      } else {
        changes.push(["added", after[right++]]);
      }
    }
  }
  while (left < endBefore) changes.push(["removed", before[left++]]);
  while (right < endAfter) changes.push(["added", after[right++]]);
  while (left < before.length) changes.push(["same", before[left++]]);
  return { changes, coarse };
}

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\r": "&#13;", "\0": "␀" };
const escapeHTML = text => text.replace(/[&<>\r\0]/g, character => entities[character]);

function parseRubric(text) {
  const preamble = { description: [], options: [] };
  const components = [];
  let current = preamble;
  let field = "description";
  for (const line of lines(text)) {
    const heading = line.match(/^\s*(\d+)\s*:\s*Component\s*[-–—]\s*(\S.*?)\s*$/i);
    if (heading) {
      current = { number: heading[1], name: heading[2], heading: [line],
        description: [], options: [] };
      components.push(current);
      field = "description";
    } else {
      if (current !== preamble && /^\s*Rating Options\s*:?\s*$/i.test(line)) {
        field = "options";
      }
      current[field].push(line);
    }
  }
  return { preamble, components };
}

function pairComponents(before, after) {
  const remaining = new Set(before);
  const pairs = after.map(component => [undefined, component]);
  for (const [key, normalize] of [
    ["name", name => name.toLowerCase()],
    ["number", number => number]
  ]) {
    const lookup = components => {
      const byKey = new Map();
      for (const component of components) {
        const value = normalize(component[key]);
        byKey.set(value, byKey.has(value) ? null : component);
      }
      return byKey;
    };
    const original = lookup(remaining);
    const updated = lookup(pairs.filter(([left]) => !left).map(([, right]) => right));
    for (const pair of pairs) {
      const value = normalize(pair[1][key]);
      const match = original.get(value);
      if (!pair[0] && match && updated.get(value)) {
        pair[0] = match;
        remaining.delete(match);
      }
    }
  }
  return pairs.concat(Array.from(remaining, component => [component, undefined]));
}

function trimBlankEdges(block) {
  const first = block.findIndex(line => line.trim());
  if (first === -1) return [];
  let end = block.length;
  while (!block[end - 1].trim()) end--;
  return block.slice(first, end);
}

function renderDiff(before, after) {
  const { changes, coarse } = compare(trimBlankEdges(before), trimBlankEdges(after));
  const items = changes.filter(([kind]) => kind !== "same").map(([kind, value]) => {
    const marker = kind === "added" ? "+" : "−";
    const content = value.trim() ? escapeHTML(value) : '<em>Blank line</em>';
    return `<li class="item ${kind}"><span class="marker" aria-hidden="true">${marker}</span><span class="sr-only">${kind}: </span><span class="item-text">${content}</span></li>`;
  }).join("");
  if (!items) return "";
  return `${coarse ? "<p>This block is large, so its changes are shown as one replacement.</p>" : ""}
<ul class="changes" role="list">${items}</ul>`;
}

function report(before, after) {
  const original = parseRubric(before);
  const updated = parseRubric(after);
  const counts = { modified: 0, added: 0, removed: 0, unchanged: 0 };
  const preamble = renderDiff(original.preamble.description, updated.preamble.description);
  const sections = pairComponents(original.components, updated.components).map(([left, right], index) => {
    const component = right ?? left;
    const fields = [
      ["Heading", "heading"],
      ["Description", "description"],
      ["Rating options", "options"]
    ].map(([label, key]) => {
      if (key === "heading" && (!left || !right)) return "";
      const diff = renderDiff(left?.[key] ?? [], right?.[key] ?? []);
      return diff ? `<div class="field"><h3>${label}</h3>${diff}</div>` : "";
    }).join("");
    const kind = !left ? "added" : !right ? "removed" : fields ? "modified" : "unchanged";
    counts[kind]++;
    const id = `component-${index + 1}`;
    return `<section class="component component-${kind}" aria-labelledby="${id}">
<header class="component-header">
<span class="number">Component ${component.number}</span>
<h2 id="${id}">${escapeHTML(component.name)}</h2>
<span class="badge ${kind}">${kind}</span>
</header>
${fields || (kind === "unchanged" ? '<p class="empty">No item changes.</p>' : "")}
</section>`;
  }).join("");
  const summary = Object.entries(counts)
    .map(([kind, count]) => `<span class="${kind}">${count} ${kind}</span>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Rubric Diff Report</title><style>
*{box-sizing:border-box}
body{margin:0;background:#f2f5f3;color:#162724;font:1rem/1.5 system-ui,sans-serif}
main{max-width:900px;margin:auto;padding:clamp(22px,5vw,48px) clamp(12px,4vw,28px)}
h1{margin:0;font-size:clamp(1.8rem,5vw,2.7rem);letter-spacing:-.04em;line-height:1.15}
.legend{margin:8px 0;color:#526460}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 26px}
.badge,.summary span{display:inline-block;padding:4px 9px;border-radius:6px;font-size:.8rem;font-weight:700}
.badge{text-transform:capitalize}
.added{background:#dcf5e6;color:#145235}.removed{background:#fce5e5;color:#842b31}
.modified{background:#fff0cc;color:#634500}.unchanged{background:#e6eeea;color:#435751}
.component{overflow:hidden;margin:0 0 18px;background:white;border:1px solid #cddbd4;border-radius:12px}
.component-header{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:14px 16px;background:#e6eeea;border-left:5px solid #657a70}
.component-modified .component-header{border-left-color:#9c6c06}
.component-added .component-header{border-left-color:#268457}
.component-removed .component-header{border-left-color:#b54448}
.number{font-size:.78rem;font-weight:750;color:#435751}
h2{margin:0;flex:1 1 12rem;font-size:1.2rem;overflow-wrap:anywhere}
.field,.empty{margin:0;padding:12px 16px 16px}
.field + .field{border-top:1px solid #e6eeea}
h3{margin:0 0 7px;font-size:.85rem}
.empty{color:#526460;font-size:.9rem}
.changes{display:grid;gap:4px;list-style:none;margin:0;padding:0}
.item{display:grid;grid-template-columns:1rem minmax(0,1fr);gap:8px;padding:7px 10px;border-left:3px solid;border-radius:5px}
.item.added{border-left-color:#268457}.item.removed{border-left-color:#b54448}
.marker{font-weight:800}
.item-text{white-space:pre-wrap;overflow-wrap:anywhere}
.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style></head><body><main><h1>Rubric Diff Report</h1>
<p class="legend">Only changed lines are shown. <strong>−</strong> Removed · <strong>+</strong> Added</p>
<div class="summary" aria-label="Component summary">${summary}</div>
${sections || '<p>No component headings found. Use <code>1: Component - Accuracy</code> to start a section.</p>'}
${preamble ? `<section class="component" aria-labelledby="outside-components"><header class="component-header"><h2 id="outside-components">Text outside components</h2></header><div class="field">${preamble}</div></section>` : ""}
</main></body></html>`;
}

const form = document.querySelector("#comparison");
const original = document.querySelector("#original");
const updated = document.querySelector("#updated");
const status = document.querySelector("#status");

function updateControls() {
  for (const input of [original, updated]) {
    const count = lines(input.value).length;
    document.querySelector(`#${input.id}-count`).textContent = `${count} ${count === 1 ? "line" : "lines"}`;
  }
  for (const button of form.querySelectorAll("button")) {
    button.disabled = !original.value && !updated.value;
  }
  status.textContent = "";
}

form.addEventListener("input", updateControls);
form.addEventListener("submit", event => {
  event.preventDefault();
  const download = event.submitter?.name === "download";
  const file = new Blob([report(original.value, updated.value)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  if (download) link.download = "rubric-diff-report.html";
  else {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  status.textContent = download ? "HTML download requested." : "Report requested in a new tab.";
});
updateControls();
