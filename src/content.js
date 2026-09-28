// Generated from content/facts.md by the Coder stage of the /ship pipeline.
// Every value below is the facts.md text for that ID, verbatim, with any
// trailing " **(confirm)**" marker removed. To change copy, edit
// content/facts.md and rerun the pipeline -- never hand-edit the values here.
export const FACTS = {
  P1: '문다니엘 · Daniel Moon',
  P2: 'Seoul National University, College of Engineering — B.S. Electrical and Computer Engineering (Mar 2020 – Feb 2027, expected)',
  P3: 'AI Hardware Researcher — computer architecture, FPGA-based AI accelerators and NPU design, bridging neural-network algorithms and silicon-level optimization.',
  P4: 'Focus: Computer Architecture · FPGA Accelerators · SoC Design · NPU Optimization · Diffusion LLMs',
  P5: 'Born and raised in Kolkata (Calcutta), India; moved to Seoul for Electrical and Computer Engineering at SNU.',
  P6: 'Languages — English (native), Korean (native), Hindi (third language)',
  P7: 'Every project is framed as 문제 → AI 활용 → 결과물.',
  M1: 'Title: AI-Agent–Assisted MoE Inference Optimization',
  M2: '사용된 모델: Claude Opus, GPT Sol 5.5 Ultra',
  M3: 'Headline: AI 에이전트를 연구 파트너로 활용한 MoE LLM 추론 최적화',
  M4: 'Sub-headline: 메모리 병목을 줄이는 MoE 양자화 설계',
  M5: 'Status: 비공개 연구 (no public link)',
  E1: '사용된 모델: Claude Opus, GPT Sol 5.5 Ultra',
  E2: '링크: https://github.com/zlnnny/CES_Project.git',
  E3: '문제: 리더의 발언이 시장을 움직이지만, 기존 서비스는 헤드라인이나 가격 차트만 보여줄 뿐 어떤 말이 어떤 자산을 움직였는지 설명하지 못합니다.',
  E4: 'AI 활용: 6인 팀에서 NLP 스코어링을 맡아 두 모델과 설계·구현을 반복했습니다. 키워드 사전 기반 감성 분석을 SBERT 임베딩–앵커 문장 유사도 방식으로 바꿔 라벨 데이터 없이 감성(-1~1)과 매파/비둘기파 톤을 판별하게 했고, 긴급 키워드·수치 언급 등 뉴스 중요도 요인과 튜닝 가중치, 같은 산업 자산 간 영향 전파를 구현했습니다.',
  E5: '결과물: 발언이 수집되면 인물–자산 영향 그래프가 자동 갱신(감쇠 ρ=0.9)되고, GNN식 메시지 패싱으로 인물·국가·산업별 Power Ranking을 보여주는 웹 서비스(FastAPI·React·PostgreSQL/pgvector)를 완성했습니다.',
  E6: 'SBERT model: sentence-transformers/all-MiniLM-L6-v2. Tone = Hawkish / Dovish / Neutral.',
  E7: 'Anchor sentence examples — positive: "Markets rally after strong earnings and upbeat outlook"; negative: "Shares plunge after weak results and lowered guidance"; hawkish: "Central bank signals rate hikes to fight inflation"; dovish: "Central bank signals rate cuts to support growth".',
  E8: 'News importance factors, each with a tunable multiplier: descriptor overlap, asset hits, urgency keywords, numeric mentions, recency decay with a 24-hour half-life.',
  E9: 'Stack: FastAPI, React (Vite), PostgreSQL + pgvector, Docker Compose. Team of 6.',
  A1: '사용된 모델: Claude Opus, Claude Sonnet',
  A2: '링크: 첨부 포트폴리오',
  A3: '문제: 에이전트 하나에 기획·구현·테스트·리뷰를 모두 맡기면 컨텍스트가 뒤섞여 품질이 떨어지고, 매 단계 사람이 병목이 됩니다.',
  A4: 'AI 활용: Claude Code 서브에이전트로 4인 개발팀 파이프라인을 만들었습니다. ①Planner(Opus)는 코드를 쓰지 않고 요구사항을 파일 경로·인터페이스·엣지 케이스가 담긴 spec으로 만들며, 모호하면 OPEN QUESTION으로 멈춥니다. ②Coder(Sonnet)는 spec 범위만 구현합니다. ③Tester(Sonnet)는 정상·경계·실패 케이스를 테스트하고, 실패하면 코드를 고치지 않고 파이프라인을 멈춥니다. ④Reviewer(Opus)는 수정 권한 없는 읽기 전용으로 git diff와 원본 자료를 대조해 SHIP/NEEDS WORK/BLOCK을 판정합니다. 에이전트는 .pipeline/ 파일(spec→changes→test-results→review)로만 인수인계해 각자 좁은 컨텍스트를 유지하고, /ship 한 줄로 전 과정이 실행됩니다. 토큰 소모가 큰 구현·테스트는 Sonnet에 맡겨 토큰의 약 70%를 저비용 모델이 처리하도록 설계했습니다.',
  A5: '결과물: 이 지원서에 첨부한 포트폴리오가 바로 이 파이프라인의 산출물입니다. 밤에 /ship을 걸어두면 아침에 review.md 판정이 기다리고, 자동 병합 없이 최종 승인은 제가 합니다.',
  W1: 'Title: AI Workflow — AI 에이전트를 한 팀처럼 쓰는 법',
  W2: 'Credit: pattern adapted from Ray Fu, "How to Build a 4-Agent Dev Team That Ships Features While You Sleep" — https://www.raycfu.com/guides/four-agent-dev-team',
  W3: 'Why a team, not one agent: one agent that plans, codes, tests and reviews carries all of it in a single context window, and quality drops. Four specialists each keep a clean, narrow context and do one job well.',
  W4: 'The team —',
  'W4.1': 'Planner (Claude Opus): turns a request into a spec with exact file paths, interfaces, edge cases and patterns to follow. Writes no code; anything ambiguous becomes an OPEN QUESTION and the run stops.',
  'W4.2': 'Coder (Claude Sonnet): builds exactly what the spec says — no extra features, no refactors outside scope — and writes a summary of what changed.',
  'W4.3': "Tester (Claude Sonnet): writes and runs tests for the happy path, the spec's edge cases and at least one failure case. If a test fails, it reports and stops; it never fixes the code itself.",
  'W4.4': 'Reviewer (Claude Opus): read-only. Compares the diff with the spec, judges whether the tests mean anything, checks security, performance and correctness, and gives a verdict: SHIP, NEEDS WORK or BLOCK.',
  W5: 'Handoffs are files, not conversations: .pipeline/spec.md → changes.md → test-results.md → review.md. Each agent reads only what the previous one left.',
  W6: 'One command runs it all: /ship <request> runs the four stages in order and confirms each handoff file exists before moving on.',
  W7: 'Right model for each job: Opus where one careful decision sets the ceiling (planning and review, once per feature); Sonnet where most tokens are spent (coding and testing). By design, about 70% of tokens go to Sonnet and 30% to Opus.',
  W8: `Why the Reviewer can't edit code: a reviewer that can patch problems tends to hide them; one that can only judge has to report them. "Green tests are not the same as correct behavior." — Ray Fu`,
  W9: 'A human stays the last gate: nothing merges automatically. Start /ship before bed, read review.md in the morning, and merge only after a SHIP verdict and your own look at the code.',
  W10: 'Habits that make it work: write specific requests; start with small, bounded features; read every .pipeline file to learn how the agents think; clear .pipeline between runs; run parallel features in separate git worktrees.',
  W11: 'This site is the proof: every change to it was made by a /ship run of this pipeline.',
  W12: 'Files that define the team: .claude/agents/ (planner, coder, tester, reviewer), .claude/commands/ship.md, and the .pipeline/ handoff folder.',
  G1: 'danielmoon0410.github.io — The repository behind this site: the playable 3D portfolio you are exploring, built with the four-agent pipeline. Before this, it hosted my academic single-page portfolio (About, CV, Publications, Personal). Link: https://github.com/danielmoon0410/danielmoon0410.github.io',
  G2: 'influence-insights — A platform that tracks how influential people move market assets using AI news analysis. React, TypeScript, Vite, Tailwind CSS and shadcn/ui on Supabase (Lovable Cloud). Serverless functions crawl news (Firecrawl), analyze each article with Gemini 2.5 Flash through the Lovable AI Gateway (sentiment from −1 to 1, plus the people and assets mentioned) and compute influence scores with a 7-day half-life decay, normalized to 0–100. Pages: dashboard, Power Rankings, markets, news, person and asset details. 66 commits; created Jan 2026. Link: https://github.com/danielmoon0410/influence-insights',
  G3: 'CES2026 — Team hub for the six-member CES 2026 project: members, majors, interests and the on-site schedule in the US. Created Sep 2025. Link: https://github.com/danielmoon0410/CES2026',
  G6: 'Contributed: zlnnny/CES_Project (EchoNomics) — see Project 02.',
  K1: 'Seoul National University — B.S. Electrical and Computer Engineering, Mar 2020 – Feb 2027 (expected graduation)',
  K2: 'Calcutta International School, Kolkata — Valedictorian, 2007 – 2019',
  K3: 'VLSI Lab, Seoul National University (Prof. Jaejoon Kim) — Undergraduate Student Researcher, Dec 2025 – May 2026: graduation paper research, Dynamic Block Decoding for Diffusion-based Language Models',
  K4: 'CMA Lab, Seoul National University (Prof. Sungjoo Yoo) — Undergraduate Researcher, Jul 2025 – Dec 2025: diffusion language model inference optimization; microscaling floating-point implementations',
  K5: 'HyperAccel (Korean NPU startup), FPGA System Team — Research Assistant (intern), Dec 2024 – Jul 2025: run-time software across FPGA devices for efficient LLM inference; LPU architecture FPGA migration assistance — AMD Alveo U55C → V80, U55C → Achronix Speedster7t, V80 → AWS EC2 F2',
  K6: 'CAPP Lab, Seoul National University (Prof. Taeho Lee, Nguyen Xuan Truong) — Undergraduate Researcher, Jul 2024 – Oct 2024: FPGA-based CNN accelerator for 3D convolution models (YOLOv3, UNet, 3D UNet)',
  K7: 'Republic of Korea Army, Ministry of National Defense Honor Guard — Sergeant, Sep 2021 – Mar 2023',
  K8: 'Publication — ISCAS 2025 (accepted): "An Energy-Efficient Daily Surveillance System with DVS-CIS Sensor Fusion and Event-based NPU Triggering", third author, lecture session and poster',
  K9: 'Other projects — Social Media-Driven Financial Market Prediction (SNU, Spring 2026); CNN Inference Architecture Design (AIX Design Contest, Summer 2025, Nexys A7-100T); CIS-DVS Sensor Fusion System (CAPP Lab, Fall 2024); ETRI Fashion-How self-improving AI competition (Summer 2024)',
  K10: 'Activities — Samsung Shining Star: team captain in a semiconductor product-development program, 3rd place. SURI investment club: strategy department.',
  K11: 'Skills — C/C++, Python, Verilog · Vivado, Git, LaTeX · AMD Alveo, Xilinx Zynq, Nexys A7, Achronix Speedster7t',
  K12: "Highlight: HyperAccel — redesigned the address mapping from U55C's 32 HBM channels to V80's 64 and built a C/C++ custom runtime for QDMA.",
  K13: 'Highlight: CAPP Lab — pipelined camera capture, FPGA inference and display with 3 threads and ring buffers: about 10 FPS → 58 FPS.',
  K14: 'Georgia Institute of Technology, GT Synergy Lab (Prof. Tushar Krishna) — Undergraduate Student Researcher (remote intern from Seoul), May 2026 – present',
  U1: 'Interactive site: https://danielmoon0410.github.io/ (replaces the current site at deployment)',
  L1: 'Title of the EchoNomics details block: 구현 디테일',
  L2: 'Section titles in the 2D view and panels: About · Projects · AI Workflow · GitHub · Career · Contact',
  C1: 'GitHub — https://github.com/danielmoon0410',
  C2: 'Email — daniel.moon0410@gmail.com',
  C3: 'Email — daniel.moon0410@snu.ac.kr',
  C4: 'LinkedIn — https://www.linkedin.com/in/daniel-moon-35948b269',
  C5: 'Instagram — https://www.instagram.com/__danielmoon__/',
  C6: 'Facebook — https://www.facebook.com/daniel.moon.33449',
  C7: "Download CV — assets/CV_resume.pdf (Daniel's current CV, carried over from the old site; button label: Download CV)",
  V1: 'DANIEL MOON — Portfolio, now playable.',
  V2: '이 PDF는 예고편입니다. 본편은 직접 운전해서 보세요.',
  V3: '▶ PRESS START',
  V4: '스캔하면 바로 시동이 걸립니다.',
  V5: '조작법 — W A S D 주행 · Space 브레이크 · R 리셋',
  V6: "바쁘신 심사위원을 위한 치트키: 'Skip to projects' 버튼 하나면 모든 내용을 2D로 볼 수 있습니다.",
  V7: '모바일에서는 화면 속 컨트롤로 운전하세요.',
  V8: '월드맵 — 모든 스테이션을 돌면 제 이야기가 끝납니다. 과속은 권장합니다.',
  V9: '이 PDF도 같은 4인 에이전트 파이프라인이 설계하고 만들었습니다. 최종 판정은 Reviewer와 제가 합니다.',
  V10: '혼자 다 하는 천재 에이전트 대신, 한 가지씩 잘하는 네 명의 팀원.',
  V11: '초록색 테스트가 정답을 뜻하지는 않습니다. 그래서 마지막 판정은 읽기 전용 Reviewer와 제가 합니다.',
  V12: '자세한 설계는 아직 비공개입니다. 궁금하시면 면접에서 화이트보드로 설명드리겠습니다.',
  V13: 'HBM처럼 한 층씩 쌓아 올린 경력.',
  V14: '커밋은 거짓말을 하지 않습니다.',
  V15: '말 한마디에 시장이 움직입니다. 그 한마디를 숫자로 바꿨습니다.',
  V16: '캘커타에서 서울까지, 소프트웨어에서 실리콘까지.',
  V17: 'GAME OVER? 아니요 — 인터뷰 스테이지로 이동합니다.',
  V18: 'CONTINUE? ▶ YES',
  V19: 'Made with Claude Code — Planner, Coder, Tester, Reviewer, and one human with the final say.',
};

