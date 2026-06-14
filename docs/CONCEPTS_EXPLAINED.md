# MemOS — Every Concept, Explained Simply

> A learning companion. Before (or while) you build MemOS, read this to understand *every* idea the project uses — in plain English, with analogies, why it matters, and how it shows up in your code. No prior knowledge assumed. When something clicks, you'll review Claude's code as a person who *gets it*, not someone nodding along.
>
> Read order: skim it once now, then come back to a section the moment that concept appears in the build.

---

## How to use this doc

Each concept follows the same shape:
- **In one line** — the simplest possible definition.
- **Analogy** — a real-world picture.
- **Why we use it here** — the concrete role in MemOS.
- **Watch for** — the mistake or subtlety to catch when reviewing.

---

# PART A — The Big Picture Concepts

## A1. What "MemOS" actually is (the mental model)
**In one line:** A shared notebook that many AI agents read from and write to, so one agent's discovery helps all the others.

**Analogy:** Imagine a company where everyone has amnesia at the end of each day. MemOS is the shared logbook they all write their findings into and check each morning — so nobody re-solves yesterday's problem.

**Why we use it here:** This is the entire product. Everything else (the API, the database, the gates) exists to keep that shared notebook *trustworthy and useful*.

---

## A2. Client / Server
**In one line:** The **server** is a program that waits for requests and answers them; the **client** is anything that sends requests.

**Analogy:** A restaurant kitchen (server) and customers (clients). Customers send orders; the kitchen prepares and returns food. The kitchen doesn't care *who* the customer is as long as the order is valid.

**Why we use it here:** Your **gateway** is the server. The **AI agents** and the **dashboard** are clients. They talk over HTTP.

**Watch for:** The server should never trust the client. Every request gets re-validated server-side, even if the client "should" have sent good data.

---

## A3. API (Application Programming Interface)
**In one line:** The menu of things a server lets you ask it to do.

**Analogy:** A restaurant menu. You don't walk into the kitchen and cook — you pick from a defined list of dishes. The API is that list of allowed requests.

**Why we use it here:** Agents can't touch the database directly. They can only call the operations on the menu: `fact.record`, `learning.query`, etc.

---

## A4. HTTP & REST vs RPC (this is a key design choice in MemOS)
**In one line:** HTTP is the language clients and servers speak over the web. **REST** and **RPC** are two *styles* of designing an API on top of HTTP.

**Analogy:**
- **REST** = organizing the menu by *nouns* (resources). "Here are our `/facts`, here are our `/learnings`. To create one, POST to `/facts`. To read one, GET `/facts/123`." Very structured around *things*.
- **RPC** (Remote Procedure Call) = organizing the menu by *verbs* (actions). "Here are the things you can *do*: `recordFact`, `queryLearning`." You call an action by name.

**Why we use it here:** MemOS uses **RPC with a single endpoint** — `POST /v1/intent/{name}`. Every action is a verb you name in the URL. We chose this because:
1. One door means we check auth, validate, rate-limit, and log in *one* place (instead of repeating it on every REST route).
2. An AI agent can read the whole API as a flat list of verbs from one file — easy for an LLM to reason about.
3. Every response has the *same shape*, so error handling is mechanical.

**Watch for:** In REST, the HTTP method (GET/POST/PUT/DELETE) carries meaning. In our RPC style, it's always POST and the *intent name* carries the meaning. Don't mix the two styles.

---

## A5. The "uniform envelope"
**In one line:** Every response from the server looks the same on the outside, whether it succeeded or failed.

**Analogy:** Every package from a delivery company arrives in the same box with the same label format — you always know where to look for "did it work?" and "what went wrong?"

**Why we use it here:** Every response is either `{ ok: true, data: {...} }` or `{ ok: false, error: "...", error_type: "..." }`. The agent's code can *always* check `ok` first. No guessing.

**Watch for:** A handler should never "throw" a raw error to the client (which would produce an ugly, inconsistent response). It catches problems and returns the envelope.

---

# PART B — Backend Concepts

## B1. Authentication vs Authorization (auth)
**In one line:** **Authentication** = "who are you?" **Authorization** = "are you allowed to do this?"

**Analogy:** Authentication is showing your ID at the building door. Authorization is whether your keycard opens *this particular room*.

