# AI Platform integration

The rules, commands, and agent definitions in this directory were copied from
[`kumakumapon/ai-platform`](https://github.com/kumakumapon/ai-platform) at
`b87a9f8776c56664b4993a6ad8d16aa551f6d1ba` (MIT license; see
`AI-PLATFORM-LICENSE`).

- `rules/ai-platform-common.md` comes from `prompts/coding-agent-typescript-python.md`.
- `commands/` comes from the remaining `prompts/` files.
- `agents/` comes from `agents/`.
- The repository root `CLAUDE.md` comes from `templates/CLAUDE.bridge.md`, with
  the PR template path adjusted for this repository.
- The marked section of `AGENTS.md` summarizes the upstream common rules.
- `.github/ISSUE_TEMPLATE/ai-platform.yml` adapts the upstream issue form;
  `.github/PULL_REQUEST_TEMPLATE.md` retains the Stack-chan template with
  additional AI Platform reporting fields.

When updating, compare with the upstream `prompts/sync-ai-platform.md` and
preserve Stack-chan's project-specific instructions and GitHub workflows.
