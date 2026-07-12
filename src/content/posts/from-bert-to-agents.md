---
title: "From BERT to agents: scaling document AI to 400K+ documents"
description: "The architecture decisions that took us from one extraction model to a multi-model platform, and what broke along the way."
date: 2026-06-12
category: systems
tags: ["systems", "document-ai", "agents"]
draft: false
---

Production document AI starts as a model problem and quickly becomes a systems problem. The first useful classifier or extractor is only one component in a much larger workflow that has to move files, normalize inputs, manage confidence, route exceptions, and preserve an audit trail.

The BERT-era approach gave us a strong foundation because it forced the team to care about labels, sampling, and measurable extraction quality. It also exposed the limits of a single-model mindset. Documents vary too much by carrier, template, line of business, and downstream workflow for one technique to stay dominant forever.

The durable pattern was to make the pipeline multi-stage and multi-model. Cheaper deterministic steps handled normalization and obvious validation. Transformer models handled language-heavy extraction. Rules stayed close to compliance and business invariants. Human review stayed in the loop where confidence, cost, or regulatory impact demanded it.

That structure made it possible to process 400K+ documents without treating every page as a bespoke machine learning problem. It also created a better path toward agents: once each stage has clear inputs, outputs, and verification boundaries, autonomous workflow components have something stable to operate inside.

The hard part was not deciding whether to use better models. The hard part was building the surrounding system so better models could be swapped in without rewriting the whole operation.