**Why we use it here:**
- *Authentication:* an agent sends a bearer token (`syn_...`); we look it up to learn which agent it is.
- *Authorization (scope):* that agent is only allowed to touch *its* projects. Trying to read another project → denied.

**Watch for:** They're separate steps. A valid token (authenticated) can still be denied an action it has no scope for (not authorized) → that's the 403 case.

---

## B2. Bearer tokens & hashing
**In one line:** A **bearer token** is a secret string that proves who you are ("whoever bears this token is this agent"). **Hashing** is a one-way scramble so we can store a token without keeping the real secret.

**Analogy:** A bearer token is like a movie ticket — whoever holds it gets in; the cinema doesn't check your name. Hashing is like storing a *photo of the ticket's barcode* rather than the ticket itself: you can check a presented ticket against the photo, but a thief who steals your photo collection can't reverse it into real tickets.

**Why we use it here:** On enrollment we generate `syn_...`, show it to the agent *once*, and store only its **hash**. When the agent calls us, we hash what it sent and compare. If our database leaks, the real tokens aren't in it.

**Watch for:** Never log the raw token. Never store it unhashed. "Shown once" means if they lose it, they re-enroll.

---

## B3. Enrollment flow (code → token)
**In one line:** A **single-use code** gets exchanged for a **permanent token**.

**Analogy:** A concert pre-sale code you redeem once for a season pass. The code dies after redemption; the pass is what you keep.

**Why we use it here:** The operator mints an `enr_code_...` for a new agent. The agent calls `agent.enroll` with it (the *only* call needing no token) and gets back its permanent `syn_...`. The code is then consumed.

**Watch for:** Enrollment is the one unauthenticated endpoint. Guard it: codes are single-use, expire, and are tied to specific scopes.

---

## B4. Validation & schemas (Zod)
**In one line:** **Validation** is checking incoming data is shaped correctly *before* you act on it. A **schema** is the rulebook describing the correct shape.

**Analogy:** A bouncer with a checklist: right age, name on the list, dress code. If anything's off, you don't get in — and the bouncer tells you exactly what failed.

**Why we use it here:** **Zod** lets us declare, per intent, "this field is required, this must be one of low/medium/high, this is a UUID." If the agent sends junk, we reject with `400` and a precise `field_errors` list — so the agent (or you) knows exactly what to fix.

**Watch for:** Validation is the *first* line of defense but not the only one. Some rules (like "this artifact must belong to your project") need a database check too — Zod can't know that.

---

## B5. Business rules / invariants
**In one line:** Rules that must *always* be true in your system, beyond just "the data is well-formed."

**Analogy:** A bank rule: "you can't withdraw more than your balance." The withdrawal request can be perfectly well-formed and still be illegal.

**Why we use it here:** MemOS's invariants are its soul:
- *Evidence gate:* a medium/high-confidence claim **must** have attached evidence.
- *Non-obvious gate:* a reusable learning must explain why it's non-obvious.
- *Provenance:* everything links back to the work that produced it.

**Watch for:** These are enforced in *layers* — schema, handler, and database — on purpose (see B11, defense in depth). If you can write a medium-confidence fact with no evidence and it succeeds, the product is broken.

---

## B6. The database & SQL
**In one line:** A **database** is organized, persistent storage. **SQL** is the language for asking it questions and changing it.

**Analogy:** A giant, super-organized spreadsheet system with a precise query language. "Give me every learning tagged `fine-tuning`, newest first."

**Why we use it here:** Postgres stores every agent, OKR, fact, learning, etc. SQL (mostly generated by Drizzle for us) reads and writes them.

---

## B7. Relational database & why Postgres
**In one line:** A **relational** database stores data in tables that *reference each other*, and guarantees those references stay consistent.

**Analogy:** A library where every book record points to a real author record and a real shelf — the system won't let you file a book under an author who doesn't exist.

**Why we use it here:** MemOS is a *graph of relationships*: a fact points to an artifact, a workflow points to an OKR. Postgres enforces that these links are always valid (foreign keys, B8). A loosely-structured store (like a document DB) would let those links rot.

**Watch for:** This relational integrity is *why* the provenance chain is trustworthy. It's not optional polish — it's the foundation.

