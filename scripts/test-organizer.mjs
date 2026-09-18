import test from "node:test";
import assert from "node:assert/strict";
import { organizeEntries } from "../apps/web/src/lib/organizer.mjs";
const entry = (file, content, extra = {}) => ({
  title: file,
  source: file,
  content,
  kind: "memory",
  ...extra,
});
test("project family and related feedback use the complete body", () => {
  const r = organizeEntries([
    entry(
      "project_orion_api.md",
      "Orion service API authentication and deployment.",
    ),
    entry("project_orion_ui.md", "Orion dashboard settings and accounts."),
    entry(
      "feedback_orion_login.md",
      "Orion authentication should use password login.",
    ),
    entry(
      "reference_setup.md",
      "General introduction. ".repeat(200) +
        "Orion authentication service API deployment dashboard accounts.",
    ),
  ]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].name, "Orion");
  assert.equal(r.entries.length, 4);
});
test("separate explicitly named projects do not merge on generic similarity", () => {
  const r = organizeEntries([
    entry("a.md", "Use PostgreSQL and account login.", {
      projectName: "Project A",
    }),
    entry("b.md", "Use PostgreSQL and account login.", {
      projectName: "Project B",
    }),
  ]);
  assert.equal(r.groups.length, 2);
  assert.equal(r.entries.length, 2);
});
test("identical duplicate is skipped, different versions retained", () => {
  const r = organizeEntries([
    entry("one.md", "Same   memory", { projectName: "Project A" }),
    entry("two.md", "Same memory", { projectName: "Project A" }),
    entry("three.md", "Updated memory", { projectName: "Project A" }),
  ]);
  assert.equal(r.entries.length, 2);
  assert.equal(r.duplicates, 1);
});
test("long chunks from the same file remain in the same project", () => {
  const r = organizeEntries([
    entry("project_orion_api.md", "Authentication notes."),
    entry("project_orion_api.md", "Unrelated troubleshooting appendix."),
  ]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.entries.length, 2);
});
