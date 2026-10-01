# danielmoon0410.github.io

Daniel Moon's playable 3D portfolio. Drive around a bright tech-campus world to explore his projects, AI workflow, GitHub repositories and career.

**Live:** https://danielmoon0410.github.io/

## Controls
- **W A S D / arrow keys:** drive. **Space** brakes; **S** also brakes while moving forward.
- **R:** back to the start.
- **E / Enter** at a glowing pad: open that station.
- **M:** minimap. **B:** music on/off.
- **Skip to projects:** a plain 2D view with the same content.

## How it is built
- three.js and cannon-es as native ES modules from jsDelivr, with no build step.
- Built by a four-agent Claude Code pipeline: Planner (Claude Opus) → Coder (Claude Sonnet) → Tester (Claude Sonnet) → Reviewer (Claude Opus). Daniel is the final gate.
- Every change passes its in-browser self-test before it ships. The full test suite and the Reviewer check it right after, and their findings become the next run's work.

## Credits
- Inspired by Bruno Simon's playable portfolio (bruno-simon.com).
- Pipeline pattern adapted from Ray Fu, "How to Build a 4-Agent Dev Team That Ships Features While You Sleep".