---

## B8. Primary keys, foreign keys, indexes
**In one line:** A **primary key** uniquely names each row. A **foreign key** is one row pointing at another. An **index** is a lookup shortcut that makes searches fast.

**Analogy:**
- Primary key = a person's unique national ID.
- Foreign key = "emergency contact: ID #4471" — a pointer to another person's record, which the system verifies exists.
- Index = the alphabetical tabs on a filing cabinet; without them you'd flip through every file to find one.

**Why we use it here:**
- PK: every fact/learning/run has a unique id.
- FK: `fact.bd_id` points to a real workflow run; `fact.evidence_artifact_id` points to a real artifact.
- Index: we index `project_id`, `created_at`, tags, and the vector column so queries stay fast as data grows.

**Watch for:** Missing indexes are invisible until the data grows, then everything crawls. Index the columns you filter/join on.

---

## B9. ORM & migrations (Drizzle)
**In one line:** An **ORM** lets you describe and query your database using your programming language instead of raw SQL. **Migrations** are versioned, repeatable scripts that evolve the database structure.

**Analogy:**
- ORM = a translator who turns your TypeScript into SQL and back.
- Migrations = git history for your database shape. Each migration is one reviewable change; you can replay them on any fresh database to rebuild the exact structure.

**Why we use it here:** **Drizzle** keeps the schema as TypeScript (so types flow into your code), and generates migration files. You never hand-edit the live database — you change the schema, generate a migration, review the SQL, apply it.

**Watch for:** Always *read* the generated migration before applying. Auto-generated SQL can do surprising things (e.g. drop-and-recreate a column, losing data).

---

## B10. Multi-tenancy & isolation
**In one line:** **Multi-tenancy** = one system serving many separate customers (tenants) whose data must never mix. **Isolation** = the guarantees that keep them separate.

**Analogy:** An apartment building. One building, many tenants. Your key opens *your* unit only. A bug where your key opens a neighbor's unit is a catastrophe, not a minor glitch.

**Why we use it here:** MemOS serves many orgs/teams/projects. Team A must never see Team B's facts. Every row is stamped with `project_id`, and we enforce "you can only see your projects."

**Watch for:** This is a *security boundary*, so we don't trust handler code alone to enforce it — we push it down to the database (next concept).

---

## B11. Row-Level Security (RLS) & defense in depth
**In one line:** **RLS** is the database itself refusing to return rows you're not allowed to see. **Defense in depth** means enforcing the same rule at multiple layers so one bug doesn't break everything.

**Analogy:** RLS is a vault that checks your clearance on *every single drawer*, not just the front door. Defense in depth is having the front-door guard, the drawer locks, *and* a logbook — three independent checks. A failure in one is caught by the others.

**Why we use it here:** Even if a handler has a bug and forgets to filter by project, Postgres RLS *still* won't return another tenant's rows. We set a per-request "these are your projects" context, and policies on each table enforce it. The handler check + RLS = two independent walls.

**Watch for:** RLS only works if the gateway correctly sets the per-request context (`memos.agent_projects`). Get that wiring right and *test it* with a "can Agent A read Project B?" test that must fail.

---

## B12. Blob storage & why bytes don't go in the database
**In one line:** **Blob storage** is a separate place for big files (logs, images). The database stores only a *pointer* to the file, not the file itself.

**Analogy:** A library catalog (database) stores the call number and shelf location of a book — not a photocopy of every page. The books live on shelves (blob storage).

**Why we use it here:** Evidence artifacts (logs, screenshots) can be large. We store the bytes in MinIO/S3 and keep only `bucket_path` + `sha256` + size in Postgres. This keeps the database small and fast.

**Watch for:** The database row and the blob can get out of sync (row exists, file missing, or vice versa). The `sha256` lets you verify a file is the one you expect.

---

## B13. Idempotency & concurrency
**In one line:** **Idempotent** = doing the same operation twice has the same effect as doing it once. **Concurrency** = multiple things happening at the same time, which can collide.

**Analogy:**
- Idempotency: pressing a crosswalk button twice doesn't summon two green lights. Safe to retry.
- Concurrency: two people editing the same Google Doc paragraph at once — without coordination, one overwrites the other.

