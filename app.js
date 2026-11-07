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

const explicitHeading = /^\s*(\d+)(?:\s*:\s*Component\s*[-–—]|\s*\.\s*Component\s*:)\s*(\S.*?)\s*$/i;
const numberedHeading = /^\s*(\d+)\s*:\s*(\S.*?)\s*$/;
const numberLine = /^\s*(\d+)\s*\.\s*$/;
const componentLine = /^\s*Component\s*:\s*(\S.*?)\s*$/i;

function parseRubric(text) {
  const input = lines(text);
  const readHeading = index => {
    const line = input[index];
    const inline = line.match(explicitHeading);
    if (inline) return { number: inline[1], name: inline[2], heading: line.trim(), size: 1 };
    const number = line.match(numberLine);
    const component = number && input[index + 1]?.match(componentLine);
    if (component) {
      return { number: number[1], name: component[1],
        heading: `${line.trim()} ${input[index + 1].trim()}`, size: 2 };
    }
  };
  const hasExplicitHeadings = input.some((_, index) => readHeading(index));
  const preamble = [];
  const components = [];
  let content = preamble;
  for (let index = 0; index < input.length; index++) {
    const line = input[index];
    let heading = readHeading(index);
    if (!heading && !hasExplicitHeadings) {
      const plain = line.match(numberedHeading);
      if (plain) heading = { number: plain[1], name: plain[2], heading: line.trim(), size: 1 };
    }
    if (heading) {
      const { size, ...component } = heading;
      content = [];
      components.push({ ...component, content });
      index += size - 1;
    } else {
      content.push(line);
    }
  }
  return { preamble, components };
}

function groupByName(components) {
  const groups = new Map();
  for (const component of components) {
    const name = component.name.toLowerCase();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(component);
  }
  return groups;
}

function pairComponents(before, after) {
  const originals = groupByName(before);
  const updates = groupByName(after);
  const byOriginal = new Map();
  const pairs = after.map(right => {
    const name = right.name.toLowerCase();
    const candidates = originals.get(name) ?? [];
    const matchingNumber = candidates.filter(left => left.number === right.number);
    const sameNumberCount = updates.get(name).filter(item => item.number === right.number).length;
    const left = candidates.length === 1 && updates.get(name).length === 1
      ? candidates[0]
      : matchingNumber.length === 1 && sameNumberCount === 1 ? matchingNumber[0] : undefined;
    const pair = { left, right, removedBefore: [] };
    if (left) byOriginal.set(left, pair);
    return pair;
  });

  // Keep removed tiles near their original neighbors while using the updated order.
  const trailing = [];
  let removed = trailing;
  for (let index = before.length - 1; index >= 0; index--) {
    const left = before[index];
    const pair = byOriginal.get(left);
    if (pair) removed = pair.removedBefore;
    else removed.push({ left });
  }
  return pairs.flatMap(pair => [...pair.removedBefore.reverse(), pair]).concat(trailing.reverse());
}

function trimTrailingBlanks(block) {
  let end = block.length;
  while (end && !block[end - 1].trim()) end--;
  return block.slice(0, end);
}

function renderRows(changes) {
  const rows = [];
  let removed = [];
  let added = [];
  const cell = (value, kind) => {
    if (value === undefined) return '<td class="gap"></td>';
    const label = { added: "+ Added", removed: "− Removed" }[kind];
    const marker = label ? `<span class="marker" aria-label="${label}">${label[0]}</span>` : "";
    return `<td class="${kind}">${marker}<span class="line">${escapeHTML(value)}</span></td>`;
  };
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push(`<tr>${cell(removed[index], "removed")}${cell(added[index], "added")}</tr>`);
    }
    removed = [];
    added = [];
  };
  for (const [kind, value] of changes) {
    if (kind === "same") {
      flush();
      rows.push(`<tr>${cell(value, "same")}${cell(value, "same")}</tr>`);
    } else {
      (kind === "removed" ? removed : added).push(value);
    }
  }
  flush();
  return rows.join("");
}

function renderTile(id, title, left, right, originalHeading, updatedHeading) {
  const { changes, coarse } = compare(trimTrailingBlanks(left ?? []), trimTrailingBlanks(right ?? []));
  const kind = !left ? "added" : !right ? "removed"
    : originalHeading !== updatedHeading || changes.some(([type]) => type !== "same") ? "modified" : "unchanged";
  const columnHeading = (label, block, heading) => {
    const detail = block ? heading : "Component absent";
    return `<th scope="col">${label}${detail ? `<small>${escapeHTML(detail)}</small>` : ""}</th>`;
  };
  return `<section class="tile" aria-labelledby="${id}">
<header class="tile-heading"><h3 id="${id}">${escapeHTML(title)}</h3><span class="badge ${kind}">${kind}</span></header>
<table aria-labelledby="${id}"><thead><tr>
${columnHeading("Original", left, originalHeading)}${columnHeading("Updated", right, updatedHeading)}
</tr></thead><tbody>${renderRows(changes)}</tbody></table>
${coarse ? "<p>This component is large, so its changes are shown as one replacement.</p>" : ""}
</section>`;
}

