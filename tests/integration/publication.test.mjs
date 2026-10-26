import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, contentRoutes, createContentBuild, dist as buildDirectory, escapeAttribute, escapeHtml, homeSectionSize, homeSections, labFixture, listFiles, listPageRoutes, publishedContent, readContentInventory, root as repositoryRoot, sitemapPaths, withContentBuild } from "../shared/node-helpers.mjs";

// Build each publication fixture once. Check routes and rendered pages against the same independent inventory.

function assertContentBuild(buildDirectory, sourceInventory) {
  // A published scene folder holds the model's own files. It is not an Astro page and not a site route.
  const builtRoutes = listPageRoutes(buildDirectory);
  const sitemapRoutes = sitemapPaths(buildDirectory);
  const expectedRoutes = ["/", ...contentRoutes(sourceInventory)].sort();
  assert.deepEqual(builtRoutes, expectedRoutes, "build routes must match published content");
  assert.deepEqual(sitemapRoutes, expectedRoutes, "sitemap routes must match published content");
  assert.equal(existsSync(join(buildDirectory, "about")), false, "the retired About route must not build");
  const homepageHtml = readFileSync(join(buildDirectory, "index.html"), "utf8");
  for (const [section, entries] of Object.entries(sourceInventory)) {
    const publishedEntries = entries.filter((entry) => !entry.data.draft);
    assert.equal(existsSync(join(buildDirectory, section, "index.html")), publishedEntries.length > 0, `${section} index must follow visibility`);
    assert.equal(homepageHtml.includes(`href="/${section}/"`), publishedEntries.length > 0, `${section} homepage links must follow visibility`);
    for (const entry of entries.filter((entry) => entry.data.draft)) {
      assert.equal(existsSync(join(buildDirectory, section, entry.id)), false, `${entry.id} draft route must be absent`);
      assert.ok(!sitemapRoutes.includes(entry.href), `${entry.id} draft must stay out of the sitemap`);
      assert.ok(!homepageHtml.includes(`href="${entry.href}"`), `${entry.id} draft link must stay off the homepage`);
    }
  }
}

// Read the link addresses inside the first element that matches a start tag and ends at the closing tag.
function linkAddresses(markup) {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(([, linkAddress]) => linkAddress);
}