export const HEADINGS = {
  // facts.md: "## Project 02 -- EchoNomics: Visualizing How Words Move Markets"
  p02: 'EchoNomics: Visualizing How Words Move Markets',
  // facts.md: "## Project 03 -- AI Portfolio Agent"
  p03: 'AI Portfolio Agent',
};

export const UI_TEXT = {
  skip: 'Skip to projects',
  back3d: 'Return to the 3D world',
  close: 'Close',
  workflowLink: 'AI Workflow \u2192',
  letters: 'DANIEL MOON',
};

export const SECTIONS = ['about', 'projects', 'workflow', 'github', 'career', 'contact'];

export const CV = {
  label: { id: 'C7', upTo: ' \u2014 ' },
  href: 'assets/CV_resume.pdf',
};

// Section titles are derived from FACTS.L2 so they are never written as literals.
const SECTION_TITLE_PREFIX = 'Section titles in the 2D view and panels: ';
const SECTION_TITLE_PARTS = FACTS.L2.slice(SECTION_TITLE_PREFIX.length).split(' \u00b7 ');
function sectionTitleFor(sectionId) {
  return SECTION_TITLE_PARTS[SECTIONS.indexOf(sectionId)];
}

const ABOUT_TITLE = sectionTitleFor('about');
const CONTACT_TITLE = sectionTitleFor('contact');