**Why we use it here:**
- Agents retry on network blips; an idempotency key stops a retried `fact.record` from creating duplicate facts.
- Two agents might update the same OKR metric at once; optimistic concurrency (check-then-write, retry if it changed under you) prevents lost updates.

**Watch for:** "Exactly once" over a network is hard. Aim for "safe to retry" (idempotent) instead.

---

## B14. Rate limiting
**In one line:** Capping how many requests a client can make in a window, so one client can't overwhelm the system.

**Analogy:** A theme-park ride that lets each person ride a max number of times per hour, so one person can't hog it all day.

**Why we use it here:** A runaway agent in a loop shouldn't be able to flood the gateway and starve everyone else. Per-token buckets; over the limit → `429` with "try again later."

---

## B15. Stateless services & horizontal scaling
**In one line:** **Stateless** = the server keeps no memory between requests; everything it needs comes in the request or from the database. **Horizontal scaling** = handle more load by running more copies.

**Analogy:** Fast-food cashiers who keep nothing personal at their register — any cashier can serve any customer. Busy? Open more identical registers. (The opposite: a single artisan who only *they* can finish their orders — you can't just clone them.)

**Why we use it here:** The gateway holds no per-agent memory between calls (state lives in Postgres). So under load you run 2, 5, 50 copies behind a load balancer and they're interchangeable.

**Watch for:** The moment you stash something in a server's local memory (a cache of who's logged in), you've broken statelessness and made scaling harder. Keep shared state in the database/Redis.

---

## B16. Async work & job queues
**In one line:** **Asynchronous** work happens *later*, off to the side, so the user isn't kept waiting. A **job queue** is the to-do list that background workers pull from.

**Analogy:** At a pharmacy, they take your prescription and say "ready in 20 minutes" instead of making you stand there. The queue is the rack of pending prescriptions; the pharmacists are the workers.

**Why we use it here:** Some work is slow or periodic and shouldn't block the agent's request:
- computing an embedding for a new claim,
- the critic sweeps, DOK grading, brief escalation.
We drop a job on the queue (BullMQ/pg-boss) and return immediately; workers process it.

**Watch for:** Jobs can fail or run twice — make them idempotent and retryable. A backlog should slow *freshness*, never corrupt data.

---

# PART C — AI System Design Concepts

## C1. The Fact vs Learning split
**In one line:** A **fact** is a one-time, verified observation tied to its project. A **learning** is a reusable, generalizable insight other projects could apply.

**Analogy:** A fact is a lab measurement ("on March 3, sample #7 boiled at 98°C"). A learning is the principle you extracted ("at this altitude, water boils below 100°C — adjust recipes"). The measurement is specific; the principle travels.

**Why we use it here:** They have different jobs, lifecycles, and quality bars, so we store them in separate tables. Facts stay project-scoped. Learnings are tagged to travel across projects.

**Watch for:** Don't merge them "to simplify." The whole value of a learning is that it *escapes* its origin project — a fact deliberately doesn't.

---

## C2. Evidence-gating (the most important idea in the project)
**In one line:** You can't record a confident claim without attaching proof.

**Analogy:** Wikipedia's "citation needed." An unsourced bold claim gets rejected; a sourced one stays. This single rule is why people trust the encyclopedia instead of treating it as rumor.

**Why we use it here:** Without it, the shared store fills with confident-sounding guesses and nobody trusts it — so nobody queries it — so it's worthless. Requiring evidence on medium/high claims keeps the signal high enough that querying is *worth it*. It's the load-bearing wall.

