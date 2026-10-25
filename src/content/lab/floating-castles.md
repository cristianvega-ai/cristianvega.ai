---
title: "Eight models, one prompt: which AI builds the best 3D world?"
label: "Floating castles"
description: "Sonnet 5.5 built the most complete world, Opus 5.5 the most cinematic one, and Haiku 5.5 wrote its own renderer for $1.45."
date: "2026-10-23"
draft: true
prompt: |
  # Task
  Create a visual of a castle on a floating rock in the sky, with waterfalls falling onto the ground from the rock platform. The castle is surrounded by rich greenery and trees, and there are birds that fly around the clouds. Make this awe-inspiring and a testament to what AI can build. Push your capabilities. The style should be 3D voxels. Use shaders and other techniques to make this look realistic and alive. This folder is your workspace. Do not store any source files anywhere else. You are free to use your abilities to do research and pull down dependencies to accomplish this task. The end result should be in a subfolder called output.
note: "Each world is the model's own real-time WebGL app, captured frame by frame, with the same camera moves in every clip."
results:
  - name: "Sonnet 5.5"
    slug: sonnet-5-5
    effort: xHigh
  - name: "Opus 5.5"
    slug: opus-5-5
    effort: xHigh
  - name: "GPT-6 Astra"
    slug: gpt-6-astra
    effort: xHigh
  - name: "Kimi K3.1 Pro"
    slug: kimi-k3-1-pro
    effort: Max
  - name: "Haiku 5.5"
    slug: haiku-5-5
    effort: xHigh
  - name: "GPT-6.1 Sol"
    slug: gpt-6-1-sol
    effort: xHigh
  - name: "DeepSeek v4.1 Flash 1017"
    slug: deepseek-v4-1-flash-1017
    effort: high
  - name: "Muse Wonder Full"
    slug: muse-wonder-full
    effort: xHigh
---

I can afford to run every frontier model on the same task. Most people can't, so this is what I learned.

I gave eight models the same one-paragraph prompt, which is at the end of this post: build a floating voxel castle in real-time 3D, with waterfalls, trees, birds and clouds, and make it awe-inspiring. Each model got an empty folder, its usual agent, its highest effort setting and no help from me. Then I read every session log to see how each one actually worked. Every scene below runs live: select one to explore it.

## The verdict

| Rank | Model | Why |
| --- | --- | --- |
| Gold | Sonnet 5.5 | The most complete and polished world. It checked itself with 102 screenshots and needed no help. |
| Silver | Opus 5.5 | The most advanced rendering, in less time than Sonnet, but it shipped one loading bug. |
| Bronze | GPT-6 Astra | A polished scene, checked offline and on a phone, in 20 minutes. |

Two more picks, depending on what you need:

- **Best value: Haiku 5.5.** For $1.45 it wrote a ray-marching renderer from scratch, in one 1,060-line file. Its 4K still is the most photographic image of the eight. Its live view is grainy.
- **Fastest close match: Kimi K3.1 Pro.** In 19 minutes it built the scene that matches the prompt most closely, and it had a second agent review the work.

## At a glance

| Model | Agent and effort | Build time | Cost | How it checked itself |
| --- | --- | --- | --- | --- |
| Sonnet 5.5 | Claude Code, xHigh | 78 min | $22.69 | 102 screenshots |
| Opus 5.5 | Claude Code, xHigh | 57 min | $20.65 | 29 screenshots |
| GPT-6 Astra | Codex, xHigh | 20 min | Not reported | 15 scripted checks |
| Kimi K3.1 Pro | Kimi Code, Max | 19 min | Not reported | Test renders, 2 browser scripts, a review agent |
| Haiku 5.5 | Claude Code, xHigh | 20 min | $1.45 | About 15 test renders |
| GPT-6.1 Sol | Codex, xHigh | 21 min | Not reported | 8 scripted checks |
| DeepSeek v4.1 Flash 1017 | OpenCode, high | 98 min | Not reported | Headless screenshots |
| Muse Wonder Full | Unknown, xHigh | About 17 min | Not reported | At least one screenshot |

Costs are what Claude Code reported for each session, at standard API prices. Opus's figure includes the fix described below. Codex, Kimi Code and OpenCode report tokens but no dollar cost, so I left those blank instead of guessing.

Speed did not decide quality. Three of the top five finished in about 20 minutes. The two slowest builds went opposite ways: Sonnet's is the best of the eight, and DeepSeek's run went sideways.