export const STATIONS = [
  {
    id: 'about',
    section: 'about',
    label: ABOUT_TITLE,
    sign: [ABOUT_TITLE],
    accent: 'trace',
    title: { fact: 'P1' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'P2' },
        { id: 'P3' },
        { id: 'P4', split: true },
        { id: 'P5' },
        { id: 'P6' },
        { id: 'P7' },
      ] },
      { kind: 'cv', panelOnly: true },
    ],
  },
  {
    id: 'moe',
    section: 'projects',
    label: 'Project 01 \u2014 MoE Expert District',
    sign: ['Project 01', 'MoE Expert District'],
    accent: 'cyan',
    title: { fact: 'M1', strip: 'Title: ' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'M2', split: true },
        { id: 'M3', strip: 'Headline: ' },
        { id: 'M4', strip: 'Sub-headline: ' },
        { id: 'M5', strip: 'Status: ' },
      ] },
    ],
  },
  {
    id: 'echonomics',
    section: 'projects',
    label: 'Project 02 \u2014 EchoNomics Trading Floor',
    sign: ['Project 02', 'EchoNomics Trading Floor'],
    accent: 'amber',
    title: { text: HEADINGS.p02 },
    blocks: [
      { kind: 'lines', items: [
        { id: 'E1', split: true },
        { id: 'E2', split: true, link: { href: 'https://github.com/zlnnny/CES_Project.git' } },
        { id: 'E3', split: true },
        { id: 'E4', split: true },
        { id: 'E5', split: true },
      ] },
      { kind: 'details', summary: { id: 'L1', strip: 'Title of the EchoNomics details block: ' }, items: [
        { id: 'E6', split: true },
        { id: 'E7' },
        { id: 'E8', split: true },
        { id: 'E9', split: true },
      ] },
    ],
  },
  {
    id: 'portfolio-agent',
    section: 'projects',
    label: 'Project 03 \u2014 AI Portfolio Agent',
    sign: ['Project 03', 'AI Portfolio Agent'],
    accent: 'magenta',
    title: { text: HEADINGS.p03 },
    blocks: [
      { kind: 'lines', items: [
        { id: 'A1', split: true },
        { id: 'A2', split: true },
        { id: 'A3', split: true },
        { id: 'A4', split: true },
        { id: 'A5', split: true },
      ] },
    ],
  },
  {
    id: 'workflow',
    section: 'workflow',
    label: 'AI Workflow \u2014 Agent Factory',
    sign: ['AI Workflow', 'Agent Factory'],
    accent: 'violet',
    title: { fact: 'W1', strip: 'Title: ' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'W3', split: true },
      ] },
      { kind: 'list', intro: { id: 'W4' }, items: [
        { id: 'W4.1', split: true },
        { id: 'W4.2', split: true },
        { id: 'W4.3', split: true },
        { id: 'W4.4', split: true },
      ] },
      { kind: 'lines', items: [
        { id: 'W5', split: true },
        { id: 'W6', split: true },
      ] },
      { kind: 'pagelink', href: 'workflow.html', text: UI_TEXT.workflowLink },
    ],
  },
  {
    id: 'gh-portfolio',
    section: 'github',
    label: 'GitHub District \u2014 danielmoon0410.github.io',
    sign: ['GitHub District', 'danielmoon0410.github.io'],
    accent: 'cyan',
    title: { text: 'danielmoon0410.github.io' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'G1', link: { href: 'https://github.com/danielmoon0410/danielmoon0410.github.io' } },
      ] },
    ],
  },
  {
    id: 'gh-influence',
    section: 'github',
    label: 'GitHub District \u2014 influence-insights',
    sign: ['GitHub District', 'influence-insights'],
    accent: 'magenta',
    title: { text: 'influence-insights' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'G2', link: { href: 'https://github.com/danielmoon0410/influence-insights' } },
      ] },
    ],
  },
  {
    id: 'gh-ces2026',
    section: 'github',
    label: 'GitHub District \u2014 CES2026',
    sign: ['GitHub District', 'CES2026'],
    accent: 'amber',
    title: { text: 'CES2026' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'G3', link: { href: 'https://github.com/danielmoon0410/CES2026' } },
      ] },
    ],
  },
  {
    id: 'gh-echonomics',
    section: 'github',
    label: 'GitHub District \u2014 zlnnny/CES_Project',
    sign: ['GitHub District', 'zlnnny/CES_Project'],
    accent: 'violet',
    title: { text: 'zlnnny/CES_Project' },
    blocks: [
      { kind: 'lines', items: [
        { id: 'G6' },
        { id: 'E2', split: true, link: { href: 'https://github.com/zlnnny/CES_Project.git' } },
      ] },
    ],
  },
  {
    id: 'career',
    section: 'career',
    label: 'Career \u2014 HBM Tower',
    sign: ['Career', 'HBM Tower'],
    accent: 'violet',
    title: { section: true },
    blocks: [
      { kind: 'timeline' },
      { kind: 'lines', items: [
        { id: 'K8' },
        { id: 'K9' },
        { id: 'K10' },
        { id: 'K11' },
      ] },
    ],
  },
  {
    id: 'contact',
    section: 'contact',
    label: CONTACT_TITLE,
    sign: [CONTACT_TITLE],
    accent: 'trace',
    title: { section: true },
    blocks: [
      { kind: 'lines', items: [
        { id: 'C1', link: { href: 'https://github.com/danielmoon0410' } },
        { id: 'C2', link: { href: 'mailto:daniel.moon0410@gmail.com', text: 'daniel.moon0410@gmail.com' } },
        { id: 'C3', link: { href: 'mailto:daniel.moon0410@snu.ac.kr', text: 'daniel.moon0410@snu.ac.kr' } },
        { id: 'C4', link: { href: 'https://www.linkedin.com/in/daniel-moon-35948b269' } },
        { id: 'C5', link: { href: 'https://www.instagram.com/__danielmoon__/' } },
        { id: 'C6', link: { href: 'https://www.facebook.com/daniel.moon.33449' } },
      ] },
      { kind: 'cv' },
    ],
  },
];

export const CAREER = {
  entries: [
    { id: 'K2', sort: 200700 },
    { id: 'K1', sort: 202003 },
    { id: 'K7', sort: 202109 },
    { id: 'K6', sort: 202407 },
    { id: 'K5', sort: 202412 },
    { id: 'K4', sort: 202507 },
    { id: 'K3', sort: 202512 },
    { id: 'K14', sort: 202605 },
  ],
  highlights: [
    { id: 'K12', parent: 'K5' },
    { id: 'K13', parent: 'K6' },
  ],
  extra: ['K8', 'K9', 'K10', 'K11'],
};

export const PIPELINE = {
  stages: [
    { name: 'Planner', model: 'Claude Opus' },
    { name: 'Coder', model: 'Claude Sonnet' },
    { name: 'Tester', model: 'Claude Sonnet' },
    { name: 'Reviewer', model: 'Claude Opus' },
  ],
  handoffs: ['spec.md', 'changes.md', 'test-results.md', 'review.md'],
  gate: FACTS.W9.slice(0, FACTS.W9.indexOf(': ')),
};

export const TICKER_LINES = (FACTS.E7.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1));

export const ROBOT_LABELS = ['Planner', 'Coder', 'Tester', 'Reviewer'];