function assertHomepagePublication(pageHtml, sourceInventory) {
  assert.doesNotMatch(pageHtml, /href="#"/);
  const expectedSections = homeSections(sourceInventory);
  const renderedSections = [...pageHtml.matchAll(/<section class="home-section[^"]*"[^>]*aria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.deepEqual(renderedSections.map(([, headingId]) => headingId), expectedSections.map((homeSection) => homeSection.headingId),
    "the homepage must render the published sections in page order");
  assert.equal((pageHtml.match(/<h2\b/g) ?? []).length, expectedSections.length, "the homepage must have one heading for each section");
  for (const [sectionIndex, expectedSection] of expectedSections.entries()) {
    const sectionHtml = renderedSections[sectionIndex][2];
    assert.match(sectionHtml, new RegExp(`<h2 class="home-section__label" id="${expectedSection.headingId}">${expectedSection.label}</h2>`));
    const rowTags = [...sectionHtml.matchAll(/<a class="entry-row[^"]*"[^>]*>/g)].map(([rowTag]) => rowTag);
    assert.ok(rowTags.length <= homeSectionSize, `${expectedSection.section} must show at most ${homeSectionSize} rows`);
    assert.deepEqual(rowTags.map((rowTag) => rowTag.match(/href="([^"]+)"/)[1]), expectedSection.rows.map((entry) => entry.href),
      expectedSection.section === "principles" ? "principles must show the featured principles in page order" : `${expectedSection.section} must show its newest entries, newest first`);
    for (const [rowIndex, entry] of expectedSection.rows.entries()) {
      assert.ok(rowTags[rowIndex].includes(`data-morph-key="${expectedSection.section}/${entry.id}"`), `${entry.id} row must carry its transition key`);
    }
    assert.deepEqual([...sectionHtml.matchAll(/<span class="entry-row__title">([^<]*)<\/span>/g)].map(([, rowTitle]) => rowTitle),
      expectedSection.rows.map((entry) => escapeHtml(entry.data.title)), `${expectedSection.section} rows must show their titles`);
    const allLinks = [...sectionHtml.matchAll(/<a class="home-section__all" href="([^"]+)">([^<]*)<\/a>/g)];
    assert.deepEqual(allLinks.map(([, allHref, allLabel]) => [allHref, allLabel]), [[expectedSection.allHref, expectedSection.allLabel]],
      `${expectedSection.section} must end with one link to its index`);
    // A published entry that is not among the newest must not reach the homepage.
    for (const olderEntry of sourceInventory[expectedSection.section].filter((entry) => !entry.data.draft && !expectedSection.rows.includes(entry))) {
      assert.ok(!sectionHtml.includes(`href="${olderEntry.href}"`), `${olderEntry.id} is older than the newest ${homeSectionSize} and must stay off the homepage`);
    }
  }
  for (const homeSection of [{ section: "principles", allHref: "/principles/" }, { section: "products", allHref: "/products/" }, { section: "writing", allHref: "/writing/" }]) {
    if (!expectedSections.some((expectedSection) => expectedSection.section === homeSection.section)) {
      assert.ok(!pageHtml.includes(`href="${homeSection.allHref}"`), `${homeSection.section} must not link to an absent index`);
    }
  }
}

// Check what every detail page of the kind shares: the kind, the star back to its parent, and the indexing state.
function assertDetailFrame(pageHtml, { kind, parentHref, parentLabel, label }) {
  assertPageBasics(pageHtml);
  assert.match(pageHtml, new RegExp(`<html\\b[^>]*data-page="${kind}"`), `${label} must name its kind in data-page`);
  assert.match(pageHtml, new RegExp(`<a class="reading-star__link" href="${parentHref}">[\\s\\S]*?<span class="reading-star__label">${parentLabel}</span>`), `${label} star must lead to ${parentLabel}`);
  assert.doesNotMatch(pageHtml, /name="robots" content="noindex|class="detail__draft"|class="entry-row__draft"/, `${label} must carry no draft marks`);
}

// The links in the principle rows of an article or an experiment page.
function principleRowAddresses(pageHtml, headingId) {
  return linkAddresses(pageHtml.match(new RegExp(`<section class="detail__section" aria-labelledby="${headingId}">([\\s\\S]*?)</section>`))?.[1] ?? "");
}

// The published principles that a piece names, in page order. A draft principle stays off a published page.
function expectedPrincipleAddresses(piece, sourceInventory) {
  return (publishedContent(sourceInventory).principles ?? []).filter((principle) => piece.data.principles.includes(principle.id)).map((principle) => principle.href);
}

// Check the principles page: the published principles in page order under their groups, each with its statement,
// its star link, and the published articles and experiments that name it.
function assertPrinciplesPublication(buildDirectory, sourceInventory) {
  const { principles, writing = [], lab = [] } = publishedContent(sourceInventory);
  const pageHtml = readFileSync(join(buildDirectory, "principles", "index.html"), "utf8");
  assertDetailFrame(pageHtml, { kind: "principles", parentHref: "/", parentLabel: "Home", label: "Principles page" });
  assert.doesNotMatch(pageHtml, /class="principle__draft"/, "the principles page must carry no draft marks");
  assert.deepEqual([...pageHtml.matchAll(/<div class="principle" id="([^"]+)">/g)].map(([, principleId]) => principleId), principles.map((principle) => principle.id),
    "the principles page must list the published principles in page order");
  assert.deepEqual([...pageHtml.matchAll(/<h2 class="principle-group__label" id="principle-group-([^"]+)">/g)].map(([, groupId]) => groupId), [...new Set(principles.map((principle) => principle.data.group))],
    "the principles page must show each group that holds a published principle, in page order");
  const newestUpdate = new Date(Math.max(...principles.map((principle) => principle.data.updated.getTime())));
  assert.ok(pageHtml.includes(`<time datetime="${newestUpdate.toISOString().slice(0, 10)}">`), "the principles page must show the day of its newest published change");
  // Each principle runs from its start tag to the start of the next one.
  const principleBlocks = pageHtml.split(/(?=<div class="principle" id=")/).slice(1);
  for (const [principleIndex, principle] of principles.entries()) {
    const principleHtml = principleBlocks[principleIndex];
    assert.ok(principleHtml.includes(`<span class="principle__text">${escapeHtml(principle.data.title)}</span>`), `${principle.id} must show its statement`);
    assert.ok(principleHtml.includes(`<a class="principle__star" href="#${principle.id}" aria-label="Link to this principle: ${escapeAttribute(principle.data.title)}">`), `${principle.id} star must link to the principle`);
    const reasonText = principleHtml.match(/<div class="principle__reason prose">([\s\S]*?)<\/div>/)?.[1].replace(/<[^>]+>/g, "").trim() ?? "";
    assert.ok(reasonText.length > 0, `${principle.id} must show its reason`);
    const explorations = [...writing, ...lab].filter((piece) => piece.data.principles.includes(principle.id)).map((piece) => piece.href);
    assert.deepEqual(linkAddresses(principleHtml.match(/<p class="principle__explored">([\s\S]*?)<\/p>/)?.[1] ?? ""), explorations,
      `${principle.id} must list the published articles, then the published experiments, that name it`);
  }
}

function assertPublishedPages(buildDirectory, sourceInventory) {
  const readBuiltPage = (...segments) => readFileSync(join(buildDirectory, ...segments), "utf8");
  const publishedEntries = publishedContent(sourceInventory);
  assertHomepagePublication(readBuiltPage("index.html"), sourceInventory);
  if (publishedEntries.principles?.length) assertPrinciplesPublication(buildDirectory, sourceInventory);
  for (const [section, entries] of Object.entries(publishedEntries)) {
    // The Lab pages have their own frame and checks in assertLabPublication. The principles share one page.
    if (!entries.length || section === "lab" || section === "principles") continue;
    const sectionIndexHtml = readBuiltPage(section, "index.html");
    assertDetailFrame(sectionIndexHtml, { kind: section, parentHref: "/", parentLabel: "Home", label: `${section} index` });
    assert.deepEqual(linkAddresses(sectionIndexHtml.match(/<div class="detail__body">([\s\S]*)<\/div>/)[1]), entries.map((entry) => entry.href),
      `${section} list must follow its content order`);
    for (const draftEntry of sourceInventory[section].filter((entry) => entry.data.draft)) {
      assert.ok(!sectionIndexHtml.includes(`href="${draftEntry.href}"`), `${draftEntry.id} draft must stay out of the index`);
    }
    if (section === "writing") {
      // The index groups articles under year headings, newest year first.
      const expectedYears = [...new Set(entries.map((entry) => entry.data.date.getUTCFullYear()))];
      assert.deepEqual([...sectionIndexHtml.matchAll(/<h2 class="detail__section-label" id="writing-\d+">(\d+)<\/h2>/g)].map(([, year]) => Number(year)), expectedYears);
    }
    for (const [entryIndex, entry] of entries.entries()) {
      const pageHtml = readBuiltPage(section, entry.id, "index.html");
      const detailKind = section === "writing" ? "article" : "product";
      assertDetailFrame(pageHtml, { kind: detailKind, parentHref: `/${section}/`, parentLabel: section === "writing" ? "Writing" : "Products", label: entry.id });
      assert.ok(pageHtml.includes(`data-morph-key="${section}/${entry.id}"`), `${entry.id} must carry the transition key of its row`);
      assert.ok(pageHtml.includes(`data-morph-title>${escapeHtml(entry.data.title)}</h1>`), `${entry.id} must show its title`);
      assert.ok(pageHtml.includes(`name="description" content="${escapeAttribute(entry.data.description)}"`), `${entry.id} must keep its description`);
      assert.ok(pageHtml.includes(`<p class="detail__lede">${escapeHtml(entry.data.description)}</p>`), `${entry.id} must show its description as the lede`);
      assert.ok(pageHtml.includes(`rel="canonical" href="https://cristianvega.ai${entry.href}"`), `${entry.id} must keep its canonical URL`);
      if (section === "writing") {
        assert.ok(pageHtml.includes(`property="article:published_time" content="${entry.data.date.toISOString()}"`));
        assert.match(pageHtml, /<div class="article__share">/, `${entry.id} must offer sharing`);
        assert.ok(pageHtml.includes(`data-copy-link="https://cristianvega.ai${entry.href}" hidden`));
        const shareAnchors = [...pageHtml.matchAll(/<a\b[^>]*aria-label="(Share on [^"]+)"[^>]*>/g)];
        assert.deepEqual(shareAnchors.map(([, shareName]) => shareName), ["Share on LinkedIn", "Share on X"]);
        for (const [shareTag] of shareAnchors) assert.match(shareTag, /rel="noopener noreferrer"/);
        // The star reads "More writing" newest first: the newer neighbour, then the older one.
        const moreWritingHtml = pageHtml.match(/<nav class="detail__section" aria-labelledby="more-writing">([\s\S]*?)<\/nav>/)?.[1] ?? "";
        assert.deepEqual(linkAddresses(moreWritingHtml), [entries[entryIndex - 1]?.href, entries[entryIndex + 1]?.href].filter(Boolean),
          `${entry.id} must link its newer and older neighbours`);
        assert.deepEqual(principleRowAddresses(pageHtml, "article-principles"), expectedPrincipleAddresses(entry, sourceInventory),
          `${entry.id} must list the published principles it names, in page order`);
      } else {
        assert.ok(pageHtml.includes(`<p class="detail__meta">${escapeHtml(entry.data.status)}</p>`), `${entry.id} must show its status or Product`);
        const outboundLink = pageHtml.match(/<a class="product__link"[^>]*target="_blank"[^>]*>/)?.[0];
        if (entry.data.url) {
          assert.ok(outboundLink?.includes(`href="${escapeAttribute(entry.data.url)}"`));
          assert.match(outboundLink, /rel="noopener noreferrer"/);
        } else assert.equal(outboundLink, undefined, `${entry.id} must omit an absent outbound address`);
      }
    }
  }
}

// Read one attribute from a start tag, or undefined when the tag has none.
function attributeOf(startTag, attributeName) {
  return startTag.match(new RegExp(`\\s${attributeName}="([^"]*)"`))?.[1];
}

function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|amp|lt|gt|quot);/g, (entity, codePoint) => codePoint ? String.fromCodePoint(Number(codePoint)) : ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' })[entity]);
}

// The Lab media folders of an experiment, in the source and in the build.
const labMediaFolders = [["clips", "media/{id}/clips"], ["posters", "media/{id}/posters"], ["scenes", "scenes/{id}"]];

// Check a build that holds no published Lab experiment. A draft must leave no trace in dist/, even with its media at hand.
function assertNoLabInBuild(buildDirectory) {
  assert.equal(existsSync(join(buildDirectory, "lab")), false, "a build with no published experiment must leave no dist/lab folder");
  assert.deepEqual(listFiles(buildDirectory).filter((builtPath) => /\.(?:mp4|webp)$/.test(builtPath)), [], "a build with no published experiment must hold no Lab clip or poster");
  const homepageHtml = readFileSync(join(buildDirectory, "index.html"), "utf8");
  assert.doesNotMatch(homepageHtml, /lab-label|data-preview-|href="\/lab\//, "the homepage must not mention an unpublished Lab");
  assert.doesNotMatch(readFileSync(join(buildDirectory, "sitemap-0.xml"), "utf8"), /\/lab\//, "the sitemap must not list an unpublished Lab");
}

// Check the Lab pages and media of every published experiment against the source inventory and the media source folders.
function assertLabPublication(buildDirectory, sourceInventory) {
  const readBuiltPage = (...segments) => readFileSync(join(buildDirectory, ...segments), "utf8");
  const experiments = publishedContent(sourceInventory).lab;
  assert.ok(experiments.length > 0, "the Lab check needs a published experiment");
  const homepageHtml = readBuiltPage("index.html");
  const labSectionHtml = homepageHtml.match(/<section class="home-section[^"]*"[^>]*aria-labelledby="lab-label"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(labSectionHtml, "the homepage must hold the Lab section");
  const sectionOrder = [...homepageHtml.matchAll(/<section class="home-section[^"]*"[^>]*aria-labelledby="([^"]+)"/g)].map(([, headingId]) => headingId);
  assert.ok(sectionOrder.indexOf("products-label") < sectionOrder.indexOf("lab-label") && sectionOrder.indexOf("lab-label") < sectionOrder.indexOf("writing-label"),
    `the Lab section must sit between Products and Writing: ${sectionOrder.join(", ")}`);
  const labRows = [...labSectionHtml.matchAll(/<a class="entry-row[^"]*"[^>]*>/g)].map(([rowTag]) => rowTag);
  assert.deepEqual(labRows.map((rowTag) => attributeOf(rowTag, "href")), experiments.map((experiment) => experiment.href), "the Lab section must list the experiments, newest first");

  const labIndexHtml = readBuiltPage("lab", "index.html");
  assertDetailFrame(labIndexHtml, { kind: "lab", parentHref: "/", parentLabel: "Home", label: "Lab index" });
  const cards = [...labIndexHtml.matchAll(/<li(?: class="([^"]*)")?><a class="lab-card"[^>]*>([\s\S]*?)<\/a><\/li>/g)];
  assert.equal(cards.length, experiments.length, "the Lab index must show one card for each experiment");
  assert.ok(labIndexHtml.includes("data-clip-pause"), "the Lab index must offer the pause control");

  for (const [experimentIndex, experiment] of experiments.entries()) {
    const { id, data } = experiment;
    const isGroup = data.results.length > 1;
    const singleOrFirst = data.results[0];
    // Compare the card, the homepage row, and the preview attributes with the experiment.
    const [, cardClasses, cardHtml] = cards[experimentIndex];
    const cardTag = labIndexHtml.match(new RegExp(`<a class="lab-card"[^>]*href="${experiment.href}"[^>]*>`))?.[0];
    assert.ok(cardTag, `${id} card must link to its experiment page`);
    assert.equal(attributeOf(cardTag, "data-morph-key"), `lab/${id}`, `${id} card must carry its transition key`);
    assert.equal((cardClasses ?? "").includes("lab-index__group"), isGroup, `${id} card must follow its group state`);
    assert.ok(cardHtml.includes(`<span class="lab-card__title">${escapeHtml(data.title)}</span>`), `${id} card must show its title`);
    assert.ok(cardHtml.includes(`<span class="lab-card__meta">${isGroup ? `${data.results.length} models` : escapeHtml(singleOrFirst.name)}</span>`), `${id} card must show its model count or model name`);
    assert.doesNotMatch(cardHtml, /lab-card__draft/, `${id} card must carry no draft mark`);
    const clipName = isGroup ? "mosaic" : singleOrFirst.slug;
    const mediaAddress = `/lab/media/${id}`;
    for (const markup of [cardHtml, labRows[experimentIndex]]) {
      assert.ok(markup.includes(`${mediaAddress}/posters/${clipName}.webp`), `${id}: the poster of ${clipName} must be addressed`);
    }
    assert.ok(cardHtml.includes(`src="${mediaAddress}/clips/${clipName}.av1.mp4"`) && cardHtml.includes(`src="${mediaAddress}/clips/${clipName}.h264.mp4"`), `${id} card clip must offer AV1 and H.264`);
    assert.ok(cardHtml.indexOf(".av1.mp4") < cardHtml.indexOf(".h264.mp4"), `${id} card clip must list AV1 first`);
    assert.equal(attributeOf(labRows[experimentIndex], "data-preview-av1"), `${mediaAddress}/clips/${clipName}.av1.mp4`);
    assert.equal(attributeOf(labRows[experimentIndex], "data-preview-h264"), `${mediaAddress}/clips/${clipName}.h264.mp4`);
    assert.equal(attributeOf(labRows[experimentIndex], "data-preview-poster"), `${mediaAddress}/posters/${clipName}.webp`);

    // Compare the media of the build with the media source, file by file.
    const mediaSource = join(repositoryRoot, "assets", "lab", id);
    for (const [sourceFolder, builtFolder] of labMediaFolders) {
      const builtFiles = listFiles(join(buildDirectory, "lab", builtFolder.replace("{id}", id)));
      assert.ok(builtFiles.length > 0, `${id}: the build must hold ${sourceFolder}`);
      assert.deepEqual(builtFiles, listFiles(join(mediaSource, sourceFolder)), `${id}: the build must copy every ${sourceFolder} file and nothing else`);
    }
    for (const result of data.results) {
      for (const mediaPath of [`clips/${result.slug}.av1.mp4`, `clips/${result.slug}.h264.mp4`, `posters/${result.slug}.webp`]) {
        assert.ok(statSync(join(buildDirectory, "lab", "media", id, mediaPath)).size > 1_000, `${id}: ${mediaPath} must hold media data`);
      }
      assert.ok(statSync(join(buildDirectory, "lab", "scenes", id, result.slug, "index.html")).size > 100, `${id}: the ${result.slug} scene must have an entry page`);
    }

    // The experiment page.
    const experimentHtml = readBuiltPage("lab", id, "index.html");
    assertDetailFrame(experimentHtml, { kind: "experiment", parentHref: "/lab/", parentLabel: "Lab", label: id });
    assert.ok(experimentHtml.includes(`data-morph-title>${escapeHtml(data.title)}</h1>`), `${id} must show its title`);
    assert.ok(experimentHtml.includes(`<p class="detail__lede">${escapeHtml(data.description)}</p>`), `${id} must show its description as the lede`);
    // The article comes first, then the prompt, then the results.
    const sectionOffsets = ['<div class="prose">', '<section class="prompt-block"', '<section class="results"'].map((marker) => experimentHtml.indexOf(marker));
    assert.ok(sectionOffsets.every((offset) => offset > 0) && sectionOffsets[0] < sectionOffsets[1] && sectionOffsets[1] < sectionOffsets[2], `${id} must show its article, its prompt, then its results: ${sectionOffsets}`);
    if (experiment.body.trim()) assert.ok(experimentHtml.slice(sectionOffsets[0], sectionOffsets[1]).replace(/<[^>]+>/g, "").trim().length > 0, `${id} must render its article`);
    const promptText = decodeEntities(experimentHtml.match(/<p class="prompt-block__text">([\s\S]*?)<\/p>/)?.[1] ?? "");
    assert.equal(promptText, data.prompt.trim(), `${id} must show its prompt exactly`);
    assert.match(experimentHtml, new RegExp(`<h2 class="detail__section-label" id="results-label">${isGroup ? "Results" : "Result"}</h2>`));
    assert.ok(experimentHtml.includes("data-clip-pause"), `${id} must offer the pause control`);
    const tiles = [...experimentHtml.matchAll(/<a class="result-tile"[^>]*>([\s\S]*?)<\/a>/g)];
    assert.deepEqual(tiles.map(([tile]) => attributeOf(tile, "href")), data.results.map((result) => `${experiment.href}${result.slug}/`), `${id} tiles must follow the result order`);
    for (const [resultIndex, result] of data.results.entries()) {
      const [tile, tileHtml] = tiles[resultIndex];
      assert.equal(attributeOf(tile, "data-stage-key"), result.slug, `${result.slug} tile must carry its stage key`);
      assert.ok(tileHtml.includes("data-stage-media"), `${result.slug} tile must mark its media for the page transition`);
      assert.ok(tileHtml.includes(`<span class="result-tile__name">${escapeHtml(result.name)}</span>`), `${result.slug} tile must show its model name`);
      assert.equal(tileHtml.includes("result-tile__effort"), Boolean(result.effort), `${result.slug} tile must show an effort only when the result has one`);
      if (result.effort) assert.ok(tileHtml.includes(`<span class="result-tile__effort">${escapeHtml(result.effort)}</span>`));
      const clipTag = tileHtml.match(/<video\b[^>]*>/)?.[0] ?? "";
      for (const clipAttribute of ["data-clip", "muted", "loop", "playsinline", 'preload="auto"', 'aria-hidden="true"']) assert.ok(clipTag.includes(clipAttribute), `${result.slug} clip must set ${clipAttribute}`);
      assert.ok(tileHtml.includes(`${mediaAddress}/clips/${result.slug}.av1.mp4`) && tileHtml.indexOf(".av1.mp4") < tileHtml.indexOf(".h264.mp4"), `${result.slug} clip must list AV1 before H.264`);
    }
    if (data.note) assert.ok(experimentHtml.includes(`<p class="results__note">${escapeHtml(data.note)} Select a result to run it live.</p>`), `${id} must show its note`);
    assert.deepEqual(principleRowAddresses(experimentHtml, "experiment-principles"), expectedPrincipleAddresses(experiment, sourceInventory),
      `${id} must list the published principles it names, in page order`);

    // The scene page of each result.
    for (const [resultIndex, result] of data.results.entries()) {
      const sceneHtml = readBuiltPage("lab", id, result.slug, "index.html");
      assert.match(sceneHtml, new RegExp(`<html\\b[^>]*data-page="scene"[^>]*data-stage-key="${result.slug}"`), `${result.slug} scene page must name its kind and stage key`);
      assert.doesNotMatch(sceneHtml, /name="robots" content="noindex/, `${result.slug} scene page must stay indexable`);
      assert.equal((sceneHtml.match(/<h1\b/g) ?? []).length, 1, `${result.slug} scene page must hold one primary heading`);
      assert.ok(sceneHtml.includes(`<span class="scene-bar__name">${escapeHtml(result.name)}</span>`), `${result.slug} scene bar must name the model`);
      const frameTag = sceneHtml.match(/<iframe\b[^>]*>/)?.[0] ?? "";
      assert.equal(attributeOf(frameTag, "src"), `/lab/scenes/${id}/${result.slug}/`, `${result.slug} frame must load its own scene folder`);
      assert.equal(attributeOf(frameTag, "sandbox"), "allow-scripts allow-pointer-lock allow-downloads", `${result.slug} frame must run sandboxed with no same-origin access`);
      assert.match(sceneHtml, new RegExp(`<img class="scene-stage__poster" src="${mediaAddress}/posters/${result.slug}.webp"`), `${result.slug} stage must hold its poster`);
      assert.match(sceneHtml, new RegExp(`<a class="scene-bar__back" href="${experiment.href}" data-scene-back>`), `${result.slug} bar must lead back to the experiment`);
      const stepTags = [...sceneHtml.matchAll(/<a class="scene-bar__step"[^>]*>/g)].map(([stepTag]) => stepTag);
      if (isGroup) {
        // The arrows wrap around the group.
        const previous = data.results[(resultIndex + data.results.length - 1) % data.results.length];
        const next = data.results[(resultIndex + 1) % data.results.length];
        assert.deepEqual(stepTags.map((stepTag) => [attributeOf(stepTag, "data-direction"), attributeOf(stepTag, "href")]),
          [["previous", `${experiment.href}${previous.slug}/`], ["next", `${experiment.href}${next.slug}/`]], `${result.slug} arrows must lead to its neighbours`);
        assert.ok(sceneHtml.includes(`<span class="scene-bar__position">${resultIndex + 1} of ${data.results.length}</span>`), `${result.slug} bar must show its position`);
      } else {
        assert.deepEqual(stepTags, [], `${result.slug}: a single piece must have no arrows`);
        assert.doesNotMatch(sceneHtml, /scene-bar__position/, `${result.slug}: a single piece must show no position`);
      }
    }
  }
}

function assertPublicationBuild(buildDirectory, sourceInventory) {
  assertContentBuild(buildDirectory, sourceInventory);
  assertPublishedPages(buildDirectory, sourceInventory);
  const hasPublishedLab = (sourceInventory.lab ?? []).some((experiment) => !experiment.data.draft);
  if (hasPublishedLab) assertLabPublication(buildDirectory, sourceInventory);
  else if (sourceInventory.lab) assertNoLabInBuild(buildDirectory);
}

test("the current production build excludes drafts and preserves published routes, content, and metadata", () => {
  assertPublicationBuild(buildDirectory, readContentInventory());
});

// The crowded fixture holds six published entries in each section, so the homepage must cut two of them.
for (const fixtureKind of ["all-draft", "mixed", "crowded"]) {
  test(`the ${fixtureKind} publication build preserves routes, content order, rendered content, and metadata`, { timeout: 90_000 }, async () => {
    await withContentBuild(fixtureKind, (fixture) => {
      assertPublicationBuild(fixture.dist, fixture.inventory);
      if (fixtureKind === "crowded") {
        for (const homeSection of homeSections(fixture.inventory)) {
          assert.equal(homeSection.rows.length, homeSectionSize, `${homeSection.section} must fill its section`);
          assert.ok(publishedContent(fixture.inventory)[homeSection.section].length > homeSectionSize, `${homeSection.section} must hold more entries than the section shows`);
        }
      }
    });
  });
}

// The Lab fixtures add the real experiment and link its media. The media is about 40 MB, so each build copies it once.
test("a published Lab experiment builds its pages, media, and scenes, and the Lab section sits between Products and Writing", { timeout: 90_000 }, async () => {
  await withContentBuild("mixed", (fixture) => {
    assert.equal(fixture.inventory.lab.length, 1, "the fixture must hold the one Lab experiment");
    assert.equal(fixture.inventory.lab[0].id, labFixture.experiment);
    assert.equal(fixture.inventory.lab[0].data.results.length, labFixture.resultCount, "the fixture experiment must hold every result");
    assertPublicationBuild(fixture.dist, fixture.inventory);
  }, { lab: { state: "published" } });
});

test("a draft Lab experiment leaves nothing in dist even when its media is available", { timeout: 90_000 }, async () => {
  await withContentBuild("mixed", (fixture) => {
    assert.equal(fixture.inventory.lab[0].data.draft, true, "the fixture experiment must be a draft");
    assert.ok(existsSync(join(fixture.root, "assets", "lab", labFixture.experiment, "clips")), "the media must be available to the build");
    assertPublicationBuild(fixture.dist, fixture.inventory);
    assertNoLabInBuild(fixture.dist);
  }, { lab: { state: "draft" } });
});

test("a published single piece has no arrows, shows its model name, and previews its own clip", { timeout: 90_000 }, async () => {
  await withContentBuild("mixed", (fixture) => {
    assert.equal(fixture.inventory.lab[0].data.results.length, 1);
    assertPublicationBuild(fixture.dist, fixture.inventory);
    const experimentHtml = readFileSync(join(fixture.dist, "lab", labFixture.experiment, "index.html"), "utf8");
    assert.match(experimentHtml, /results__grid results__grid--single/, "a single piece must use the single-tile grid");
    assert.doesNotMatch(experimentHtml, /lab-index__group/);
  }, { lab: { state: "published", resultIndexes: [0] } });
});

// The build stops, so the experiment cannot take a path that the media or the scenes use.
for (const [conditionName, lab, expectedMessage] of [
  ["a reserved media slug", { state: "published", id: "media" }, /"media" takes a reserved path/],
  ["a reserved scenes slug", { state: "published", id: "scenes" }, /"scenes" takes a reserved path/],
  ["a repeated result slug", { state: "published", resultIndexes: [0, 0] }, /repeats a result slug/],
]) {
  test(`the build stops for ${conditionName}`, { timeout: 90_000 }, async () => {
    await assert.rejects(createContentBuild("mixed", { lab }), (error) => {
      assert.match(`${error.stdout}${error.stderr}${error.message}`, expectedMessage);
      return true;
    });
  });
}