## Gold: Sonnet 5.5

**How it worked.** Sonnet probed the browser's WebGL support first, then built a three.js project bundled with esbuild. Over 78 minutes it made 538 tool calls, and 102 of them were screenshots. It checked every time of day, close-ups, the underside of the island, a phone-width layout and its own camera tour. It hit real bugs and fixed each one:

- The island rendered as a black mass because its post-processing produced invalid numbers.
- One of its own patch scripts cut a source file short.
- A shader used a reserved word.

**What it built.** The broadest world of the eight:

- a castle with a drawbridge and a moat;
- a village with a windmill;
- a lake with a pier;
- a lighthouse and sailboats;
- four waterfalls that land in their own pools;
- eagles, butterflies and lanterns.

On top of that it added a cinematic tour, nine viewpoints, a day cycle, generated ambient sound, screenshot export and a phone layout.

**Gotchas.** It took the longest of the top three, produced the most output, 520,000 tokens, and cost the most: $22.69. Its birds weave between the clouds instead of circling them. It could not hear its own sound, and it never tested the page opened as a local file.

**Use it when** you want a finished, explorable piece and can give it an hour.

## Silver: Opus 5.5

**How it worked.** Opus spent 57 minutes and 205 tool calls. It built with three.js and Vite and packed everything into one 696 KB HTML file. Its rendering is physics first:

- A Rayleigh and Mie sky: the light-scattering model behind real skies.
- Soft shadows that widen with distance.
- Voxel clouds traced step by step through the grid, with their own shadows and light shafts.
- Waterfalls that follow real ballistic arcs, with a rainbow at 42 degrees.
- Birds that circle the clouds.

**What it built.** The most cinematic scene: a pale stone castle with blue spires, floating islets, drifting clouds and a valley far below. Keys 1 to 5 jump between dawn, midday, golden hour, sunset and night.

**Gotchas.** Its page loaded a Google Font, and the browser held the scene until that request finished, so the page sat on "Preparing". Opus's final message said the offline fallback worked. It did not. When I reported the stall, it reproduced it by blocking the font server and fixed it within minutes. The build cost $18.67, and $20.65 with the fix. It also used the most memory: about 240 MB of JavaScript heap, against 25 MB or less for every other scene. It has no sound and no export.

**Use it when** rendering quality matters most. Check its offline claims yourself.

## Bronze: GPT-6 Astra

**How it worked.** Astra finished in 19 minutes 50 seconds in Codex, using 49,000 output tokens. It built with three.js and Vite and packaged the result into one 682 KB file. It opened the three.js docs once and read the reflection and ambient-occlusion source code in its own dependencies. It also ran a security audit, found a high-severity issue in Vite and upgraded it. It wrote 15 checks to a verification file, including a run with the network off and a phone layout.

**What it built.** An elegant pastel scene: a castle with teal spires, four waterfalls into a lake with real reflections, soft shadows, bloom and film grain. It added three lighting presets, three camera viewpoints, generated sound and a 2560-pixel PNG export.

**Gotchas.** Its clouds are soft haze, not voxels, and its distant mountains read as flat pyramids. It left 82 MB of dependencies and build files inside the output folder.

**Use it when** you want a reliable, checked result fast.

## Kimi K3.1 Pro

**How it worked.** Kimi finished in 18 minutes 44 seconds, with 134 tool calls and 84,000 output tokens. It wrote a plan and kept a four-step to-do list. Then it loaded my own orchestration skill, unprompted, and ran a reviewer agent twice. The reviewer caught a waterfall hidden behind rock, and a second pass fixed it.

**What it built.** Five waterfalls that land in a lake on a voxel valley floor, the closest match to the prompt's "falling onto the ground". The lake reflects the castle. Wind moves the foliage, and 19 birds fly around blocky clouds. Everything runs offline.

**Gotchas.** The clouds are chunky and the sky is flat. To keep every download inside its folder, as the prompt asked, it installed the browsers it tested with into the output folder: 477 MB of Chromium next to a 601 KB app. The skill and the reviewer came from my setup, so another setup may not get the same help.

**Use it when** speed and fidelity to the prompt matter. Tell it where tools belong.

## Haiku 5.5

