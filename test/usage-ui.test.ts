import { strict as assert } from "node:assert";
import vm from "node:vm";
import test from "node:test";
import { renderUsageHtml } from "../src/ui/usageHtml.js";

test("usage webview renders a VS Code-styled accessible dashboard shell", () => {
  const html = renderUsageHtml("nonce<>!");

  assert.match(html, /value="1">Last 24 hours/);
  assert.match(html, /value="7">Last 7 days/);
  assert.match(html, /value="30" selected>Last 30 days/);
  assert.match(html, /value="all">All time/);
  assert.match(html, /for="directory">Project/);
  assert.match(html, /All projects/);
  assert.match(html, /id="updated"/);
  assert.match(html, /Updated just now/);
  assert.match(html, /--vscode-editorWidget-background/);
  assert.match(html, /appearance:none/);
  assert.match(html, /id="clear-filters"/);
  assert.match(html, /id="refresh"/);
  assert.match(html, /id="edit-prices"/);
  assert.doesNotMatch(html, /id="keep-alive"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /main\[aria-busy="true"\]\{opacity:\.7\}/);
  assert.doesNotMatch(html, /Working Directory<\/label>/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("usage webview includes optional-data dashboard interactions", () => {
  const html = renderUsageHtml("nonce");

  for (const id of [
    "input",
    "cached",
    "fresh",
    "output",
    "interactions",
    "cost",
    "quota-list",
    "usage-chart",
    "top-projects",
    "top-models",
    "table-search",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="group-by"/);
  for (const value of [
    "tokens",
    "interactions",
    "cached",
    "uncached",
    "output",
    "hour",
    "day",
    "week",
    "month",
    "project",
    "model",
    "account",
  ]) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  for (const key of [
    "project",
    "model",
    "total",
    "input",
    "cached",
    "output",
    "cost",
    "cacheRate",
    "interactions",
    "account",
  ]) {
    assert.match(html, new RegExp(`data-sort-key="${key}"`));
  }
  assert.match(html, /aria-expanded/);
  assert.match(html, /aria-valuenow/);
  assert.match(html, /progressbar/);
  assert.match(html, /\[SELECTED\]/);
  assert.match(html, /Resets /);
  assert.match(html, /formatQuotaWindow/);
  assert.match(html, /quota-windows/);
  assert.doesNotMatch(html, /flatMap/);
  assert.match(html, /5 hours/);
  assert.match(html, /formatCost/);
  assert.match(html, /type:'editPricing'/);
  assert.match(html, /Weekly/);
  assert.doesNotMatch(html, /Last Keep Alive at:/);
  assert.match(html, /top 5/);
  assert.match(html, /chartBucket/);
  assert.match(html, /chartGroup:state\.chart\.group/);
  assert.match(html, /request\('chart'\)/);
  assert.match(html, /refresh\.addEventListener\('click',\(\)=>request\('refresh'\)\)/);
  assert.doesNotMatch(html, /request\('keepAlive'\)/);
  assert.match(html, /normalizeRow/);
  assert.match(html, /cell\.textContent=compact\(value\[key\]\);cell\.title=exact\(value\[key\]\)/);
  assert.match(html, /savedUi\.expanded/);
  assert.match(html, /next==='empty'/);
  assert.match(html, /next==='error'/);
  assert.match(html, /nonce="nonce"/);
});

test("usage webview embedded script is valid JavaScript", () => {
  const html = renderUsageHtml("nonce");
  const start = html.indexOf(">", html.indexOf("<script")) + 1;
  const end = html.lastIndexOf("</script>");
  assert.doesNotThrow(() => new vm.Script(html.slice(start, end)));
});