function renderReport(before, after) {
  const original = parseRubric(before);
  const updated = parseRubric(after);
  const components = pairComponents(original.components, updated.components);
  const tiles = components.map(({ left, right }, index) => {
    const component = right ?? left;
    return renderTile(`component-${index + 1}`, `${component.number}. ${component.name}`,
      left?.content, right?.content, left?.heading, right?.heading);
  }).join("");
  const preamble = [...original.preamble, ...updated.preamble].some(line => line.trim())
    ? renderTile("outside-components", "Text outside components", original.preamble, updated.preamble)
    : "";
  return `<h2 id="report-title" tabindex="-1">Component comparison</h2>
<p class="legend"><span class="removed">− Removed</span> <span class="added">+ Added</span></p>
${components.length ? tiles : '<p>No numbered component headings found. Start each section with a number such as <code>1.</code> on one line and <code>Component: Accuracy</code> on the next.</p>'}
${preamble}`;
}

const reportStyles = `
.rubric-report{color:#162724;font:1rem/1.5 system-ui,sans-serif}
.rubric-report h2{margin:0;font-size:1.65rem}
.rubric-report .legend{display:flex;gap:8px;margin:8px 0 20px}
.rubric-report .badge,.rubric-report .legend span{padding:4px 9px;border-radius:6px;font-size:.8rem;font-weight:700}
.rubric-report .badge{text-transform:capitalize}
.rubric-report .added{background:#dcf5e6;color:#145235}
.rubric-report .removed{background:#fce5e5;color:#842b31}
.rubric-report .modified{background:#fff0cc;color:#634500}
.rubric-report .unchanged{background:#e6eeea;color:#435751}
.rubric-report .tile{overflow:hidden;margin:0 0 24px;background:white;border:1px solid #9bada4;border-radius:12px}
.rubric-report .tile-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;background:#1d4035;color:white}
.rubric-report h3{margin:0;font-size:1.25rem;overflow-wrap:anywhere}
.rubric-report table{width:100%;border-collapse:collapse;table-layout:fixed}
.rubric-report th,.rubric-report td{padding:6px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.rubric-report th{width:50%;background:#f4f7f5;font-size:.85rem;border-top:1px solid #cddbd4}
.rubric-report th small{display:block;color:#526460;font-size:.82rem;font-weight:400}
.rubric-report td{border-top:1px solid #e0e8e3;font-size:.9rem}
.rubric-report :is(th,td) + :is(th,td){border-left:1px solid #cddbd4}
.rubric-report .gap{background:#f6f8f7}
.rubric-report .marker{margin-right:.4em;font-weight:800}
.rubric-report .line{white-space:pre-wrap}
.rubric-report .tile > p{padding:0 10px}
`;

function standaloneReport(content) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Rubric Diff Report</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8f5}
main{max-width:1100px;margin:auto;padding:24px 12px}
${reportStyles}
</style></head><body><main class="rubric-report">${content}</main></body></html>`;
}

const form = document.querySelector("#comparison");
const original = document.querySelector("#original");
const updated = document.querySelector("#updated");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const styles = document.createElement("style");
styles.textContent = reportStyles;
document.head.append(styles);

function updateControls() {
  for (const input of [original, updated]) {
    const count = lines(input.value).length;
    document.querySelector(`#${input.id}-count`).textContent = `${count} ${count === 1 ? "line" : "lines"}`;
  }
  for (const button of form.querySelectorAll("button")) {
    button.disabled = !original.value && !updated.value;
  }
  status.textContent = "";
  results.hidden = true;
}

form.addEventListener("input", updateControls);
form.addEventListener("submit", event => {
  event.preventDefault();
  const content = renderReport(original.value, updated.value);
  if (event.submitter?.name !== "download") {
    results.innerHTML = content;
    results.hidden = false;
    results.querySelector("h2").focus({ preventScroll: true });
    results.scrollIntoView();
    status.textContent = "Component comparison updated.";
    return;
  }
  const file = new Blob([standaloneReport(content)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rubric-diff-report.html";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  status.textContent = "HTML download requested.";
});
updateControls();