**How it worked.** Haiku finished in 19 minutes 37 seconds, for $1.45. It used no libraries. It wrote a WebGL renderer in one 1,060-line file that traces every pixel through a 320 by 200 by 320 voxel grid. The image builds up over successive frames, with volumetric clouds, soft sun shadows and depth of field. Haiku built its own render harness and worked through about 15 test frames. When its clouds failed four times, it rendered a debug view of the cloud density and found the cause, instead of guessing again.

**What it built.** The most photographic picture of the eight: a 3840 by 2160 still at 256 samples per pixel.

**Gotchas.** The castle is small in a sea of clouds, the birds are specks, and the clouds are not voxels. Live, the image is grainy, and it is the heaviest scene to run: 170 frames per second on my machine, at three-quarters resolution, the lowest of the eight. It shipped a 10 MB copy of the still next to the page.

**Use it when** you are on a budget or want a still image, not an interactive piece.

## GPT-6.1 Sol

**How it worked.** Sol finished in 21 minutes in Codex, with three.js and Vite, as one 1.88 MB file. It wrote a browser test suite with eight checks:

- offline loading;
- pause;
- the presets;
- sound;
- the orbit;
- PNG export;
- a phone layout;
- reduced motion.

**What it built.** The most consistently voxel world: blocky clouds, ridges, forest and floating islands, plus three waterfalls with ripples where they land. Its code is the most modular of the fast builds.

**Gotchas.**

- The ground is a flat field of repeated pines, and one waterfall stops short.
- It embedded its fonts in full, so the file is 1.88 MB.
- It left a 124 MB download cache inside the output folder, 206 MB of tooling in all.
- It left its development server running for four hours after it finished.

**Use it when** you want the voxel look. Clean up after it.

## DeepSeek v4.1 Flash 1017

**How it worked.** Two DeepSeek sessions ran in the same folder at the same time. Each one noticed the other rewriting its files, moved its own work into a subfolder and finished anyway. The run you see here took 98 minutes and 221 tool calls, at the high effort setting. That is the slowest build of the eight.

**What it built.** A warm sunset scene:

- a dense castle with a gatehouse, a portcullis and torches;
- two waterfalls into a lake;
- a loading screen, a capture button and an orbit toggle.

It runs offline from a local file.

**Gotchas.** It left 16 probe scripts and 35 MB of test renders in its workspace. And the overlapping sessions overwrote each other's work: never point two agents at one folder.

**Use it when** you can wait. Give it a folder of its own.

## Muse Wonder Full

**How it worked.** I could not find Muse's session log. The file times suggest about 17 minutes.

**What it built.** The most readable composition: a big, characterful castle with flags and glowing windows, and birds large enough to see, flapping and banking, with a rainbow over the falls. It is one 35 KB file.

**Gotchas.** It loads three.js from a CDN and needs a local web server, so it does not open offline. Its readme says the internet is needed "once", but nothing is cached. The look is stylised rather than realistic, and the valley ends in a hard horizon. For the live view here, I bundled three.js next to the scene.

**Use it when** you want a quick, charming prototype.

## Lessons for a small plan

1. **Ask for one offline file, in so many words:** no CDN, no web fonts, and it must open from a local file. Two models broke this: Opus with a font, Muse with a CDN.
2. **Tell the model where its tools go.** Kimi, Sol and Astra left 477 MB, 206 MB and 82 MB of tooling in their output folders.
3. **Ask it to check its own work.** Sonnet's screenshots and Astra's scripted checks caught bugs I never had to see.
4. **Do not judge by speed.** Astra and Kimi matched models that took three times as long.
5. **Give every agent its own folder.**
6. **Try the small model first.** Haiku's renderer cost $1.45, about a sixteenth of Sonnet's bill.

## How I ran it

Each model ran once on one prompt, so luck plays a part. The agents differ:

- Claude Code ran Sonnet, Opus and Haiku.
- Codex ran Astra and Sol.
- OpenCode ran DeepSeek, and Kimi Code ran Kimi.
- I could not trace Muse's agent.

Effort differs too: DeepSeek ran on high, Kimi on Max and the rest on xHigh. Times, tool calls and tokens come from the session logs. Token counts are rough across agents, because each one counts reasoning differently.

Dollar costs come from Claude Code's own session records at standard API prices. I checked them against the token counts in the logs, and they agree within 2%. On a subscription plan you pay a flat fee instead, but the ratios still show the relative weight of each model.

I measured the frame rates on one Apple M5 Max at 1080p with no frame cap. Every scene ran smoothly there. A smaller laptop will show the gaps sooner, and Haiku and Opus will feel it first.
