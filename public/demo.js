// Demo data for the hosted version (GitHub Pages has no server and must never see real session logs).
// Shapes match /api/state from server.mjs; times are relative to "now" so everything looks fresh.
const M = 60e3, H = 60 * M, D = 24 * H;

const PROJECTS = [
  ['weather-bot', 'Weather Bot', 'working', 2 * M, 'A Telegram bot that sends a rain alert before you leave home.'],
  ['pixel-portfolio', 'Pixel Portfolio', 'recent', 40 * M, 'Personal site with a head that follows your cursor.'],
  ['recipe-api', 'Recipe API', 'recent', 95 * M, 'REST API for recipes, with search and a nutrition calculator.'],
  ['launch-video', 'Launch Video', 'week', 1 * D, 'A 30-second stop-motion launch video made with Remotion.'],
  ['invoice-ninja', 'Invoice Tool', 'week', 2 * D, 'Small invoicing app for freelancers.'],
  ['tokyo-rain', 'Tokyo Rain World', 'week', 3 * D, 'Three.js rainy Tokyo you can walk around in.'],
  ['blinky', 'Blinky', 'week', 4 * D, 'Tap anywhere and the character blinks.'],
  ['gandhi-jayanti', 'Gandhi Jayanti Site', 'week', 5 * D, 'Scroll tribute: Bapu steps out of a portrait and walks to the sea.'],
  ['ebook-forge', 'Ebook Forge', 'quiet', 9 * D, 'Generates Kindle ebooks from an outline.'],
  ['dental-outreach', 'Dental Outreach', 'quiet', 12 * D, 'Demo dentist websites for cold outreach.'],
  ['n8n-backup', 'n8n Backup', 'quiet', 16 * D, 'Nightly backup of n8n workflows.'],
  ['blog-pipeline', 'Blog Pipeline', 'quiet', 21 * D, 'AI blog automation: research, write, publish.'],
];
const TOOLS = [['Edit', 'index.html'], ['Read', 'server.js'], ['Bash', 'npm test'], ['Write', 'README.md'], ['Grep', '"TODO"'], ['Edit', 'style.css'], ['Bash', 'git status'], ['Read', 'package.json'], ['WebSearch', 'three.js instancing'], ['Edit', 'app.js']];