**Watch for:** Low-confidence claims are allowed *without* evidence (they're flagged as tentative). The gate kicks in at medium and above.

---

## C3. The "non-obvious" bar for learnings
**In one line:** A learning must explain *why a smart person would have missed it*.

**Analogy:** A good "lessons learned" memo doesn't say "test your code" (everyone knows that). It says "this race condition only appears when the cache TTL exceeds the retry window — which looks unrelated." The non-obviousness is what makes it worth saving.

**Why we use it here:** It forces quality. "Water is wet" learnings are noise. Requiring a `non_obvious_marker` (≥15 chars of reasoning) filters out the obvious and keeps the genuinely useful.

---

## C4. Tagging for cross-silo discovery (`applies_to`)
**In one line:** Label learnings by their *problem domain*, not by which project made them, so other teams can find them.

**Analogy:** Filing a medical research paper under "inflammation, immune response" (concepts other researchers search) instead of "Dr. Smith's Lab 2024" (which only his lab would look up). The second filing buries it.

**Why we use it here:** A learning tagged `vllm-deployment`, `gpu-cloud` surfaces when *any* agent searches those topics. Tagged `sat-rw-project`, it's invisible to everyone outside that project — defeating the entire point.

**Watch for:** This is subtle and easy to get wrong — a critic worker actively hunts for project-name tags and flags them.

---

## C5. Embeddings & semantic search (pgvector)
**In one line:** An **embedding** turns text into a list of numbers that captures its *meaning*, so you can find things by meaning, not just exact words. **Semantic search** is searching by meaning.

**Analogy:** Imagine placing every sentence on a giant map where similar *meanings* sit close together — "the model overfit" lands near "training memorized the data" even though they share no words. To find related notes, you look at what's *nearby on the map*, not what shares keywords.

**Why we use it here:** When an agent asks "anything about epochs causing memorization?", keyword search might miss a learning phrased as "5 epochs degrades vs 3." Embeddings find it by meaning. We compute an embedding for each claim on write and store it in a `vector` column; **pgvector** does the "what's nearby on the map" math inside Postgres.

**Watch for:** Embeddings cost money/time to compute — do it once on write (async), not on every read. And start with plain keyword search (FTS) first; add embeddings when you want better recall.

---

## C6. Full-text search (FTS) vs vector search
**In one line:** **FTS** finds exact words and their variants. **Vector search** finds similar meanings.

**Analogy:** FTS is Ctrl+F that also knows "run/running/ran" are the same word. Vector search is a librarian who understands what you *meant* and brings related books even if your words don't appear in them.

**Why we use it here:** We start with FTS (simple, built into Postgres, no embedding cost) and layer vector search on top for semantic recall. Often you combine both ("hybrid search").

---

## C7. The agent operating loop
**In one line:** The fixed sequence every agent follows on each task: fetch guidance → bind to a goal → work → publish evidence-backed findings → close out.

**Analogy:** A pilot's pre-flight and in-flight checklist. Same steps, every flight, so nothing critical is skipped — even when the pilot is experienced and busy.

**Why we use it here:** It's the behavior that makes the network *work*. If agents skip "publish what you learned," the shared memory stays empty. The loop is documented in the manifest so every agent runs it the same way.

---

## C8. Self-governance: critic agents & dogfooding
**In one line:** The system runs its *own* AI agents that audit the shared store and nudge misbehaving agents. **Dogfooding** = the platform uses itself.

**Analogy:** A neighborhood where some residents volunteer as a watch committee — they live there too (dogfooding), and they flag broken streetlights and file reports (critics) so the whole neighborhood stays nice without a city inspector visiting.

**Why we use it here:** Humans can't manually police thousands of writes. Critic workers scan for evidence-less claims, bad tags, and abandoned work, then file "briefs" back at the offending agents. They're regular MemOS clients themselves — which also proves the platform works.

---

## C9. Trust scores & quality grading (DOK)
**In one line:** Each agent earns a **trust score** based on good behavior; each learning gets a **quality grade** (DOK = Depth of Knowledge, 1–4).

**Analogy:** Trust score = a credit score for agents (pay your dues → score rises → more privileges; misbehave → score drops → access revoked). DOK grade = a peer-review rating on a paper (only well-evidenced, non-obvious ones get the top tier and wide circulation).

**Why we use it here:** Trust scores let the system automatically revoke bad actors. DOK grades push the best learnings to the top of search results and demote shallow ones out of cross-team discovery.

---

## C10. The reuse feedback loop
**In one line:** When an agent *uses* a learning and reports whether it helped, that outcome is recorded — so good learnings rise.

**Analogy:** Product reviews. A tip that helped 50 people (and failed 2) visibly outranks an untested one. The crowd's experience compounds.

**Why we use it here:** `reuse_count` / `reuse_success_count` turn the store from a static pile into a self-ranking system. The most *battle-tested* learnings surface first. This is the "compounding capital" idea — knowledge that gets more valuable as it's used.

---

# PART D — System Design Concepts (HLD + LLD)

## D1. HLD vs LLD
**In one line:** **High-Level Design** is the city map (which neighborhoods, how they connect). **Low-Level Design** is the building blueprint (rooms, wiring, dimensions).

**Analogy:** HLD: "the gateway talks to Postgres and a blob store; workers run on the side." LLD: "the `facts` table has these 9 columns, these 3 indexes, this RLS policy."

**Why we use it here:** Interviewers and collaborators read HLD first to understand the shape, then LLD to judge the rigor. You have both as starter docs (`ARCHITECTURE.md`, `DATA_MODEL.md`).

---

## D2. Separation of concerns & module boundaries
**In one line:** Each part of the system does *one* job and doesn't reach into others' internals.

**Analogy:** A kitchen brigade: the person on grill doesn't also do dishes and accounting. Clear stations mean you can replace or scale one without disturbing the rest.

**Why we use it here:** Gateway (handle requests) ≠ workers (background jobs) ≠ web (UI) ≠ db layer (storage). The monorepo's `packages/` enforce these boundaries. You can rebuild the UI without touching the gateway.

---

## D3. The provenance graph
**In one line:** A web of links showing *where every piece of knowledge came from*: insight → evidence → the work → the goal → the agent.

**Analogy:** A "chain of custody" in forensics — every item of evidence traces back through who handled it, when, and why, so it's admissible. Break the chain and it's worthless.

**Why we use it here:** This chain (threaded by `bd_id` and foreign keys) is what makes the store *trustworthy* rather than just full. It's also the striking visual you'll render with React Flow — clicking a learning lights up its whole lineage.

---

## D4. Eventual consistency
**In one line:** Some things become correct *soon after* an action, not instantly — and that's an acceptable trade.

**Analogy:** You post a photo; your friend sees it a few seconds later, not the same millisecond. The system "catches up." Fine for a feed; not fine for a bank balance.

**Why we use it here:** A new learning's embedding, its DOK grade, and critic attention all happen *async* (slightly later). The fact itself is saved instantly (consistent), but its "extras" arrive shortly. We trade instant-everywhere for speed and scalability.

**Watch for:** Decide per-feature what *must* be instant (the write itself, isolation checks) vs what can lag (embeddings, grades).

---

## D5. Scaling, replicas, backpressure
**In one line:** **Scaling** = handling more load. **Read replicas** = extra copies of the database for reads. **Backpressure** = gracefully slowing down when overwhelmed instead of crashing.

**Analogy:** A popular library opens extra reading-copy branches (replicas) so researchers aren't all fighting over the one master copy. If the returns desk is swamped, books pile up in a holding area (queue) and get processed steadily — the desk doesn't collapse (backpressure).

**Why we use it here:** Dashboard reads and `*.query` calls can hit replicas; writes go to the primary. If critic/embedding jobs pile up, the queue absorbs it and freshness lags — but nothing breaks. Good answers to "how would you scale this to 10k agents?"

---

## D6. Audit logging
**In one line:** A tamper-evident record of who did what, when.

**Analogy:** Security-camera footage for your data — when something looks wrong, you can rewind and see exactly what happened.

**Why we use it here:** Every mutation writes an audit row (agent, action, time, `bd_id`). Essential for debugging, trust, and the "I can see exactly how this knowledge got here" story.

---

# PART E — Frontend Concepts

## E1. Frontend vs Backend
**In one line:** **Frontend** is what the user sees and clicks (in the browser). **Backend** is the server/database doing the work behind it.

**Analogy:** A car's dashboard and steering wheel (frontend) vs the engine and transmission (backend). You interact with one; the other does the heavy lifting.

**Why we use it here:** The operator dashboard is frontend (Next.js in the browser). The gateway/DB are backend. They talk over HTTP.

---

## E2. React & components
**In one line:** **React** builds UIs out of reusable **components** — self-contained pieces (a button, a card, a chart) you compose like LEGO.

**Analogy:** LEGO bricks. You build a `Button` brick once and snap it in everywhere. Change the brick, every usage updates.

**Why we use it here:** The dashboard is React components: an `OkrCard`, an `ActivityFeedItem`, a `ProvenanceGraph`. Composing them builds the whole UI.

---

## E3. Next.js, SSR, and the App Router
**In one line:** **Next.js** is a framework on top of React that can render pages on the *server* (faster first load, better for data) as well as in the browser.

**Analogy:** A restaurant that can either hand you ingredients to assemble at your table (browser rendering) *or* serve the dish ready-made from the kitchen (server rendering). Next.js does both, choosing what's best per page.

**Why we use it here:** Data-heavy pages (the OKR tree) render on the server (fast, secure — secrets stay server-side); interactive pieces (the live feed) run in the browser. The "App Router" is Next.js's modern way of organizing this.

---

## E4. Server vs client components
**In one line:** **Server components** run on the server and can safely talk to the database; **client components** run in the browser and handle interactivity (clicks, live updates).

**Analogy:** The kitchen (server component) preps and plates; the waiter at your table (client component) handles your live requests ("more water!"). Each does what it's positioned for.

**Why we use it here:** Fetch the OKR data in a server component (close to the DB, no secrets leaked); make the live activity feed a client component (it needs to react to real-time events).

**Watch for:** Don't put secrets (DB credentials, API keys) in client components — they ship to the browser where anyone can read them.

---

## E5. Design systems (Tailwind, shadcn/ui)
**In one line:** A **design system** is a consistent kit of styles and pre-built components so everything looks coherent. **Tailwind** styles via utility classes; **shadcn/ui** gives you polished, accessible components to start from.

**Analogy:** A brand style guide + a box of matching, professionally-designed parts. You don't reinvent a button's look each time — you use the kit, so the whole app feels like one product.

**Why we use it here:** It's how you get an "extraordinary UI" *fast*. shadcn gives you beautiful primitives; Tailwind keeps spacing/colors consistent. You spend your effort on the *signature* pieces, not on restyling buttons.

---

## E6. Realtime (WebSockets / SSE)
**In one line:** Technology that lets the server *push* updates to the browser the instant they happen, instead of the browser repeatedly asking "anything new?"

**Analogy:** A group chat where messages appear instantly (push) versus refreshing your email every minute to check (polling). Push is live; polling is laggy and wasteful.

**Why we use it here:** The live activity feed — new checkins/facts/learnings stream in and animate onto the screen the moment an agent writes them. That liveness is the demo's "wow" moment. Supabase Realtime or SSE delivers the push.

---

## E7. Data visualization (Recharts, React Flow)
**In one line:** Turning numbers and relationships into pictures. **Recharts** draws charts; **React Flow** draws node-and-edge graphs you can drag and click.

**Analogy:** A dashboard of gauges and a subway map. The gauges (Recharts) show progress at a glance; the subway map (React Flow) shows how stations connect.

**Why we use it here:** Recharts for OKR rollup progress bars. React Flow for the **provenance graph** — the interactive lineage of a piece of knowledge. The latter is conceptually deep *and* visually striking — your standout screenshot.

---

# PART F — Workflow & Tooling Concepts

## F1. Monorepo
**In one line:** One repository holding multiple related projects (gateway, workers, web, SDK) that share code.

**Analogy:** One apartment building housing related families who share a lobby and utilities — versus everyone in scattered houses across town. Easier to coordinate, one front door.

**Why we use it here:** Gateway + web + workers + SDK live together and share types (so the frontend and backend can't disagree about a fact's shape). One clone, one install, everything in sync.

---

## F2. Migrations as version control for your database
**In one line:** Treat database structure changes like code commits — small, reviewable, replayable.

**Analogy:** Git history, but for table shapes. Anyone can replay the migrations on a blank database and get the *exact* structure, every time.

**Why we use it here:** Reproducible databases (dev, CI, prod all identical), reviewable schema changes, and the ability to roll forward safely. Covered by the `db-migration` skill.

---

## F3. Testing & invariant tests
**In one line:** Automated checks that your code does what it should — and keeps doing it as you change things. **Invariant tests** specifically guard the rules that must *never* break.

**Analogy:** A smoke detector you test monthly. It exists precisely so that a future change doesn't silently disable safety. An invariant test for "evidence-less medium write must be rejected" screams the instant someone weakens that gate.

**Why we use it here:** The evidence gate, the isolation boundary, the provenance checks — each gets a test that *fails loudly* if a future edit breaks it. This is how you refactor fearlessly. The `evidence-gate-check` skill is the merge gate for write-path changes.

---

## F4. CI (Continuous Integration)
**In one line:** A robot that automatically runs your tests/lint/type-checks on every change, so broken code is caught before it lands.

**Analogy:** An automatic quality-control line in a factory — every item is inspected before it ships, no human has to remember to check.

**Why we use it here:** GitHub Actions runs typecheck + tests + lint on every push. If you (or Claude) break an invariant, CI catches it. It's also a hygiene signal reviewers respect.

---

## F5. ADRs (Architecture Decision Records)
**In one line:** Short notes capturing *why* you made a significant design choice, including the alternatives you rejected.

**Analogy:** A ship captain's logbook entry explaining why they chose a route around a storm — so future crews understand the reasoning, not just the destination.

**Why we use it here:** This is what proves *you* drove the architecture (not just accepted defaults). "Why intent-RPC over REST," "why RLS at the DB" — each an ADR. They're gold in interviews and keep your future self from re-litigating settled decisions. The `write-adr` skill generates them.

---

## F6. The agentic build setup (skills, plan mode, CLAUDE.md)
**In one line:** Configuring Claude Code so it builds *consistently and the way you want*, while you stay the reviewer.

**Analogy:** A head chef (you) with a well-trained kitchen: standard recipes (skills), a rule that big dishes get approved before cooking (plan mode), and a posted kitchen policy (CLAUDE.md). You taste and direct; the line cooks execute reliably.

**Why we use it here:** Skills encode repeatable workflows so output is uniform. Plan mode keeps you in the architect's seat. `CLAUDE.md` carries the rules into every session. This is *how* you go fast without losing understanding — you review plans and diffs, not keystrokes.

---

# Quick glossary (one-liners to jog memory)

- **API** — the menu of allowed requests to a server.
- **RPC** — calling a server action by its verb name (our style).
- **Envelope** — the uniform `{ok, data/error}` response shape.
- **Authentication / Authorization** — who you are / what you may do.
- **Bearer token** — a secret string that proves identity.
- **Hashing** — one-way scramble; store the scramble, not the secret.
- **Zod** — declares the required shape of incoming data.
- **Invariant** — a rule that must always hold.
- **Postgres** — our relational database.
- **Primary/Foreign key** — unique row name / verified pointer to another row.
- **Index** — a lookup shortcut for fast queries.
- **ORM (Drizzle)** — write DB code in TypeScript; it generates SQL.
- **Migration** — a versioned, replayable DB-structure change.
- **Multi-tenancy** — one system, many isolated customers.
- **RLS** — the database enforcing per-row access control.
- **Defense in depth** — same rule enforced at multiple layers.
- **Blob storage** — separate home for big files; DB holds a pointer.
- **Idempotent** — safe to repeat; same effect each time.
- **Stateless** — server keeps no memory between requests → easy to scale.
- **Job queue** — to-do list for background workers.
- **Fact vs Learning** — point-in-time observation vs reusable insight.
- **Evidence gate** — no confident claim without proof.
- **Embedding** — text turned into meaning-numbers for semantic search.
- **pgvector** — semantic search inside Postgres.
- **Provenance** — the traceable origin chain of each piece of knowledge.
- **Critic agents** — the system auditing itself.
- **Trust score / DOK** — agent reputation / learning quality grade.
- **HLD / LLD** — city map / building blueprint.
- **Eventual consistency** — correct soon, not instantly (an accepted trade).
- **Monorepo** — one repo, many related projects sharing code.
- **Component (React)** — a reusable UI building block.
- **SSR / server vs client components** — render on server vs in browser.
- **Realtime (SSE/WebSocket)** — server pushes live updates to the browser.
- **ADR** — a recorded "why we chose this" decision.

---

*This is a learning scratchpad, not a spec. The authoritative build docs are `PROJECT_DOC.md`, `ARCHITECTURE.md`, and `DATA_MODEL.md`. When a concept here appears in real code during the build, come back, re-read its section, then go read the code — that loop is how it sticks.*
