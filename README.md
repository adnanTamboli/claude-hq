# Claude HQ

A live 3D command centre for your Claude Code agents, in the spirit of Gather.
- Every project is a pod in a holographic town.
- Every running Claude session is a little robot that walks to the project it's working on and types at the desk.
- When a session is waiting for your answer, its robot waves at you with a "?".
- When you open the app, the **Today** list tells you what needs you.

**Live demo:** https://adnantamboli.github.io/claude-hq/

The hosted version runs on sample data, because GitHub Pages has no server and your session logs stay private. Run HQ on your own PC to see your real agents.

## Run it

Double-click **`start-hq.cmd`**. It starts the server (in a minimized console; close that window to stop it) and opens HQ in its own Edge app window.

Or start it by hand:

```
node server.mjs      # then open http://localhost:4321
```

The app needs Node 18 or newer and has no npm dependencies. Three.js loads from a CDN.

## Where the data comes from (all local; the server only listens on 127.0.0.1)

| What | Source |
|---|---|
| Agents, prompts, tool activity, spend | `~/.claude/projects/*/*.jsonl` (Claude Code session logs), read incrementally and watched live |
| Projects | Folders that Claude touched (Edit/Write count most), plus the auto-memory notes (`~/.claude/projects/*/memory/`) |
| Ship-it items | `git status` / unpushed commits in each project folder |
| Open loops | Sentences in your memory notes that mention unfinished work ("not yet", "pending", "blocked"…) |
| ✦ Plan my day | Optional. Runs `claude -p` once with a summary of the above, and caches the result for the day in `data/` |

## Using it (blocky edition)

HQ is a Minecraft-style voxel island:
- **Houses are your projects.** The roof colour shows status: green = working now, orange = waiting on you, purple = active today, light blue = this week, grey = quiet. A beacon beam rises over houses where Claude is working, and the wooden sign out front shows recent activity.
- **Robots are your Claude sessions.** They walk to the house they're working on and mine away at it. A robot that jumps with a **?** is waiting for your answer.
- **The gold beacon pyramid in the middle is Today.** Click it, or press **Q**, for the quest log. The XP bar fills as you tick quests off.

Everyone in the city is **Clawd**, the Claude Code mascot, built from the same pixel sprite as the welcome banner in your terminal. The crowned one is you:
- **WASD** or the arrow keys walk, **Shift** runs, **Space** jumps. The camera follows you.
- Press **E** at a front door to enter that project.
- Press **E** at the beacon for the quest log.
- Press **E** next to an agent Clawd to read what it's saying.
- Agents that aren't busy wander around the city.

Controls:
- **1–9** jump to the projects in your hotbar.
- **/** or **Ctrl+K** opens `/tp`.
- **Esc** flies home.
- **☀** cycles day / sunset / night; by default it follows your clock.
- **♪** toggles the sound effects.
- The chat (bottom left) is Claude's live activity.

URL options:
- `?skip` skips the title screen.
- `?time=night` fixes the time of day.
- `?pixel=1` renders crisp, without the chunky pixels.

## Panels

- Click a pod to fly to it. Its panel has four tabs:
  - Overview: your notes on the project
  - Activity: what Claude did, tool by tool
  - Sessions: copy a `claude --resume` command
  - Git: status and recent commits
- Click the orange core, or press **T**, to open Today. Tick items off as you go; the ticks are saved per day.
- Press **Ctrl+K** to jump to any project or agent. Press **Esc** to fly home.
- Status colours:
  - mint: working now
  - amber: waiting on you
  - violet: active in the last couple of hours
  - blue: this week
  - grey: quiet

Set `HQ_NAME=YourName` to change the greeting, and `PORT=` to change the port.