export function buildDemo() {
  const now = Date.now();
  const projects = PROJECTS.map(([id, name, status, age, hook], i) => {
    const lastTs = now - age;
    const activity = Array.from({ length: status === 'quiet' ? 3 : 8 }, (_, k) => {
      const [tool, detail] = TOOLS[(i * 3 + k) % TOOLS.length];
      return { ts: lastTs - k * 4 * M, tool, detail, project: id, session: `${name} session` };
    });
    return {
      id, root: `~/projects/${id}`, name, status, lastTs, lastCommit: lastTs - 30 * M, weight: 40 - i * 2, live: null,
      notes: { title: name, hook, file: `${id}.md`, text: `${hook}\n\n**This is demo data.** Run Claude HQ on your own machine to see your real projects, agents and to-dos.` },
      sessions: [{ id: `demo-${id}-1`, title: `${name} session`, lastTs, weight: 30 }],
      activity,
      git: { branch: 'main', remote: null, dirty: i === 1 ? 3 : i === 4 ? 1 : 0, changes: i === 1 ? [' M index.html', ' M style.css', '?? avatar.png'] : i === 4 ? [' M invoice.js'] : [], ahead: i === 2 ? 2 : 0,
        commits: [{ h: 'a1b2c3d', s: 'Polish the landing page', t: lastTs - H }, { h: 'e4f5a6b', s: 'Add tests', t: lastTs - 3 * H }] },
    };
  });
  const agents = [
    { id: 'demo-a1', title: 'Rain alerts for Weather Bot', state: 'working', question: null, project: 'weather-bot', lastTs: now - 30e3, prompts: 12, cost: 1.84,
      lastPrompt: 'make the bot send a rain alert at 8am', lastText: 'Adding the 8am schedule and a test for it.', activity: projects[0].activity.slice(0, 6) },
    { id: 'demo-a2', title: 'Portfolio cursor head', state: 'waiting', question: 'Should the head follow the cursor on mobile too, or stay still?', project: 'pixel-portfolio', lastTs: now - 6 * M, prompts: 7, cost: .92,
      lastPrompt: 'make the head follow the cursor', lastText: 'Done on desktop. Should the head follow the cursor on mobile too, or stay still?', activity: projects[1].activity.slice(0, 6) },
    { id: 'demo-a3', title: 'Recipe API search', state: 'idle', question: null, project: 'recipe-api', lastTs: now - 70 * M, prompts: 9, cost: 1.2,
      lastPrompt: 'add search by ingredient', lastText: 'Search by ingredient is in, with tests passing.', activity: projects[2].activity.slice(0, 6) },
  ];
  const today = [
    { id: 'reply:demo-a2', kind: 'reply', pr: 0, project: 'pixel-portfolio', title: 'Answer Claude in “Portfolio cursor head”', why: agents[1].question, done: false },
    { id: 'commit:pixel-portfolio', kind: 'ship', pr: 2, project: 'pixel-portfolio', title: 'Commit 3 changes in Pixel Portfolio', why: 'M index.html · M style.css · ?? avatar.png', done: false },
    { id: 'push:recipe-api', kind: 'ship', pr: 2, project: 'recipe-api', title: 'Push 2 commits in Recipe API', why: 'origin/main', done: false },
    { id: 'commit:invoice-ninja', kind: 'ship', pr: 2, project: 'invoice-ninja', title: 'Commit 1 change in Invoice Tool', why: 'M invoice.js', done: false },
    { id: 'loop:n8n', kind: 'loop', pr: 3, project: 'n8n-backup', title: 'The backup server is being cancelled next month — pick a new home.', why: 'from your notes on n8n Backup', done: false },
    { id: 'cont:weather-bot', kind: 'momentum', pr: 4, project: 'weather-bot', title: 'Keep going on Weather Bot', why: 'last: Rain alerts for Weather Bot', done: false },
  ];
  const feed = projects.slice(0, 3).flatMap((p) => p.activity.map((a) => ({ ...a, sid: 'demo' }))).sort((a, b) => b.ts - a.ts).slice(0, 20);
  return {
    demo: true, generatedAt: now, date: new Date().toISOString().slice(0, 10), user: 'Explorer',
    stats: { working: 1, waiting: 1, agents: 3, projects: projects.length, sessionsToday: 3, promptsToday: 28, costToday: 3.96 },
    projects, agents, today, feed,
  };
}

/** Make the demo feel alive: every few seconds the working agent "does" something. */
export function tickDemo(S) {
  const a = S.agents[0], [tool, detail] = TOOLS[Math.floor(Math.random() * TOOLS.length)];
  const ev = { ts: Date.now(), tool, detail, project: a.project, session: a.title, sid: 'demo' };
  a.activity.unshift(ev); a.activity.length = Math.min(a.activity.length, 8); a.lastTs = ev.ts;
  const p = S.projects.find((x) => x.id === a.project); p.activity.unshift(ev); p.activity.length = 8; p.lastTs = ev.ts;
  S.feed.unshift(ev); S.feed.length = 20;
  S.generatedAt = Date.now();
  return S;
}

export const DEMO_BRIEF = `# A focused day: unblock, ship, then build
## Do first
- Answer Claude about the cursor head on mobile, so Pixel Portfolio can ship.
- Commit and push Pixel Portfolio's 3 changes.
## Then
- Push Recipe API's 2 commits.
- Keep going on Weather Bot's rain alerts.
## Can wait
- Choose a new home for the n8n backup before the server is cancelled.

*(Demo plan. Locally, Claude writes this from your real projects.)*`;
